import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  PREMIUM_REQUEST_STATES,
  hasSpecificActionableResult,
  isPremiumResultChargeable,
  premiumEligibilityForResult,
} from '../lib/premiumRequestMonetization';
import { PLACE_FIND_DEV_PACKS, PLACE_FIND_FREE_LIFETIME_USES } from '../lib/placeFindConfig';

const passed: string[] = [];
function test(name: string, run: () => void): void {
  run();
  passed.push(name);
  console.log(`PASS ${name}`);
}
function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

const eligibleBase = {
  status: 'needs_help',
  analysis_attempted: true,
  failure_category: 'analysis_insufficient',
  candidate_payload: {},
};

for (const code of ['insufficient_evidence', 'no_result', 'no_trustworthy_place', 'recognition_recovery_exhausted']) {
  test(`eligible: completed normal analysis with ${code}`, () => {
    assert.equal(premiumEligibilityForResult({ ...eligibleBase, failure_code: code }).eligible, true);
  });
}

for (const code of [
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
]) {
  test(`not eligible: excluded ${code}`, () => {
    assert.equal(premiumEligibilityForResult({ ...eligibleBase, failure_code: code }).eligible, false);
  });
}

for (const status of ['queued', 'processing_metadata', 'completed', 'failed', 'cancelled']) {
  test(`not eligible: non-insufficient terminal ${status}`, () => {
    assert.equal(premiumEligibilityForResult({ ...eligibleBase, status }).eligible, false);
  });
}

test('not eligible: analysis never attempted', () => {
  assert.equal(premiumEligibilityForResult({ ...eligibleBase, analysis_attempted: false }).eligible, false);
});
test('not eligible: unstructured needs-help reason', () => {
  assert.equal(premiumEligibilityForResult({ status: 'needs_help', analysis_attempted: true, needs_help_reason: 'copy_says_try_premium' }).eligible, false);
});
test('not eligible: a saved place exists', () => {
  assert.equal(premiumEligibilityForResult({ ...eligibleBase, saved_place_id: 'saved' }).eligible, false);
});

const concreteCandidates: Array<[string, unknown]> = [
  ['Google id', { googlePlaceId: 'g-1', name: 'Cafe' }],
  ['snake Google id', { google_place_id: 'g-2', name: 'Cafe' }],
  ['place id', { placeId: 'p-1', name: 'Cafe' }],
  ['coordinates', { name: 'Cafe', latitude: 34.1, longitude: -118.2 }],
  ['formatted address', { name: 'Cafe', formattedAddress: '1 Main St' }],
];
for (const [label, candidate] of concreteCandidates) {
  test(`specific candidate recognized: ${label}`, () => {
    assert.equal(hasSpecificActionableResult({ candidates: [candidate] }), true);
  });
}
test('specific multi-place candidate recognized', () => {
  assert.equal(hasSpecificActionableResult({ mentionSlots: [{ candidates: [{ googlePlaceId: 'g' }] }] }), true);
});
test('saved multi-place slot recognized', () => {
  assert.equal(hasSpecificActionableResult({ mentionSlots: [{ savedPlaceId: 's' }] }), true);
});
test('observable named physical-location lead is actionable', () => {
  assert.equal(hasSpecificActionableResult({
    mentionSlots: [{ identityHypotheses: [{ name: 'The French Laundry', evidenceKind: 'observable' }] }],
  }), true);
});
test('field-grounded named search lead is actionable', () => {
  assert.equal(hasSpecificActionableResult({
    mentionSlots: [],
    partialResult: { resultClass: 'search_lead', searchQuery: 'The French Laundry', clueCount: 2 },
  }), true);
});
test('model-prior named lead is not actionable', () => {
  assert.equal(hasSpecificActionableResult({
    mentionSlots: [{ identityHypotheses: [{ name: 'The French Laundry', evidenceKind: 'model_prior' }] }],
  }), false);
});
test('area-only partial is not actionable', () => {
  assert.equal(hasSpecificActionableResult({
    partialResult: { resultClass: 'area_match', searchQuery: 'coffee Los Angeles', clueCount: 3 },
  }), false);
});
test('broad city-only lead is not actionable', () => {
  assert.equal(hasSpecificActionableResult({ candidates: [{ name: 'Los Angeles' }] }), false);
});
test('generic category-only lead is not actionable', () => {
  assert.equal(hasSpecificActionableResult({ candidates: [{ name: 'coffee shop' }] }), false);
});
test('malformed payload is not actionable', () => {
  assert.equal(hasSpecificActionableResult('not-json'), false);
});

test('charge: saved Premium result', () => {
  assert.equal(isPremiumResultChargeable({ status: 'completed', saved_place_id: 'saved' }).chargeable, true);
});
for (const [label, candidate] of concreteCandidates) {
  test(`charge: specific Premium ${label}`, () => {
    assert.equal(isPremiumResultChargeable({ status: 'needs_help', candidate_payload: { candidates: [candidate] } }).chargeable, true);
  });
}
for (const [label, facts] of [
  ['empty result', { status: 'needs_help', candidate_payload: {} }],
  ['broad result', { status: 'needs_help', candidate_payload: { candidates: [{ name: 'California' }] } }],
  ['technical failure', { status: 'failed', failure_code: 'provider_unavailable' }],
  ['cancelled', { status: 'cancelled' }],
  ['processing', { status: 'processing_metadata' }],
] as const) {
  test(`release: ${label}`, () => {
    assert.equal(isPremiumResultChargeable(facts).chargeable, false);
  });
}

test('durable state machine contains every required state exactly once', () => {
  assert.deepEqual(PREMIUM_REQUEST_STATES, [
    'not_eligible','eligible','awaiting_token','reserved','processing',
    'useful_result','no_useful_result','failed','cancelled',
  ]);
});
test('pack economics and lifetime tokens match V2', () => {
  assert.equal(PLACE_FIND_FREE_LIFETIME_USES, 5);
  assert.deepEqual(PLACE_FIND_DEV_PACKS.map((pack) => [pack.uses, pack.mockDisplayPrice]), [
    [10, '$7.99'], [30, '$20.99'], [75, '$44.99'],
  ]);
});

const migration = source('supabase/migrations/20260904000001_premium_request_monetization.sql');
const originalMigration = source('supabase/migrations/20260903000001_place_find_monetization.sql');
const processor = source('supabase/functions/process-share-jobs/index.ts');
const monetizationEdge = source('supabase/functions/monetization/index.ts');
const monetizationClient = source('lib/monetizationClient.ts');
const workerModel = source('services/media-worker/src/providers/model.ts');
const workerIndex = source('services/media-worker/src/index.ts');
const workerPipeline = source('services/media-worker/src/pipeline/runMediaTask.ts');
const workerPremium = source('services/media-worker/src/premium/premiumRecognitionAdapter.ts');
const detail = source('app/share-jobs/[jobId].tsx');
const store = source('app/monetization.tsx');
const settings = source('app/(tabs)/settings.tsx');
const map = source('app/(tabs)/map.tsx');
const extension = source('ShareExtension.tsx');
const handoff = source('components/ShareJobHandoff.tsx');

const sourceTests: Array<[string, () => void]> = [
  ['normal create is explicitly normal_free', () => assert.match(migration, /'normal_free','unmetered:normal_free'/)],
  ['normal create never reserves', () => assert.doesNotMatch(migration.match(/create or replace function public\.create_share_job_for_user[\s\S]*?end;\s*\$\$;/)?.[0] ?? '', /reserve_place_find_use/)],
  ['premium request RPC is service-role only', () => assert.match(migration, /request_premium_recognition\(uuid,uuid\)[\s\S]*to service_role/)],
  ['premium request verifies owner in locked row', () => assert.match(migration, /where id=p_job_id and user_id=p_user_id for update/)],
  ['premium request reserves after explicit request', () => assert.match(migration, /request_premium_recognition[\s\S]*reserve_place_find_use/)],
  ['premium task has unique request identity', () => assert.match(migration, /share_media_tasks_premium_request_uidx/)],
  ['premium task has unique job obligation', () => assert.match(migration, /share_media_tasks_premium_job_uidx/)],
  ['zero balance persists awaiting_token', () => assert.match(migration, /premium_state='awaiting_token'/)],
  ['purchase resumes exact premium request', () => assert.match(monetizationEdge, /premiumJobId[\s\S]*request_premium_recognition/)],
  ['client stores pending premium job identity', () => assert.match(detail, /setPendingPremiumRequestJobId\(job\.id\)/)],
  ['store auto-resumes without a second request tap', () => assert.match(store, /resumed automatically on the original post/)],
  ['normal worker model omits Premium Sol', () => assert.doesNotMatch(workerModel.match(/export function selectModelProvider[\s\S]*?\n\}/)?.[0] ?? '', /PremiumRecognition|premiumRequest/)],
  ['worker wires distinct premium model', () => assert.match(workerIndex, /premiumModel: createPremiumRecognitionModel\(cfg\)/)],
  ['premium task selects premium model', () => assert.match(workerPipeline, /task\.task_kind === 'premium_recognition'[\s\S]*deps\.premiumModel/)],
  ['premium path invokes the explicit direct Sol engine', () => assert.match(workerPremium, /runPremiumRecognition\(/)],
  ['premium path contains no MCP integration', () => assert.doesNotMatch([workerModel, workerIndex, workerPipeline, workerPremium].join('\n'), /model context protocol|mcp__/i)],
  ['central Edge chargeability policy is used', () => assert.match(processor, /isPremiumResultChargeable/)],
  ['premium settlement is atomic RPC', () => assert.match(processor, /settle_premium_request/)],
  ['technical Premium results release', () => assert.match(processor, /failure_category === 'technical_failure'[\s\S]*'failed'/)],
  ['Premium no-result remains analysis-insufficient and releases', () => assert.match(source('lib/shareFailurePresentation.ts'), /INSUFFICIENT_CODES[\s\S]*premium_no_useful_result/)],
  ['normal settlement is unmetered', () => assert.match(processor, /billing_outcome = 'unmetered:normal_free'/)],
  ['offer copy states normal recognition was free', () => assert.match(detail, /Normal recognition was free/)],
  ['offer displays one-token price', () => assert.match(detail, /Try Premium Request · 1 token/)],
  ['failure explicitly says token returned', () => assert.match(detail, /Your token was returned\./)],
  ['failure offers manual search and Done', () => {
    assert.match(detail, /title="Search manually"/);
    assert.match(detail, /title="Done"/);
  }],
  ['Premium offer uses the token mark', () => assert.match(detail, /<TokenSymbol size=\{26\}/)],
  ['store is positioned around Premium Requests', () => assert.match(store, /PREMIUM REQUESTS|Premium Request/)],
  ['settings has compact Premium copy', () => assert.match(settings, /Used for Premium Requests/)],
  ['settings has no per-share charge copy', () => assert.doesNotMatch(settings, /token per shared video/i)],
  ['map has no balance surface', () => assert.doesNotMatch(map, /PlaceFindBalance|usePlaceFindBalance|token balance/i)],
  ['share extension has no token gate', () => assert.doesNotMatch(extension, /purchase_required|out of tokens|monetization\?jobId/i)],
  ['host share handoff has no token gate', () => assert.doesNotMatch(handoff, /out_of_finds|balance_exhausted|out of tokens/i)],
  ['product identifiers remain stable', () => {
    for (const id of ['place_finds.10','place_finds.25','place_finds.50']) assert.match(migration, new RegExp(id.replace('.', '\\.')));
  }],
  ['five-token grant remains lifetime_v1', () => assert.match(originalMigration, /'free_lifetime','lifetime_v1',5,5/)],
  ['request analytics are privacy-safe ids and enums', () => assert.doesNotMatch(migration.match(/premium_request_started[\s\S]{0,250}/)?.[0] ?? '', /source_url|caption|transcript/)],
];
for (const [name, run] of sourceTests) test(name, run);

assert.ok(passed.length >= 40, `expected at least 40 cases, got ${passed.length}`);
const outputDir = path.resolve(process.cwd(), 'artifacts/monetization');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'premium-request-monetization-test-results.json'), `${JSON.stringify({
  suite: 'premium-request-monetization',
  passed: passed.length,
  failed: 0,
  cases: passed,
}, null, 2)}\n`);
console.log(`PASS wrote artifacts/monetization/premium-request-monetization-test-results.json (${passed.length} cases)`);
