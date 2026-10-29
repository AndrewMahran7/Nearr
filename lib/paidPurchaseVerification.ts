/** Server-only parsing contract. The caller MUST authenticate the RevenueCat
 * webhook before calling this module and load both identities from trusted
 * configuration/database records. No SDK CustomerInfo or client receipt is
 * an authorization input. SQL must atomically enforce transaction ownership.
 * Schema: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 */
export const PAID_TOKEN_PRODUCTS = Object.freeze({
  'com.nearr.tokens.20.v2': 20,
  'com.nearr.tokens.50.v2': 50,
  'com.nearr.tokens.200.v2': 200,
});
export type PaidTokenProduct = keyof typeof PAID_TOKEN_PRODUCTS;
export type PaidStoreEnvironment = 'SANDBOX' | 'PRODUCTION';
export type PaidPurchaseEvent = {
  transactionId: string;
  productId: PaidTokenProduct;
  purchasedAt: string;
  environment: PaidStoreEnvironment;
  state: 'verified' | 'revoked';
  verifiedAt: string;
  eventId: string;
  eventType: 'NON_RENEWING_PURCHASE' | 'CANCELLATION' | 'REFUND_REVERSED';
  occurredAt: string;
  appUserId: string;
};
export type PaidPurchaseVerificationConfig = {
  /** RevenueCat app configuration ID, not the Apple bundle ID. */
  appId: string;
  /** The primary opaque ID assigned to this database account. Never an alias. */
  appUserId: string;
  environment: PaidStoreEnvironment;
};
const ID = /^[A-Za-z0-9._-]{1,200}$/;
const OPAQUE_ID = /^np_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_AGE_MS = 15 * 60 * 1000;
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function millis(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
}
function identifier(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function identity(value: unknown): value is string { return typeof value === 'string' && OPAQUE_ID.test(value); }
function environment(value: unknown): value is PaidStoreEnvironment { return value === 'SANDBOX' || value === 'PRODUCTION'; }
function product(value: unknown): value is PaidTokenProduct {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAID_TOKEN_PRODUCTS, value);
}
export function paidPurchaseQuantity(productId: unknown): number {
  if (!product(productId)) throw new Error('paid_product_mismatch');
  return PAID_TOKEN_PRODUCTS[productId];
}

/** Parse an already authenticated event, not the outer webhook envelope.
 * Delayed webhook deliveries are valid: freshness is the authenticated receipt
 * time, while occurredAt orders refunds. Neither aliases nor original IDs grant
 * ownership. Transfers must be separately reconciled in the database.
 */
export function parseTrustedPaidPurchaseEvent(
  input: unknown, config: PaidPurchaseVerificationConfig, now = Date.now(),
): PaidPurchaseEvent {
  if (!millis(now) || !identifier(config.appId) || !identity(config.appUserId) || !environment(config.environment)) {
    throw new Error('paid_verification_config_invalid');
  }
  const event = record(input);
  if (!event || typeof event.type !== 'string' || !['NON_RENEWING_PURCHASE', 'CANCELLATION', 'REFUND_REVERSED'].includes(event.type)) {
    throw new Error('paid_event_type_invalid');
  }
  if (event.app_id !== config.appId || event.environment !== config.environment || event.store !== 'APP_STORE') {
    throw new Error('paid_store_mismatch');
  }
  if (!identity(event.app_user_id) || event.app_user_id !== config.appUserId) throw new Error('paid_owner_mismatch');
  if (!product(event.product_id)) throw new Error('paid_product_mismatch');
  if (!identifier(event.transaction_id) || !identifier(event.id)) throw new Error('paid_transaction_invalid');
  if (event.is_family_share !== false) throw new Error('paid_ownership_unverified');
  if (!millis(event.purchased_at_ms) || !millis(event.event_timestamp_ms)
    || event.purchased_at_ms > now + 60_000 || event.event_timestamp_ms > now + 60_000
    || event.event_timestamp_ms < event.purchased_at_ms) throw new Error('paid_event_time_invalid');
  if (event.expiration_at_ms != null || (event.period_type != null && event.period_type !== 'NORMAL')) {
    throw new Error('paid_consumable_shape_invalid');
  }
  // Quantities are fixed by the allowlist. Unsupported multi-quantity purchases
  // fail closed rather than silently under-crediting or trusting payload units.
  if (event.quantity != null && event.quantity !== 1) throw new Error('paid_quantity_unsupported');
  return {
    transactionId: event.transaction_id, productId: event.product_id,
    purchasedAt: new Date(event.purchased_at_ms).toISOString(), environment: config.environment,
    state: event.type === 'CANCELLATION' ? 'revoked' : 'verified', verifiedAt: new Date(now).toISOString(),
    eventId: event.id, eventType: event.type as PaidPurchaseEvent['eventType'],
    occurredAt: new Date(event.event_timestamp_ms).toISOString(), appUserId: config.appUserId,
  };
}

/** Pure transition model for SQL parity tests. Call inside a transaction holding
 * the global (store, environment, transactionId) ownership lock; a JS check alone
 * does not prevent two accounts racing. A purchase replay never clears a refund.
 */
export function reconcilePaidPurchaseEvent(previous: PaidPurchaseEvent | null, incoming: PaidPurchaseEvent): PaidPurchaseEvent {
  if (!previous) return incoming;
  if (previous.transactionId !== incoming.transactionId || previous.environment !== incoming.environment
    || previous.productId !== incoming.productId || previous.purchasedAt !== incoming.purchasedAt) throw new Error('paid_transaction_conflict');
  if (previous.appUserId !== incoming.appUserId) throw new Error('paid_owner_mismatch');
  if (previous.eventId === incoming.eventId) {
    if (previous.eventType !== incoming.eventType || previous.occurredAt !== incoming.occurredAt || previous.state !== incoming.state) {
      throw new Error('paid_event_conflict');
    }
    return previous;
  }
  if (incoming.eventType === 'NON_RENEWING_PURCHASE') return previous;
  const oldTime = Date.parse(previous.occurredAt), newTime = Date.parse(incoming.occurredAt);
  if (!Number.isFinite(oldTime) || !Number.isFinite(newTime)) throw new Error('paid_event_time_invalid');
  if (incoming.eventType === 'REFUND_REVERSED') return newTime > oldTime ? incoming : previous;
  // A cancellation wins ties. Only a later explicit reversal can supersede it.
  if (previous.eventType !== 'NON_RENEWING_PURCHASE' && oldTime > newTime) return previous;
  return incoming;
}

/** V1 documents non_subscriptions.id as a RevenueCat ID, not StoreKit's
 * transaction_id, and supplies no documented refund/ownership state there.
 * Never guess a mapping by timestamp, product, SDK data, or original ID.
 * Sync/restore must await/replay authenticated webhooks and read the existing
 * ledger; absence here must never revoke or credit an existing purchase.
 * https://www.revenuecat.com/docs/api-v1/customer-info-model
 */
export function inspectPaidSubscriberPurchases(
  input: unknown, config: Pick<PaidPurchaseVerificationConfig, 'appUserId' | 'environment'>, now = Date.now(),
): { purchases: never[]; verificationGap: 'v1_store_transaction_and_refund_state_unavailable'; verifiedAt: string } {
  if (!identity(config.appUserId) || !environment(config.environment) || !millis(now)) throw new Error('paid_verification_config_invalid');
  const root = record(input), subscriber = record(root?.subscriber), purchases = record(subscriber?.non_subscriptions);
  const requested = root?.request_date_ms;
  if (!subscriber || !purchases || !millis(requested) || requested > now + 60_000 || requested < now - MAX_AGE_MS) {
    throw new Error('paid_subscriber_invalid');
  }
  // A foreign original identity cannot be treated as ownership. Anonymous/alias
  // migrations need explicit server reconciliation, even though this grants none.
  if (subscriber.original_app_user_id !== config.appUserId) throw new Error('paid_owner_mismatch');
  for (const [productId, rows] of Object.entries(purchases)) {
    if (!product(productId)) continue; // Unrelated historical products confer no token credit.
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error('paid_subscriber_invalid');
    for (const value of rows) {
      const row = record(value);
      if (!row || row.store !== 'app_store' || row.is_sandbox !== (config.environment === 'SANDBOX')) throw new Error('paid_store_mismatch');
    }
  }
  return { purchases: [], verificationGap: 'v1_store_transaction_and_refund_state_unavailable', verifiedAt: new Date(requested).toISOString() };
}
