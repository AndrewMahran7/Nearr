/** Actual Edge handler with inert external boundaries; pure verifiers stay real.
 * Dashboard TEST semantics: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 * These local tests prove routing, not a real StoreKit transaction or live delivery.
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { plusWebhookIdentities, plusWebhookMatchesConfiguration, verifyPaidSubscriber } from '../lib/plusEntitlements';
import { PAID_TOKEN_PRODUCTS, parseTrustedPaidPurchaseEvent } from '../lib/paidPurchaseVerification';

const owner = '11111111-1111-1111-1111-111111111111';
const appUserId = `np_${owner}`;
const config = {
  release_mode: 'paid', revenuecat_app_id: 'app_fixture', environment: 'SANDBOX',
  entitlement_id: 'nearr_plus', product_id: 'com.nearr.plus.unlimited.monthly.v1',
};
// Matches the observed dashboard TEST shape without retaining its random IDs.
const dashboardEvent = {
  id: 'fixture-dashboard-test', type: 'TEST', app_id: config.revenuecat_app_id,
  environment: 'SANDBOX', store: 'APP_STORE', product_id: 'test_product',
  app_user_id: 'synthetic-customer', original_app_user_id: 'synthetic-original', aliases: ['synthetic-alias'],
};
type Options = {
  config?: typeof config | null; configError?: boolean; customerError?: boolean;
  env?: Record<string, string>; subscriberStatus?: number; rpcError?: string; applied?: boolean;
};
type SendOptions = { authorization?: string | null; method?: string; raw?: string };
const source = readFileSync('supabase/functions/revenuecat-plus-webhook/index.ts', 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(options: Options = {}) {
  let handler!: (request: Request) => Promise<Response>;
  const calls = { tables: [] as string[], customers: [] as string[][], fetches: [] as any[], rpcs: [] as any[] };
  const admin = {
    from(table: string) {
      calls.tables.push(table);
      if (table === 'nearr_plus_config') return {
        select: () => ({ eq: () => ({ single: async () => ({
          data: Object.prototype.hasOwnProperty.call(options, 'config') ? options.config : config,
          error: options.configError ? { message: 'fixture failure' } : null,
        }) }) }),
      };
      if (table === 'nearr_plus_customers') return {
        select: () => ({ in: async (_column: string, ids: string[]) => {
          calls.customers.push(ids);
          return { data: [{ user_id: owner, app_user_id: appUserId }], error: options.customerError ? {} : null };
        } }),
      };
      throw new Error(`Unexpected table access: ${table}`);
    },
    async rpc(name: string, args: unknown) {
      calls.rpcs.push({ name, args });
      assert.equal(name, 'apply_nearr_paid_webhook');
      return { data: options.applied ?? true, error: options.rpcError ? { message: options.rpcError } : null };
    },
  };
  const env: Record<string, string> = {
    SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    REVENUECAT_WEBHOOK_SECRET: 'fixture-webhook', REVENUECAT_SECRET_API_KEY: 'fixture-v1', ...options.env,
  };
  vm.runInNewContext(code, {
    serve: (value: typeof handler) => { handler = value; }, createClient: () => admin,
    Request, Response, TextEncoder, AbortSignal, crypto: webcrypto, console: { warn() {} },
    Deno: { env: { get: (key: string) => env[key] } },
    plusWebhookIdentities, plusWebhookMatchesConfiguration, verifyPaidSubscriber,
    PAID_TOKEN_PRODUCTS, parseTrustedPaidPurchaseEvent,
    fetch: async (url: string, init: any) => {
      calls.fetches.push({ url, authorization: init.headers.Authorization });
      assert.match(url, /^https:\/\/api\.revenuecat\.com\/v1\/subscribers\/np_/);
      return Response.json({ request_date_ms: Date.now(), subscriber: { entitlements: {}, subscriptions: {} } },
        { status: options.subscriberStatus ?? 200 });
    },
  }, { timeout: 1000 });
  return {
    calls,
    async send(event: unknown = dashboardEvent, request: SendOptions = {}) {
      const authorization = request.authorization === undefined ? 'Bearer fixture-webhook' : request.authorization;
      const method = request.method ?? 'POST';
      const response = await handler(new Request('https://fixture.invalid/revenuecat-plus-webhook', {
        method, headers: { ...(authorization === null ? {} : { authorization }), 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: request.raw ?? JSON.stringify({ api_version: '1.0', event }) } : {}),
      }));
      return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
    },
  };
}
function noFinancialWork(f: ReturnType<typeof fixture>, configReads = 1) {
  assert.deepEqual(f.calls.tables, Array(configReads).fill('nearr_plus_config'));
  assert.equal(f.calls.customers.length, 0);
  assert.equal(f.calls.fetches.length, 0); // No RevenueCat or recognition-provider request.
  assert.equal(f.calls.rpcs.length, 0); // No event, customer, entitlement, or token ledger write.
}
let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn(); passed++; console.log(`PASS ${name}`);
}
async function denied(name: string, options: Options, event: unknown, status: number, error: string,
  request: SendOptions = {}, configReads = 1) {
  await test(name, async () => {
    const f = fixture(options), result = await f.send(event, request);
    assert.equal(result.status, status); assert.deepEqual(result.body, { ok: false, error });
    noFinancialWork(f, configReads);
  });
}

async function main() {
  await test('authenticated matching dashboard TEST is a no-op', async () => {
    const f = fixture(), result = await f.send();
    assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true, test: true, applied: false });
    assert.equal(result.cacheControl, 'no-store'); noFinancialWork(f);
  });
  await test('duplicate TEST remains a no-op without event deduplication writes', async () => {
    const f = fixture();
    for (let i = 0; i < 2; i++) assert.deepEqual((await f.send()).body, { ok: true, test: true, applied: false });
    noFinancialWork(f, 2);
  });
  await test('TEST containing a real-shaped owner and token SKU cannot grant', async () => {
    const f = fixture(), result = await f.send({ ...dashboardEvent, app_user_id: appUserId,
      aliases: [appUserId], product_id: 'com.nearr.tokens.20.v2' });
    assert.equal(result.status, 200); assert.equal(result.body.applied, false); noFinancialWork(f);
  });
  await denied('missing Authorization', {}, dashboardEvent, 401, 'unauthorized', { authorization: null }, 0);
  await denied('wrong Authorization', {}, dashboardEvent, 401, 'unauthorized', { authorization: 'Bearer wrong-secret' }, 0);
  await denied('missing server webhook secret', { env: { REVENUECAT_WEBHOOK_SECRET: '' } }, dashboardEvent, 401, 'unauthorized', {}, 0);
  await denied('non-POST method', {}, dashboardEvent, 405, 'method_not_allowed', { method: 'GET' }, 0);
  await denied('wrong app', {}, { ...dashboardEvent, app_id: 'app_foreign' }, 400, 'configuration_mismatch');
  await denied('wrong environment', {}, { ...dashboardEvent, environment: 'PRODUCTION' }, 400, 'configuration_mismatch');
  await denied('missing environment', {}, { ...dashboardEvent, environment: undefined }, 400, 'configuration_mismatch');
  await denied('free-only still refuses TEST', { config: { ...config, release_mode: 'free_only' } }, dashboardEvent, 409, 'purchases_deferred');
  await denied('config lookup failure', { configError: true }, dashboardEvent, 400, 'configuration_mismatch');
  await denied('missing config', { config: null }, dashboardEvent, 400, 'configuration_mismatch');
  await denied('missing service configuration', { env: { SUPABASE_SERVICE_ROLE_KEY: '' } }, dashboardEvent, 500, 'server_misconfigured', {}, 0);
  await denied('existing API key prerequisite remains', { env: { REVENUECAT_SECRET_API_KEY: '' } }, dashboardEvent, 500, 'server_misconfigured', {}, 0);
  await denied('invalid event id', {}, { ...dashboardEvent, id: 'invalid/id' }, 400, 'invalid_event', {}, 0);
  await denied('invalid event type', {}, { ...dashboardEvent, type: 'test' }, 400, 'invalid_event', {}, 0);
  await denied('missing event type', {}, { ...dashboardEvent, type: undefined }, 400, 'invalid_event', {}, 0);
  await denied('malformed JSON', {}, dashboardEvent, 400, 'invalid_json', { raw: '{' }, 0);
  await denied('oversized payload', {}, dashboardEvent, 400, 'invalid_payload', { raw: 'x'.repeat(512001) }, 0);
  await denied('other event with synthetic owner still denied', {}, { ...dashboardEvent, type: 'INITIAL_PURCHASE' }, 400, 'unknown_customer');

  const subscriptionEvent = { ...dashboardEvent, type: 'INITIAL_PURCHASE', app_user_id: appUserId, aliases: [],
    product_id: config.product_id };
  await test('subscription event still fetches a verified snapshot and applies the financial RPC', async () => {
    const f = fixture(), result = await f.send(subscriptionEvent);
    assert.deepEqual(result.body, { ok: true, applied: true }); assert.equal(result.status, 200);
    assert.deepEqual(f.calls.tables, ['nearr_plus_config', 'nearr_plus_customers']);
    assert.equal(f.calls.fetches.length, 1); assert.equal(f.calls.fetches[0].authorization, 'Bearer fixture-v1');
    assert.equal(f.calls.rpcs.length, 1);
    const args = f.calls.rpcs[0].args;
    assert.equal(args.p_event_type, 'INITIAL_PURCHASE'); assert.match(args.p_payload_sha256, /^[a-f0-9]{64}$/);
    assert.equal(args.p_snapshots[0].userId, owner); assert.equal(args.p_snapshots[0].snapshot.state, 'free');
    assert.equal(args.p_purchase, null);
  });
  const now = Date.now();
  const tokenEvent = { ...subscriptionEvent, type: 'NON_RENEWING_PURCHASE', product_id: 'com.nearr.tokens.20.v2',
    transaction_id: 'fixture-store-transaction', purchased_at_ms: now - 1000, event_timestamp_ms: now,
    is_family_share: false, expiration_at_ms: null, period_type: 'NORMAL' };
  for (const type of ['NON_RENEWING_PURCHASE', 'CANCELLATION', 'REFUND_REVERSED']) {
    await test(`${type} token event retains its financial verification route`, async () => {
      const f = fixture(), result = await f.send({ ...tokenEvent, type });
      assert.deepEqual(result.body, { ok: true, applied: true }); assert.equal(result.status, 200);
      assert.equal(f.calls.customers.length, 1); assert.equal(f.calls.fetches.length, 0); assert.equal(f.calls.rpcs.length, 1);
      const args = f.calls.rpcs[0].args;
      assert.equal(args.p_event_type, type); assert.equal(args.p_purchase_user, owner); assert.equal(args.p_snapshots.length, 0);
      assert.equal(args.p_purchase.transactionId, tokenEvent.transaction_id);
      assert.equal(args.p_purchase.eventType, type); assert.equal(args.p_purchase.state, type === 'CANCELLATION' ? 'revoked' : 'verified');
    });
  }
  await test('financial duplicate result remains authoritative from SQL', async () => {
    const f = fixture({ applied: false }), result = await f.send(tokenEvent);
    assert.deepEqual(result.body, { ok: true, applied: false }); assert.equal(f.calls.rpcs.length, 1);
  });
  await test('financial free-only cutover remains rejected by SQL', async () => {
    const f = fixture({ rpcError: 'plus_free_only_paid_grant_blocked' }), result = await f.send(tokenEvent);
    assert.equal(result.status, 409); assert.equal(result.body.error, 'release_mode_changed');
    assert.equal(f.calls.rpcs.length, 1);
  });
  await test('subscriber verification failure cannot apply ledger state', async () => {
    const f = fixture({ subscriberStatus: 503 }), result = await f.send(subscriptionEvent);
    assert.equal(result.status, 503); assert.equal(result.body.error, 'store_verification_unavailable');
    assert.equal(f.calls.fetches.length, 1); assert.equal(f.calls.rpcs.length, 0);
  });
  console.log(`${passed} actual paid webhook handler scenarios passed; no live requests.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
