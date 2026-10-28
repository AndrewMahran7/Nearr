// RevenueCat webhook: authenticate, re-read each subscriber from RevenueCat,
// then atomically deduplicate the event and apply verified snapshots.
// @ts-nocheck -- Supabase Edge/Deno runtime.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { plusWebhookIdentities, plusWebhookMatchesConfiguration, verifyPlusSubscriber } from '../../../lib/plusEntitlements.ts';

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
function equalSecret(actual: string, expected: string) {
  const encoder = new TextEncoder(); const a = encoder.encode(actual); const b = encoder.encode(expected);
  if (!a.length || a.length !== b.length) return false;
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]; return difference === 0;
}
async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function subscriber(secret: string, appUserId: string) {
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`revenuecat_http_${response.status}`); }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 512_000) { await response.body?.cancel(); throw new Error('revenuecat_response_too_large'); }
  const text = await response.text(); if (text.length > 512_000) throw new Error('revenuecat_response_too_large');
  return JSON.parse(text);
}

serve(async req => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
  const supplied = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!equalSecret(supplied, webhookSecret)) return json({ ok: false, error: 'unauthorized' }, 401);
  const raw = await req.text();
  if (!raw || raw.length > 512_000) return json({ ok: false, error: 'invalid_payload' }, 400);
  let root: any; try { root = JSON.parse(raw); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
  const event = root?.event;
  if (!event || typeof event.id !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(event.id)
      || typeof event.type !== 'string' || !/^[A-Z_]{1,80}$/.test(event.type)) {
    return json({ ok: false, error: 'invalid_event' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const revenueCatSecret = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
  if (!supabaseUrl || !serviceKey || !revenueCatSecret) return json({ ok: false, error: 'server_misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: config, error: configError } = await admin.from('nearr_plus_config').select('*').eq('id', true).single();
  // Free-only is an explicit release decision, not a temporary store outage.
  // Never contact RevenueCat or apply paid grants while this mode is selected.
  if (!configError && config?.release_mode === 'free_only') return json({ ok: false, error: 'purchases_deferred' }, 409);
  if (configError || !config || !plusWebhookMatchesConfiguration(event, config.revenuecat_app_id, config.environment)) return json({ ok: false, error: 'configuration_mismatch' }, 400);
  let identities: string[]; try { identities = plusWebhookIdentities(event); } catch { return json({ ok: false, error: 'invalid_identities' }, 400); }
  if (!identities.length) return json({ ok: false, error: 'unknown_customer' }, 400);

  const { data: customers, error: customerError } = await admin.from('nearr_plus_customers').select('user_id,app_user_id').in('app_user_id', identities);
  if (customerError) return json({ ok: false, error: 'customer_lookup_failed' }, 503);
  const byIdentity = new Map((customers ?? []).map(row => [row.app_user_id, row]));
  const snapshots = [];
  try {
    for (const appUserId of identities) {
      const customer = byIdentity.get(appUserId); if (!customer) continue;
      const payload = await subscriber(revenueCatSecret, appUserId);
      snapshots.push({ userId: customer.user_id, snapshot: verifyPlusSubscriber(payload, {
        entitlementId: config.entitlement_id, productId: config.product_id, environment: config.environment,
      }) });
    }
  } catch (error) {
    console.warn(`[plus-webhook] verification failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return json({ ok: false, error: 'store_verification_unavailable' }, 503);
  }
  if (!snapshots.length) return json({ ok: false, error: 'unknown_customer' }, 400);
  const applied = await admin.rpc('apply_nearr_plus_webhook', {
    p_event_id: event.id, p_event_type: event.type, p_payload_sha256: await sha256(raw), p_snapshots: snapshots,
  });
  if (applied.error) return json({ ok: false, error: 'webhook_apply_failed' }, 503);
  return json({ ok: true, applied: applied.data === true });
});
