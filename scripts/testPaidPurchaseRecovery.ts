import assert from 'node:assert/strict';
import { fetchPaidPurchaseRecovery, reconcilePaidPurchaseRecovery, verifyPaidPurchaseRecovery } from '../lib/paidPurchaseRecovery';
import { parseTrustedPaidPurchaseEvent } from '../lib/paidPurchaseVerification';
const now = Date.parse('2026-10-29T20:00:00Z');
const owner = 'np_11111111-1111-4111-8111-111111111111';
const other = 'np_22222222-2222-4222-8222-222222222222';
const config = { projectId: 'proj_fixture', appId: 'app_fixture', appUserId: owner, environment: 'SANDBOX' as const,
  productIds: { 'com.nearr.tokens.20.v2': 'prod20', 'com.nearr.tokens.50.v2': 'prod50', 'com.nearr.tokens.200.v2': 'prod200' } };
const tx = '2000000123456789';
const purchase = { object: 'purchase', id: 'purch_fixture', customer_id: owner, original_customer_id: other, product_id: 'prod20',
  purchased_at: now - 3600000, quantity: 1, status: 'owned', environment: 'sandbox', store: 'app_store', store_purchase_identifier: tx, ownership: 'purchased' };
const list = { object: 'list', items: [purchase], next_page: null };
const product = { object: 'product', id: 'prod20', state: 'active', store_identifier: 'com.nearr.tokens.20.v2', type: 'one_time',
  subscription: null, one_time: { is_consumable: true }, app_id: config.appId,
  app: { object: 'app', id: config.appId, project_id: config.projectId, type: 'app_store', app_store: { bundle_id: 'com.nearr.ios' } } };
const verify = (p: unknown = list, pr: unknown = product) => verifyPaidPurchaseRecovery(p, pr, config, tx, now - 1000, now);
let checks = 0;
function check(label: string, run: () => void) { run(); checks++; console.log(`PASS ${label}`); }
const snapshot = verify();
check('verified exact owned purchase binds all configured identifiers', () => {
  assert.equal(snapshot.state, 'verified'); assert.equal(snapshot.appUserId, owner); assert.equal(snapshot.transactionId, tx);
  assert.equal(snapshot.projectId, config.projectId); assert.equal(snapshot.appId, config.appId); assert.equal('eventType' in snapshot, false);
});
check('refunded snapshot is explicit revoked, never purchase grant', () => assert.equal(verify({ ...list, items: [{ ...purchase, status: 'refunded' }] }).state, 'revoked'));
check('archived compatible product still restores historical purchase', () => assert.equal(verify(list, { ...product, state: 'archived' }).state, 'verified'));
for (const [label, patch] of Object.entries({
  'wrong primary owner despite original owner': { customer_id: other, original_customer_id: owner },
  'unknown internal product': { product_id: 'prod_unknown' }, 'wrong transaction': { store_purchase_identifier: '200000099999' },
  'numeric transaction coercion': { store_purchase_identifier: Number(tx) }, 'wrong environment': { environment: 'production' },
  'test store': { store: 'test_store' }, 'family ownership': { ownership: 'family_shared' }, 'assigned ownership': { ownership: 'assigned' },
  'missing ownership': { ownership: undefined }, 'quantity over one': { quantity: 2 }, 'string quantity': { quantity: '1' },
  'unknown state': { status: 'active' }, 'future purchase': { purchased_at: now + 60001 }, 'invalid time': { purchased_at: 'yesterday' },
  'array refund status cannot coerce to verified': { status: ['refunded'] },
})) check(`reject ${label}`, () => assert.throws(() => verify({ ...list, items: [{ ...purchase, ...patch }] })));
for (const [label, payload] of Object.entries({ empty: { ...list, items: [] }, duplicate: { ...list, items: [purchase, purchase] },
  pagination: { ...list, next_page: 'https://malicious.example/purchases' }, missingPagination: { object: 'list', items: [purchase] } })) {
  check(`reject ${label} result`, () => assert.throws(() => verify(payload)));
}
for (const [label, patch] of Object.entries({
  'product internal ID': { id: 'prod50' }, 'store product mapping': { store_identifier: 'com.nearr.tokens.200.v2' },
  'product app': { app_id: 'app_other' }, 'subscription product': { type: 'subscription' },
  'non-consumable product': { one_time: { is_consumable: false } }, 'missing consumable proof': { one_time: null },
  'unexpected subscription info': { subscription: { duration: 'P1M' } }, 'unknown product state': { state: 'deleted' },
  'array product state cannot coerce to active': { state: ['active'] },
  'unexpanded app': { app: null }, 'foreign project': { app: { ...product.app, project_id: 'proj_other' } },
  'foreign expanded app': { app: { ...product.app, id: 'app_other' } },
  'wrong bundle': { app: { ...product.app, app_store: { bundle_id: 'com.attacker.app' } } },
})) check(`reject ${label}`, () => assert.throws(() => verify(list, { ...product, ...patch })));
check('missing trusted mapping rejects before lookup', () => assert.throws(() => verifyPaidPurchaseRecovery(list, product, { ...config, productIds: {} as any }, tx, now - 1000, now)));
check('ambiguous mappings rejected', () => assert.throws(() => verifyPaidPurchaseRecovery(list, product, { ...config, productIds: { ...config.productIds, 'com.nearr.tokens.50.v2': 'prod20' } }, tx, now - 1000, now)));
check('stale read window rejected', () => assert.throws(() => verifyPaidPurchaseRecovery(list, product, config, tx, now - 15001, now)));
const refund = parseTrustedPaidPurchaseEvent({ type: 'CANCELLATION', id: 'refund_fixture', app_id: config.appId, app_user_id: owner,
  product_id: snapshot.productId, store: 'APP_STORE', environment: 'SANDBOX', transaction_id: tx, purchased_at_ms: purchase.purchased_at,
  event_timestamp_ms: now - 10000, is_family_share: false }, config, now);
check('owned recovery never revives refund tombstone', () => assert.equal(reconcilePaidPurchaseRecovery(refund, snapshot), refund));
check('recovery replay preserves prior decision and timestamp', () => assert.equal(reconcilePaidPurchaseRecovery(snapshot, { ...snapshot, verifiedAt: new Date(now + 500).toISOString() }), snapshot));
check('verified ledger versus fresh refunded recovery revokes spendable credit', () => assert.equal(reconcilePaidPurchaseRecovery(snapshot, { ...snapshot, state: 'revoked' }).state, 'revoked'));
check('newer callback outranks in-flight refunded recovery', () => {
  const callback = { ...refund, state: 'verified' as const, eventType: 'REFUND_REVERSED' as const, occurredAt: new Date(now - 500).toISOString() };
  assert.equal(reconcilePaidPurchaseRecovery(callback, { ...snapshot, state: 'revoked' }), callback);
});
check('older callback cannot keep freshly refunded funds spendable', () => {
  const callback = { ...refund, state: 'verified' as const, eventType: 'REFUND_REVERSED' as const };
  assert.equal(reconcilePaidPurchaseRecovery(callback, { ...snapshot, state: 'revoked' }).state, 'revoked');
});
check('older recovery cannot replace a newer observed decision', () => {
  const newer = { ...snapshot, verifiedAt: new Date(now + 500).toISOString() };
  assert.equal(reconcilePaidPurchaseRecovery(newer, { ...snapshot, state: 'revoked' }), newer);
});
check('recovery cannot transfer another account transaction', () => assert.throws(() => reconcilePaidPurchaseRecovery(refund, { ...snapshot, appUserId: other }), /paid_owner_mismatch/));
check('recovery cannot change historical pack', () => assert.throws(() => reconcilePaidPurchaseRecovery(refund, { ...snapshot, productId: 'com.nearr.tokens.200.v2' }), /paid_transaction_conflict/));
check('missing ledger recovery retains explicit provenance', () => assert.deepEqual(reconcilePaidPurchaseRecovery(null, snapshot), snapshot));

async function main() {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const fixtureFetch = (async (url: any, options?: RequestInit) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(calls.length === 1 ? list : product), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const result = await fetchPaidPurchaseRecovery(config, tx, 'fixture-server-secret', fixtureFetch, () => now);
  check('adapter uses two bounded fixed-origin GETs and approved product', () => {
    assert.equal(result.state, 'verified'); assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `https://api.revenuecat.com/v2/projects/${config.projectId}/purchases?store_purchase_identifier=${tx}`);
    assert.equal(calls[1].url, `https://api.revenuecat.com/v2/projects/${config.projectId}/products/prod20?expand=app`);
    for (const call of calls) { assert.equal(call.options?.method, 'GET'); assert.equal(call.options?.redirect, 'error'); assert.equal(call.options?.cache, 'no-store'); assert.ok(call.options?.signal); }
  });
  const rejects = async (label: string, response: () => Response) => {
    let count = 0;
    await assert.rejects(fetchPaidPurchaseRecovery(config, tx, 'fixture-secret', (async () => { count++; return response(); }) as typeof fetch, () => now));
    check(label, () => assert.equal(count, 1));
  };
  await rejects('HTTP denial stops before product request', () => new Response('do not print credential-like upstream body', { status: 403 }));
  await rejects('redirect stops before credentials can be resent', () => new Response('', { status: 302, headers: { location: 'https://malicious.example' } }));
  await rejects('non-JSON fails closed', () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }));
  await rejects('declared oversized body fails closed', () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '262145' } }));
  await rejects('streamed oversized body fails closed', () => new Response('x'.repeat(262145), { headers: { 'content-type': 'application/json' } }));
  await rejects('invalid JSON fails closed', () => new Response('{', { headers: { 'content-type': 'application/json' } }));
  let callsBeforeConfig = 0;
  await assert.rejects(fetchPaidPurchaseRecovery(config, 'https://malicious.example', 'fixture-secret', (async () => { callsBeforeConfig++; throw Error('unexpected'); }) as typeof fetch));
  check('client URL rejected before network', () => assert.equal(callsBeforeConfig, 0));
  await assert.rejects(fetchPaidPurchaseRecovery(config, tx, 'fixture-secret', (async () => { throw Error('secret-in-upstream-error'); }) as typeof fetch), (e: any) => e.message === 'paid_recovery_transport_error');
  checks++; console.log('PASS transport errors redact upstream details');
  const timeoutStarted = Date.now();
  await assert.rejects(fetchPaidPurchaseRecovery(config, tx, 'fixture-secret', (() => new Promise(() => {})) as typeof fetch), /paid_recovery_timeout/);
  check('total timeout bounds even a transport ignoring abort', () => assert.ok(Date.now() - timeoutStarted < 20000));
  console.log(`${checks} paid purchase recovery checks passed. Offline fixtures only; no live API or StoreKit qualification.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
