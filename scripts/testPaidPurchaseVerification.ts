import assert from 'node:assert/strict';
import { inspectPaidSubscriberPurchases, paidPurchaseQuantity, parseTrustedPaidPurchaseEvent, reconcilePaidPurchaseEvent } from '../lib/paidPurchaseVerification';

const now = Date.parse('2026-10-29T20:00:00.000Z');
const owner = 'np_11111111-1111-4111-8111-111111111111';
const other = 'np_22222222-2222-4222-8222-222222222222';
const config = { appId: 'app_test_fixture', appUserId: owner, environment: 'SANDBOX' as const };
const event = { type: 'NON_RENEWING_PURCHASE', id: 'evt_purchase', app_id: config.appId, app_user_id: owner,
  product_id: 'com.nearr.tokens.20.v2', store: 'APP_STORE', environment: 'SANDBOX', transaction_id: '2000000123456789',
  purchased_at_ms: now - 3600000, event_timestamp_ms: now - 3500000, is_family_share: false, expiration_at_ms: null, period_type: 'NORMAL' };
let checks = 0;
function check(label: string, fn: () => void) { fn(); checks++; console.log(`PASS ${label}`); }
const parse = (overrides: Record<string, unknown> = {}) => parseTrustedPaidPurchaseEvent({ ...event, ...overrides }, config, now);
const purchase = parse();
check('all three fixed product quantities', () => {
  for (const [product_id, qty] of [['com.nearr.tokens.20.v2', 20], ['com.nearr.tokens.50.v2', 50], ['com.nearr.tokens.200.v2', 200]] as const) {
    assert.equal(paidPurchaseQuantity(parse({ product_id }).productId), qty);
  }
});
check('normalized purchase is bound to primary opaque owner and exact environment', () => {
  assert.equal(purchase.appUserId, owner); assert.equal(purchase.environment, 'SANDBOX');
  assert.equal(purchase.state, 'verified'); assert.equal(purchase.verifiedAt, new Date(now).toISOString());
  assert.equal(purchase.transactionId, event.transaction_id); assert.equal('quantity' in purchase, false);
});
for (const [label, patch] of Object.entries({
  'foreign application': { app_id: 'another-app' }, 'bundle ID is not app ID': { app_id: 'com.nearr.ios' },
  'wrong environment': { environment: 'PRODUCTION' }, 'missing environment': { environment: undefined },
  'non Apple store': { store: 'PLAY_STORE' }, 'StoreKit local test store': { store: 'TEST_STORE' },
  'foreign primary identity despite aliases': { app_user_id: other, aliases: [owner], original_app_user_id: owner },
  'client user ID': { app_user_id: '11111111-1111-4111-8111-111111111111' },
  'anonymous primary identity': { app_user_id: '$RCAnonymousID:abc', aliases: [owner] },
  'legacy token ID': { product_id: 'com.nearr.tokens.20.v1' }, 'subscription is not pack': { product_id: 'com.nearr.plus.unlimited.monthly.v1' },
  'prototype product name': { product_id: '__proto__' }, 'numeric transaction ID': { transaction_id: 2000000123456789 },
  'missing transaction ID': { transaction_id: undefined }, 'missing event ID': { id: undefined },
  'family shared transaction': { is_family_share: true }, 'unverified family status': { is_family_share: undefined },
  'future event': { event_timestamp_ms: now + 60001 }, 'future purchase': { purchased_at_ms: now + 60001 },
  'event precedes purchase': { event_timestamp_ms: now - 4000000 }, 'fractional time': { purchased_at_ms: 1.5 },
  'trial pack': { period_type: 'TRIAL' }, 'expiring pack': { expiration_at_ms: now + 10000 },
  'untrusted quantity': { quantity: 999 }, 'dashboard test event': { type: 'TEST' },
  'array event type cannot coerce to cancellation': { type: ['CANCELLATION'] },
})) check(`reject ${label}`, () => assert.throws(() => parse(patch)));
check('malformed configuration rejected', () => assert.throws(() => parseTrustedPaidPurchaseEvent(event, { ...config, environment: 'INVALID' as any }, now)));
check('untrusted SDK CustomerInfo is not a webhook', () => assert.throws(() => parseTrustedPaidPurchaseEvent({ nonSubscriptionTransactions: [event] }, config, now)));
check('delayed authenticated delivery accepted without changing event time', () => assert.equal(parseTrustedPaidPurchaseEvent(event, config, now + 30 * 86400000).occurredAt, purchase.occurredAt));
const refund = parse({ type: 'CANCELLATION', id: 'evt_refund', event_timestamp_ms: now - 2000000 });
const reversed = parse({ type: 'REFUND_REVERSED', id: 'evt_reversed', event_timestamp_ms: now - 1000000 });
check('refund after grant revokes', () => assert.equal(reconcilePaidPurchaseEvent(purchase, refund).state, 'revoked'));
check('refund before original purchase remains revoked', () => assert.equal(reconcilePaidPurchaseEvent(refund, purchase), refund));
check('late ordinary purchase cannot clear refund even with later timestamp', () => assert.equal(reconcilePaidPurchaseEvent(refund, parse({ id: 'evt_late', event_timestamp_ms: now - 1000 })), refund));
check('explicit newer refund reversal restores the same transaction', () => assert.equal(reconcilePaidPurchaseEvent(refund, reversed), reversed));
check('late old refund cannot undo newer reversal', () => assert.equal(reconcilePaidPurchaseEvent(reversed, refund), reversed));
check('new refund after reversal revokes', () => assert.equal(reconcilePaidPurchaseEvent(reversed, parse({ type: 'CANCELLATION', id: 'evt_refund2', event_timestamp_ms: now - 1000 })).state, 'revoked'));
check('ties favor revocation', () => {
  const tie = parse({ type: 'REFUND_REVERSED', id: 'evt_tie', event_timestamp_ms: now - 2000000 });
  assert.equal(reconcilePaidPurchaseEvent(refund, tie), refund);
  assert.equal(reconcilePaidPurchaseEvent(tie, refund), refund);
});
check('duplicate event is no additional grant', () => assert.equal(reconcilePaidPurchaseEvent(purchase, { ...purchase, verifiedAt: new Date(now + 10).toISOString() }), purchase));
check('same event ID with changed state is rejected', () => assert.throws(() => reconcilePaidPurchaseEvent(purchase, { ...refund, eventId: purchase.eventId }), /paid_event_conflict/));
check('repeated transaction across account is rejected', () => assert.throws(() => reconcilePaidPurchaseEvent(purchase, { ...purchase, appUserId: other }), /paid_owner_mismatch/));
check('same transaction cannot change pack', () => assert.throws(() => reconcilePaidPurchaseEvent(purchase, { ...purchase, productId: 'com.nearr.tokens.200.v2' }), /paid_transaction_conflict/));
check('same transaction cannot cross environments', () => assert.throws(() => reconcilePaidPurchaseEvent(purchase, { ...purchase, environment: 'PRODUCTION' }), /paid_transaction_conflict/));
const subscriber = { request_date_ms: now, subscriber: { original_app_user_id: owner, non_subscriptions: {
  'com.nearr.tokens.20.v2': [{ id: 'rc_internal_id', store: 'app_store', is_sandbox: true, purchase_date: new Date(now - 3600000).toISOString() }],
} } };
check('documented v1 row never grants from internal ID or timestamp', () => {
  const result = inspectPaidSubscriberPurchases(subscriber, config, now);
  assert.deepEqual(result.purchases, []); assert.equal(result.verificationGap, 'v1_store_transaction_and_refund_state_unavailable');
});
check('even extra unqualified v1 fields do not create grants', () => {
  const extra = JSON.parse(JSON.stringify(subscriber)); Object.assign(extra.subscriber.non_subscriptions['com.nearr.tokens.20.v2'][0], { store_transaction_id: event.transaction_id, ownership_type: 'PURCHASED', quantity: 1000 });
  assert.deepEqual(inspectPaidSubscriberPurchases(extra, config, now).purchases, []);
});
check('empty v1 response cannot erase prior ledger', () => assert.deepEqual(inspectPaidSubscriberPurchases({ ...subscriber, subscriber: { original_app_user_id: owner, non_subscriptions: {} } }, config, now).purchases, []));
check('stale v1 response rejected', () => assert.throws(() => inspectPaidSubscriberPurchases({ ...subscriber, request_date_ms: now - 900001 }, config, now)));
check('v1 ownership mismatch rejected', () => assert.throws(() => inspectPaidSubscriberPurchases({ ...subscriber, subscriber: { ...subscriber.subscriber, original_app_user_id: other } }, config, now), /paid_owner_mismatch/));
check('v1 environment mismatch rejected', () => assert.throws(() => inspectPaidSubscriberPurchases(subscriber, { ...config, environment: 'PRODUCTION' }, now), /paid_store_mismatch/));
console.log(`${checks} paid purchase verification checks passed. Offline fixtures only; no StoreKit or live RevenueCat qualification.`);
