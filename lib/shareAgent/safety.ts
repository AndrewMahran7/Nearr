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
import { compactNameMatches, isWrongLocationCandidate } from './recoveryHints.ts';

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
  /**
   * 2026-05-27 — Patch 9 (wrong-location guard). The resolved
   * place's formatted address (verbatim from Places), so safety
   * can confirm it sits in the caption's inferred US state /
   * country. Pass null when no place was resolved.
   */
  resolvedFormattedAddress?: string | null;
  /**
   * 2026-05-27 — Patch 9 (wrong-location guard). Two-letter US
   * state code (uppercase) inferred from caption text — typically
   * `extractCityStateContext(text).state` or the state pulled from
   * an extracted street address. Pass null when unknown.
   */
  expectedState?: string | null;
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

  // 2026-05-27 — Patch 9 (wrong-location guard): if the resolved
  // place is in a different country / US state than the caption's
  // address context, the candidate is unsafe to surface (let alone
  // auto-save). Recorded as a reason and used to block both
  // auto_save AND the plausible-candidate upgrade below.
  const wrongLocation = isWrongLocationCandidate(
    context.resolvedFormattedAddress ?? null,
    context.expectedState ?? proposal.state ?? null,
  );
  if (wrongLocation) reasons.push('candidate_wrong_location');

  // 2026-05-27 — Patch 10 (auto_save tightening): explicit street
  // address evidence is now required. Posts with only name+city
  // signal (e.g. "Tacos El Chuy" + Santa Cruz hashtag) must reach
  // the user as candidate_confirmation, never silent-save.
  const hasExplicitAddress = evidenceSet.has('caption_explicit_address');
  if (
    proposal.decision === 'auto_save' &&
    !hasExplicitAddress &&
    !reasons.includes('autosave_requires_explicit_address')
  ) {
    reasons.push('autosave_requires_explicit_address');
  }

  // 2026-05-27 — Patch 13 (multi-branch auto_save block).
  //
  // Auto-save must NEVER fire when Places returned two or more
  // candidates whose normalized names match (e.g. multiple
  // "Taqueria Los Pericos" branches at different addresses) AND
  // the runner-up score is non-trivial (>= 0.5). Without a full
  // address in the caption we cannot pick the right branch; that
  // decision belongs to the user via candidate_confirmation.
  const sameBrandRunnerUp =
    typeof context.secondMatchScore === 'number' &&
    context.secondMatchScore >= 0.5 &&
    multipleSameBrandCandidates(proposal);
  if (sameBrandRunnerUp) reasons.push('multiple_same_brand_candidates');

  // ---- Decision ------------------------------------------------------
  const eligibleForAutoSave =
    proposal.decision === 'auto_save' &&
    proposal.confidence === 'high' &&
    accepted.length > 0 &&
    hasPlacesStrong &&
    hasExplicitAddress &&
    !wrongLocation &&
    !sameBrandRunnerUp &&
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

  // 2026-05-27 — Patch 11 (plausible-candidate upgrade).
  //
  // Manual fallback is a poor user experience — it asks the user to
  // type a search query from scratch. When the backend has
  // ALREADY located a plausible Google Places candidate (either via
  // the synchronous agent path or the timeout-recovery path), we
  // should surface it as `candidate_confirmation` so the user can
  // confirm or pick an alternative, instead of starting over.
  //
  // Plausibility rules (ALL must hold to upgrade):
  //   - decision is currently `manual_fallback`
  //   - we have at least one candidate with a real Place ID, OR a
  //     resolved place from this run
  //   - the candidate name compactly matches the proposal's place
  //     name (or the safety context already verified the match)
  //   - we are NOT blocked by wrong-location
  //   - the post is NOT pure generic content without ANY explicit
  //     anchor — if generic_content evidence is set BUT the caption
  //     also carried an explicit venue or street address (i.e. it's
  //     actually a single-place post that just happens to read like
  //     food porn), the plausible candidate IS surfaceable.
  //   - handle_only stays a block UNLESS Places returned a strong
  //     match for that handle (the strong external match is itself
  //     trustworthy evidence the handle resolves to a real venue).
  const genericBlocksUpgrade =
    hasGeneric && !hasStrongCaptionEvidence;
  const handleOnlyBlocksUpgrade = handleOnly && !hasPlacesStrong;
  if (
    decision === 'manual_fallback' &&
    !wrongLocation &&
    !genericBlocksUpgrade &&
    !handleOnlyBlocksUpgrade
  ) {
    const plausibleCandidate = pickPlausibleCandidate(proposal, context);
    if (plausibleCandidate) {
      decision = 'candidate_confirmation';
      reasons.push('manual_fallback_upgraded_plausible_candidate');
    }
  }

  return {
    decision,
    safeToAutoSave,
    reasons,
    acceptedEvidence: accepted,
    rejectedEvidence: rejected,
  };
}

/**
 * 2026-05-27 — Patch 11 helper.
 *
 * Returns the first proposal candidate whose name compactly matches
 * the proposal's place name (i.e. is a plausible same-business
 * match), or null when no such candidate exists. Also accepts the
 * safety context's resolved-name flag as positive evidence when set.
 *
 * Stub candidates produced by Gemini (`googlePlaceId === name`) are
 * skipped — they would surface as broken Place cards on the client.
 */
/**
 * 2026-05-27 — Patch 13 helper.
 *
 * True when proposal.candidates contains 2+ entries whose compact
 * normalized names are equal — i.e. the same brand at different
 * addresses (e.g. "Taqueria Los Pericos" in Santa Cruz AND Aptos).
 */
function multipleSameBrandCandidates(proposal: ExtractionProposal): boolean {
  const candidates = proposal.candidates ?? [];
  if (candidates.length < 2) return false;
  const normalize = (value: string | null | undefined): string =>
    (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const seen = new Map<string, number>();
  for (const candidate of candidates) {
    const key = normalize(candidate.name);
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if ((seen.get(key) ?? 0) >= 2) return true;
  }
  return false;
}

function pickPlausibleCandidate(
  proposal: ExtractionProposal,
  context: SafetyContext,
): { googlePlaceId: string; name: string } | null {
  const placeName = (proposal.placeName ?? '').trim();
  if (
    context.resolvedPlaceNameMatchesProposal === true &&
    context.resolvedPlaceFromThisRun === true
  ) {
    // The agent already verified the resolved place matches the
    // proposal — the upgrade is unambiguously safe.
    return { googlePlaceId: 'context-verified', name: placeName || 'resolved_place' };
  }
  const evidenceSet = new Set(proposal.evidenceUsed ?? []);
  const hasAddressAnchor = evidenceSet.has('caption_explicit_address');
  let firstRealCandidate: { googlePlaceId: string; name: string } | null = null;
  for (const candidate of proposal.candidates ?? []) {
    const id = (candidate.googlePlaceId ?? '').trim();
    const name = (candidate.name ?? '').trim();
    if (!id || !name) continue;
    // Skip Gemini stubs whose Place ID is just the name echoed back.
    if (id.toLowerCase() === name.toLowerCase()) continue;
    if (!firstRealCandidate) firstRealCandidate = { googlePlaceId: id, name };
    if (placeName && compactNameMatches(placeName, name)) {
      return { googlePlaceId: id, name };
    }
  }
  // 2026-05-27 — Patch 11b: when the post had an explicit street
  // address in the caption AND Places returned a real candidate
  // (even one Gemini didn't strictly name-match), it is much better
  // UX to surface that candidate for confirmation than to dump the
  // user into manual search. The address anchor is the strong
  // evidence — the user can confirm or pick an alternative.
  if (hasAddressAnchor && firstRealCandidate) return firstRealCandidate;
  return null;
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
