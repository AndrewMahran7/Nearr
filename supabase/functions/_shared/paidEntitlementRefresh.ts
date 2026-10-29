/** Shared Edge/Node server helper. Caller supplies an authenticated account or
 * persisted job/task owner, never an untrusted request-body user ID. This is
 * purchase verification only; it does not grant recognition/consent permission.
 * No Deno globals, HTTP server initialization, inference, or client SDK input.
 */
import { PLUS_PRODUCT_ID, PLUS_VERIFICATION_MAX_AGE_MS, verifyPaidSubscriber } from '../../../lib/plusEntitlements.ts';

type Result = { data?: unknown; error?: unknown };
export type PaidEntitlementAdmin = {
  // Supabase query builders are structurally compatible in both runtimes.
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        single: () => PromiseLike<Result>;
        maybeSingle: () => PromiseLike<Result>;
      };
    };
  };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Result>;
};
type Config = Record<string, unknown> & {
  environment: 'SANDBOX' | 'PRODUCTION'; product_id: string; entitlement_id: string; revenuecat_app_id: string;
};
export type PaidEntitlementRefreshOptions = {
  revenueCatSecret?: string;
  fetchImpl?: typeof fetch;
  /** Injectable server clock for deterministic boundary tests. */
  now?: () => number;
};
export type PaidEntitlementRefreshResult = {
  refreshed: boolean;
  reason: 'policy_disabled' | 'not_stale' | 'refreshed';
};
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CUSTOMER_ID = /^np_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIVE = new Set(['active', 'trial', 'intro', 'grace', 'cancelled']);
const ENTITLEMENT_FIELDS = 'product_id,environment,state,access_until,verified_at';
const TOTAL_TIMEOUT_MS = 15000;
const RESPONSE_BYTES = 262144;
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function date(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : NaN;
}
function qualifiedConfig(value: unknown): Config {
  const config = record(value);
  if (!config || config.paid_find_policy_enabled !== true || config.release_mode !== 'paid'
    || config.release_qualified !== true || config.enforce_allowance !== true
    || config.catalog_verified !== true || config.token_catalog_verified !== true
    || config.subscription_benefit !== 'unlimited' || config.product_id !== PLUS_PRODUCT_ID
    || config.free_finds !== 3 || !['SANDBOX', 'PRODUCTION'].includes(String(config.environment))
    || typeof config.environment !== 'string' || typeof config.entitlement_id !== 'string'
    || !/^[A-Za-z0-9._-]{1,200}$/.test(config.entitlement_id)
    || typeof config.revenuecat_app_id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(config.revenuecat_app_id)) {
    throw new Error('paid_entitlement_config_invalid');
  }
  return config as Config;
}
function needsRefresh(value: unknown, productId: string, config: Config, now: number): boolean {
  if (value == null) return false;
  const row = record(value);
  if (!row) throw new Error('paid_entitlement_snapshot_invalid');
  // Foreign products/environments confer no active access under this policy.
  if (row.product_id !== productId || row.environment !== config.environment) return false;
  if (typeof row.state !== 'string' || !ACTIVE.has(row.state)) return false;
  const until = date(row.access_until);
  if (!Number.isFinite(until)) throw new Error('paid_entitlement_snapshot_invalid');
  // An active receipt whose old period ended may be a missed renewal webhook.
  // Verify once before falling back to free/tokens; a verified expired state
  // stops subsequent refreshes until another trusted purchase changes it.
  if (until <= now) return true;
  const verified = date(row.verified_at);
  return !Number.isFinite(verified) || verified > now + 60000 || now - verified >= PLUS_VERIFICATION_MAX_AGE_MS;
}
async function boundedSubscriber(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || response.redirected) {
    await response.body?.cancel(); throw new Error('paid_entitlement_upstream_unavailable');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel(); throw new Error('paid_entitlement_invalid_response');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > RESPONSE_BYTES)) {
    await response.body?.cancel(); throw new Error('paid_entitlement_response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('paid_entitlement_invalid_response');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('paid_entitlement_refresh_timeout');
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > RESPONSE_BYTES) throw new Error('paid_entitlement_response_too_large');
      chunks.push(chunk.value);
    }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)); }
    catch { throw new Error('paid_entitlement_invalid_response'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Refresh stale, otherwise-active unlimited OR capped legacy subscriptions.
 * One fixed-origin RevenueCat GET maximum, no redirects/retries, 256 KiB body,
 * 10-second HTTP deadline inside a 15-second whole-helper deadline. A disabled
 * policy reads no customer/entitlement and makes no external call. Fresh/free/
 * verified-expired/revoked rows require no external verification. A formerly
 * active period that ended is verified before free/token fallback. The SQL RPC
 * preserves newer concurrent proofs and its transaction/ownership safeguards.
 * Errors MUST prevent caller admission/settlement; never catch and continue.
 */
export async function refreshStalePaidEntitlements(
  admin: PaidEntitlementAdmin, userId: string, options: PaidEntitlementRefreshOptions,
): Promise<PaidEntitlementRefreshResult> {
  if (!USER_ID.test(userId)) throw new Error('paid_entitlement_owner_invalid');
  const clock = options.now ?? Date.now;
  const controller = new AbortController();
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let httpTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    totalTimer = setTimeout(() => { controller.abort(); reject(new Error('paid_entitlement_refresh_timeout')); }, TOTAL_TIMEOUT_MS);
  });
  const readConfig = async () => {
    const result = await admin.from('nearr_plus_config').select('*').eq('id', true).single();
    if (result.error || !record(result.data)) throw new Error('paid_entitlement_config_unavailable');
    return result.data as Record<string, unknown>;
  };
  const work = async (): Promise<PaidEntitlementRefreshResult> => {
    const initial = await readConfig();
    if (initial.paid_find_policy_enabled === false) return { refreshed: false, reason: 'policy_disabled' };
    const config = qualifiedConfig(initial);
    const now = clock();
    if (!Number.isSafeInteger(now) || now <= 0) throw new Error('paid_entitlement_clock_invalid');
    const [unlimited, legacy] = await Promise.all([
      admin.from('nearr_plus_entitlements').select(ENTITLEMENT_FIELDS).eq('user_id', userId).maybeSingle(),
      admin.from('nearr_legacy_plus_entitlements').select(ENTITLEMENT_FIELDS).eq('user_id', userId).maybeSingle(),
    ]);
    if (unlimited.error || legacy.error) throw new Error('paid_entitlement_snapshot_unavailable');
    const stale = needsRefresh(unlimited.data, PLUS_PRODUCT_ID, config, now)
      || needsRefresh(legacy.data, 'nearr_plus_monthly_v1', config, now);
    if (!stale) return { refreshed: false, reason: 'not_stale' };
    const customer = await admin.from('nearr_plus_customers').select('app_user_id').eq('user_id', userId).maybeSingle();
    const customerId = record(customer.data)?.app_user_id;
    if (customer.error || typeof customerId !== 'string' || !CUSTOMER_ID.test(customerId)) throw new Error('paid_entitlement_customer_unavailable');
    const secret = options.revenueCatSecret;
    if (typeof secret !== 'string' || secret.length < 8 || /[\r\n]/.test(secret)) throw new Error('paid_entitlement_credentials_unavailable');
    if (controller.signal.aborted) throw new Error('paid_entitlement_refresh_timeout');
    httpTimer = setTimeout(() => controller.abort(), 10000);
    let payload: unknown;
    try {
      const response = await (options.fetchImpl ?? fetch)(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(customerId)}`, {
        method: 'GET', headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json', 'Cache-Control': 'no-cache' },
        signal: controller.signal, redirect: 'error', cache: 'no-store',
      });
      payload = await boundedSubscriber(response, controller.signal);
    } finally { if (httpTimer !== undefined) clearTimeout(httpTimer); }
    if (controller.signal.aborted) throw new Error('paid_entitlement_refresh_timeout');
    // Use the actual shared verifier; untrusted client snapshots never enter.
    const { snapshot, legacySnapshot } = verifyPaidSubscriber(payload, {
      entitlementId: config.entitlement_id, productId: config.product_id, environment: config.environment,
    }, clock());
    const current = await readConfig();
    if (current.paid_find_policy_enabled !== true || current.environment !== config.environment
      || current.product_id !== config.product_id || current.entitlement_id !== config.entitlement_id
      || current.revenuecat_app_id !== config.revenuecat_app_id) throw new Error('paid_entitlement_policy_changed');
    qualifiedConfig(current);
    if (controller.signal.aborted) throw new Error('paid_entitlement_refresh_timeout');
    const applied = await admin.rpc('apply_nearr_paid_subscriber', {
      p_user_id: userId, p_snapshot: snapshot, p_legacy_snapshot: legacySnapshot,
    });
    if (applied.error) throw new Error('paid_entitlement_apply_failed');
    if (controller.signal.aborted) throw new Error('paid_entitlement_refresh_timeout');
    // The RPC deliberately preserves newer proofs. A corrupt future timestamp
    // can therefore cause it to ignore this response; success alone is not proof
    // that the caller may proceed. Read the actual persisted state back.
    const [updatedUnlimited, updatedLegacy] = await Promise.all([
      admin.from('nearr_plus_entitlements').select(ENTITLEMENT_FIELDS).eq('user_id', userId).maybeSingle(),
      admin.from('nearr_legacy_plus_entitlements').select(ENTITLEMENT_FIELDS).eq('user_id', userId).maybeSingle(),
    ]);
    if (updatedUnlimited.error || updatedLegacy.error) throw new Error('paid_entitlement_snapshot_unavailable');
    const checkedAt = clock();
    if (!Number.isSafeInteger(checkedAt) || checkedAt <= 0) throw new Error('paid_entitlement_clock_invalid');
    if (needsRefresh(updatedUnlimited.data, PLUS_PRODUCT_ID, config, checkedAt)
      || needsRefresh(updatedLegacy.data, 'nearr_plus_monthly_v1', config, checkedAt)) {
      throw new Error('paid_entitlement_refresh_incomplete');
    }
    return { refreshed: true, reason: 'refreshed' };
  };
  try { return await Promise.race([work(), timeout]); }
  catch (error) {
    if (error instanceof Error && /^paid_entitlement_[a-z_]+$/.test(error.message)) throw error;
    throw new Error(controller.signal.aborted ? 'paid_entitlement_refresh_timeout' : 'paid_entitlement_refresh_failed');
  } finally {
    if (totalTimer !== undefined) clearTimeout(totalTimer);
    if (httpTimer !== undefined) clearTimeout(httpTimer);
    controller.abort();
  }
}
