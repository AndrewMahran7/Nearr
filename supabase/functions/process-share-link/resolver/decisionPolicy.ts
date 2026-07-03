// supabase/functions/process-share-link/resolver/decisionPolicy.ts
//
// Translate a ranked candidate list + evidence into a
// `ResolverDecision`. This is the single source of truth for
// when we auto-save, ask the user to confirm, show a picker, or
// punt to the host app.
//
// Policy summary (auto-save count preserved vs. legacy):
//   • auto_save: address-verified single candidate with name match,
//     OR strong-name+correct-state+business-type single candidate
//     with clear lead over second place.
//   • candidate_confirmation: single best candidate but evidence is
//     weak or the lead is narrow.
//   • candidate_picker: 2+ plausible candidates within a tight band.
//   • manual_fallback: no plausible candidate.
//   • failed: hard error (no query, no candidates).

import type { Evidence } from '../evidence/extractEvidence.ts';
import type { ResolverDecision, ResolvedCandidate, Confidence } from '../types.ts';

export type DecisionInput = {
  evidence: Evidence;
  candidates: ResolvedCandidate[];
  /** True iff the top candidate was reached via the address-first
   *  verification path (`verifyPlaceAtAddressServer`). */
  addressVerified: boolean;
};

export type DecisionOutput = {
  decision: ResolverDecision;
  confidence: Confidence;
  safeToAutoSave: boolean;
  primaryCandidate?: ResolvedCandidate;
  candidates: ResolvedCandidate[];
  reasons: string[];
};

const STRONG_SCORE = 0.78;
const MEDIUM_SCORE = 0.55;
const LOW_SCORE = 0.15;
// Below this normalized score, a single candidate must carry a real place
// signal (name/state/address match) to be shown as a confirmation. Chosen
// above the observed platform-noise band (0.16–0.22) and below the legitimate
// name-match band. Does not affect auto-save (address-verified path only).
const CONFIRM_FLOOR = 0.35;
const PICKER_BAND = 0.08;

// Evidence keys that count as a "meaningful" place signal for the purpose
// of confirming a non-address text-search candidate. A bare poster handle /
// poster name / city context is intentionally excluded — those never
// license confirming a candidate that has no name match.
const MEANINGFUL_EVIDENCE_KEYS = new Set<string>([
  'caption_venue_hint',
  'caption_explicit_address',
  'caption_multiple_addresses',
  'venue_handle_tagged',
]);

export function decide(input: DecisionInput): DecisionOutput {
  const { evidence, candidates, addressVerified } = input;
  const reasons: string[] = [];

  if (evidence.isRoundup) {
    reasons.push('roundup_post');
    return {
      decision: 'manual_fallback',
      confidence: 'low',
      safeToAutoSave: false,
      candidates,
      reasons,
    };
  }

  if (candidates.length === 0) {
    reasons.push('no_candidates');
    return {
      decision: 'manual_fallback',
      confidence: 'low',
      safeToAutoSave: false,
      candidates,
      reasons,
    };
  }

  const primary = candidates[0];
  const second = candidates[1];

  // Address-verified single result: highest-trust path.
  //
  // 2026-05-27 regression fix — the gold set is explicit: even
  // address-verified single matches should go through
  // candidate_confirmation. Auto-saving here triggered wrong-place
  // saves when Google returned an adjacent suite (#50 vs the
  // caption's #49) as the only nearby business. The user can still
  // confirm in one tap; we just refuse to commit on their behalf.
  if (addressVerified && candidates.length === 1) {
    reasons.push('address_verified_single');
    return {
      decision: 'candidate_confirmation',
      confidence: 'high',
      safeToAutoSave: false,
      primaryCandidate: primary,
      candidates,
      reasons,
    };
  }

  // Multiple address-verified ambiguous matches: picker.
  if (addressVerified && candidates.length > 1) {
    reasons.push('address_verified_ambiguous');
    return {
      decision: 'candidate_picker',
      confidence: 'medium',
      safeToAutoSave: false,
      primaryCandidate: primary,
      candidates,
      reasons,
    };
  }

  // Non-address path: NEVER auto_save without address verification.
  // The legacy backend only auto-saved when the caption included a
  // verifiable street address (or an address-verified profile). The
  // gold set is explicit: name-only matches must go through
  // candidate_confirmation so the user can sanity-check the city /
  // location before it lands in their saved list.
  const genericCard = primary.reasons.includes('generic_address_card');
  const lead = second ? primary.confidenceScore - second.confidenceScore : 1;

  // Meaningful-evidence gate (2026-07-02): a non-address text-search
  // candidate may only be CONFIRMED when the caption carried at least one
  // real place signal — an explicit venue hint, a street address, or a
  // tagged venue handle — OR the candidate's name actually matches a
  // caption-derived name hint. Casual caption prose ("pretty cool spot!!
  // glad i stopped by") produces neither, so it must route to manual
  // fallback even though Google happily returns unrelated businesses.
  // This does NOT touch auto-save (that path requires address verification).
  const hasMeaningfulEvidence = evidence.keys.some((k) =>
    MEANINGFUL_EVIDENCE_KEYS.has(k),
  );
  const hasNameMatch = primary.reasons.some(
    (r) =>
      r === 'compact_name_match' ||
      r === 'strong_name_match' ||
      r === 'meaningful_name_match',
  );
  if (!hasMeaningfulEvidence && !hasNameMatch) {
    reasons.push('manual_fallback_no_explicit_place_evidence');
    return {
      decision: 'manual_fallback',
      confidence: 'low',
      safeToAutoSave: false,
      primaryCandidate: primary,
      candidates,
      reasons,
    };
  }

  // Two plausible candidates within the picker band: picker.
  if (second && lead < PICKER_BAND && second.confidenceScore >= MEDIUM_SCORE) {
    reasons.push('multiple_plausible_candidates');
    return {
      decision: 'candidate_picker',
      confidence: 'medium',
      safeToAutoSave: false,
      primaryCandidate: primary,
      candidates,
      reasons,
    };
  }

  // Single plausible candidate: ask user to confirm. We use a low
  // threshold here on purpose — the legacy behavior is "surface
  // SOMETHING when we have a non-generic candidate" rather than
  // bouncing the user out to the host app. Manual_fallback is
  // reserved for truly empty or rejected results.
  //
  // Candidate-confirmation FLOOR (2026-07-02): refuse to surface a
  // confirmation for an extremely-low-score candidate that has NO
  // real place signal — no address match, no state/city match, and no
  // name match. This stops arbitrary low-score Google results (e.g. a
  // stray business returned by a noisy caption query) from being
  // presented as "the place". This does NOT touch auto-save (the
  // non-address path never auto-saves) — it only tightens confirmation.
  const hasRealMatch = primary.reasons.some(
    (r) =>
      r === 'compact_name_match' ||
      r === 'strong_name_match' ||
      r === 'meaningful_name_match' ||
      r === 'state_match' ||
      r === 'address_verified' ||
      r === 'address_verified_multi' ||
      r === 'address_verified_multi_ambiguous',
  );
  if (primary.confidenceScore < CONFIRM_FLOOR && !hasRealMatch) {
    reasons.push('below_confirmation_floor');
    return {
      decision: 'manual_fallback',
      confidence: 'low',
      safeToAutoSave: false,
      primaryCandidate: primary,
      candidates,
      reasons,
    };
  }

  if (primary.confidenceScore >= LOW_SCORE && !genericCard) {
    const conf: Confidence =
      primary.confidenceScore >= STRONG_SCORE
        ? 'high'
        : primary.confidenceScore >= MEDIUM_SCORE
          ? 'medium'
          : 'low';
    reasons.push('single_candidate');
    return {
      decision: 'candidate_confirmation',
      confidence: conf,
      safeToAutoSave: false,
      primaryCandidate: primary,
      candidates,
      reasons,
    };
  }

  // Everything else: manual fallback (keeps host app in the loop).
  reasons.push('no_strong_candidate');
  return {
    decision: 'manual_fallback',
    confidence: 'low',
    safeToAutoSave: false,
    primaryCandidate: primary,
    candidates,
    reasons,
  };
}
