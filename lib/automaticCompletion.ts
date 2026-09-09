/**
 * Product-level policy for the save-first recognition contract.
 *
 * Confidence changes rank; it is not a veto. Automatic completion additionally
 * requires an explicit exact-identity authorization produced by an evidence
 * gate. A plausible top result is never authorization by itself.
 */

import { evaluateExactIdentitySafety, type ExactIdentityStrength } from './exactIdentitySafety.ts';

export const AUTOMATIC_COMPLETION_RULE_VERSION = 'automatic-completion-2026-09-09.v2-exact-identity';
export const MAX_SOFT_ALTERNATIVES = 2;

export type AutomaticCompletionCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  types?: string[];
  primaryType?: string | null;
  matchScore?: number | null;
  confidenceScore?: number | null;
  reasons?: string[];
  discoveryOnly?: boolean;
  exactIdentityStrength?: Exclude<ExactIdentityStrength, 'none'>;
  upstreamSafetyDecision?: 'AUTO_SAVE' | 'REVIEW' | 'REJECT' | null;
};

export type AutomaticCompletionPlan<T extends AutomaticCompletionCandidate> =
  | { action: 'save'; primary: T; alternatives: T[]; reason: 'exact_identity_supported' }
  | { action: 'escalate'; primary: null; alternatives: []; reason: 'no_defensible_specific_place' | 'exact_identity_unproven' | 'related_place_not_distinguished' | 'upstream_exact_identity_review_required' };

const BROAD_TYPES = new Set([
  'locality', 'administrative_area_level_1', 'administrative_area_level_2',
  'country', 'postal_code', 'continent', 'political',
]);
const BLOCKING_REASONS = new Set([
  'location_conflict', 'wrong_location_rejected', 'candidate_semantic_mismatch',
  'semantic_contradiction', 'provider_clearly_unrelated', 'platform_noise_rejected',
  'source_entity_semantic_conflict',
  'permanently_closed', 'provider_permanently_closed', 'category_only_candidate',
]);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function finiteCoordinate(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function isDefensibleSpecificCandidate(candidate: AutomaticCompletionCandidate): boolean {
  if (!text(candidate.googlePlaceId) || !text(candidate.name) || candidate.discoveryOnly === true) return false;
  if (!finiteCoordinate(candidate.latitude, -90, 90) || !finiteCoordinate(candidate.longitude, -180, 180)) return false;
  const types = Array.isArray(candidate.types) ? candidate.types.map((value) => text(value).toLowerCase()).filter(Boolean) : [];
  if (types.length > 0 && types.every((type) => BROAD_TYPES.has(type))) return false;
  const reasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
  return !reasons.some((reason) => BLOCKING_REASONS.has(text(reason)));
}

export function planAutomaticCompletion<T extends AutomaticCompletionCandidate>(
  rankedCandidates: readonly T[],
): AutomaticCompletionPlan<T> {
  const seen = new Set<string>();
  const plausible: T[] = [];
  for (const candidate of rankedCandidates) {
    const id = text(candidate.googlePlaceId);
    if (!id || seen.has(id) || !isDefensibleSpecificCandidate(candidate)) continue;
    seen.add(id);
    plausible.push(candidate);
    if (plausible.length === 1 + MAX_SOFT_ALTERNATIVES) break;
  }
  if (plausible.length === 0) {
    return { action: 'escalate', primary: null, alternatives: [], reason: 'no_defensible_specific_place' };
  }
  const primary = plausible[0]!;
  const candidateBoundCount = plausible.filter(
    (candidate) => candidate.exactIdentityStrength === 'candidate_bound',
  ).length;
  const exact = evaluateExactIdentitySafety({
    support: {
      exactAddress: primary.exactIdentityStrength === 'candidate_bound' && candidateBoundCount === 1,
      exactSourceNameSources: primary.exactIdentityStrength === 'source_named' ? ['source'] : [],
      visualNameObservationCount: primary.exactIdentityStrength === 'distinctive_visual' ? 2 : 0,
      visualNameTimestampCount: primary.exactIdentityStrength === 'distinctive_visual' ? 2 : 0,
      visualConfidence: primary.exactIdentityStrength === 'distinctive_visual' ? 1 : 0,
      providerGeographyCorroborated: primary.exactIdentityStrength === 'distinctive_visual',
    },
    plausibleCandidateCount: plausible.length,
    upstreamSafetyDecision: primary.upstreamSafetyDecision,
  });
  if (!exact.allowed) {
    const reason = exact.reason === 'related_place_not_distinguished' ||
        exact.reason === 'upstream_exact_identity_review_required'
      ? exact.reason
      : 'exact_identity_unproven';
    return {
      action: 'escalate',
      primary: null,
      alternatives: [],
      reason,
    };
  }
  return {
    action: 'save',
    primary,
    alternatives: plausible.slice(1),
    reason: 'exact_identity_supported',
  };
}

export function nativeNearrPlaceId(name: string, latitude: number, longitude: number): string {
  const slug = text(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'place';
  return `nearr-native:${slug}:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

export type SoftAlternativeState =
  | 'secondary_soft_saved'
  | 'secondary_promoted'
  | 'secondary_removed';

export function transitionSoftAlternative(
  state: SoftAlternativeState,
  action: 'promote' | 'remove',
): SoftAlternativeState {
  if (state !== 'secondary_soft_saved') return state;
  return action === 'promote' ? 'secondary_promoted' : 'secondary_removed';
}
