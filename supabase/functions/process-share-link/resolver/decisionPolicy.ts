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
const PICKER_BAND = 0.08;

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
