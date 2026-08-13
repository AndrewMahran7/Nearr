import type { MentionResult } from '../process-share-link/resolver/nameDrivenResolver.ts';
import type { VenueMention } from './mediaMentions.ts';

export const MEDIA_AUTO_SAVE_RULE_VERSION = 'media-autosave-2026-08-13.v5';
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

function hasLocationConflict(scoreReasons: Set<string>): boolean {
  return (
    scoreReasons.has('wrong_location_rejected') ||
    scoreReasons.has('distance_close') ||
    scoreReasons.has('distance_medium') ||
    scoreReasons.has('distance_far')
  );
}

function evidenceSufficiencyReason(
  mention: VenueMention,
  candidate: any,
  scoreReasons: Set<string>,
): 'strong_named_single_match' | 'single_match_with_location_support' | 'visual_landmark_single_match' | null {
  const hasExplicitNameEvidence = mention.nameEvidenceSources.length > 0;
  const hasStrongProviderNameMatch =
    scoreReasons.has('compact_name_match') || scoreReasons.has('strong_name_match');
  const hasDistinctiveProviderNameMatch = scoreReasons.has('distinctive_token_match');
  if (!hasExplicitNameEvidence || !hasStrongProviderNameMatch || !hasDistinctiveProviderNameMatch) {
    return null;
  }

  // A one-token mention expanded into a longer provider name is a common broad
  // geography/generic-name failure (for example, a country resolving to a
  // museum or road containing that country name). Keep it in review. Exact
  // one-word brands remain eligible, and multi-token landmarks may tolerate
  // harmless provider naming differences such as "Lower Corlieu Falls" versus
  // "Corlieu Falls".
  if (
    mention.distinctiveTokens.length === 1 &&
    normalizedName(mention.displayName) !== normalizedName(candidate?.name)
  ) {
    return null;
  }

  const hasLocationSupport =
    scoreReasons.has('state_match') || scoreReasons.has('distance_nearby');
  const hasVisualIdentity =
    mention.nameEvidenceSources.includes('frame') &&
    (scoreReasons.has('expected_category_match') || hasLocationSupport);
  if (hasVisualIdentity) return 'visual_landmark_single_match';
  if (hasLocationSupport) return 'single_match_with_location_support';
  return 'strong_named_single_match';
}

function duplicateCanonicalCount(placeId: string, results: MentionResult[]): number {
  return results.filter((result) =>
    result.candidates.some((candidate) => candidate.googlePlaceId === placeId),
  ).length;
}

function providerAmbiguityReason(
  result: MentionResult,
): 'branch_ambiguity' | 'competing_candidates' {
  const names = result.candidates.map((candidate) => normalizedName(candidate.name)).filter(Boolean);
  for (let left = 0; left < names.length; left += 1) {
    for (let right = left + 1; right < names.length; right += 1) {
      const a = names[left]!;
      const b = names[right]!;
      if (a === b || a.includes(b) || b.includes(a)) return 'branch_ambiguity';
    }
  }
  return 'competing_candidates';
}

export function evaluateMediaAutoSave(
  input: MediaAutoSaveGateInput,
  minScore: number = DEFAULT_MEDIA_AUTO_SAVE_THRESHOLD,
): MediaAutoSaveGateDecision {
  const reasons: string[] = [];
  const candidate = input.result.candidates[0];
  const score = input.result.scoring.find(
    (entry) => entry.googlePlaceId === candidate?.googlePlaceId && !entry.rejected,
  );
  const scoreReasons = new Set(score?.reasons ?? []);
  const evidenceReason = evidenceSufficiencyReason(input.mention, candidate, scoreReasons);

  if (input.result.outcome !== 'verified_single' || input.result.candidates.length !== 1) {
    reasons.push(
      input.result.candidates.length > 1
        ? providerAmbiguityReason(input.result)
        : 'provider_result_not_verified',
    );
  }
  if (!candidate?.googlePlaceId) reasons.push('missing_provider_identity');
  if (!candidate?.formattedAddress?.trim()) reasons.push('missing_formatted_address');
  if (!validCoordinates(candidate)) reasons.push('invalid_provider_coordinates');
  if (!score) reasons.push('missing_score_explanation');
  if (!score || score.normalizedScore < minScore) reasons.push('below_threshold');
  if (hasLocationConflict(scoreReasons)) reasons.push('location_conflict');
  if (scoreReasons.has('permanently_closed') || candidate?.businessStatus === 'CLOSED_PERMANENTLY') {
    reasons.push('permanently_closed');
  }
  if (!evidenceReason) reasons.push('insufficient_identity_evidence');
  if (input.mention.hostVenueName || input.mention.relationshipType) {
    reasons.push('host_relationship');
  }
  if (
    candidate?.googlePlaceId &&
    duplicateCanonicalCount(candidate.googlePlaceId, input.allResults) !== 1
  ) {
    reasons.push('canonical_place_ambiguity');
  }

  return {
    eligible: reasons.length === 0,
    confidenceScore: score?.normalizedScore ?? null,
    ruleVersion: MEDIA_AUTO_SAVE_RULE_VERSION,
    reasonCodes: reasons.length === 0 ? [evidenceReason!] : [...new Set(reasons)],
  };
}
