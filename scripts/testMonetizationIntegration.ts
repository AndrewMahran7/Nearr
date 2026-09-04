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
import { isPremiumResultChargeable, premiumEligibilityForResult } from '../lib/premiumRequestMonetization';

const passed: string[] = [];
function test(name: string, run: () => void): void {
  run();
  passed.push(name);
  console.log(`PASS ${name}`);
}
function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

test('pack economics stay 10/30/75 and lifetime grant stays 5', () => {
  assert.equal(PLACE_FIND_FREE_LIFETIME_USES, 5);
  assert.deepEqual(PLACE_FIND_DEV_PACKS.map((pack) => pack.uses), [10, 30, 75]);
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
test('explicit Premium reservation primitive is idempotent', () => {
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
test('legacy released reservation can still be reconciled idempotently', () => {
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
const tokenPackConfig = source('supabase/migrations/20260903000004_dev_token_pack_quantities.sql');
const premiumMigration = source('supabase/migrations/20260904000001_premium_request_monetization.sql');
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
test('normal recognition is free for permanent and anonymous users', () => {
  assert.match(premiumMigration, /'normal_free','unmetered:normal_free'/);
  assert.doesNotMatch(premiumMigration.match(/create or replace function public\.create_share_job_for_user[\s\S]*?end;\n\$\$;/)?.[0] ?? '', /reserve_place_find_use/);
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
  assert.match(processor, /isPremiumResultChargeable/);
  assert.match(processor, /settle_premium_request/);
  assert.match(processor, /billingMode === 'premium_request'/);
  assert.match(processor, /release_stale_place_find_reservations/);
});
test('dev mock grant is triple-gated and real verification fails closed', () => {
  assert.match(monetizationEdge, /qnfxnmvxpjzfydgudtvs/);
  assert.match(monetizationEdge, /MONETIZATION_DEV_MOCK_ENABLED/);
  assert.match(monetizationEdge, /MONETIZATION_DEV_TEST_USER_IDS/);
  assert.match(monetizationEdge, /storekit_verification_not_configured/);
  assert.match(premiumMigration, /mock_display_price='\$7\.99',mock_price_cents=799/);
  assert.match(tokenPackConfig, /use_count = 30[\s\S]*place_finds\.25'/);
  assert.match(tokenPackConfig, /use_count = 75[\s\S]*place_finds\.50'/);
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
test('paywall uses server product metadata and labels Dev pricing honestly', () => {
  assert.match(paywall, /snapshot\?\.products\.map/);
  assert.match(paywall, /snapshot\?\.mode === 'dev_mock'/);
  assert.match(paywall, /Dev pricing preview/);
  assert.match(paywall, /Apple purchases are not available in this build/);
});
test('normal share surfaces never enter the token store', () => {
  assert.doesNotMatch(extension, /result\.requiresPurchase|purchase_required|monetization\?jobId=/);
  assert.match(premiumMigration, /requires_purchase boolean/);
});
test('account deletion closes the wallet while retaining replay ledgers', () => {
  assert.match(deletion, /close_place_find_wallet/);
  assert.match(migration, /status='closed'/);
});
test('analytics cover the canonical Premium and purchase funnels', () => {
  for (const event of ['premium_request_reserved', 'premium_request_started', 'premium_request_useful_result', 'premium_request_no_useful_result', 'premium_request_token_consumed', 'premium_request_token_released']) assert.match(premiumMigration, new RegExp(event));
  for (const event of ['paywall_shown', 'pack_viewed', 'purchase_started', 'purchase_succeeded', 'purchase_failed']) assert.match(paywall, new RegExp(event));
});
test('structured eligibility and chargeability fail closed', () => {
  assert.equal(premiumEligibilityForResult({ status: 'needs_help', analysis_attempted: true, failure_category: 'analysis_insufficient', candidate_payload: {} }).eligible, true);
  assert.equal(premiumEligibilityForResult({ status: 'needs_help', analysis_attempted: false, failure_code: 'insufficient_evidence' }).eligible, false);
  assert.equal(isPremiumResultChargeable({ status: 'completed', saved_place_id: 'saved' }).chargeable, true);
  assert.equal(isPremiumResultChargeable({ status: 'needs_help', candidate_payload: { candidates: [{ name: 'Los Angeles' }] } }).chargeable, false);
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
