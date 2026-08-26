import {
  PLAUSIBLE_FLOOR,
  type MentionResult,
} from '../process-share-link/resolver/nameDrivenResolver.ts';
import { isGeographicContextOnly } from '../process-share-link/places/placeNormalization.ts';
import type { VenueMention } from './mediaMentions.ts';
import {
  candidatePoiCategory,
  semanticAutoSaveDecision,
  semanticCategoryCompatibility,
  type SemanticCompatibility,
} from '../../../lib/recognitionTruth.ts';

export const MEDIA_AUTO_SAVE_RULE_VERSION = 'media-autosave-2026-08-25.v8';

// Retained for configuration compatibility and diagnostics. The v7 decision
// does not apply this value as a second confirmation threshold: the resolver's
// existing PLAUSIBLE_FLOOR defines the minimum meaningful candidate score.
export const DEFAULT_MEDIA_AUTO_SAVE_THRESHOLD = 0.70;
export const MEDIA_AUTO_SAVE_MIN_SCORE = DEFAULT_MEDIA_AUTO_SAVE_THRESHOLD;

export type MediaAutoSaveThreshold = {
  value: number;
  valid: boolean;
  source: 'default' | 'environment';
};

export function resolveMediaAutoSaveThreshold(
  raw: string | null | undefined,
): MediaAutoSaveThreshold {
  const configured = raw?.trim();
  if (!configured) {
    return { value: DEFAULT_MEDIA_AUTO_SAVE_THRESHOLD, valid: true, source: 'default' };
  }
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return { value: DEFAULT_MEDIA_AUTO_SAVE_THRESHOLD, valid: false, source: 'environment' };
  }
  return { value: parsed, valid: true, source: 'environment' };
}

export type MediaAutoSaveGateInput = {
  mention: VenueMention;
  result: MentionResult;
  allResults: MentionResult[];
};

export type MediaAutoSaveGateDecision = {
  eligible: boolean;
  confidenceScore: number | null;
  ruleVersion: string;
  reasonCodes: string[];
  rawCandidateCount: number;
  plausibleCandidateCount: number;
  selectedProviderId: string | null;
  candidateRejectionReasons: string[];
  explicitConflictFlags: string[];
  semanticCompatibility: SemanticCompatibility;
  sceneCategory: string | null;
  candidateCategory: string | null;
  semanticOverrideApplied: boolean;
};

export function mediaAutoSaveAuthorized(args: {
  enabled: boolean;
  canaryUserId: string | null;
  userId: string;
}): boolean {
  if (!args.enabled) return false;
  return !args.canaryUserId || args.canaryUserId === args.userId;
}

function validCoordinates(candidate: any): boolean {
  return (
    Number.isFinite(candidate?.latitude) &&
    candidate.latitude >= -90 &&
    candidate.latitude <= 90 &&
    Number.isFinite(candidate?.longitude) &&
    candidate.longitude >= -180 &&
    candidate.longitude <= 180
  );
}

function validProviderIdentity(candidate: any): boolean {
  return !!candidate?.googlePlaceId &&
    !!candidate?.formattedAddress?.trim() &&
    validCoordinates(candidate);
}

function normalizedName(value: unknown): string {
  return typeof value === 'string'
    ? value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function nameTokens(value: unknown): string[] {
  return normalizedName(value).split(' ').filter((token) => token.length >= 2);
}

// These words describe a kind of place rather than its identifying brand or
// proper name. They are used only to reject obvious semantic mismatches; they
// never create a positive evidence requirement.
const PLACE_KIND_TOKENS = new Set([
  'bar', 'beach', 'bridge', 'brewery', 'cafe', 'cathedral', 'church', 'coffee',
  'cove', 'dental', 'distillery', 'falls', 'hotel', 'island', 'lake', 'loop', 'marina',
  'museum', 'park', 'peak', 'restaurant', 'resort', 'river', 'road', 'school',
  'spa', 'store', 'trail', 'waterfall',
]);

function hasLocationConflict(scoreReasons: Set<string>): boolean {
  return (
    scoreReasons.has('wrong_location_rejected') ||
    scoreReasons.has('distance_close') ||
    scoreReasons.has('distance_medium') ||
    scoreReasons.has('distance_far')
  );
}

function hasPlausibleIdentity(
  mention: VenueMention,
  candidate: any,
  scoreReasons: Set<string>,
): boolean {
  const strong =
    scoreReasons.has('compact_name_match') || scoreReasons.has('strong_name_match');
  const anyIdentity =
    strong ||
    scoreReasons.has('meaningful_name_match') ||
    scoreReasons.has('distinctive_token_match');
  if (!anyIdentity) return false;

  const mentionName = normalizedName(mention.displayName);
  const candidateName = normalizedName(candidate?.name);
  if (!mentionName || !candidateName) return false;

  // A broad one-token mention resolving to a longer entity merely containing
  // that token is not a plausible identity (for example, "Mangystau" resolving
  // to a museum). Exact one-word brands remain plausible.
  if (mention.distinctiveTokens.length === 1 && mentionName !== candidateName) {
    return false;
  }
  if (strong) return true;

  // For weaker name relationships, require a shared proper-name token. Shared
  // place-kind words alone ("Peak", "Bridge") cannot make an unrelated result
  // plausible. A directly conflicting kind ("Falls" versus "Dental") also
  // rejects the candidate. This is an unrelated-result filter, not a positive
  // taxonomy requirement.
  const mentionTokens = nameTokens(mention.displayName);
  const candidateTokens = new Set(nameTokens(candidate?.name));
  const sharedSpecific = mentionTokens.some(
    (token) => !PLACE_KIND_TOKENS.has(token) && candidateTokens.has(token),
  );
  if (!sharedSpecific) return false;

  const mentionKinds = mentionTokens.filter((token) => PLACE_KIND_TOKENS.has(token));
  const candidateKinds = new Set(
    [...candidateTokens].filter((token) => PLACE_KIND_TOKENS.has(token)),
  );
  if (
    mentionKinds.length > 0 &&
    candidateKinds.size > 0 &&
    !mentionKinds.some((token) => candidateKinds.has(token))
  ) {
    return false;
  }
  return true;
}

type PlausibleCandidate = {
  candidate: any;
  score: MentionResult['scoring'][number];
};

function assessCandidate(
  mention: VenueMention,
  result: MentionResult,
  candidate: any,
): { plausible: PlausibleCandidate | null; rejectionReasons: string[]; conflictFlags: string[] } {
  const rejectionReasons: string[] = [];
  const conflictFlags: string[] = [];
  const score = result.scoring.find(
    (entry) => entry.googlePlaceId === candidate?.googlePlaceId && !entry.rejected,
  );
  const scoreReasons = new Set(score?.reasons ?? []);

  if (!validProviderIdentity(candidate)) {
    rejectionReasons.push('provider_identity_invalid');
  }
  // Same semantic boundary as the metadata gate, through the same helper:
  // geographic context (city / county / country / postal code / bare geocode)
  // is never the destination. Type-driven, so a park or a business with a
  // geographic name stays eligible.
  if (isGeographicContextOnly(candidate)) {
    rejectionReasons.push('provider_entity_not_saveable');
  }
  if (!score) rejectionReasons.push('score_explanation_missing');
  else if (score.normalizedScore < PLAUSIBLE_FLOOR) rejectionReasons.push('below_plausible_floor');
  if (hasLocationConflict(scoreReasons)) {
    rejectionReasons.push('location_conflict');
    conflictFlags.push('location_conflict');
  }
  if (
    scoreReasons.has('permanently_closed') ||
    candidate?.businessStatus === 'CLOSED_PERMANENTLY'
  ) {
    rejectionReasons.push('permanently_closed');
    conflictFlags.push('permanently_closed');
  }
  if (!hasPlausibleIdentity(mention, candidate, scoreReasons)) {
    rejectionReasons.push('obviously_unrelated');
  }

  return {
    plausible: rejectionReasons.length === 0 && score ? { candidate, score } : null,
    rejectionReasons,
    conflictFlags,
  };
}

function duplicateCanonicalCount(placeId: string, results: MentionResult[]): number {
  return results.filter((result) =>
    result.candidates.some((candidate) => candidate.googlePlaceId === placeId),
  ).length;
}

function ambiguityReason(
  candidates: PlausibleCandidate[],
): 'branch_ambiguity' | 'multiple_plausible_candidates' {
  const names = candidates
    .map(({ candidate }) => normalizedName(candidate.name))
    .filter(Boolean);
  for (let left = 0; left < names.length; left += 1) {
    for (let right = left + 1; right < names.length; right += 1) {
      const a = names[left]!;
      const b = names[right]!;
      if (a === b || a.includes(b) || b.includes(a)) return 'branch_ambiguity';
    }
  }
  return 'multiple_plausible_candidates';
}

export function mediaReviewDecision(
  unresolvedResults: Array<Pick<MentionResult, 'candidates'>>,
): 'candidate_confirmation' | 'multi_candidate_confirmation' {
  return unresolvedResults.length > 1 ||
      unresolvedResults.some((result) => result.candidates.length > 1)
    ? 'multi_candidate_confirmation'
    : 'candidate_confirmation';
}

export function evaluateMediaAutoSave(
  input: MediaAutoSaveGateInput,
): MediaAutoSaveGateDecision {
  const rawCandidateCount = input.result.scoring.length;
  const candidateRejectionReasons = input.result.scoring
    .filter((score) => score.rejected)
    .map((score) => score.rejectionReason || 'provider_rejected');
  const explicitConflictFlags: string[] = [];
  const plausibleByProviderId = new Map<string, PlausibleCandidate>();

  for (const candidate of input.result.candidates) {
    const assessed = assessCandidate(input.mention, input.result, candidate);
    candidateRejectionReasons.push(...assessed.rejectionReasons);
    explicitConflictFlags.push(...assessed.conflictFlags);
    if (assessed.plausible && !plausibleByProviderId.has(candidate.googlePlaceId)) {
      plausibleByProviderId.set(candidate.googlePlaceId, assessed.plausible);
    }
  }

  const plausible = [...plausibleByProviderId.values()];
  let reasonCode: string;
  let semanticCompatibility: SemanticCompatibility = 'UNKNOWN';
  let sceneCategory: string | null = null;
  let candidateCategory: string | null = null;
  let semanticOverrideApplied = false;
  if (input.mention.identityEvidenceKind === 'model_prior') {
    reasonCode = 'model_prior_unverified';
    explicitConflictFlags.push('model_prior_unverified');
  } else if ((input.mention.identityAlternatives?.length ?? 0) > 0 && plausible.length <= 1) {
    // A second surviving model identity that Places could not independently
    // eliminate is real uncertainty, never permission to silently choose the
    // only listed candidate. Two canonical candidates are handled below by the
    // ordinary ambiguity branch.
    reasonCode = 'identity_hypothesis_uncertainty';
    explicitConflictFlags.push('identity_hypothesis_uncertainty');
  } else if (input.mention.hostVenueName || input.mention.relationshipType) {
    reasonCode = 'host_relationship';
    explicitConflictFlags.push('host_relationship');
  } else if (plausible.length === 0) {
    if (explicitConflictFlags.includes('location_conflict')) reasonCode = 'location_conflict';
    else if (
      input.result.candidates.length > 0 &&
      input.result.candidates.every((candidate) => !validProviderIdentity(candidate))
    ) {
      reasonCode = 'provider_identity_invalid';
    } else reasonCode = 'no_plausible_candidate';
  } else if (plausible.length > 1) {
    reasonCode = ambiguityReason(plausible);
    explicitConflictFlags.push(reasonCode);
  } else {
    const selected = plausible[0]!;
    if (duplicateCanonicalCount(selected.candidate.googlePlaceId, input.allResults) !== 1) {
      reasonCode = 'canonical_place_ambiguity';
      explicitConflictFlags.push('canonical_place_ambiguity');
    } else {
      const compatibility = semanticCategoryCompatibility({
        sceneCategory: input.mention.category,
        sceneConfidence: input.mention.categoryConfidence,
        categoryEvidenceTags: input.mention.categoryEvidenceTags,
        candidateCategory: candidatePoiCategory(selected.candidate),
      });
      semanticCompatibility = compatibility.verdict;
      sceneCategory = compatibility.sceneCategory;
      candidateCategory = compatibility.candidateCategory;
      const identity = {
        exactAddress: selected.score.reasons?.includes('address_verified') ||
          selected.score.reasons?.includes('address_verified_multi'),
        readableSignageExactName: input.mention.sources.includes('visible_text') &&
          input.mention.nameEvidenceSources.includes('visible_text'),
        explicitCaptionExactName: input.mention.nameEvidenceSources.includes('caption'),
        independentNameSourceCount: input.mention.nameEvidenceSources.length,
      };
      const semantic = semanticAutoSaveDecision({ compatibility, identityEvidence: identity });
      semanticOverrideApplied = semantic.overridden;
      if (!semantic.allowed) {
        reasonCode = 'candidate_semantic_mismatch';
        candidateRejectionReasons.push('candidate_semantic_mismatch');
        explicitConflictFlags.push('candidate_semantic_mismatch');
      } else {
        reasonCode = 'single_plausible_candidate';
        if (semantic.overridden) explicitConflictFlags.push('candidate_semantic_override');
      }
    }
  }

  const selected = plausible.length === 1 ? plausible[0]! : null;
  return {
    eligible: reasonCode === 'single_plausible_candidate',
    confidenceScore: selected?.score.normalizedScore ?? null,
    ruleVersion: MEDIA_AUTO_SAVE_RULE_VERSION,
    reasonCodes: [reasonCode],
    rawCandidateCount,
    plausibleCandidateCount: plausible.length,
    selectedProviderId: selected?.candidate.googlePlaceId ?? null,
    candidateRejectionReasons: [...new Set(candidateRejectionReasons)],
    explicitConflictFlags: [...new Set(explicitConflictFlags)],
    semanticCompatibility,
    sceneCategory,
    candidateCategory,
    semanticOverrideApplied,
  };
}

function safeLogValue(value: string | null | undefined): string {
  return (value ?? 'none').replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 180);
}

export function formatMediaAutoSaveDecisionLog(args: {
  jobId: string;
  logicalPlaceId: string;
  decision: MediaAutoSaveGateDecision;
  finalDecision: 'auto_save' | 'review';
  finalReasonCodes: string[];
}): string {
  const selectedScore = args.decision.confidenceScore == null
    ? 'none'
    : args.decision.confidenceScore.toFixed(4);
  return [
    '[media-autosave]',
    `job_id=${safeLogValue(args.jobId)}`,
    `logical_place_id=${safeLogValue(args.logicalPlaceId)}`,
    `raw_candidate_count=${args.decision.rawCandidateCount}`,
    `plausible_candidate_count=${args.decision.plausibleCandidateCount}`,
    `selected_provider_id=${safeLogValue(args.decision.selectedProviderId)}`,
    `selected_score=${selectedScore}`,
    `rejection_reasons=${safeLogValue(args.decision.candidateRejectionReasons.join(','))}`,
    `explicit_conflict_flags=${safeLogValue(args.decision.explicitConflictFlags.join(','))}`,
    `semantic_compatibility=${safeLogValue(args.decision.semanticCompatibility)}`,
    `scene_category=${safeLogValue(args.decision.sceneCategory)}`,
    `candidate_category=${safeLogValue(args.decision.candidateCategory)}`,
    `semantic_override=${args.decision.semanticOverrideApplied ? 'true' : 'false'}`,
    `final_decision=${args.finalDecision}`,
    `decision_reason=${safeLogValue(args.finalReasonCodes.join(','))}`,
  ].join(' ');
}
