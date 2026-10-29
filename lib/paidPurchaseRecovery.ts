/** Server-only recovery from RevenueCat v2. This module performs GETs only.
 * Credentials and mappings must be loaded by the Edge service, never clients.
 * https://www.revenuecat.com/docs/api-v2/purchase
 * https://www.revenuecat.com/docs/api-v2/product
 */
import { PAID_TOKEN_PRODUCTS, type PaidPurchaseEvent, type PaidStoreEnvironment, type PaidTokenProduct } from './paidPurchaseVerification.ts';

export type PaidPurchaseRecoveryConfig = {
  projectId: string;
  appId: string;
  appUserId: string;
  environment: PaidStoreEnvironment;
  /** Exact approved Apple product -> RevenueCat internal product mapping. */
  productIds: Record<PaidTokenProduct, string>;
};
export type PaidPurchaseRecoverySnapshot = {
  source: 'revenuecat_v2';
  projectId: string;
  appId: string;
  appUserId: string;
  revenueCatPurchaseId: string;
  revenueCatProductId: string;
  transactionId: string;
  productId: PaidTokenProduct;
  purchasedAt: string;
  environment: PaidStoreEnvironment;
  state: 'verified' | 'revoked';
  requestStartedAt: string;
  verifiedAt: string;
};
const ID = /^[A-Za-z0-9._-]{1,200}$/;
const APP_USER = /^np_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RESPONSE_BYTES = 262144;
const REQUEST_MS = 15000;
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function time(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < 8_640_000_000_000_000; }
function validateConfig(config: PaidPurchaseRecoveryConfig, transactionId: string) {
  const mapping = record(config.productIds);
  if (!id(config.projectId) || !id(config.appId) || config.appId === 'com.nearr.ios' || !APP_USER.test(config.appUserId)
    || !['SANDBOX', 'PRODUCTION'].includes(config.environment) || !id(transactionId) || !mapping
    || Object.keys(mapping).length !== 3
    || Object.keys(PAID_TOKEN_PRODUCTS).some(product => !Object.prototype.hasOwnProperty.call(mapping, product) || !id(mapping[product]))
    || new Set(Object.values(mapping)).size !== 3) throw new Error('paid_recovery_config_invalid');
}
function purchaseFromList(input: unknown, config: PaidPurchaseRecoveryConfig, transactionId: string) {
  const list = record(input);
  // Never follow response-controlled pagination/URLs or pick one ambiguous row.
  if (!list || list.object !== 'list' || list.next_page !== null || !Array.isArray(list.items)
    || list.items.length !== 1) throw new Error('paid_recovery_lookup_ambiguous');
  const purchase = record(list.items[0]);
  if (!purchase || purchase.object !== 'purchase' || !id(purchase.id)
    || purchase.store_purchase_identifier !== transactionId || purchase.customer_id !== config.appUserId
    || purchase.store !== 'app_store' || purchase.environment !== config.environment.toLowerCase()
    || purchase.ownership !== 'purchased' || purchase.quantity !== 1
    || typeof purchase.status !== 'string' || !['owned', 'refunded'].includes(purchase.status)) throw new Error('paid_recovery_purchase_invalid');
  const storeProduct = (Object.keys(PAID_TOKEN_PRODUCTS) as PaidTokenProduct[]).find(p => config.productIds[p] === purchase.product_id);
  if (!storeProduct) throw new Error('paid_recovery_product_mismatch');
  return { purchase, storeProduct };
}

/** Pure validation of fresh responses fetched from fixed authenticated URLs.
 * A client may supply a transaction ID as a lookup hint, never the response,
 * identity, product mapping, request time, or credentials.
 */
export function verifyPaidPurchaseRecovery(
  searchPayload: unknown, productPayload: unknown, config: PaidPurchaseRecoveryConfig,
  transactionId: string, requestStartedAt: number, verifiedAt: number,
): PaidPurchaseRecoverySnapshot {
  validateConfig(config, transactionId);
  if (!time(requestStartedAt) || !time(verifiedAt) || verifiedAt < requestStartedAt || verifiedAt - requestStartedAt > REQUEST_MS) {
    throw new Error('paid_recovery_stale');
  }
  const { purchase, storeProduct } = purchaseFromList(searchPayload, config, transactionId);
  if (!time(purchase.purchased_at) || purchase.purchased_at > verifiedAt + 60000) throw new Error('paid_recovery_purchase_time_invalid');
  const product = record(productPayload), app = record(product?.app), apple = record(app?.app_store);
  const oneTime = record(product?.one_time);
  if (!product || product.object !== 'product' || product.id !== config.productIds[storeProduct]
    || product.store_identifier !== storeProduct || product.app_id !== config.appId
    || typeof product.state !== 'string' || !['active', 'archived'].includes(product.state)
    || !((product.type === 'consumable' && oneTime?.is_consumable !== false)
      || (product.type === 'one_time' && oneTime?.is_consumable === true))
    || product.subscription != null) throw new Error('paid_recovery_product_mismatch');
  if (!app || app.object !== 'app' || app.id !== config.appId || app.project_id !== config.projectId
    || app.type !== 'app_store' || apple?.bundle_id !== 'com.nearr.ios') throw new Error('paid_recovery_app_mismatch');
  return {
    source: 'revenuecat_v2', projectId: config.projectId, appId: config.appId, appUserId: config.appUserId,
    revenueCatPurchaseId: purchase.id as string, revenueCatProductId: config.productIds[storeProduct], transactionId, productId: storeProduct,
    purchasedAt: new Date(purchase.purchased_at).toISOString(), environment: config.environment,
    state: purchase.status === 'refunded' ? 'revoked' : 'verified',
    requestStartedAt: new Date(requestStartedAt).toISOString(), verifiedAt: new Date(verifiedAt).toISOString(),
  };
}

/** Pure funding decision, NOT a replacement callback row. SQL must retain the
 * callback watermark and revoked-recovery observation in separate records.
 * Fresh refunded recovery conservatively revokes funds; owned recovery never
 * revives them. A callback after the read began outranks an in-flight snapshot.
 * Apply again atomically under the shared ownership lock.
 */
export function reconcilePaidPurchaseRecovery<T extends PaidPurchaseEvent | PaidPurchaseRecoverySnapshot>(
  previous: T | null, snapshot: PaidPurchaseRecoverySnapshot,
): T | PaidPurchaseRecoverySnapshot {
  if (!previous) return snapshot;
  if (previous.transactionId !== snapshot.transactionId || previous.productId !== snapshot.productId
    || previous.environment !== snapshot.environment || previous.purchasedAt !== snapshot.purchasedAt) throw new Error('paid_transaction_conflict');
  if (previous.appUserId !== snapshot.appUserId) throw new Error('paid_owner_mismatch');
  if (snapshot.state === 'revoked') {
    if ('eventType' in previous && Date.parse(previous.occurredAt) > Date.parse(snapshot.requestStartedAt)) return previous;
    if ('source' in previous && Date.parse(previous.verifiedAt) > Date.parse(snapshot.verifiedAt)) return previous;
    return snapshot;
  }
  return previous;
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || response.redirected) {
    await response.body?.cancel(); throw new Error(`paid_recovery_http_${response.status}`);
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel(); throw new Error('paid_recovery_content_type');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > RESPONSE_BYTES)) {
    await response.body?.cancel(); throw new Error('paid_recovery_response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('paid_recovery_empty_response');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('paid_recovery_timeout');
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > RESPONSE_BYTES) throw new Error('paid_recovery_response_too_large');
      chunks.push(chunk.value);
    }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)); }
    catch { throw new Error('paid_recovery_invalid_json'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** At most two GETs, fixed RevenueCat origin, 15s total, 256 KiB per response,
 * redirects refused. This is server reconciliation, not provider inference.
 * Required scopes: customer_information:purchases:read,
 * project_configuration:products:read and project_configuration:apps:read.
 */
export async function fetchPaidPurchaseRecovery(
  config: PaidPurchaseRecoveryConfig, transactionId: string, serverSecret: string,
  fetchImpl: typeof fetch = fetch, clock: () => number = Date.now,
): Promise<PaidPurchaseRecoverySnapshot> {
  validateConfig(config, transactionId);
  if (typeof serverSecret !== 'string' || serverSecret.length < 8 || /[\r\n]/.test(serverSecret)) throw new Error('paid_recovery_credentials_unavailable');
  const started = clock(), controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('paid_recovery_timeout')); }, REQUEST_MS);
  });
  const request = async (url: string) => boundedJson(await fetchImpl(url, {
    method: 'GET', headers: { Authorization: `Bearer ${serverSecret}`, Accept: 'application/json', 'Cache-Control': 'no-cache' },
    signal: controller.signal, redirect: 'error', cache: 'no-store',
  }), controller.signal);
  try {
    return await Promise.race([(async () => {
      const base = `https://api.revenuecat.com/v2/projects/${encodeURIComponent(config.projectId)}`;
      const search = await request(`${base}/purchases?store_purchase_identifier=${encodeURIComponent(transactionId)}`);
      const { purchase } = purchaseFromList(search, config, transactionId);
      const product = await request(`${base}/products/${encodeURIComponent(String(purchase.product_id))}?expand=app`);
      return verifyPaidPurchaseRecovery(search, product, config, transactionId, started, clock());
    })(), timeout]);
  } catch (error) {
    if (error instanceof Error && /^paid_[a-z_0-9]+$/.test(error.message)) throw error;
    // Never leak credentials, upstream body, request URL, or customer identifiers.
    throw new Error(controller.signal.aborted ? 'paid_recovery_timeout' : 'paid_recovery_transport_error');
  } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}
