/** Shared, pure contract. Only the Edge service may turn RevenueCat API responses
 * into database entitlements. SDK customerInfo is never an authorization input. */
export const PLUS_ENTITLEMENT_ID = 'nearr_plus';
export const PLUS_PRODUCT_ID = 'com.nearr.plus.unlimited.monthly.v1';
export const PLUS_FREE_FINDS = 3;
/** Unlimited is deliberately not represented by a large numeric allowance. */
export const PLUS_MONTHLY_FINDS = null;
export const PLUS_VERIFICATION_MAX_AGE_MS = 15 * 60 * 1000;

export type PlusState = 'free' | 'active' | 'trial' | 'intro' | 'grace' | 'cancelled' | 'expired' | 'revoked';
export type PlusEntitlementSnapshot = {
  state: PlusState; productId: string | null; periodStart: string | null;
  expiresAt: string | null; accessUntil: string | null; verifiedAt: string;
  environment: 'SANDBOX' | 'PRODUCTION'; periodKey: string | null;
};
type VerificationConfig = { entitlementId: string; productId: string; environment: 'SANDBOX' | 'PRODUCTION' };

function object(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}
function date(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value); return Number.isFinite(time) ? time : null;
}
function iso(value: number | null): string | null { return value === null ? null : new Date(value).toISOString(); }

/** Missing, foreign, or malformed products fail closed. Cancellation is not
 * expiry; refund is immediate revocation; verified billing grace preserves its bound. */
export function verifyPlusSubscriber(payload: unknown, config: VerificationConfig, now = Date.now()): PlusEntitlementSnapshot {
  const root = object(payload); const subscriber = object(root?.subscriber);
  const entitlements = object(subscriber?.entitlements); const subscriptions = object(subscriber?.subscriptions);
  const requested = typeof root?.request_date_ms === 'number' ? root.request_date_ms : date(root?.request_date);
  if (!subscriber || !entitlements || !subscriptions || requested === null || !Number.isFinite(requested) || requested > now + 60_000 || requested < now - PLUS_VERIFICATION_MAX_AGE_MS) throw new Error('plus_verification_invalid');
  const empty: PlusEntitlementSnapshot = { state: 'free', productId: null, periodStart: null, expiresAt: null, accessUntil: null, verifiedAt: new Date(requested).toISOString(), environment: config.environment, periodKey: null };
  const entitlement = object(entitlements[config.entitlementId]);
  if (!entitlement) return empty;
  if (entitlement.product_identifier !== config.productId) throw new Error('plus_product_mismatch');
  const subscription = object(subscriptions[config.productId]);
  if (!subscription || subscription.store !== 'app_store' || typeof subscription.is_sandbox !== 'boolean' || subscription.is_sandbox !== (config.environment === 'SANDBOX') || subscription.ownership_type !== 'PURCHASED') throw new Error('plus_store_mismatch');
  const start = date(subscription.purchase_date); const transaction = subscription.store_transaction_id;
  if ((typeof transaction !== 'string' && typeof transaction !== 'number') || !/^[A-Za-z0-9._-]{1,200}$/.test(String(transaction))) throw new Error('plus_transaction_invalid');
  const expires = date(entitlement.expires_date); const subscriptionExpiry = date(subscription.expires_date);
  if (start === null || expires === null || subscriptionExpiry === null || start > now + 60_000 || expires <= start || subscriptionExpiry !== expires) throw new Error('plus_period_invalid');
  const grace = date(entitlement.grace_period_expires_date); const confirmedGrace = date(subscription.grace_period_expires_date);
  if (grace !== confirmedGrace) throw new Error('plus_grace_invalid');
  const accessUntil = Math.max(expires, grace ?? 0);
  let state: PlusState = 'active';
  if (subscription.refunded_at != null) state = 'revoked';
  else if (accessUntil <= now) state = 'expired';
  else if (expires <= now) state = 'grace';
  else if (subscription.unsubscribe_detected_at != null) state = 'cancelled';
  else if (subscription.period_type === 'trial') state = 'trial';
  else if (subscription.period_type === 'intro') state = 'intro';
  return { state, productId: config.productId, periodStart: iso(start), expiresAt: iso(expires), accessUntil: state === 'revoked' ? iso(Math.min(now, expires)) : iso(accessUntil), verifiedAt: empty.verifiedAt, environment: config.environment, periodKey: `${config.environment}:${config.productId}:${String(transaction)}` };
}

export function hasVerifiedPlusAccess(snapshot: PlusEntitlementSnapshot | null | undefined, now = Date.now()): boolean {
  if (!snapshot || snapshot.productId !== PLUS_PRODUCT_ID || !['active', 'trial', 'intro', 'grace', 'cancelled'].includes(snapshot.state)) return false;
  const verified = date(snapshot.verifiedAt); const until = date(snapshot.accessUntil);
  return verified !== null && until !== null && verified <= now + 60_000 && now - verified <= PLUS_VERIFICATION_MAX_AGE_MS && until > now;
}

/** Keep the old capped subscription's verified obligation separate. Its receipt
 * can never establish unlimited access and a new free snapshot cannot erase it. */
export function verifyPaidSubscriber(payload: unknown, config: VerificationConfig, now = Date.now()) {
  const root = object(payload); const subscriber = object(root?.subscriber);
  const entitlements = object(subscriber?.entitlements); const subscriptions = object(subscriber?.subscriptions);
  if (!root || !subscriber || !entitlements || !subscriptions) throw new Error('plus_verification_invalid');
  const oldProduct = 'nearr_plus_monthly_v1';
  const current = object(entitlements[config.entitlementId]);
  const newEntitlements = { ...entitlements };
  if (current?.product_identifier === oldProduct) delete newEntitlements[config.entitlementId];
  const snapshot = verifyPlusSubscriber({ ...root, subscriber: { ...subscriber, entitlements: newEntitlements } }, config, now);
  const old = object(subscriptions[oldProduct]);
  const legacyEntitlements = old ? { [config.entitlementId]: {
    product_identifier: oldProduct, expires_date: old.expires_date,
    grace_period_expires_date: old.grace_period_expires_date ?? null,
  } } : {};
  const legacySnapshot = verifyPlusSubscriber({ ...root, subscriber: { ...subscriber, entitlements: legacyEntitlements } }, { ...config, productId: oldProduct }, now);
  return { snapshot, legacySnapshot };
}

/** Opaque server-assigned identities, never email, advertising IDs or a client
 * supplied Supabase account id. Bound the work performed by one webhook. */
export function plusWebhookIdentities(event: unknown): string[] {
  const row = object(event); if (!row) throw new Error('plus_event_invalid');
  const candidates = row.type === 'TRANSFER'
    ? [...(Array.isArray(row.transferred_from) ? row.transferred_from : []), ...(Array.isArray(row.transferred_to) ? row.transferred_to : [])]
    : [row.app_user_id, row.original_app_user_id, ...(Array.isArray(row.aliases) ? row.aliases : [])];
  if (candidates.length > 50) throw new Error('plus_event_too_large');
  return [...new Set(candidates.filter(id => typeof id === 'string' && /^np_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))].sort() as string[];
}
export function plusWebhookMatchesConfiguration(event: unknown, appId: string, environment: string): boolean {
  const row = object(event); if (!row || !appId || row.app_id !== appId) return false;
  if (row.type === 'TRANSFER' && row.environment == null) return true;
  return row.environment === environment;
}
export function classifyPlusPurchaseError(error: unknown): 'cancelled' | 'pending' | 'error' {
  const row = object(error);
  if (row?.userCancelled === true || String(row?.code) === '1') return 'cancelled';
  if (String(row?.code) === '20') return 'pending';
  return 'error';
}
