/**
 * Deterministic safety gate for the backend share-extraction agent.
 *
 * STAGE 3 — agent-driven auto-save IS now possible, but ONLY when every
 * one of the rules below passes. This file is the SINGLE SOURCE OF TRUTH
 * for "is it safe for the agent to silent-save?". Both the host app and
 * the Edge Function call into here; the iOS share extension relies on
 * the Edge Function's verdict.
 *
 * It is a PURE function: no I/O, no model calls, no caches.
 *
 * Stage-3 hardened rules — auto_save requires ALL of:
 *   (1) agent's own decision is `auto_save`
 *   (2) confidence is `high`
 *   (3) at least one STRONG evidence key (caption_explicit_venue,
 *       caption_explicit_address, profile_bio_name, profile_bio_address,
 *       profile_bio_city, transcript_venue)
 *   (4) the selected Google Place came from `searchPlaces` IN THIS RUN
 *   (5) the top Places match score is strong (≥0.75) — i.e.
 *       evidence includes `places_strong_match`
 *   (6) no major ambiguity between top candidates
 *   (7) when the proposal carried a placeName/address, the resolved
 *       place's name/address matches it
 *   (8) NONE of: profile_blocked, generic_content, handle-only,
 *       display-name-only
 *
 * If any rule fails, the gate downgrades the decision and records one or
 * more explicit reason codes (see vocabulary below).
 *
 * Reason vocabulary — both eval fixtures and dev panel read these:
 *   - strong_evidence_with_strong_places_match    (auto-save accepted)
 *   - handle_context_unverified
 *   - profile_fetch_blocked
 *   - weak_generic_text
 *   - display_name_only
 *   - no_places_match
 *   - weak_places_match
 *   - ambiguous_candidates
 *   - low_confidence
 *   - missing_verified_evidence
 *   - address_mismatch
 *   - candidate_name_mismatch
 *   - resolved_place_not_from_this_run
 *   - agent_proposal_below_autosave
 *   - medium_confidence_requires_user_confirmation
 *   - default_safety_floor
 *   - agent_reported_failed
 */

import type {
  AgentDecision,
  AgentResponse,
  EvidenceKey,
  ExtractionProposal,
  SafetyDecision,
} from './types.ts';

const STRONG_EVIDENCE: ReadonlySet<EvidenceKey> = new Set<EvidenceKey>([
  'caption_explicit_venue',
  'caption_explicit_address',
  'profile_bio_name',
  'profile_bio_address',
  'profile_bio_city',
  'transcript_venue',
]);

const WEAK_OR_NEGATIVE_EVIDENCE: ReadonlySet<EvidenceKey> = new Set<EvidenceKey>([
  'profile_display_name',
  'profile_blocked',
  'tagged_handle_only',
  'poster_handle_only',
  'transcript_unsupported',
  'places_weak_match',
  'places_no_match',
  'generic_content',
]);

/**
 * STAGE 3 — runtime context the agent passes alongside the proposal so
 * the gate can verify Places-side claims. Every field is optional; when
 * absent the gate behaves conservatively (treats it as "unknown" and
 * refuses to escalate to auto-save).
 */
export type SafetyContext = {
  /**
   * True iff the resolved place was produced by a `searchPlaces` tool
   * invocation in THIS run. Required to be true for auto-save.
   */
  resolvedPlaceFromThisRun?: boolean;
  /** Top Places candidate's match-vs-evidence score, 0..1. */
  topMatchScore?: number | null;
  /** Second-best score, 0..1 — used to detect ambiguous candidates. */
  secondMatchScore?: number | null;
  /**
   * Whether the resolved place's name matched the proposal's placeName.
   * Pass `null` when the proposal had no placeName to compare.
   */
  resolvedPlaceNameMatchesProposal?: boolean | null;
  /**
   * Whether the resolved place's formatted address matched the proposal's
   * address. Pass `null` when the proposal had no address to compare.
   */
  resolvedPlaceAddressMatchesProposal?: boolean | null;
};

const AUTOSAVE_TOP_SCORE_FLOOR = 0.75;
const AMBIGUITY_MARGIN = 0.15;
const AMBIGUITY_SECOND_FLOOR = 0.5;

export function evaluateSafety(
  proposal: ExtractionProposal,
  context: SafetyContext = {},
): SafetyDecision {
  const reasons: string[] = [];
  const accepted: EvidenceKey[] = [];
  const rejected: EvidenceKey[] = [];

  const evidenceSet = new Set<EvidenceKey>(proposal.evidenceUsed ?? []);
  for (const key of evidenceSet) {
    if (STRONG_EVIDENCE.has(key)) accepted.push(key);
    if (WEAK_OR_NEGATIVE_EVIDENCE.has(key)) rejected.push(key);
  }

  const hasBlocked = evidenceSet.has('profile_blocked');
  const hasGeneric = evidenceSet.has('generic_content');
  const hasPlacesStrong = evidenceSet.has('places_strong_match');
  const hasPlacesWeak = evidenceSet.has('places_weak_match');
  const hasPlacesNone = evidenceSet.has('places_no_match');
  const handleOnly =
    (evidenceSet.has('tagged_handle_only') || evidenceSet.has('poster_handle_only')) &&
    accepted.length === 0;
  const displayNameOnly =
    evidenceSet.has('profile_display_name') &&
    !evidenceSet.has('profile_bio_address') &&
    !evidenceSet.has('profile_bio_city') &&
    !evidenceSet.has('caption_explicit_address') &&
    !evidenceSet.has('caption_explicit_venue');

  // 2026-05-26: this Nearr version intentionally does NOT rely on
  // Instagram/TikTok profile bios or transcription. When the post
  // title/description itself carries strong evidence (explicit venue
  // name OR explicit street address) AND Google Places returned a
  // strong match, an IG profile rate-limit / login wall is not a
  // safety concern — every meaningful signal we trust is intact. We
  // keep `profile_fetch_blocked` visible as a reason so the dev panel
  // / logs still surface it, but it no longer prevents auto-save in
  // this specific strong-description configuration. Handle-only /
  // display-name-only / generic-content paths are NOT affected — they
  // continue to require bio fallback they will never get and so stay
  // conservative.
  const hasStrongCaptionEvidence =
    evidenceSet.has('caption_explicit_venue') ||
    evidenceSet.has('caption_explicit_address');

  // ---- Disqualifiers — recorded as reasons regardless of decision ----
  if (hasBlocked) reasons.push('profile_fetch_blocked');
  if (hasGeneric) reasons.push('weak_generic_text');
  if (handleOnly) reasons.push('handle_context_unverified');
  if (displayNameOnly) reasons.push('display_name_only');

  // ---- Places-side checks (Stage 3) ---------------------------------
  const resolvedFromThisRun = context.resolvedPlaceFromThisRun === true;
  const topScore = typeof context.topMatchScore === 'number' ? context.topMatchScore : null;
  const secondScore =
    typeof context.secondMatchScore === 'number' ? context.secondMatchScore : null;

  let placesProblem: string | null = null;
  if (hasPlacesNone || (!hasPlacesStrong && !hasPlacesWeak)) {
    placesProblem = 'no_places_match';
  } else if (!hasPlacesStrong) {
    placesProblem = 'weak_places_match';
  } else if (topScore !== null && topScore < AUTOSAVE_TOP_SCORE_FLOOR) {
    placesProblem = 'weak_places_match';
  }

  const ambiguous =
    !placesProblem &&
    secondScore !== null &&
    topScore !== null &&
    secondScore >= AMBIGUITY_SECOND_FLOOR &&
    topScore - secondScore < AMBIGUITY_MARGIN;
  if (ambiguous) reasons.push('ambiguous_candidates');

  const nameMismatch =
    !!proposal.placeName && context.resolvedPlaceNameMatchesProposal === false;
  const addressMismatch =
    !!proposal.address && context.resolvedPlaceAddressMatchesProposal === false;
  if (nameMismatch) reasons.push('candidate_name_mismatch');
  if (addressMismatch) reasons.push('address_mismatch');

  if (placesProblem) reasons.push(placesProblem);
  if (proposal.confidence === 'low') reasons.push('low_confidence');
  if (
    accepted.length === 0 &&
    !hasBlocked &&
    !hasGeneric &&
    !handleOnly &&
    !displayNameOnly
  ) {
    reasons.push('missing_verified_evidence');
  }

  // When profile-fetch failure is superseded by strong description
  // evidence + a strong Places match, surface a single explicit reason
  // so reviewers / dev panel can see that the gate considered the
  // tradeoff. Does NOT remove `profile_fetch_blocked` (kept as a
  // warning), only documents the override.
  const profileBlockedSuperseded =
    hasBlocked &&
    hasStrongCaptionEvidence &&
    hasPlacesStrong &&
    !placesProblem;
  if (profileBlockedSuperseded) {
    reasons.push('profile_fetch_blocked_superseded_by_strong_description');
  }

  // ---- Decision ------------------------------------------------------
  const eligibleForAutoSave =
    proposal.decision === 'auto_save' &&
    proposal.confidence === 'high' &&
    accepted.length > 0 &&
    hasPlacesStrong &&
    !placesProblem &&
    !ambiguous &&
    !nameMismatch &&
    !addressMismatch &&
    (!hasBlocked || profileBlockedSuperseded) &&
    !hasGeneric &&
    !handleOnly &&
    !displayNameOnly &&
    resolvedFromThisRun;

  let decision: AgentDecision;
  let safeToAutoSave = false;

  if (eligibleForAutoSave) {
    decision = 'auto_save';
    safeToAutoSave = true;
    reasons.push('strong_evidence_with_strong_places_match');
  } else if (proposal.decision === 'auto_save' && !resolvedFromThisRun && !placesProblem) {
    reasons.push('resolved_place_not_from_this_run');
    decision = pickDowngradedDecision({
      hasBlocked: hasBlocked && !profileBlockedSuperseded,
      hasGeneric,
      handleOnly,
      displayNameOnly,
      hasPlacesNone,
      acceptedCount: accepted.length,
      confidence: proposal.confidence,
    });
  } else if (
    proposal.decision === 'auto_save' &&
    (placesProblem || ambiguous || nameMismatch || addressMismatch)
  ) {
    reasons.push('agent_proposal_below_autosave');
    decision = pickDowngradedDecision({
      hasBlocked: hasBlocked && !profileBlockedSuperseded,
      hasGeneric,
      handleOnly,
      displayNameOnly,
      hasPlacesNone,
      acceptedCount: accepted.length,
      confidence: proposal.confidence,
    });
  } else if (
    proposal.confidence === 'high' &&
    (hasPlacesStrong || hasPlacesWeak || accepted.length > 0) &&
    !hasGeneric &&
    !handleOnly &&
    !displayNameOnly &&
    (!hasBlocked || hasPlacesStrong || hasPlacesWeak)
  ) {
    decision = 'candidate_confirmation';
  } else if (
    proposal.confidence === 'medium' &&
    !hasGeneric &&
    !handleOnly &&
    (!hasBlocked || profileBlockedSuperseded)
  ) {
    decision = 'candidate_confirmation';
    reasons.push('medium_confidence_requires_user_confirmation');
  } else if (
    hasPlacesNone ||
    hasGeneric ||
    handleOnly ||
    (hasBlocked && !hasPlacesStrong && !hasPlacesWeak) ||
    displayNameOnly
  ) {
    decision = 'manual_fallback';
  } else if (proposal.confidence === 'low') {
    decision = 'manual_fallback';
  } else if (proposal.decision === 'failed') {
    decision = 'failed';
    reasons.push('agent_reported_failed');
  } else {
    decision = 'manual_fallback';
    reasons.push('default_safety_floor');
  }

  if (proposal.decision === 'failed') {
    decision = 'failed';
    safeToAutoSave = false;
  }

  return {
    decision,
    safeToAutoSave,
    reasons,
    acceptedEvidence: accepted,
    rejectedEvidence: rejected,
  };
}

function pickDowngradedDecision(args: {
  hasBlocked: boolean;
  hasGeneric: boolean;
  handleOnly: boolean;
  displayNameOnly: boolean;
  hasPlacesNone: boolean;
  acceptedCount: number;
  confidence: 'high' | 'medium' | 'low';
}): AgentDecision {
  if (args.hasGeneric || args.handleOnly || args.hasBlocked || args.hasPlacesNone) {
    return 'manual_fallback';
  }
  if (args.displayNameOnly) return 'manual_fallback';
  if (args.acceptedCount === 0 && args.confidence === 'low') return 'manual_fallback';
  return 'candidate_confirmation';
}

/**
 * Convenience: apply safety to an in-progress AgentResponse using a
 * SafetyContext derived elsewhere (see lib/shareAgent/agent.ts).
 */
export function applySafety(
  response: AgentResponse,
  context: SafetyContext = {},
): AgentResponse {
  const safety = evaluateSafety(response.proposal, context);
  return { ...response, safety };
}
