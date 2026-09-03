import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  applyPlaceFindPurchase,
  consumePlaceFind,
  emptyPlaceFindLedger,
  grantPlaceFinds,
  releasePlaceFind,
  reservePlaceFind,
} from '../lib/placeFindLedger';
import { PLACE_FIND_DEV_PACKS, PLACE_FIND_FREE_LIFETIME_USES } from '../lib/placeFindConfig';
import { placeFindSettlementForTerminalJob } from '../lib/placeFindSettlement';
import { classifyShareJobDetail, isQueueVisibleStatus } from '../lib/shareJobRouting';
import { queueSwipeAvailability } from '../lib/queueInbox';

const passed: string[] = [];
function test(name: string, run: () => void): void {
  run();
  passed.push(name);
  console.log(`PASS ${name}`);
}
function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

test('pack economics stay 10/25/50 and lifetime grant stays 5', () => {
  assert.equal(PLACE_FIND_FREE_LIFETIME_USES, 5);
  assert.deepEqual(PLACE_FIND_DEV_PACKS.map((pack) => pack.uses), [10, 25, 50]);
});

let state = emptyPlaceFindLedger();
test('new permanent account gets the free grant exactly once', () => {
  const first = grantPlaceFinds(state, 'free:user-1:v1', 5);
  state = first.state;
  assert.equal(first.replayed, false);
  const replay = grantPlaceFinds(state, 'free:user-1:v1', 5);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.available, 5);
});
test('existing account initialization does not duplicate its grant', () => {
  assert.equal(grantPlaceFinds(state, 'free:user-1:v1', 5).state.available, 5);
});
test('job creation reserves before work and duplicate creation is idempotent', () => {
  const reserved = reservePlaceFind(state, 'job-useful');
  state = reserved.state;
  assert.deepEqual({ available: state.available, reserved: state.reserved }, { available: 4, reserved: 1 });
  assert.equal(reservePlaceFind(state, 'job-useful').replayed, true);
});
test('durable result consumes once', () => {
  state = consumePlaceFind(state, 'job-useful').state;
  assert.equal(state.reserved, 0);
  assert.equal(consumePlaceFind(state, 'job-useful').replayed, true);
});
test('technical/no-result settlement releases', () => {
  state = reservePlaceFind(state, 'job-failed').state;
  state = releasePlaceFind(state, 'job-failed').state;
  assert.equal(state.available, 4);
  assert.equal(releasePlaceFind(state, 'job-failed').replayed, true);
});
test('retry creates a new reservation cycle without double debit', () => {
  state = reservePlaceFind(state, 'job-failed').state;
  assert.equal(state.reservations.get('job-failed')?.cycle, 2);
  assert.equal(state.available, 3);
});
test('concurrent different jobs cannot overspend a zero balance', () => {
  let one = grantPlaceFinds(emptyPlaceFindLedger(), 'single', 1).state;
  one = reservePlaceFind(one, 'concurrent-a').state;
  assert.throws(() => reservePlaceFind(one, 'concurrent-b'), /insufficient_place_finds/);
});
test('duplicate purchase transaction grants once', () => {
  const first = applyPlaceFindPurchase(state, 'transaction-1', 10);
  const replay = applyPlaceFindPurchase(first.state, 'transaction-1', 10);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.available, state.available + 10);
});
test('completed, cache-hit-shaped and multi-place results consume', () => {
  assert.equal(placeFindSettlementForTerminalJob({ status: 'completed', saved_place_id: 'sp' }).action, 'consume');
  assert.equal(placeFindSettlementForTerminalJob({ status: 'completed', candidate_payload: { cacheHit: true } }).action, 'consume');
  assert.equal(placeFindSettlementForTerminalJob({ status: 'needs_help', candidate_payload: { mentionSlots: [{ candidates: [{ name: 'A' }] }] } }).action, 'consume');
});
test('candidate review consumes; empty/manual technical outcomes release', () => {
  assert.equal(placeFindSettlementForTerminalJob({ status: 'needs_help', candidate_payload: { candidates: [{ name: 'A' }] } }).action, 'consume');
  assert.equal(placeFindSettlementForTerminalJob({ status: 'needs_help', candidate_payload: {} }).action, 'release');
  assert.equal(placeFindSettlementForTerminalJob({ status: 'failed', failure_reason: 'timeout' }).action, 'release');
});
test('zero-balance jobs are visible, control-free, and cannot swipe-save', () => {
  assert.equal(isQueueVisibleStatus('awaiting_purchase'), true);
  assert.equal(classifyShareJobDetail({ status: 'awaiting_purchase' }), 'purchase_required');
  assert.equal(queueSwipeAvailability({ id: 'j', status: 'awaiting_purchase' }).save, false);
});

const migration = source('supabase/migrations/20260903000001_place_find_monetization.sql');
const monetizationEdge = source('supabase/functions/monetization/index.ts');
const processor = source('supabase/functions/process-share-jobs/index.ts');
const paywall = source('app/monetization.tsx');
const extension = source('ShareExtension.tsx');
const environment = source('lib/appEnvironmentCore.ts');
const deletion = source('supabase/functions/delete-account/index.ts');

test('database is authoritative and grants are unique by account/version', () => {
  assert.match(migration, /place_find_free_grant_claims[\s\S]*claim_key text primary key/);
  assert.match(migration, /perform \* from public\.ensure_place_find_wallet/);
});
test('anonymous onboarding is exempt once but cannot receive permanent balance', () => {
  assert.match(migration, /place_find_onboarding_claims[\s\S]*anonymous_user_id uuid primary key/);
  assert.match(migration, /p_is_anonymous[\s\S]*billing_mode='onboarding_free'/);
});
test('same completed URL is free unless force rerun is explicit', () => {
  assert.match(migration, /if not p_force_rerun[\s\S]*sj\.status='completed'/);
});
test('reservations and transaction replay keys are unique', () => {
  assert.match(migration, /share_job_id uuid unique/);
  assert.match(migration, /primary key\(environment, transaction_id\)/);
  assert.match(migration, /idempotency_key text not null unique/);
});
test('central finalization settles every terminal path and runs stale recovery', () => {
  assert.match(processor, /placeFindSettlementForTerminalJob/);
  assert.match(processor, /settle_place_find_use/);
  assert.match(processor, /pending_\$\{plannedSettlement\.action\}/);
  assert.match(processor, /release_stale_place_find_reservations/);
});
test('dev mock grant is triple-gated and real verification fails closed', () => {
  assert.match(monetizationEdge, /qnfxnmvxpjzfydgudtvs/);
  assert.match(monetizationEdge, /MONETIZATION_DEV_MOCK_ENABLED/);
  assert.match(monetizationEdge, /MONETIZATION_DEV_TEST_USER_IDS/);
  assert.match(monetizationEdge, /storekit_verification_not_configured/);
  assert.match(migration, /dev\.mock\.nearr\.place_finds\.10',10,'dev_mock','\$3\.99',399,10,false/);
});
test('production configuration blocks dev mock monetization', () => {
  assert.match(environment, /PROD_DEV_MOCK_MONETIZATION/);
  assert.match(source('app.config.js'), /Dev mock monetization must never be included in a production build/);
});
test('clients cannot mutate balances or mint purchase grants', () => {
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on public\.place_find_products,public\.place_find_wallets/);
  assert.match(migration, /apply_dev_mock_place_find_purchase[\s\S]*to service_role/);
});
test('paywall uses server product metadata and labels mock prices', () => {
  assert.match(paywall, /snapshot\?\.products\.map/);
  assert.match(paywall, /NEARR-DEV MOCK PRICING/);
  assert.match(paywall, /Consumable packs do not restore/);
});
test('extension preserves an out-of-balance post and enters the paywall', () => {
  assert.match(extension, /result\.requiresPurchase/);
  assert.match(extension, /Your post is safe/);
  assert.match(extension, /monetization\?jobId=/);
});
test('account deletion closes the wallet while retaining replay ledgers', () => {
  assert.match(deletion, /close_place_find_wallet/);
  assert.match(migration, /status='closed'/);
});
test('analytics cover reserve, consume, release and purchase funnel', () => {
  for (const event of ['use_reserved', 'use_consumed', 'use_released']) assert.match(migration, new RegExp(event));
  for (const event of ['paywall_shown', 'pack_viewed', 'purchase_started', 'purchase_succeeded', 'purchase_failed']) assert.match(paywall, new RegExp(event));
});
test('new monetization surfaces use Nearr product language', () => {
  assert.doesNotMatch(paywall, /Vayrin/i);
  assert.doesNotMatch(source('components/PlaceFindBalance.tsx'), /Vayrin/i);
});

const outputDir = path.resolve(process.cwd(), 'artifacts/monetization');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'monetization-test-results.json'), `${JSON.stringify({
  suite: 'monetization-integration',
  passed: passed.length,
  failed: 0,
  cases: passed,
}, null, 2)}\n`);
console.log(`PASS wrote artifacts/monetization/monetization-test-results.json (${passed.length} cases)`);
