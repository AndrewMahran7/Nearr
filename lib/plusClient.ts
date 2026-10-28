import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { classifyPlusPurchaseError, hasVerifiedPlusAccess, type PlusEntitlementSnapshot } from './plusEntitlements';
import type { PlusReleaseMode } from './plusReleasePolicy';

export const PLUS_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';
export type PlusStatus = {
  ok: true; salesEnabled: boolean; purchaseEligible: boolean; restoreAvailable: boolean;
  releaseMode?: PlusReleaseMode;
  appUserId: string | null; offeringId: string; productId: string;
  freeFinds: number; plusFinds: number;
  usage: { used: number; reserved: number; limit: number; remaining: number; periodStart: string; periodEnd: string; enforced?: boolean };
  entitlement: PlusEntitlementSnapshot | null;
};
export type PlusOffer = { package: any; price: string; productId: string };
let configured = false; let identity: string | null = null; let operationQueue: Promise<unknown> = Promise.resolve();
function sdkKey(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const key = extra.revenueCatIosApiKey;
  return typeof key === 'string' && key.startsWith('appl_') ? key : '';
}
async function authenticatedUser(expected: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (!data.session || data.session.user.id !== expected || data.session.user.is_anonymous) throw new Error('plus_account_changed');
}
async function sdkOperation<T>(userId: string, appUserId: string, task: (sdk: any) => Promise<T>): Promise<T> {
  const run = operationQueue.catch(() => undefined).then(async () => {
    await authenticatedUser(userId); if (!sdkKey()) throw new Error('plus_store_unavailable');
    const Purchases = require('react-native-purchases').default;
    if (!configured) { Purchases.configure({ apiKey: sdkKey(), appUserID: appUserId }); configured = true; identity = appUserId; }
    else if (identity !== appUserId) { await Purchases.logIn(appUserId); identity = appUserId; }
    await authenticatedUser(userId); const value = await task(Purchases); await authenticatedUser(userId); return value;
  });
  operationQueue = run; return run;
}
export async function fetchPlusStatus(userId: string, action = 'status'): Promise<PlusStatus> {
  await authenticatedUser(userId);
  const { data, error } = await supabase.functions.invoke('plus-api', { body: { action } });
  await authenticatedUser(userId);
  if (error || !data?.ok || !data.usage || typeof data.productId !== 'string') throw new Error('plus_unavailable');
  return data as PlusStatus;
}
export async function loadPlusOffer(userId: string, status: PlusStatus): Promise<PlusOffer | null> {
  if (status.releaseMode === 'free_only' || !status.salesEnabled || !status.purchaseEligible || !status.appUserId || hasVerifiedPlusAccess(status.entitlement)) return null;
  return sdkOperation(userId, status.appUserId, async sdk => {
    const offerings = await sdk.getOfferings();
    const matches = offerings.all[status.offeringId]?.availablePackages.filter((item: any) => item.product.identifier === status.productId && item.packageType === 'MONTHLY' && item.product.subscriptionPeriod === 'P1M' && item.product.price > 0 && item.product.priceString.trim().length > 0);
    if (!matches || matches.length !== 1) return null;
    return { package: matches[0], price: matches[0].product.priceString, productId: status.productId };
  });
}
export async function purchasePlus(userId: string, offer: PlusOffer): Promise<{ outcome: 'verified' | 'pending' | 'cancelled' | 'error'; status?: PlusStatus }> {
  try {
    const status = await fetchPlusStatus(userId);
    if (status.releaseMode === 'free_only' || !status.salesEnabled || !status.purchaseEligible || !status.appUserId || status.productId !== offer.productId) throw new Error('plus_offer_unavailable');
    await recordPlusEvent('purchase_initiated');
    await sdkOperation(userId, status.appUserId, async sdk => { await sdk.purchasePackage(offer.package); });
    const verified = await fetchPlusStatus(userId, 'sync');
    return { outcome: hasVerifiedPlusAccess(verified.entitlement) ? 'verified' : 'pending', status: verified };
  } catch (error) {
    const outcome = classifyPlusPurchaseError(error); if (outcome === 'cancelled') await recordPlusEvent('purchase_cancelled'); return { outcome };
  }
}
export async function restorePlus(userId: string): Promise<PlusStatus> {
  const status = await fetchPlusStatus(userId, 'restore');
  if (status.releaseMode === 'free_only' || !status.restoreAvailable || !status.appUserId) throw new Error('plus_store_unavailable');
  await sdkOperation(userId, status.appUserId, async sdk => { await sdk.restorePurchases(); });
  const verified = await fetchPlusStatus(userId, 'restore'); await recordPlusEvent('restore_completed'); return verified;
}
export async function recordPlusEvent(event: string): Promise<void> {
  try { await supabase.functions.invoke('plus-api', { body: { action: 'event', event, eventId: Crypto.randomUUID() } }); } catch { /* optional */ }
}
