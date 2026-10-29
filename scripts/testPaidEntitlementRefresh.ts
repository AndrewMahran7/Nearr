import assert from 'node:assert/strict';
import { refreshStalePaidEntitlements } from '../supabase/functions/_shared/paidEntitlementRefresh';
import { PLUS_PRODUCT_ID } from '../lib/plusEntitlements';

const NOW = Date.parse('2026-10-29T21:00:00Z');
const USER = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = `np_${USER}`;
const config = { paid_find_policy_enabled: true, release_mode: 'paid', release_qualified: true, enforce_allowance: true,
  catalog_verified: true, token_catalog_verified: true, subscription_benefit: 'unlimited', product_id: PLUS_PRODUCT_ID,
  entitlement_id: 'nearr_plus', revenuecat_app_id: 'app_fixture', environment: 'SANDBOX', free_finds: 3, sales_enabled: true };
const until = new Date(NOW + 3600000).toISOString();
const stale = { product_id: PLUS_PRODUCT_ID, environment: 'SANDBOX', state: 'active', access_until: until, verified_at: new Date(NOW - 900001).toISOString() };
const old = { ...stale, product_id: 'nearr_plus_monthly_v1' };
function subscriber(productId = PLUS_PRODUCT_ID, state: 'active' | 'revoked' | 'expired' | 'free' = 'active') {
  const expiry = state === 'expired' ? new Date(NOW - 1000).toISOString() : until;
  return { request_date_ms: NOW, subscriber: {
    entitlements: state === 'free' || productId !== PLUS_PRODUCT_ID ? {} : { nearr_plus: { product_identifier: productId, expires_date: expiry, grace_period_expires_date: null } },
    subscriptions: state === 'free' ? {} : { [productId]: { store: 'app_store', is_sandbox: true, ownership_type: 'PURCHASED',
      purchase_date: new Date(NOW - 86400000).toISOString(), expires_date: expiry, grace_period_expires_date: null,
      store_transaction_id: '2000000123456789', refunded_at: state === 'revoked' ? new Date(NOW - 1000).toISOString() : null } },
  } };
}
type Setup = { config?: any; unlimited?: any; legacy?: any; customer?: any; dbError?: string; response?: unknown;
  http?: () => Response; fetchFailure?: boolean; applyError?: boolean; afterConfig?: any; hang?: boolean;
  keepOldAfterApply?: boolean; readbackError?: boolean };
function fixture(setup: Setup = {}) {
  let requests = 0, configReads = 0;
  let updatedUnlimited: unknown, updatedLegacy: unknown;
  const reads: string[] = [], applied: any[] = [], http: { url: string; options?: RequestInit }[] = [];
  const admin = {
    from: (table: string) => ({ select: (_columns: string) => ({ eq: (column: string, value: unknown) => {
      if (table !== 'nearr_plus_config') { assert.equal(column, 'user_id'); assert.equal(value, USER); }
      const execute = async () => {
        reads.push(table);
        let data: unknown;
        if (table === 'nearr_plus_config') data = configReads++ > 0 && setup.afterConfig !== undefined ? setup.afterConfig : setup.config ?? config;
        else if (table === 'nearr_plus_entitlements') data = updatedUnlimited !== undefined ? updatedUnlimited : Object.prototype.hasOwnProperty.call(setup, 'unlimited') ? setup.unlimited : stale;
        else if (table === 'nearr_legacy_plus_entitlements') data = updatedLegacy !== undefined ? updatedLegacy : setup.legacy ?? null;
        else if (table === 'nearr_plus_customers') data = Object.prototype.hasOwnProperty.call(setup, 'customer') ? setup.customer : { app_user_id: CUSTOMER };
        else throw Error(`unexpected table ${table}`);
        return { data, error: table === setup.dbError || (setup.readbackError && applied.length > 0) ? { message: 'private upstream detail' } : null };
      };
      return { single: execute, maybeSingle: execute };
    } }) }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, 'apply_nearr_paid_subscriber'); applied.push(args);
      if (!setup.applyError && !setup.keepOldAfterApply) {
        const persisted = (snapshot: any) => ({ product_id: snapshot.productId, environment: snapshot.environment,
          state: snapshot.state, access_until: snapshot.accessUntil, verified_at: snapshot.verifiedAt });
        updatedUnlimited = persisted(args.p_snapshot); updatedLegacy = persisted(args.p_legacy_snapshot);
      }
      return { data: null, error: setup.applyError ? { message: 'private apply failure' } : null };
    },
  };
  const fetchImpl = (async (url: any, options?: RequestInit) => {
    requests++; http.push({ url: String(url), options });
    if (setup.hang) return new Promise<Response>(() => {});
    if (setup.fetchFailure) throw Error('do not leak key/customer/upstream details');
    return setup.http?.() ?? Response.json(setup.response ?? subscriber());
  }) as typeof fetch;
  return { admin, run: (secret: string | undefined = 'fixture-server-secret') => refreshStalePaidEntitlements(admin, USER, { revenueCatSecret: secret, fetchImpl, now: () => NOW }),
    reads, applied, http, requests: () => requests };
}
let checks = 0;
async function check(label: string, run: () => Promise<void>) { await run(); checks++; console.log(`PASS ${label}`); }
async function main() {
  await check('disabled policy reads no entitlements or customer and calls no API', async () => {
    const f = fixture({ config: { paid_find_policy_enabled: false } }); assert.deepEqual(await f.run(undefined), { refreshed: false, reason: 'policy_disabled' });
    assert.deepEqual(f.reads, ['nearr_plus_config']); assert.equal(f.requests(), 0); assert.equal(f.applied.length, 0);
  });
  for (const [label, patch] of Object.entries({ 'fresh active': { verified_at: new Date(NOW - 1000).toISOString() },
    'verified expired receipt': { state: 'expired', access_until: new Date(NOW).toISOString() }, 'revoked receipt': { state: 'revoked' }, 'free receipt': { state: 'free' },
    'foreign product': { product_id: 'com.nearr.pro.monthly.v1' }, 'foreign environment': { environment: 'PRODUCTION' } })) {
    await check(`${label} avoids unnecessary API call`, async () => { const f = fixture({ unlimited: { ...stale, ...patch } }); assert.equal((await f.run()).reason, 'not_stale'); assert.equal(f.requests(), 0); assert.equal(f.applied.length, 0); });
  }
  await check('absent unlimited and legacy rows require no API', async () => { const f=fixture({unlimited:null}); assert.equal((await f.run()).reason,'not_stale');assert.equal(f.requests(),0); });
  await check('stale unlimited uses real verifier and atomic subscriber RPC', async () => {
    const f=fixture(); assert.equal((await f.run()).refreshed,true);assert.equal(f.requests(),1);assert.equal(f.applied.length,1);
    assert.equal(f.applied[0].p_user_id,USER);assert.equal(f.applied[0].p_snapshot.state,'active');assert.equal(f.applied[0].p_legacy_snapshot.state,'free');
    assert.equal(f.http[0].url,`https://api.revenuecat.com/v1/subscribers/${CUSTOMER}`);assert.equal(f.http[0].options?.method,'GET');
    assert.equal(f.http[0].options?.redirect,'error');assert.equal(f.http[0].options?.cache,'no-store');assert.ok(f.http[0].options?.signal);
  });
  await check('stale capped legacy refreshes even without unlimited receipt', async () => {
    const f=fixture({unlimited:null,legacy:old,response:subscriber('nearr_plus_monthly_v1')});await f.run();assert.equal(f.applied[0].p_snapshot.state,'free');assert.equal(f.applied[0].p_legacy_snapshot.state,'active');
  });
  for (const state of ['active', 'trial', 'intro', 'grace', 'cancelled']) {
    await check(`ended formerly ${state} period refreshes despite fresh verification`, async () => {
      const f = fixture({ unlimited: { ...stale, state, access_until: new Date(NOW).toISOString(), verified_at: new Date(NOW).toISOString() } });
      assert.equal((await f.run()).refreshed, true); assert.equal(f.requests(), 1);
      assert.equal(f.applied[0].p_snapshot.state, 'active'); assert.equal(f.applied[0].p_snapshot.accessUntil, until);
    });
  }
  await check('verified expiry after missed renewal check prevents repeated API reads', async () => {
    const f = fixture({ unlimited: { ...stale, access_until: new Date(NOW).toISOString() }, response: subscriber(PLUS_PRODUCT_ID, 'expired') });
    assert.equal((await f.run()).refreshed, true); assert.equal((await f.run()).reason, 'not_stale'); assert.equal(f.requests(), 1);
  });
  await check('ended legacy period refreshes before free or token fallback', async () => {
    const f = fixture({ unlimited: null, legacy: { ...old, access_until: new Date(NOW).toISOString(), verified_at: new Date(NOW).toISOString() }, response: subscriber('nearr_plus_monthly_v1') });
    assert.equal((await f.run()).refreshed, true); assert.equal(f.applied[0].p_legacy_snapshot.state, 'active');
  });
  await check('fresh unlimited and stale legacy share one API read', async () => { const f=fixture({unlimited:{...stale,verified_at:new Date(NOW).toISOString()},legacy:old});await f.run();assert.equal(f.requests(),1); });
  await check('new sales disabled does not strand an existing paid account', async () => {const f=fixture({config:{...config,sales_enabled:false}});assert.equal((await f.run()).refreshed,true);});
  for (const verified_at of [new Date(NOW - 900000).toISOString(),new Date(NOW + 60001).toISOString(),null,'invalid']) {
    await check(`stale boundary or invalid timestamp ${String(verified_at)}`, async () => { const f=fixture({unlimited:{...stale,verified_at}});await f.run();assert.equal(f.requests(),1); });
  }
  for (const state of ['revoked','expired','free'] as const) await check(`fresh ${state} result reaches SQL without retaining old paid grant`,async()=>{const f=fixture({response:subscriber(PLUS_PRODUCT_ID,state)});await f.run();assert.equal(f.applied[0].p_snapshot.state,state);});
  for (const dbError of ['nearr_plus_config','nearr_plus_entitlements','nearr_legacy_plus_entitlements','nearr_plus_customers']) {
    await check(`${dbError} failure prevents admission and makes no grant`,async()=>{const f=fixture({dbError});await assert.rejects(f.run(),/^Error: paid_entitlement_/);assert.equal(f.requests(),0);assert.equal(f.applied.length,0);});
  }
  for (const patch of [{paid_find_policy_enabled:'true'},{environment:['SANDBOX']},{release_qualified:false},{product_id:'nearr_plus_monthly_v1'},{token_catalog_verified:false}]) {
    await check('malformed or unqualified enabled config fails before API',async()=>{const f=fixture({config:{...config,...patch}});await assert.rejects(f.run(),/paid_entitlement_config_invalid/);assert.equal(f.requests(),0);});
  }
  await check('active receipt with malformed expiry fails closed',async()=>{const f=fixture({unlimited:{...stale,access_until:'bad'}});await assert.rejects(f.run(),/paid_entitlement_snapshot_invalid/);assert.equal(f.requests(),0);});
  await check('missing primary customer fails closed',async()=>{const f=fixture({customer:null});await assert.rejects(f.run(),/paid_entitlement_customer_unavailable/);assert.equal(f.requests(),0);});
  await check('raw account ID cannot substitute primary opaque customer',async()=>{const f=fixture({customer:{app_user_id:USER}});await assert.rejects(f.run(),/paid_entitlement_customer_unavailable/);assert.equal(f.requests(),0);});
  await check('missing secret only matters when a stale receipt needs refresh',async()=>{const f=fixture();await assert.rejects(f.run(''),/paid_entitlement_credentials_unavailable/);assert.equal(f.requests(),0);});
  for (const [label,http] of Object.entries({ 'HTTP error':()=>new Response('private body',{status:503}),
    redirect:()=>new Response('',{status:302,headers:{location:'https://untrusted.invalid'}}),
    'bad content type':()=>new Response('{}',{headers:{'content-type':'text/html'}}),
    'declared oversized body':()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'262145'}}),
    'streamed oversized body':()=>new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}}),
    'invalid JSON':()=>new Response('{',{headers:{'content-type':'application/json'}}),
  })) await check(`${label} never reaches apply`,async()=>{const f=fixture({http});await assert.rejects(f.run(),/^Error: paid_entitlement_/);assert.equal(f.requests(),1);assert.equal(f.applied.length,0);});
  await check('transport failure is sanitized',async()=>{const f=fixture({fetchFailure:true});await assert.rejects(f.run(),{message:'paid_entitlement_refresh_failed'});assert.equal(f.applied.length,0);});
  await check('client CustomerInfo cannot pass real verifier',async()=>{const f=fixture({response:{entitlements:{active:{nearr_plus:{isActive:true}}}}});await assert.rejects(f.run(),{message:'paid_entitlement_refresh_failed'});assert.equal(f.applied.length,0);});
  await check('wrong store receipt is rejected by real verifier',async()=>{const payload=subscriber();payload.subscriber.subscriptions[PLUS_PRODUCT_ID].store='play_store';const f=fixture({response:payload});await assert.rejects(f.run());assert.equal(f.applied.length,0);});
  await check('configuration disabled during GET prevents grant',async()=>{const f=fixture({afterConfig:{...config,paid_find_policy_enabled:false}});await assert.rejects(f.run(),/paid_entitlement_policy_changed/);assert.equal(f.applied.length,0);});
  await check('configuration environment changed during GET prevents grant',async()=>{const f=fixture({afterConfig:{...config,environment:'PRODUCTION'}});await assert.rejects(f.run(),/paid_entitlement_policy_changed/);assert.equal(f.applied.length,0);});
  await check('RPC failure is surfaced for caller to stop',async()=>{const f=fixture({applyError:true});await assert.rejects(f.run(),{message:'paid_entitlement_apply_failed'});assert.equal(f.applied.length,1);});
  for (const verified_at of [stale.verified_at, new Date(NOW + 120000).toISOString()]) {
    await check('RPC success that leaves stale or future proof cannot admit recognition', async () => {
      const f = fixture({ unlimited: { ...stale, verified_at }, keepOldAfterApply: true });
      await assert.rejects(f.run(), { message: 'paid_entitlement_refresh_incomplete' }); assert.equal(f.requests(), 1); assert.equal(f.applied.length, 1);
    });
  }
  await check('failed persisted proof readback fails closed after apply', async () => {
    const f = fixture({ readbackError: true }); await assert.rejects(f.run(), { message: 'paid_entitlement_snapshot_unavailable' }); assert.equal(f.applied.length, 1);
  });
  await check('malformed user ID fails before DB or API',async()=>{const f=fixture();await assert.rejects(refreshStalePaidEntitlements(f.admin,'client-email@example.com',{}),/paid_entitlement_owner_invalid/);assert.equal(f.reads.length,0);});
  await check('whole-helper timeout bounds transport ignoring abort',async()=>{const f=fixture({hang:true});const start=Date.now();await assert.rejects(f.run(),/paid_entitlement_refresh_timeout/);assert(Date.now()-start<20000);assert.equal(f.applied.length,0);});
  console.log(`${checks} paid entitlement refresh checks passed. Offline fixtures, zero live RevenueCat calls.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
