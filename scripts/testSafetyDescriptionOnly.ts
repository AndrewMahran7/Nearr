/**
 * scripts/testSafetyDescriptionOnly.ts
 *
 * Asserts the deterministic safety gate for the description-only
 * extraction policy this Nearr version optimises for. No profile bio.
 * No transcript. Captions/titles/page metadata only.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testSafetyDescriptionOnly.ts
 */

import { evaluateSafety } from '../lib/shareAgent/safety';
import type { ExtractionProposal } from '../lib/shareAgent/types';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function baseProposal(overrides: Partial<ExtractionProposal> = {}): ExtractionProposal {
  return {
    platform: 'instagram',
    placeName: '2nd Floor',
    normalizedPlaceName: '2nd floor',
    address: '126 Main St',
    city: 'Huntington Beach',
    state: 'CA',
    country: null,
    searchQuery: '2nd Floor 126 Main St Huntington Beach CA',
    sourceUrl: 'https://www.instagram.com/p/TEST/',
    confidence: 'high',
    decision: 'auto_save',
    safeToAutoSave: false,
    needsUserConfirmation: false,
    evidenceUsed: [
      'caption_explicit_venue',
      'caption_explicit_address',
      'places_strong_match',
    ],
    toolsUsed: ['fetchPostMetadata', 'searchPlaces', 'compareCandidateToEvidence'],
    reasoning: 'caption has explicit venue + address',
    rejectionReasons: [],
    candidates: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. exact restaurant name + full address (the DYpcd2ZBTsZ case) →
//    auto_save even with profile_blocked.
// ---------------------------------------------------------------------------
{
  const proposal = baseProposal({
    evidenceUsed: [
      'caption_explicit_venue',
      'caption_explicit_address',
      'places_strong_match',
      'profile_blocked',
    ],
  });
  const result = evaluateSafety(proposal, {
    resolvedPlaceFromThisRun: true,
    topMatchScore: 1.0,
    secondMatchScore: null,
    resolvedPlaceNameMatchesProposal: true,
    resolvedPlaceAddressMatchesProposal: true,
  });
  check(
    'caption venue+address + strong Places + profile_blocked → auto_save',
    result.decision === 'auto_save' && result.safeToAutoSave === true,
    `decision=${result.decision} safe=${result.safeToAutoSave} reasons=${result.reasons.join(',')}`,
  );
  check(
    'reasons include both profile_fetch_blocked (warning) and supersede marker',
    result.reasons.includes('profile_fetch_blocked') &&
      result.reasons.includes('profile_fetch_blocked_superseded_by_strong_description'),
    `reasons=${result.reasons.join(',')}`,
  );
}

// ---------------------------------------------------------------------------
// 2. full address only (no explicit venue name) → still auto_save when
//    Places match is strong and address is verified.
// ---------------------------------------------------------------------------
{
  const proposal = baseProposal({
    placeName: null,
    normalizedPlaceName: null,
    evidenceUsed: [
      'caption_explicit_address',
      'places_strong_match',
      'profile_blocked',
    ],
  });
  const result = evaluateSafety(proposal, {
    resolvedPlaceFromThisRun: true,
    topMatchScore: 0.9,
    secondMatchScore: null,
    resolvedPlaceNameMatchesProposal: null,
    resolvedPlaceAddressMatchesProposal: true,
  });
  check(
    'address-only + strong Places + profile_blocked → auto_save',
    result.decision === 'auto_save' && result.safeToAutoSave === true,
    `decision=${result.decision} reasons=${result.reasons.join(',')}`,
  );
}

// ---------------------------------------------------------------------------
// 3. restaurant name + city, weak Places match → candidate_confirmation,
//    never auto_save.
// ---------------------------------------------------------------------------
{
  const proposal = baseProposal({
    address: null,
    evidenceUsed: ['caption_explicit_venue', 'places_weak_match'],
  });
  const result = evaluateSafety(proposal, {
    resolvedPlaceFromThisRun: true,
    topMatchScore: 0.55,
    secondMatchScore: 0.4,
    resolvedPlaceNameMatchesProposal: true,
    resolvedPlaceAddressMatchesProposal: null,
  });
  check(
    'venue+city + weak Places → candidate_confirmation (not auto)',
    result.decision === 'candidate_confirmation' && !result.safeToAutoSave,
    `decision=${result.decision} reasons=${result.reasons.join(',')}`,
  );
  check(
    'reasons include weak_places_match',
    result.reasons.includes('weak_places_match'),
  );
}

// ---------------------------------------------------------------------------
// 4. handle-only — no caption/address — must never auto_save and must
//    stay manual_fallback regardless of profile_blocked status. This is
//    the hard guarantee that "no profile bio" does NOT mean
//    "trust handles".
// ---------------------------------------------------------------------------
{
  const proposal = baseProposal({
    placeName: null,
    normalizedPlaceName: null,
    address: null,
    city: null,
    state: null,
    confidence: 'medium',
    decision: 'candidate_confirmation',
    evidenceUsed: ['poster_handle_only', 'profile_blocked'],
  });
  const result = evaluateSafety(proposal, {
    resolvedPlaceFromThisRun: false,
    topMatchScore: null,
    secondMatchScore: null,
  });
  check(
    'handle-only + profile_blocked → manual_fallback (no auto, no candidate)',
    result.decision === 'manual_fallback' && !result.safeToAutoSave,
    `decision=${result.decision} reasons=${result.reasons.join(',')}`,
  );
  check(
    'handle-only reasons include handle_context_unverified',
    result.reasons.includes('handle_context_unverified'),
  );
}

// ---------------------------------------------------------------------------
// 5. generic food video — no restaurant, no address → manual_fallback.
// ---------------------------------------------------------------------------
{
  const proposal = baseProposal({
    placeName: null,
    normalizedPlaceName: null,
    address: null,
    city: null,
    state: null,
    confidence: 'low',
    decision: 'manual_fallback',
    evidenceUsed: ['generic_content', 'places_no_match'],
  });
  const result = evaluateSafety(proposal, {
    resolvedPlaceFromThisRun: false,
    topMatchScore: null,
    secondMatchScore: null,
  });
  check(
    'generic_content → manual_fallback (no auto)',
    result.decision === 'manual_fallback' && !result.safeToAutoSave,
    `decision=${result.decision} reasons=${result.reasons.join(',')}`,
  );
  check(
    'generic_content reasons include weak_generic_text',
    result.reasons.includes('weak_generic_text'),
  );
}

// ---------------------------------------------------------------------------
// 6. Negative: profile_blocked override does NOT apply when Places is
//    weak. Auto-save must stay disabled — strong description alone is
//    not enough without Google's confirmation.
// ---------------------------------------------------------------------------
{
  const proposal = baseProposal({
    evidenceUsed: [
      'caption_explicit_venue',
      'caption_explicit_address',
      'places_weak_match',
      'profile_blocked',
    ],
  });
  const result = evaluateSafety(proposal, {
    resolvedPlaceFromThisRun: true,
    topMatchScore: 0.5,
    secondMatchScore: null,
    resolvedPlaceNameMatchesProposal: true,
    resolvedPlaceAddressMatchesProposal: true,
  });
  check(
    'strong caption + WEAK Places + profile_blocked → NOT auto_save',
    result.decision !== 'auto_save' && !result.safeToAutoSave,
    `decision=${result.decision} reasons=${result.reasons.join(',')}`,
  );
  check(
    'supersede marker NOT emitted when Places is weak',
    !result.reasons.includes(
      'profile_fetch_blocked_superseded_by_strong_description',
    ),
    `reasons=${result.reasons.join(',')}`,
  );
}

// ---------------------------------------------------------------------------
// 7. Negative: ambiguous candidates still block auto-save even with
//    strong description + profile_blocked override.
// ---------------------------------------------------------------------------
{
  const proposal = baseProposal({
    evidenceUsed: [
      'caption_explicit_venue',
      'caption_explicit_address',
      'places_strong_match',
      'profile_blocked',
    ],
  });
  const result = evaluateSafety(proposal, {
    resolvedPlaceFromThisRun: true,
    topMatchScore: 0.9,
    secondMatchScore: 0.85,
    resolvedPlaceNameMatchesProposal: true,
    resolvedPlaceAddressMatchesProposal: true,
  });
  check(
    'ambiguous_candidates → candidate_confirmation even with override',
    result.decision === 'candidate_confirmation' && !result.safeToAutoSave,
    `decision=${result.decision} reasons=${result.reasons.join(',')}`,
  );
  check(
    'reasons include ambiguous_candidates',
    result.reasons.includes('ambiguous_candidates'),
  );
}

console.log('');
if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All description-only safety tests passed');
