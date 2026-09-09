/**
 * Shared, pure boundary between "this result is plausible" and "the source
 * establishes this exact physical place".
 *
 * Ranking, category agreement, and geography are retrieval signals. They do
 * not bind a source to one canonical place. Automatic save needs either a
 * candidate-bound identifier, an exact source name with one remaining
 * candidate, or unusually strong visual corroboration with one remaining
 * candidate. Any unresolved sibling/parent/nearby choice stays reviewable.
 */

export const EXACT_IDENTITY_SAFETY_RULE_VERSION =
  'exact-identity-safety-2026-09-09.v1';

export type ExactIdentitySupport = Readonly<{
  exactAddress?: boolean;
  explicitProviderIdentity?: boolean;
  strongSourceEntityAgreement?: boolean;
  exactSourceNameSources?: readonly string[];
  visualNameObservationCount?: number;
  visualNameTimestampCount?: number;
  visualConfidence?: number | null;
  providerGeographyCorroborated?: boolean;
}>;

export type ExactIdentitySafetyInput = Readonly<{
  support: ExactIdentitySupport;
  plausibleCandidateCount: number;
  unresolvedIdentityAlternativeCount?: number;
  upstreamSafetyDecision?: 'AUTO_SAVE' | 'REVIEW' | 'REJECT' | null;
}>;

export type ExactIdentityStrength =
  | 'candidate_bound'
  | 'source_named'
  | 'distinctive_visual'
  | 'none';

export type ExactIdentitySafetyDecision = Readonly<{
  allowed: boolean;
  reason: string;
  strength: ExactIdentityStrength;
  ruleVersion: typeof EXACT_IDENTITY_SAFETY_RULE_VERSION;
}>;

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export function evaluateExactIdentitySafety(
  input: ExactIdentitySafetyInput,
): ExactIdentitySafetyDecision {
  const result = (
    allowed: boolean,
    reason: string,
    strength: ExactIdentityStrength,
  ): ExactIdentitySafetyDecision => ({
    allowed,
    reason,
    strength,
    ruleVersion: EXACT_IDENTITY_SAFETY_RULE_VERSION,
  });

  if (input.upstreamSafetyDecision && input.upstreamSafetyDecision !== 'AUTO_SAVE') {
    return result(false, 'upstream_exact_identity_review_required', 'none');
  }
  if (!Number.isFinite(input.plausibleCandidateCount) || input.plausibleCandidateCount < 1) {
    return result(false, 'no_plausible_candidate', 'none');
  }

  const candidateBound = input.support.exactAddress === true ||
    input.support.explicitProviderIdentity === true ||
    input.support.strongSourceEntityAgreement === true;
  if (candidateBound) {
    return result(true, 'candidate_bound_exact_identity', 'candidate_bound');
  }

  const unresolved = Math.max(0, input.unresolvedIdentityAlternativeCount ?? 0);
  if (input.plausibleCandidateCount > 1 || unresolved > 0) {
    return result(false, 'related_place_not_distinguished', 'none');
  }

  const sourceNameSources = unique(input.support.exactSourceNameSources)
    .filter((source) => source !== 'frame');
  if (sourceNameSources.length > 0) {
    return result(true, 'exact_source_name_unique_candidate', 'source_named');
  }

  const visualSupported = (input.support.visualNameObservationCount ?? 0) >= 2 &&
    (input.support.visualNameTimestampCount ?? 0) >= 2 &&
    (input.support.visualConfidence ?? 0) >= 0.9 &&
    input.support.providerGeographyCorroborated === true;
  if (visualSupported) {
    return result(true, 'distinctive_visual_unique_candidate', 'distinctive_visual');
  }

  return result(false, 'exact_identity_unproven', 'none');
}
