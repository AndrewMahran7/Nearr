// Server-authoritative Nearr Plus status and RevenueCat reconciliation.
// The client SDK may initiate StoreKit UI, but it never grants entitlement.
// @ts-nocheck -- Supabase Edge/Deno runtime.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { verifyPlusSubscriber } from '../../../lib/plusEntitlements.ts';

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
  let body: { action?: string; event?: string; eventId?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
  const action = body.action ?? 'status';
  if (!['status', 'sync', 'restore', 'event'].includes(action)) return json({ ok: false, error: 'invalid_action' }, 400);

  const { data: config, error: configError } = await admin.from('nearr_plus_config').select('*').eq('id', true).single();
  if (configError || !config) return json({ ok: false, error: 'plus_unavailable' }, 503);
  const { data: eligible, error: eligibilityError } = await admin.rpc('is_account_eligible_for_purchase', { p_user_id: auth.user.id });
  if (eligibilityError || typeof eligible !== 'boolean') return json({ ok: false, error: 'eligibility_unavailable' }, 503);
  const qualified = config.release_qualified === true && config.catalog_verified === true && !!config.revenuecat_app_id;
  const purchaseEligible = eligible === true && qualified;

  // Optional analytics remain disabled until a separately reviewed consent exists.
  if (action === 'event') return json({ ok: true, recorded: false, reason: 'optional_analytics_disabled' });

  let { data: customer } = await admin.from('nearr_plus_customers').select('app_user_id').eq('user_id', auth.user.id).maybeSingle();
  if (!customer && purchaseEligible) {
    const inserted = await admin.from('nearr_plus_customers').insert({ user_id: auth.user.id }).select('app_user_id').single();
    if (inserted.error && inserted.error.code !== '23505') return json({ ok: false, error: 'plus_identity_unavailable' }, 503);
    customer = inserted.data ?? (await admin.from('nearr_plus_customers').select('app_user_id').eq('user_id', auth.user.id).single()).data;
  }
  if ((action === 'sync' || action === 'restore') && purchaseEligible && customer?.app_user_id) {
    const secret = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
    if (!secret) return json({ ok: false, error: 'store_verification_unavailable' }, 503);
    try {
      const payload = await revenueCatSubscriber(secret, customer.app_user_id);
      const snapshot = verifyPlusSubscriber(payload, {
        entitlementId: config.entitlement_id, productId: config.product_id, environment: config.environment,
      });
      const applied = await admin.rpc('apply_nearr_plus_snapshot', { p_user_id: auth.user.id, p_snapshot: snapshot });
      if (applied.error) return json({ ok: false, error: 'entitlement_write_failed' }, 503);
    } catch (error) {
      console.warn(`[plus-api] receipt verification failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return json({ ok: false, error: 'store_verification_unavailable' }, 503);
    }
  }
  const [{ data: entitlement }, usageResult] = await Promise.all([
    admin.from('nearr_plus_entitlements').select('state,product_id,period_start,expires_at,access_until,verified_at,environment,period_key').eq('user_id', auth.user.id).maybeSingle(),
    admin.rpc('nearr_plus_usage', { p_user_id: auth.user.id }),
  ]);
  if (usageResult.error || !usageResult.data) return json({ ok: false, error: 'usage_unavailable' }, 503);
  const usage = usageResult.data;
  const periodStart = typeof usage.periodStart === 'string' ? usage.periodStart : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const paidEnd = entitlement?.access_until;
  return json({
    ok: true,
    salesEnabled: config.sales_enabled === true && purchaseEligible,
    purchaseEligible,
    restoreAvailable: purchaseEligible,
    appUserId: purchaseEligible ? customer?.app_user_id ?? null : null,
    offeringId: config.offering_id,
    productId: config.product_id,
    freeFinds: config.free_finds,
    plusFinds: config.plus_finds,
    usage: { used: usage.used, reserved: usage.reserved, limit: usage.limit, remaining: usage.remaining, periodStart, periodEnd: usage.paid && paidEnd ? paidEnd : nextUtcMonth() },
    entitlement: entitlement ? {
      state: entitlement.state, productId: entitlement.product_id, periodStart: entitlement.period_start,
      expiresAt: entitlement.expires_at, accessUntil: entitlement.access_until, verifiedAt: entitlement.verified_at,
      environment: entitlement.environment, periodKey: entitlement.period_key,
    } : null,
  });
});
