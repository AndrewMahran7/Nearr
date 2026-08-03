import type { MentionResult } from '../process-share-link/resolver/nameDrivenResolver.ts';
import type { VenueMention } from './mediaMentions.ts';

export const MEDIA_AUTO_SAVE_RULE_VERSION = 'media-autosave-2026-08-03.v1';
export const MEDIA_AUTO_SAVE_MIN_SCORE = 0.92;

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
  return args.enabled && !!args.canaryUserId && args.canaryUserId === args.userId;
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

function evidenceChannel(source: string): 'speech' | 'visual' | 'caption' | null {
  if (source === 'speech') return 'speech';
  if (source === 'visible_text' || source === 'frame') return 'visual';
  if (source === 'caption') return 'caption';
  return null;
}

function duplicateCanonicalCount(placeId: string, results: MentionResult[]): number {
  return results.filter((result) =>
    result.candidates.some((candidate) => candidate.googlePlaceId === placeId),
  ).length;
}

export function evaluateMediaAutoSave(
  input: MediaAutoSaveGateInput,
): MediaAutoSaveGateDecision {
  const reasons: string[] = [];
  const candidate = input.result.candidates[0];
  const score = input.result.scoring.find(
    (entry) => entry.googlePlaceId === candidate?.googlePlaceId && !entry.rejected,
  );
  const scoreReasons = new Set(score?.reasons ?? []);
  const channels = new Set(
    input.mention.nameEvidenceSources
      .map(evidenceChannel)
      .filter((channel): channel is 'speech' | 'visual' | 'caption' => channel !== null),
  );

  if (input.result.outcome !== 'verified_single') reasons.push('not_verified_single');
  if (input.result.candidates.length !== 1) reasons.push('candidate_not_unique_within_result');
  if (!candidate?.googlePlaceId) reasons.push('missing_google_place_id');
  if (!candidate?.formattedAddress?.trim()) reasons.push('missing_formatted_address');
  if (!validCoordinates(candidate)) reasons.push('invalid_provider_coordinates');
  if (!score) reasons.push('missing_score_explanation');
  if (!score || score.normalizedScore < MEDIA_AUTO_SAVE_MIN_SCORE) reasons.push('score_below_threshold');
  if (!scoreReasons.has('business_type')) reasons.push('business_type_not_verified');
  if (!scoreReasons.has('compact_name_match') && !scoreReasons.has('strong_name_match')) {
    reasons.push('strong_name_match_missing');
  }
  if (!scoreReasons.has('distinctive_token_match')) reasons.push('distinctive_name_match_missing');
  if (!scoreReasons.has('state_match')) reasons.push('state_match_missing');
  if (!scoreReasons.has('distance_nearby')) reasons.push('city_proximity_missing');
  if (scoreReasons.has('permanently_closed')) reasons.push('permanently_closed');
  if (channels.size < 2) reasons.push('independent_name_evidence_missing');
  if (!input.mention.repeated) reasons.push('name_not_repeated');
  if (input.mention.hostVenueName || input.mention.relationshipType) {
    reasons.push('host_relationship_requires_confirmation');
  }
  if (
    candidate?.googlePlaceId &&
    duplicateCanonicalCount(candidate.googlePlaceId, input.allResults) !== 1
  ) {
    reasons.push('canonical_place_not_unique_across_results');
  }

  return {
    eligible: reasons.length === 0,
    confidenceScore: score?.normalizedScore ?? null,
    ruleVersion: MEDIA_AUTO_SAVE_RULE_VERSION,
    reasonCodes: reasons.length === 0 ? ['all_deterministic_checks_passed'] : reasons,
  };
}