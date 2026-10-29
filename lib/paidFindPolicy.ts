import { PLUS_PRODUCT_ID, PLUS_VERIFICATION_MAX_AGE_MS, hasVerifiedPlusAccess, type PlusEntitlementSnapshot } from './plusEntitlements.ts';
/** Public catalog identifiers are not evidence that Apple/RevenueCat is configured. */
export const PAID_TOKEN_PRODUCTS = [
  { productId: 'com.nearr.tokens.20.v2', quantity: 20, packageId: 'tokens_20_v2' },
  { productId: 'com.nearr.tokens.50.v2', quantity: 50, packageId: 'tokens_50_v2' },
  { productId: 'com.nearr.tokens.200.v2', quantity: 200, packageId: 'tokens_200_v2' },
] as const;

export type VerifiedPurchase = {
  transactionId: string; productId: string; purchasedAt: string;
  state: 'verified' | 'revoked';
};

/** Client hints only select a verified server record; they never establish payment. */
export function reconcilePurchaseHint(hint: unknown, purchases: VerifiedPurchase[], freshSubscriptionSnapshot?: PlusEntitlementSnapshot | null, now = Date.now()) {
  const h = hint as Record<string, unknown> | null;
  if (!h || typeof h.productId !== 'string') return null;
  const id = typeof h.transactionId === 'string' ? h.transactionId : null;
  const since = typeof h.attemptedAt === 'string' ? Date.parse(h.attemptedAt) : NaN;
  if (h.productId === PLUS_PRODUCT_ID) {
    const s = freshSubscriptionSnapshot;
    const prefix = s ? `${s.environment}:${PLUS_PRODUCT_ID}:` : '';
    const tx = s?.periodKey?.startsWith(prefix) ? s.periodKey.slice(prefix.length) : null;
    const verified = s ? Date.parse(s.verifiedAt) : NaN;
    const purchased = s?.periodStart ? Date.parse(s.periodStart) : NaN;
    const valid = !!s && s.productId === PLUS_PRODUCT_ID && ['SANDBOX','PRODUCTION'].includes(s.environment)
      && !!tx && /^[A-Za-z0-9._-]{1,200}$/.test(tx) && Number.isFinite(verified)
      && verified <= now + 60_000 && now - verified <= PLUS_VERIFICATION_MAX_AGE_MS
      && (!Number.isFinite(since) || verified >= since)
      && (id ? tx === id : Number.isFinite(since) && purchased >= since)
      && (hasVerifiedPlusAccess(s,now) || s.state === 'revoked');
    return { productId:h.productId, transactionId:valid ? tx : id,
      state:valid ? (s!.state === 'revoked' ? 'revoked' : 'verified') : 'pending',
      ...(valid && !id ? { attemptedAt:h.attemptedAt } : {}) };
  }
  if (!PAID_TOKEN_PRODUCTS.some(p => p.productId === h.productId)) return null;
  const matches = purchases.filter(p => p.productId === h.productId &&
    (id ? p.transactionId === id : Number.isFinite(since) && Date.parse(p.purchasedAt) >= since));
  const receipt = matches.length === 1 ? matches[0] : null;
  return { productId: h.productId, transactionId: receipt?.transactionId ?? id,
    state: receipt?.state ?? 'pending',
    ...(receipt && !id ? { attemptedAt: h.attemptedAt } : {}) };
}
