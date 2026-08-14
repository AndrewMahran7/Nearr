// Pure product-level auto-save gate for the metadata resolver path.
//
// The media pipeline has its own evidence-rich v6 gate, but ordinary metadata
// jobs can resolve without ever creating a media task. The user-facing
// invariant applies to both paths: if Quick Check would receive exactly one
// valid provider candidate and there is no explicit contradiction, save it.

import { addressesMatch } from '../../../lib/shareAgent/tools.ts';

export const METADATA_AUTO_SAVE_RULE_VERSION = 'metadata-autosave-2026-08-13.v2';

type Candidate = {
  googlePlaceId?: unknown;
  name?: unknown;
  formattedAddress?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  businessStatus?: unknown;
  confidenceScore?: unknown;
  reasons?: unknown;
};

type MetadataResult = {
  decision?: unknown;
  candidates?: unknown;
};

type MetadataEvidence = {
  isRoundup?: unknown;
  address?: { raw?: unknown } | null;
  addresses?: unknown;
  venueNameHints?: unknown;
};

export type MetadataCandidateRejection = {
  providerId: string | null;
  reason: string;
};

export type MetadataAutoSaveDecision = {
  eligible: boolean;
  ruleVersion: string;
  rawCandidateCount: number;
  plausibleCandidateCount: number;
  selectedProviderId: string | null;
  confidenceScore: number | null;
  plausibleProviderIds: string[];
  rejectedCandidates: MetadataCandidateRejection[];
  reasonCodes: string[];
  candidateRejectionReasons: string[];
  explicitConflictFlags: string[];
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedName(value: unknown): string {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function finiteInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function candidateRejectionReason(candidate: Candidate): string | null {
  if (!text(candidate.googlePlaceId)) return 'provider_id_missing';
  if (!text(candidate.name)) return 'provider_name_missing';
  if (!text(candidate.formattedAddress)) return 'provider_address_missing';
  if (!finiteInRange(candidate.latitude, -90, 90) || !finiteInRange(candidate.longitude, -180, 180)) {
    return 'provider_coordinates_invalid';
  }
  if (text(candidate.businessStatus).toUpperCase() === 'CLOSED_PERMANENTLY') {
    return 'provider_permanently_closed';
  }
  const reasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
  if (reasons.includes('generic_address_card')) return 'provider_identity_invalid';
  if (reasons.includes('wrong_location_rejected')) return 'location_conflict';
  if (reasons.includes('platform_noise_rejected')) return 'provider_clearly_unrelated';
  return null;
}

export function evaluateMetadataAutoSave(input: {
  result: MetadataResult;
  evidence: MetadataEvidence;
}): MetadataAutoSaveDecision {
  const raw = Array.isArray(input.result.candidates)
    ? input.result.candidates.filter((candidate): candidate is Candidate => !!candidate && typeof candidate === 'object')
    : [];
  const candidateRejectionReasons: string[] = [];
  const rejectedCandidates: MetadataCandidateRejection[] = [];
  const plausibleByProviderId = new Map<string, Candidate>();
  for (const candidate of raw) {
    const rejection = candidateRejectionReason(candidate);
    if (rejection) {
      candidateRejectionReasons.push(rejection);
      rejectedCandidates.push({ providerId: text(candidate.googlePlaceId) || null, reason: rejection });
      continue;
    }
    plausibleByProviderId.set(text(candidate.googlePlaceId), candidate);
  }

  // A pin-style caption venue hint is explicit identity evidence. When at
  // least one provider result exactly matches it, candidates with a different
  // name are contradictions rather than extra choices. This intentionally
  // does not use score thresholds or substring matching: "Hellfire Bay" and
  // "Little Hellfire Bay" are distinct identities, while two provider rows
  // both named "Hellfire Bay" remain ambiguous until stronger evidence can
  // distinguish them.
  const hintNames = Array.isArray(input.evidence.venueNameHints)
    ? input.evidence.venueNameHints.map(normalizedName).filter(Boolean)
    : [];
  const validCandidates = [...plausibleByProviderId.values()];
  const hasExactCaptionName = hintNames.length > 0 && validCandidates.some(
    (candidate) => hintNames.includes(normalizedName(candidate.name)),
  );
  if (hasExactCaptionName) {
    for (const [providerId, candidate] of plausibleByProviderId) {
      if (hintNames.includes(normalizedName(candidate.name))) continue;
      plausibleByProviderId.delete(providerId);
      candidateRejectionReasons.push('explicit_name_conflict');
      rejectedCandidates.push({ providerId, reason: 'explicit_name_conflict' });
    }
  }

  const plausible = [...plausibleByProviderId.values()];
  const explicitConflictFlags: string[] = [];
  // A caption may mention another branch/address while resolving one logical
  // provider (the Santa Fe post does). Multi-place intent is already expressed
  // by the resolver decision; raw address count alone must not manufacture a
  // false ambiguity after the resolver produced one confirmation candidate.
  if (input.evidence.isRoundup === true) explicitConflictFlags.push('roundup_post');

  const selected = plausible.length === 1 ? plausible[0]! : null;
  const expectedAddress = text(input.evidence.address?.raw);
  if (
    selected &&
    expectedAddress &&
    !addressesMatch(expectedAddress, text(selected.formattedAddress))
  ) {
    explicitConflictFlags.push('location_conflict');
  }

  let reasonCode: string;
  if (explicitConflictFlags.length > 0) reasonCode = explicitConflictFlags[0]!;
  else if (plausible.length === 0) reasonCode = candidateRejectionReasons[0] ?? 'no_plausible_candidate';
  else if (plausible.length > 1) reasonCode = 'multiple_plausible_candidates';
  else reasonCode = 'single_plausible_candidate';

  return {
    eligible: reasonCode === 'single_plausible_candidate',
    ruleVersion: METADATA_AUTO_SAVE_RULE_VERSION,
    rawCandidateCount: raw.length,
    plausibleCandidateCount: plausible.length,
    selectedProviderId: selected ? text(selected.googlePlaceId) : null,
    plausibleProviderIds: plausible.map((candidate) => text(candidate.googlePlaceId)),
    rejectedCandidates,
    confidenceScore:
      selected && typeof selected.confidenceScore === 'number' && Number.isFinite(selected.confidenceScore)
        ? selected.confidenceScore
        : null,
    reasonCodes: [reasonCode],
    candidateRejectionReasons: [...new Set(candidateRejectionReasons)],
    explicitConflictFlags: [...new Set(explicitConflictFlags)],
  };
}

function safe(value: string | null | undefined): string {
  return (value ?? 'none').replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 180);
}

export function formatMetadataAutoSaveDecisionLog(args: {
  jobId: string;
  decision: MetadataAutoSaveDecision;
}): string {
  return [
    '[metadata-autosave]',
    `job_id=${safe(args.jobId)}`,
    `rule_version=${safe(args.decision.ruleVersion)}`,
    `raw_candidate_count=${args.decision.rawCandidateCount}`,
    `plausible_candidate_count=${args.decision.plausibleCandidateCount}`,
    `selected_provider_id=${safe(args.decision.selectedProviderId)}`,
    `selected_score=${args.decision.confidenceScore == null ? 'none' : args.decision.confidenceScore.toFixed(4)}`,
    `rejection_reasons=${safe(args.decision.candidateRejectionReasons.join(','))}`,
    `explicit_conflict_flags=${safe(args.decision.explicitConflictFlags.join(','))}`,
    `final_decision=${args.decision.eligible ? 'auto_save' : 'review'}`,
    `decision_reason=${safe(args.decision.reasonCodes.join(','))}`,
  ].join(' ');
}
