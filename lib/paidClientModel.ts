/** Client presentation contract only. Store prices never grant credit/access. */
export type PaidUsage = {
  unlimited: boolean; paid: boolean; verificationRequired: boolean;
  free: { limit: 3; used: number; reserved: number; remaining: number; periodStart: string; resetAt: string };
  tokens: { available: number; reserved: number; nonExpiring: true };
  canSubmit: boolean; paymentPriority: 'plus_free_tokens';
};
export type TokenProduct = { productId: string; quantity: 20 | 50 | 200; packageId: string };
export type PurchaseHint = { productId: string; transactionId?: string; attemptedAt: string };
export type PurchaseVerification = { productId: string; transactionId?: string; attemptedAt?:string; state: 'verified' | 'pending' | 'revoked' };
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export function paidUsage(value: unknown): PaidUsage | null {
  const u = value as PaidUsage | null;
  if (!u || u.paymentPriority !== 'plus_free_tokens' || typeof u.unlimited !== 'boolean'
    || typeof u.paid !== 'boolean' || typeof u.verificationRequired !== 'boolean' || typeof u.canSubmit !== 'boolean'
    || u.free?.limit !== 3 || u.tokens?.nonExpiring !== true
    || ![u.free.used,u.free.reserved,u.free.remaining,u.tokens.available,u.tokens.reserved].every(count)
    || u.free.used + u.free.reserved + u.free.remaining !== 3
    || !Number.isFinite(Date.parse(u.free.periodStart)) || !Number.isFinite(Date.parse(u.free.resetAt))
    || Date.parse(u.free.resetAt) <= Date.parse(u.free.periodStart)) return null;
  return u;
}
export function validTokenProducts(value: unknown): value is TokenProduct[] {
  if (!Array.isArray(value) || value.length !== 3) return false;
  return [20,50,200].every(quantity => value.filter(p => p?.quantity === quantity).length === 1)
    && new Set(value.map(p => p.productId)).size === 3 && new Set(value.map(p => p.packageId)).size === 3
    && value.every(p => typeof p.productId === 'string' && p.productId.length > 0 && typeof p.packageId === 'string' && p.packageId.length > 0);
}
export function receiptMatches(hint: PurchaseHint, receipt?: PurchaseVerification | null): boolean {
  return receipt?.state === 'verified' && receiptResolves(hint,receipt);
}
export function receiptResolves(hint: PurchaseHint, receipt?: PurchaseVerification | null): boolean {
  return !!receipt && receipt.productId === hint.productId && ['verified','revoked'].includes(receipt.state)
    && typeof receipt.transactionId === 'string' && receipt.transactionId.length>0
    && (hint.transactionId ? receipt.transactionId === hint.transactionId : receipt.attemptedAt === hint.attemptedAt);
}
export function localizedUtcDate(value: string | null | undefined, locale: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(locale, { month:'short', day:'numeric', year:'numeric', timeZone:'UTC' }).format(new Date(value));
}
