import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  PLUS_ENTITLEMENT_ID, PLUS_PRODUCT_ID, classifyPlusPurchaseError, hasVerifiedPlusAccess,
  plusWebhookIdentities, plusWebhookMatchesConfiguration, verifyPlusSubscriber,
} from '../lib/plusEntitlements';
import { isFreeOnlyPlusStatus, plusReleasePolicy } from '../lib/plusReleasePolicy';

const now = Date.parse('2026-10-20T12:00:00.000Z');
const config = { entitlementId: PLUS_ENTITLEMENT_ID, productId: PLUS_PRODUCT_ID, environment: 'SANDBOX' as const };
const names: string[] = [];
function test(name: string, run: () => void) { run(); names.push(name); console.log(`PASS ${name}`); }
function payload(over: Record<string, unknown> = {}) {
  const subscription: Record<string, any> = {
    store: 'app_store', is_sandbox: true, ownership_type: 'PURCHASED',
    purchase_date: '2026-10-01T00:00:00.000Z', expires_date: '2026-11-01T00:00:00.000Z',
    store_transaction_id: '2000000123456789', period_type: 'normal', ...over,
  };
  return { request_date_ms: now, subscriber: {
    entitlements: { [PLUS_ENTITLEMENT_ID]: { product_identifier: PLUS_PRODUCT_ID, expires_date: subscription.expires_date, grace_period_expires_date: subscription.grace_period_expires_date ?? null } },
    subscriptions: { [PLUS_PRODUCT_ID]: subscription },
  } };
}

test('valid Apple subscription verifies as active', () => assert.equal(verifyPlusSubscriber(payload(), config, now).state, 'active'));
test('trial and introductory periods remain distinct', () => {
  assert.equal(verifyPlusSubscriber(payload({ period_type: 'trial' }), config, now).state, 'trial');
  assert.equal(verifyPlusSubscriber(payload({ period_type: 'intro' }), config, now).state, 'intro');
});
test('cancelled renewal retains access until expiry', () => {
  const value = verifyPlusSubscriber(payload({ unsubscribe_detected_at: '2026-10-19T00:00:00Z' }), config, now);
  assert.equal(value.state, 'cancelled'); assert.equal(hasVerifiedPlusAccess(value, now), true);
});
test('refund revokes immediately', () => {
  const value = verifyPlusSubscriber(payload({ refunded_at: '2026-10-20T11:00:00Z' }), config, now);
  assert.equal(value.state, 'revoked'); assert.equal(hasVerifiedPlusAccess(value, now), false);
});
test('verified grace extends access', () => {
  const grace = '2026-10-25T00:00:00.000Z';
  const value = verifyPlusSubscriber(payload({ expires_date: '2026-10-19T00:00:00.000Z', grace_period_expires_date: grace }), config, now);
  assert.equal(value.state, 'grace'); assert.equal(value.accessUntil, grace);
});
test('expired subscription has no access', () => assert.equal(verifyPlusSubscriber(payload({ expires_date: '2026-10-19T00:00:00.000Z' }), config, now).state, 'expired'));
test('missing entitlement becomes verified free', () => {
  const value: any = payload(); value.subscriber.entitlements = {};
  assert.equal(verifyPlusSubscriber(value, config, now).state, 'free');
});
test('wrong product fails closed', () => {
  const value: any = payload(); value.subscriber.entitlements[PLUS_ENTITLEMENT_ID].product_identifier = 'other';
  assert.throws(() => verifyPlusSubscriber(value, config, now), /product_mismatch/);
});
test('foreign store and family sharing fail closed', () => {
  assert.throws(() => verifyPlusSubscriber(payload({ store: 'play_store' }), config, now), /store_mismatch/);
  assert.throws(() => verifyPlusSubscriber(payload({ ownership_type: 'FAMILY_SHARED' }), config, now), /store_mismatch/);
});
test('sandbox mismatch fails closed', () => assert.throws(() => verifyPlusSubscriber(payload({ is_sandbox: false }), config, now), /store_mismatch/));
test('stale and future provider timestamps fail closed', () => {
  const stale: any = payload(); stale.request_date_ms = now - 16 * 60_000;
  const future: any = payload(); future.request_date_ms = now + 61_000;
  assert.throws(() => verifyPlusSubscriber(stale, config, now), /verification_invalid/);
  assert.throws(() => verifyPlusSubscriber(future, config, now), /verification_invalid/);
});
test('mismatched expiry and grace fail closed', () => {
  const mismatch: any = payload(); mismatch.subscriber.entitlements[PLUS_ENTITLEMENT_ID].expires_date = '2026-12-01T00:00:00Z';
  assert.throws(() => verifyPlusSubscriber(mismatch, config, now), /period_invalid/);
  const grace: any = payload({ grace_period_expires_date: '2026-11-02T00:00:00Z' }); grace.subscriber.entitlements[PLUS_ENTITLEMENT_ID].grace_period_expires_date = null;
  assert.throws(() => verifyPlusSubscriber(grace, config, now), /grace_invalid/);
});
test('freshness is required on every access check', () => {
  const value = verifyPlusSubscriber(payload(), config, now);
  assert.equal(hasVerifiedPlusAccess(value, now + 14 * 60_000), true);
  assert.equal(hasVerifiedPlusAccess(value, now + 16 * 60_000), false);
});
test('opaque webhook identities are bounded, validated, deduplicated and sorted', () => {
  const a = 'np_11111111-1111-1111-1111-111111111111', b = 'np_22222222-2222-2222-2222-222222222222';
  assert.deepEqual(plusWebhookIdentities({ type: 'RENEWAL', app_user_id: b, original_app_user_id: a, aliases: [b, 'email@example.com'] }), [a, b]);
  assert.throws(() => plusWebhookIdentities({ type: 'RENEWAL', aliases: Array(51).fill(a) }), /too_large/);
});
test('transfer identities include both owners without trusting arbitrary IDs', () => {
  const a = 'np_11111111-1111-1111-1111-111111111111', b = 'np_22222222-2222-2222-2222-222222222222';
  assert.deepEqual(plusWebhookIdentities({ type: 'TRANSFER', transferred_from: [a], transferred_to: [b, 'bad'] }), [a, b]);
});
test('webhook app and environment must match configuration', () => {
  assert.equal(plusWebhookMatchesConfiguration({ type: 'RENEWAL', app_id: 'app', environment: 'SANDBOX' }, 'app', 'SANDBOX'), true);
  assert.equal(plusWebhookMatchesConfiguration({ type: 'RENEWAL', app_id: 'other', environment: 'SANDBOX' }, 'app', 'SANDBOX'), false);
  assert.equal(plusWebhookMatchesConfiguration({ type: 'TRANSFER', app_id: 'app' }, 'app', 'SANDBOX'), true);
});
test('purchase errors separate cancellation and pending states', () => {
  assert.equal(classifyPlusPurchaseError({ userCancelled: true }), 'cancelled');
  assert.equal(classifyPlusPurchaseError({ code: 20 }), 'pending');
  assert.equal(classifyPlusPurchaseError(new Error('failure')), 'error');
});
test('client uses StoreKit display price and server sync after purchase or restore', () => {
  const source = readFileSync('lib/plusClient.ts', 'utf8');
  assert.match(source, /priceString/); assert.match(source, /subscriptionPeriod === 'P1M'/);
  assert.match(source, /fetchPlusStatus\(userId, 'sync'\)/); assert.match(source, /restorePurchases/);
  assert.doesNotMatch(source, /set.*entitlement|AsyncStorage.*plus/i);
});
test('Edge endpoints authenticate server-side and re-read RevenueCat', () => {
  const api = readFileSync('supabase/functions/plus-api/index.ts', 'utf8');
  const hook = readFileSync('supabase/functions/revenuecat-plus-webhook/index.ts', 'utf8');
  assert.match(api, /auth\.getUser\(accessToken\)/); assert.match(api, /is_account_eligible_for_purchase/);
  assert.match(api, /api\.revenuecat\.com\/v1\/subscribers/); assert.match(hook, /api\.revenuecat\.com\/v1\/subscribers/);
  assert.match(hook, /equalSecret/); assert.match(hook, /apply_nearr_plus_webhook/);
  assert.match(hook,/config\?\.release_mode === 'free_only'/);
  assert.ok(hook.indexOf("config?.release_mode === 'free_only'") < hook.indexOf('const payload = await subscriber('));
});
test('release and allowance defaults are closed', () => {
  const migration = readFileSync('supabase/migrations/20261021000002_nearr_plus_verified_entitlements.sql', 'utf8');
  assert.match(migration, /sales_enabled boolean not null default false/);
  assert.match(migration, /enforce_allowance boolean not null default false/);
  assert.match(migration, /release_qualified boolean not null default false/);
  assert.match(migration, /is_account_eligible_for_ai\(p_user_id\)/);
});
test('optional funnel endpoint remains disabled without separate consent', () => {
  assert.match(readFileSync('supabase/functions/plus-api/index.ts', 'utf8'), /optional_analytics_disabled/);
});

test('free-only release is explicit, qualified, enforced and independent of a paid catalog', () => {
  const free = { release_mode:'free_only', release_qualified:true, enforce_allowance:true, sales_enabled:false, free_finds:3,
    catalog_verified:false, revenuecat_app_id:null };
  assert.deepEqual(plusReleasePolicy(free), { mode:'free_only', freeOnly:true, paidQualified:false });
  for (const change of [{release_mode:undefined},{release_mode:'FREE_ONLY'},{release_mode:'unknown'},
    {release_qualified:false},{enforce_allowance:false},{sales_enabled:true},{free_finds:10}]) {
    const result=plusReleasePolicy({...free,...change}); assert.equal(result.freeOnly,false); assert.equal(result.paidQualified,false);
  }
  const paid={...free,release_mode:'paid',catalog_verified:true,revenuecat_app_id:'app_fixture'};
  assert.equal(plusReleasePolicy(paid).paidQualified,true);
  assert.equal(plusReleasePolicy({...paid,release_mode:undefined}).mode,'paid','older server config is not free-only');
  assert.equal(plusReleasePolicy({...paid,revenuecat_app_id:' '}).paidQualified,false);
});
test('client never mistakes missing or contradictory server fields for free-only', () => {
  const free={releaseMode:'free_only',salesEnabled:false,purchaseEligible:false,restoreAvailable:false,
    appUserId:null,entitlement:null,freeFinds:3,usage:{limit:3,enforced:true}};
  assert.equal(isFreeOnlyPlusStatus(free),true);
  for(const change of [{releaseMode:undefined},{releaseMode:'paid'},{salesEnabled:true},{purchaseEligible:true},
    {restoreAvailable:true},{appUserId:'unexpected'},{entitlement:{state:'active'}},{freeFinds:10},
    {usage:{limit:3}},{usage:{limit:10,enforced:true}}]) assert.equal(isFreeOnlyPlusStatus({...free,...change}),false);
});

mkdirSync('artifacts/global-release', { recursive: true });
writeFileSync('artifacts/global-release/monetization-policy-tests.json', JSON.stringify({
  testedAt: new Date().toISOString(), passed: names.length, failed: 0, tests: names,
  scope: 'Pure verification and source contracts only; no Apple purchase, RevenueCat mutation, or network call.',
}, null, 2) + '\n');
console.log(`\n${names.length} global monetization checks passed.`);
