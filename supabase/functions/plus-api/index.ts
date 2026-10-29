// Server-authoritative Nearr Plus status and RevenueCat reconciliation.
// The client SDK may initiate StoreKit UI, but it never grants entitlement.
// @ts-nocheck -- Supabase Edge/Deno runtime.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { verifyPaidSubscriber } from '../../../lib/plusEntitlements.ts';
import { plusReleasePolicy } from '../../../lib/plusReleasePolicy.ts';
import { PAID_TOKEN_PRODUCTS, reconcilePurchaseHint } from '../../../lib/paidFindPolicy.ts';
import { fetchPaidPurchaseRecovery } from '../../../lib/paidPurchaseRecovery.ts';
import { refreshStalePaidEntitlements } from '../_shared/paidEntitlementRefresh.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
function token(req: Request) {
  const value = req.headers.get('authorization') ?? '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}
function nextUtcMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
async function revenueCatSubscriber(secret: string, appUserId: string) {
  const signal = AbortSignal.timeout(10_000);
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' }, signal,
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`revenuecat_http_${response.status}`); }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 512_000) { await response.body?.cancel(); throw new Error('revenuecat_response_too_large'); }
  const text = await response.text();
  if (text.length > 512_000) throw new Error('revenuecat_response_too_large');
  return JSON.parse(text);
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: 'server_misconfigured' }, 500);
  const accessToken = token(req);
  if (!accessToken) return json({ ok: false, error: 'unauthorized' }, 401);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !auth.user || auth.user.is_anonymous) return json({ ok: false, error: 'permanent_account_required' }, 401);
  let body: { action?: string; event?: string; eventId?: string; purchase?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
  const action = body.action ?? 'status';
  if (!['status', 'sync', 'restore', 'event'].includes(action)) return json({ ok: false, error: 'invalid_action' }, 400);

  const { data: config, error: configError } = await admin.from('nearr_plus_config').select('*').eq('id', true).single();
  if (configError || !config) return json({ ok: false, error: 'plus_unavailable' }, 503);
  const { data: eligible, error: eligibilityError } = await admin.rpc('is_account_eligible_for_purchase', { p_user_id: auth.user.id });
  if (eligibilityError || typeof eligible !== 'boolean') return json({ ok: false, error: 'eligibility_unavailable' }, 503);
  const release = plusReleasePolicy(config);
  const catalogVerified = release.paidQualified && config.subscription_benefit === 'unlimited'
    && config.product_id === 'com.nearr.plus.unlimited.monthly.v1' && config.token_catalog_verified === true
    && config.paid_find_policy_enabled === true && !!config.revenuecat_project_id
    && PAID_TOKEN_PRODUCTS.every(p => typeof config.revenuecat_token_product_ids?.[p.productId] === 'string');
  const purchaseEligible = eligible === true && catalogVerified;
  if (config.release_mode === 'free_only' && !release.freeOnly) return json({ ok: false, error: 'plus_unavailable' }, 503);
  if (release.freeOnly && (action === 'sync' || action === 'restore')) return json({ ok: false, error: 'purchases_deferred' }, 409);

  // Optional analytics remain disabled until a separately reviewed consent exists.
  if (action === 'event') return json({ ok: true, recorded: false, reason: 'optional_analytics_disabled' });
  const reaped = await admin.rpc('reap_nearr_paid_reservations', { p_user_id: auth.user.id });
  if (reaped.error) return json({ ok: false, error: 'usage_unavailable' }, 503);
  if (action === 'status') {
    try {
      await refreshStalePaidEntitlements(admin,auth.user.id,{ revenueCatSecret:Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '' });
    } catch { return json({ ok:false,error:'plus_verification_required' },503); }
  }

  let { data: customer } = await admin.from('nearr_plus_customers').select('app_user_id').eq('user_id', auth.user.id).maybeSingle();
  if (!customer && purchaseEligible) {
    const inserted = await admin.from('nearr_plus_customers').insert({ user_id: auth.user.id }).select('app_user_id').single();
    if (inserted.error?.message?.includes('plus_free_only_customer_blocked')) return json({ ok: false, error: 'release_mode_changed' }, 409);
    if (inserted.error && inserted.error.code !== '23505') return json({ ok: false, error: 'plus_identity_unavailable' }, 503);
    customer = inserted.data ?? (await admin.from('nearr_plus_customers').select('app_user_id').eq('user_id', auth.user.id).single()).data;
  }
  let freshSubscriptionSnapshot = null;
  // Reconciliation remains available for an existing customer even when new
  // sales or purchase eligibility are temporarily disabled. It never charges.
  if ((action === 'sync' || action === 'restore') && release.mode === 'paid' && customer?.app_user_id) {
    const secret = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
    if (!secret) return json({ ok: false, error: 'store_verification_unavailable' }, 503);
    try {
      const hint = body.purchase as { transactionId?: unknown; productId?: unknown } | null;
      if (typeof hint?.transactionId === 'string' && PAID_TOKEN_PRODUCTS.some(p => p.productId === hint.productId)
          && config.token_catalog_verified === true && config.revenuecat_project_id
          && PAID_TOKEN_PRODUCTS.every(p => typeof config.revenuecat_token_product_ids?.[p.productId] === 'string')) {
        // RevenueCat v1 keys are not valid v2 credentials. Recovery uses its
        // own server-only scoped key; never fall back to the subscriber key.
        const recoverySecret = Deno.env.get('REVENUECAT_V2_SECRET_API_KEY') ?? '';
        if (!recoverySecret) return json({ ok: false, error: 'purchase_verification_pending' }, 503);
        const recovery = await fetchPaidPurchaseRecovery({
          projectId: config.revenuecat_project_id, appId: config.revenuecat_app_id,
          appUserId: customer.app_user_id, environment: config.environment,
          productIds: config.revenuecat_token_product_ids,
        }, hint.transactionId, recoverySecret);
        const recovered = await admin.rpc('apply_nearr_paid_recovery', { p_user_id: auth.user.id, p_snapshot: recovery });
        if (recovered.error) return json({ ok: false, error: recovered.error.message?.includes('paid_recovery_refund_reconciliation_required')
          ? 'purchase_refund_reconciliation_required' : 'purchase_verification_pending' }, 503);
      }
      const payload = await revenueCatSubscriber(secret, customer.app_user_id);
      const { snapshot, legacySnapshot } = verifyPaidSubscriber(payload, {
        entitlementId: config.entitlement_id, productId: config.product_id, environment: config.environment,
      });
      const applied = await admin.rpc('apply_nearr_paid_subscriber', { p_user_id: auth.user.id, p_snapshot: snapshot, p_legacy_snapshot: legacySnapshot });
      if (applied.error?.message?.includes('plus_free_only_paid_grant_blocked')) return json({ ok: false, error: 'release_mode_changed' }, 409);
      if (applied.error) return json({ ok: false, error: 'entitlement_write_failed' }, 503);
      freshSubscriptionSnapshot = snapshot;
    } catch (error) {
      console.warn(`[plus-api] receipt verification failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return json({ ok: false, error: 'store_verification_unavailable' }, 503);
    }
  }
  const [{ data: entitlement }, usageResult, purchasesResult] = await Promise.all([
    admin.from('nearr_plus_entitlements').select('state,product_id,period_start,expires_at,access_until,verified_at,environment,period_key').eq('user_id', auth.user.id).maybeSingle(),
    admin.rpc('nearr_plus_usage', { p_user_id: auth.user.id }),
    admin.rpc('nearr_paid_recent_purchases', { p_user_id: auth.user.id }),
  ]);
  if (usageResult.error || !usageResult.data || purchasesResult.error) return json({ ok: false, error: 'usage_unavailable' }, 503);
  const usage = usageResult.data;
  const periodStart = typeof usage.periodStart === 'string' ? usage.periodStart : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const paidEnd = entitlement?.access_until;
  // A newer refund/transfer callback can win while the subscriber GET is in
  // flight. A successful RPC call does not mean its older snapshot was applied.
  const subscriptionProof = freshSubscriptionSnapshot && entitlement
    && entitlement.product_id === freshSubscriptionSnapshot.productId
    && entitlement.state === freshSubscriptionSnapshot.state
    && entitlement.environment === freshSubscriptionSnapshot.environment
    && entitlement.period_key === freshSubscriptionSnapshot.periodKey
    && Date.parse(entitlement.period_start) === Date.parse(freshSubscriptionSnapshot.periodStart)
    && Date.parse(entitlement.expires_at) === Date.parse(freshSubscriptionSnapshot.expiresAt)
    && Date.parse(entitlement.verified_at) === Date.parse(freshSubscriptionSnapshot.verifiedAt)
    && Date.parse(entitlement.access_until) === Date.parse(freshSubscriptionSnapshot.accessUntil)
    ? freshSubscriptionSnapshot : null;
  return json({
    ok: true,
    releaseMode: release.mode,
    salesEnabled: config.sales_enabled === true && purchaseEligible,
    purchaseEligible,
    restoreAvailable: release.mode === 'paid' && !!customer?.app_user_id,
    appUserId: customer?.app_user_id ?? null,
    offeringId: config.offering_id,
    productId: config.product_id,
    freeFinds: config.free_finds,
    plusFinds: null,
    subscriptionBenefit: 'unlimited',
    catalogVerified,
    tokenProducts: PAID_TOKEN_PRODUCTS,
    tokenPurchasesReady: config.sales_enabled === true && purchaseEligible,
    purchaseBlockedReason: !catalogVerified ? 'catalog_not_qualified' : !eligible ? 'purchase_ineligible' : !config.sales_enabled ? 'sales_disabled' : null,
    recentPurchases: purchasesResult.data ?? [],
    purchaseVerification: reconcilePurchaseHint(body.purchase, purchasesResult.data ?? [], subscriptionProof),
    // V1 non_subscriptions cannot prove StoreKit transaction identity or refund
    // state. Token restore reads this durable ledger; callbacks supply grants.
    tokenVerificationSource: 'authenticated_webhook_ledger',
    usage: { ...usage, periodStart, periodEnd: usage.paid && paidEnd ? paidEnd : nextUtcMonth() },
    entitlement: !release.freeOnly && entitlement ? {
      state: entitlement.state, productId: entitlement.product_id, periodStart: entitlement.period_start,
      expiresAt: entitlement.expires_at, accessUntil: entitlement.access_until, verifiedAt: entitlement.verified_at,
      environment: entitlement.environment, periodKey: entitlement.period_key,
    } : null,
  });
});
