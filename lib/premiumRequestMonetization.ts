/**
 * Pure Premium Request policy.
 *
 * This is the single client/Edge/test vocabulary for eligibility and charging.
 * It deliberately consumes structured result facts only; user-facing copy is
 * never a billing input.
 */

import { areaMatchIncompleteFromPayload } from './areaMatchPremium.ts';

export const PREMIUM_REQUEST_STATES = [
  'not_eligible',
  'eligible',
  'awaiting_token',
  'reserved',
  'processing',
  'useful_result',
  'no_useful_result',
  'failed',
  'cancelled',
] as const;

export type PremiumRequestState = typeof PREMIUM_REQUEST_STATES[number];

type Candidate = Record<string, unknown>;

export type PremiumResultFacts = {
  status?: string | null;
  decision?: string | null;
  saved_place_id?: string | null;
  candidate_payload?: unknown;
  failure_category?: string | null;
  failure_code?: string | null;
  needs_help_reason?: string | null;
  analysis_attempted?: boolean | null;
};

export type PremiumEligibility = {
  eligible: boolean;
  reason: string;
};

export type PremiumChargeability = {
  chargeable: boolean;
  reason: string;
};

const ELIGIBLE_FAILURE_CODES = new Set([
  'insufficient_evidence',
  'no_result',
  'no_trustworthy_place',
  'recognition_recovery_exhausted',
]);

const EXCLUDED_FAILURE_CODES = new Set([
  'authentication_required',
  'private_or_unavailable',
  'media_unavailable',
  'download_failed',
  'duration_too_long',
  'unsupported_url',
  'unsupported_platform',
  'unsupported_facebook_url',
  'provider_unavailable',
  'provider_rate_limited',
  'places_provider_unavailable',
  'places_provider_unavailable_exhausted',
  'processing_error',
  'cancelled',
]);

function record(value: unknown): Candidate | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Candidate
    : null;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteCoordinate(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A concrete place the user can act on, not a category, city, or vague lead. */
export function isSpecificActionableCandidate(value: unknown): boolean {
  const candidate = record(value);
  if (!candidate) return false;
  if (
    nonEmpty(candidate.googlePlaceId) ||
    nonEmpty(candidate.google_place_id) ||
    nonEmpty(candidate.placeId) ||
    nonEmpty(candidate.savedPlaceId)
  ) return true;
  if (finiteCoordinate(candidate.latitude) && finiteCoordinate(candidate.longitude)) return true;
  if (nonEmpty(candidate.formattedAddress) || nonEmpty(candidate.formatted_address)) return true;
  return false;
}

export function hasSpecificActionableResult(payload: unknown): boolean {
  const root = record(payload);
  if (!root) return false;
  if (Array.isArray(root.candidates) && root.candidates.some(isSpecificActionableCandidate)) return true;
  if (Array.isArray(root.mentionSlots)) {
    const hasSpecificMention = root.mentionSlots.some((rawSlot) => {
      const slot = record(rawSlot);
      return !!slot && (
        nonEmpty(slot.savedPlaceId) ||
        (Array.isArray(slot.candidates) && slot.candidates.some(isSpecificActionableCandidate)) ||
        (Array.isArray(slot.identityHypotheses) && slot.identityHypotheses.some((rawHypothesis) => {
          const hypothesis = record(rawHypothesis);
          return !!hypothesis && hypothesis.evidenceKind === 'observable' && nonEmpty(hypothesis.name);
        }))
      );
    });
    if (hasSpecificMention) return true;
  }
  // `search_lead` is emitted only for a field-grounded venue name. Area- and
  // category-only partials remain non-chargeable even when they contain a
  // useful manual-search query.
  const partial = record(root.partialResult);
  if (
    partial?.resultClass === 'search_lead' &&
    partial.discoveryOnly !== true &&
    typeof partial.clueCount === 'number' &&
    partial.clueCount > 0 &&
    nonEmpty(partial.searchQuery)
  ) return true;
  return false;
}

/**
 * The free pass must have genuinely completed and returned no useful result.
 * Technical/access/unsupported outcomes and any actionable shortlist fail
 * closed to NOT_ELIGIBLE.
 */
export function premiumEligibilityForResult(job: PremiumResultFacts): PremiumEligibility {
  if (job.status !== 'needs_help') return { eligible: false, reason: 'not_insufficient_terminal' };
  if (job.analysis_attempted !== true) return { eligible: false, reason: 'normal_analysis_not_completed' };
  if (job.saved_place_id || hasSpecificActionableResult(job.candidate_payload)) {
    return { eligible: false, reason: 'free_result_actionable' };
  }
  const code = (job.failure_code ?? '').trim().toLowerCase();
  if (EXCLUDED_FAILURE_CODES.has(code)) return { eligible: false, reason: `excluded_${code}` };
  if (job.failure_category && job.failure_category !== 'analysis_insufficient') {
    return { eligible: false, reason: `excluded_${job.failure_category}` };
  }
  if (areaMatchIncompleteFromPayload(job.candidate_payload)) {
    return { eligible: true, reason: 'area_match_incomplete' };
  }
  if (job.failure_category === 'analysis_insufficient' || ELIGIBLE_FAILURE_CODES.has(code)) {
    return { eligible: true, reason: code || 'analysis_insufficient' };
  }
  return { eligible: false, reason: 'insufficient_not_structured' };
}

/**
 * Tokens buy a useful, specific Premium result—not compute. This function is
 * the only terminal value classifier used by Premium settlement.
 */
export function isPremiumResultChargeable(job: PremiumResultFacts): PremiumChargeability {
  if (job.status === 'completed' && !!job.saved_place_id) {
    return { chargeable: true, reason: 'premium_saved_place' };
  }
  if (
    (job.status === 'completed' || job.status === 'needs_help') &&
    hasSpecificActionableResult(job.candidate_payload)
  ) {
    return { chargeable: true, reason: 'premium_specific_candidates' };
  }
  if (job.status === 'cancelled') return { chargeable: false, reason: 'premium_cancelled' };
  if (job.status === 'failed') return { chargeable: false, reason: 'premium_technical_failure' };
  return { chargeable: false, reason: 'premium_no_useful_result' };
}
