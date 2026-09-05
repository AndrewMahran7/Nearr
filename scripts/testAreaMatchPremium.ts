import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  classifyAreaMatchSpecificity,
  type AreaMatchSpecificityInput,
} from '../lib/areaMatchPremium';
import {
  hasSpecificActionableResult,
  isPremiumResultChargeable,
  premiumEligibilityForResult,
} from '../lib/premiumRequestMonetization';
import { buildShareJobDetailState } from '../lib/shareJobDetailState';
import { partialResultFromPayload } from '../lib/shareJobResult';
import {
  buildVayrinPartialResult,
  type PartialPlaceEvidence,
} from '../supabase/functions/process-share-jobs/mediaEvidence';
import { composeShareCompletionNotification } from '../supabase/functions/process-share-jobs/shareCompletionNotification';

const results: string[] = [];
function test(number: number, name: string, run: () => void): void {
  assert.equal(number, results.length + 1, `test matrix number drift at ${name}`);
  run();
  results.push(name);
  console.log(`PASS ${number}. ${name}`);
}

function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

function partial(input: Partial<PartialPlaceEvidence>): PartialPlaceEvidence {
  return {
    nameHint: null,
    category: null,
    categoryConfidence: 0.9,
    categoryEvidenceTags: [],
    addressHint: null,
    city: null,
    region: null,
    country: null,
    role: 'primary',
    confidence: 0.8,
    explicitEvidence: [],
    validationErrors: ['exact_identity_unresolved'],
    ...input,
  };
}

function fromPartialPlace(input: Partial<PartialPlaceEvidence>) {
  const value = buildVayrinPartialResult({
    places: [],
    partialPlaces: [partial(input)],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
  });
  assert.ok(value);
  return value;
}

function incompletePayload(input: AreaMatchSpecificityInput = { region: 'Bali', country: 'Indonesia', category: 'scenic_spot' }) {
  const specificity = classifyAreaMatchSpecificity(input);
  assert.ok(specificity);
  assert.equal(specificity.resultClass, 'area_match_incomplete');
  return {
    version: 2,
    candidates: [],
    mentionSlots: [],
    partialResult: {
      version: 1,
      reviewOnly: true,
      locality: specificity.area.name,
      category: input.category ?? null,
      searchQuery: [input.category?.replace(/_/g, ' '), specificity.area.name].filter(Boolean).join(' '),
      clueCount: 2,
      discoveryOnly: true,
      ...specificity,
    },
  };
}

function eligibility(payload: unknown, overrides: Record<string, unknown> = {}) {
  return premiumEligibilityForResult({
    status: 'needs_help',
    analysis_attempted: true,
    candidate_payload: payload,
    ...overrides,
  });
}

const bali = fromPartialPlace({
  category: 'scenic_spot', region: 'Bali', country: 'Indonesia',
  explicitEvidence: [
    { source: 'frame', value: 'person cliff jumping from an ocean cliff', timestampSeconds: 3 },
    { source: 'visible_text', value: 'Bali, Indonesia', timestampSeconds: 1 },
  ],
});

test(1, 'cliff jumping plus Bali-only becomes incomplete and Premium eligible', () => {
  assert.equal(bali.resultClass, 'area_match_incomplete');
  assert.equal(bali.area?.name, 'Bali');
  assert.equal(eligibility({ version: 2, candidates: [], mentionSlots: [], partialResult: bali }).eligible, true);
});
test(2, 'hidden waterfall plus Maui-only is Premium eligible', () => {
  const value = fromPartialPlace({ category: 'waterfall', region: 'Maui', country: 'United States', explicitEvidence: [
    { source: 'speech', value: 'hidden waterfall in Maui', timestampSeconds: 2 },
  ] });
  assert.equal(eligibility({ version: 2, candidates: [], mentionSlots: [], partialResult: value }).eligible, true);
});
test(3, 'restaurant intent plus Los Angeles-only is Premium eligible', () => {
  const value = fromPartialPlace({ category: 'restaurant', city: 'Los Angeles', country: 'United States', explicitEvidence: [
    { source: 'caption', value: 'restaurant somewhere in Los Angeles', timestampSeconds: null },
  ] });
  assert.equal(value.intendedSpecificity, 'SPECIFIC_PHYSICAL_DESTINATION');
  assert.equal(eligibility({ version: 2, candidates: [], mentionSlots: [], partialResult: value }).eligible, true);
});
test(4, 'hike plus Oregon-only is Premium eligible', () => {
  const value = fromPartialPlace({ category: 'hiking_trail', region: 'Oregon', country: 'United States', explicitEvidence: [
    { source: 'speech', value: 'this hike is in Oregon', timestampSeconds: 7 },
  ] });
  assert.equal(value.resolvedSpecificity, 'REGION');
  assert.equal(eligibility({ version: 2, candidates: [], mentionSlots: [], partialResult: value }).eligible, true);
});
test(5, 'an exact restaurant suppresses Premium', () => {
  assert.equal(eligibility({ ...incompletePayload(), candidates: [{ googlePlaceId: 'restaurant-1', name: 'Nobu Malibu' }] }).eligible, false);
});
test(6, 'an exact natural feature suppresses Premium', () => {
  assert.equal(eligibility({ ...incompletePayload(), candidates: [{ googlePlaceId: 'falls-1', name: 'Hidden Falls' }] }).eligible, false);
});
test(7, 'one useful specific candidate suppresses Premium', () => {
  assert.equal(eligibility({ ...incompletePayload(), candidates: [{ formattedAddress: '1 Main St', name: 'Cafe' }] }).eligible, false);
});
test(8, 'two or three specific candidates suppress Premium', () => {
  const candidates = [1, 2, 3].map((id) => ({ googlePlaceId: `p-${id}`, name: `Place ${id}` }));
  assert.equal(eligibility({ ...incompletePayload(), candidates }).eligible, false);
});
test(9, 'legitimate Bali-as-destination stays a terminal area match', () => {
  const value = classifyAreaMatchSpecificity({ region: 'Bali', country: 'Indonesia', category: 'island', areaIsDestination: true });
  assert.equal(value?.resultClass, 'area_match');
  assert.equal(value?.premiumEligible, false);
});
test(10, 'legitimate city-as-destination does not force Premium', () => {
  assert.equal(classifyAreaMatchSpecificity({ city: 'Tokyo', country: 'Japan', areaIsDestination: true })?.intendedSpecificity, 'AREA_DESTINATION');
});
test(11, 'legitimate country-as-destination preserves existing behavior', () => {
  const value = classifyAreaMatchSpecificity({ country: 'Croatia', areaIsDestination: true });
  assert.equal(value?.resolvedSpecificity, 'COUNTRY');
  assert.equal(value?.resultClass, 'area_match');
});
test(12, 'technical failure never offers Premium', () => {
  assert.equal(eligibility(incompletePayload(), { failure_category: 'technical_failure', failure_code: 'processing_error' }).eligible, false);
});
test(13, 'authentication required never offers Premium', () => {
  assert.equal(eligibility(incompletePayload(), { failure_code: 'authentication_required' }).eligible, false);
});
test(14, 'media unavailable never offers Premium', () => {
  assert.equal(eligibility(incompletePayload(), { failure_code: 'media_unavailable' }).eligible, false);
});
test(15, 'duration too long never offers Premium', () => {
  assert.equal(eligibility(incompletePayload(), { failure_code: 'duration_too_long' }).eligible, false);
});

type Wallet = { available: number; reserved: Set<string>; consumed: Set<string> };
function reserve(wallet: Wallet, jobId: string): void {
  if (wallet.reserved.has(jobId) || wallet.consumed.has(jobId)) return;
  assert.ok(wallet.available > 0);
  wallet.available -= 1;
  wallet.reserved.add(jobId);
}
function settle(wallet: Wallet, jobId: string, chargeable: boolean): void {
  if (!wallet.reserved.delete(jobId)) return;
  if (chargeable) wallet.consumed.add(jobId);
  else wallet.available += 1;
}

test(16, 'an area partial consumes zero tokens', () => {
  const wallet: Wallet = { available: 3, reserved: new Set(), consumed: new Set() };
  eligibility(incompletePayload());
  assert.equal(wallet.available, 3);
});
test(17, 'opening the Premium offer consumes zero tokens', () => {
  const wallet: Wallet = { available: 3, reserved: new Set(), consumed: new Set() };
  buildShareJobDetailState({ status: 'needs_help', candidate_payload: incompletePayload() });
  assert.equal(wallet.available, 3);
});
test(18, 'explicit Premium CTA reserves exactly one token', () => {
  const wallet: Wallet = { available: 3, reserved: new Set(), consumed: new Set() };
  reserve(wallet, 'job-1');
  assert.equal(wallet.available, 2);
  assert.match(source('supabase/migrations/20260904000001_premium_request_monetization.sql'), /request_premium_recognition[\s\S]*reserve_place_find_use/);
});
test(19, 'duplicate Premium CTA remains idempotent', () => {
  const wallet: Wallet = { available: 3, reserved: new Set(), consumed: new Set() };
  reserve(wallet, 'job-1'); reserve(wallet, 'job-1');
  assert.equal(wallet.available, 2);
  assert.match(source('supabase/migrations/20260904000001_premium_request_monetization.sql'), /replayed boolean[\s\S]*for update/);
});
test(20, 'actionable Premium result consumes the reservation', () => {
  const wallet: Wallet = { available: 3, reserved: new Set(), consumed: new Set() };
  reserve(wallet, 'job-1');
  const chargeable = isPremiumResultChargeable({ status: 'completed', saved_place_id: 'saved-1' }).chargeable;
  settle(wallet, 'job-1', chargeable);
  assert.deepEqual([wallet.available, wallet.consumed.has('job-1')], [2, true]);
});
test(21, 'no-result Premium releases the reservation', () => {
  const wallet: Wallet = { available: 3, reserved: new Set(), consumed: new Set() };
  reserve(wallet, 'job-1');
  const chargeable = isPremiumResultChargeable({ status: 'needs_help', candidate_payload: {} }).chargeable;
  settle(wallet, 'job-1', chargeable);
  assert.deepEqual([wallet.available, wallet.consumed.size], [3, 0]);
});
test(22, 'the useful area clue remains visible through the client adapter', () => {
  const normalized = partialResultFromPayload({ partialResult: { version: 1, reviewOnly: true, locality: 'Bali', category: 'scenic_spot', searchQuery: 'scenic spot Bali', clueCount: 2, discoveryOnly: true, ...classifyAreaMatchSpecificity({ region: 'Bali', country: 'Indonesia', category: 'scenic_spot' }) } });
  assert.deepEqual([normalized?.resultClass, normalized?.area?.name, normalized?.area?.country], ['area_match_incomplete', 'Bali', 'Indonesia']);
  const screen = source('app/share-jobs/[jobId].tsx');
  assert.match(screen, /AREA FOUND/);
  assert.match(screen, /See places in this area/);
  assert.match(source('lib/vayrinPresentation.ts'), /We narrowed it down to \$\{place\}, but couldn't identify the exact spot/);
});
test(23, 'an incomplete area is never silently saved', () => {
  const state = buildShareJobDetailState({ status: 'needs_help', saved_place_id: null, candidate_payload: incompletePayload() });
  assert.deepEqual([state.kind, state.savedPlaceId, state.candidates.length], ['manual', null, 0]);
});
test(24, 'an explicit area save remains possible when the user chooses it', () => {
  assert.equal(hasSpecificActionableResult({ candidates: [{ googlePlaceId: 'bali-area', name: 'Bali' }] }), true);
  assert.equal(classifyAreaMatchSpecificity({ region: 'Bali', country: 'Indonesia', areaIsDestination: true })?.premiumEligible, false);
});
test(25, 'area partial is tracked separately and not as exact-recognition success', () => {
  const screen = source('app/share-jobs/[jobId].tsx');
  for (const event of [
    'area_match_incomplete_shown',
    'premium_request_cta_tapped',
    'area_match_browse_tapped',
    'manual_search_from_area_match',
  ]) assert.match(screen, new RegExp(event));
  assert.match(source('supabase/functions/process-share-jobs/index.ts'), /premium_request_offered/);
  assert.doesNotMatch(screen.match(/area_match_incomplete_shown[\s\S]{0,400}/)?.[0] ?? '', /recognition_success|exact_place_identified/);
});
test(26, 'area partial notification never says Found it', () => {
  const note = composeShareCompletionNotification({ jobId: 'job-1', status: 'needs_help', notificationLocality: { label: 'Bali', basis: 'observable_corroborated' } });
  assert.equal(note.title, 'We narrowed it down');
  assert.doesNotMatch(`${note.title} ${note.body}`, /Found it/i);
});
test(27, 'Premium keeps the same source and job identity', () => {
  const client = source('lib/monetizationClient.ts');
  assert.match(client, /requestPremiumRecognition\(jobId[\s\S]*premiumJobId: jobId/);
  assert.match(source('supabase/migrations/20260904000001_premium_request_monetization.sql'), /request_premium_recognition\(p_user_id uuid,p_job_id uuid\)/);
});
test(28, 'Premium requires no reshare', () => {
  const screen = source('app/share-jobs/[jobId].tsx');
  assert.match(screen, /requestPremiumRecognition\(job\.id\)/);
  assert.doesNotMatch(screen.match(/const startPremiumRequest[\s\S]*?\n  \}, \[job/)?.[0] ?? '', /create_share_job|source_url|reshare/i);
});
test(29, 'the Simple Sol Premium request path is unchanged', () => {
  const fingerprint = source('services/media-worker/src/premium/premiumInferenceFingerprint.ts');
  assert.match(fingerprint, /PREMIUM_ENGINE_VERSION = 'simple-sol-premium\.v2'/);
  assert.match(fingerprint, /PREMIUM_EVIDENCE_VERSION = 'premium-evidence-2026-09-05\.v1'/);
  assert.match(fingerprint, /PREMIUM_SAFETY_VERSION = 'premium-recognition-safety\.v2'/);
  assert.match(source('services/media-worker/src/solParity/types.ts'), /SOL_PARITY_PROMPT_VERSION = 'sol-parity-natural-v1'/);
});
test(30, 'C07 Premium safety behavior remains pinned', () => {
  assert.match(source('services/media-worker/tests/premiumSolRecognition.test.ts'), /C07 famous-clip prior cannot unsafe-autosave/);
});
test(31, 'R03 Premium recognition behavior remains pinned', () => {
  assert.match(source('services/media-worker/tests/premiumSolRecognition.test.ts'), /R03 regression keeps Tamolitch family/);
});
test(32, 'multi-place siblings remain preserved under the job-level limitation', () => {
  const payload = {
    ...incompletePayload(),
    selectionMode: 'multi_independent',
    savedPlaceIds: ['saved-1', 'saved-2', 'saved-3', 'saved-4'],
    mentionSlots: [1, 2, 3, 4, 5].map((id) => ({
      mentionId: `m-${id}`, displayName: `Place ${id}`,
      outcome: id < 5 ? 'verified_single' : 'no_match',
      candidates: [], savedPlaceId: id < 5 ? `saved-${id}` : null,
    })),
  };
  const state = buildShareJobDetailState({ status: 'needs_help', saved_place_id: 'saved-1', candidate_payload: payload });
  assert.deepEqual([state.kind, state.savedPlaceIds.length], ['multi', 4]);
  assert.equal(eligibility(payload, { saved_place_id: 'saved-1' }).eligible, false);
});

assert.equal(results.length, 32);
console.log('PASS area-match Premium matrix (32/32)');
