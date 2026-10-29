import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { classifyPlusPurchaseError, hasVerifiedPlusAccess, type PlusEntitlementSnapshot } from './plusEntitlements';
import type { PlusReleaseMode } from './plusReleasePolicy';
import { paidUsage, receiptMatches, receiptResolves, validTokenProducts, type PaidUsage, type PurchaseHint, type PurchaseVerification, type TokenProduct } from './paidClientModel';

export const PLUS_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';
export type PlusStatus = {
  ok: true; salesEnabled: boolean; purchaseEligible: boolean; restoreAvailable: boolean;
  releaseMode?: PlusReleaseMode; subscriptionBenefit?: 'unlimited'; catalogVerified?: boolean;
  appUserId: string | null; offeringId: string; productId: string;
  freeFinds: number; plusFinds: number | null;
  usage: Partial<PaidUsage> & { used?: number; reserved?: number; limit?: number | null; remaining?: number | null; periodStart?: string; periodEnd?: string; enforced?: boolean };
  tokenProducts?: TokenProduct[]; tokenPurchasesReady?: boolean; purchaseBlockedReason?: string | null;
  purchaseVerification?: PurchaseVerification | null;
  entitlement: PlusEntitlementSnapshot | null;
};
export type PlusOffer = { package: any; price: string; productId: string };
export type TokenOffer = PlusOffer & { quantity: 20 | 50 | 200 };
export type PaidCatalog = { subscription: PlusOffer | null; tokens: TokenOffer[] };
export type PurchaseResult = { outcome: 'verified' | 'pending' | 'cancelled' | 'error'; status?: PlusStatus };
let configured = false; let identity: string | null = null; let operationQueue: Promise<unknown> = Promise.resolve();
let purchasing = false;
const pendingKey = (userId: string) => `nearr:pending-store-purchase:v1:${userId}`;
function sdkKey(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const key = extra.revenueCatIosApiKey;
  return Platform.OS === 'ios' && typeof key === 'string' && key.startsWith('appl_') ? key : '';
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
export async function pendingPurchase(userId: string): Promise<PurchaseHint | null> {
  const raw = await AsyncStorage.getItem(pendingKey(userId));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value.productId !== 'string' || !Number.isFinite(Date.parse(value.attemptedAt))) throw new Error('purchase_recovery_required');
  return value;
}
export function hasUnlimitedCatalog(status: PlusStatus): boolean {
  return status.releaseMode === 'paid' && status.subscriptionBenefit === 'unlimited'
    && status.plusFinds === null && status.catalogVerified === true && !!paidUsage(status.usage);
}
export async function fetchPlusStatus(userId: string, action = 'status'): Promise<PlusStatus> {
  await authenticatedUser(userId);
  const hint = action === 'sync' || action === 'restore' ? await pendingPurchase(userId) : null;
  const { data, error } = await supabase.functions.invoke('plus-api', { body: { action, ...(hint ? { purchase:hint } : {}) } });
  await authenticatedUser(userId);
  if (error || !data?.ok || !data.usage || typeof data.productId !== 'string') throw new Error('plus_unavailable');
  if (hint && receiptResolves(hint, data.purchaseVerification)) await AsyncStorage.removeItem(pendingKey(userId));
  return data as PlusStatus;
}
function validPrice(product: any): boolean {
  return typeof product?.price === 'number' && Number.isFinite(product.price) && product.price > 0
    && typeof product.priceString === 'string' && product.priceString.trim().length > 0;
}
export async function loadPaidCatalog(userId: string, status: PlusStatus): Promise<PaidCatalog> {
  const closed: PaidCatalog = { subscription:null, tokens:[] };
  if (!hasUnlimitedCatalog(status) || !status.salesEnabled || !status.purchaseEligible || !status.appUserId) return closed;
  return sdkOperation(userId, status.appUserId, async sdk => {
    const offerings = await sdk.getOfferings();
    const packages: any[] = offerings.all?.[status.offeringId]?.availablePackages ?? [];
    const matches = packages.filter(item => item.product?.identifier === status.productId && item.packageType === 'MONTHLY'
      && item.product.subscriptionPeriod === 'P1M' && item.product.productCategory === 'SUBSCRIPTION'
      && item.product.productType === 'AUTO_RENEWABLE_SUBSCRIPTION'
      && item.product.introPrice == null && validPrice(item.product));
    const subscription = matches.length === 1 && !hasVerifiedPlusAccess(status.entitlement)
      ? { package:matches[0], price:matches[0].product.priceString, productId:status.productId } : null;
    const tokens: TokenOffer[] = [];
    if (status.tokenPurchasesReady && validTokenProducts(status.tokenProducts)) {
      for (const expected of status.tokenProducts) {
        const found = packages.filter(item => item.identifier === expected.packageId && item.product?.identifier === expected.productId
          && item.product.subscriptionPeriod == null && item.product.productCategory === 'NON_SUBSCRIPTION'
          && item.product.productType === 'CONSUMABLE' && validPrice(item.product));
        if (found.length !== 1) return { subscription, tokens:[] };
        tokens.push({ package:found[0], price:found[0].product.priceString, productId:expected.productId, quantity:expected.quantity });
      }
    }
    return { subscription, tokens:tokens.sort((a,b) => a.quantity-b.quantity) };
  });
}
export async function loadPlusOffer(userId: string, status: PlusStatus): Promise<PlusOffer | null> {
  return (await loadPaidCatalog(userId,status)).subscription;
}
async function purchase(userId: string, offer: PlusOffer, kind: 'subscription' | 'tokens'): Promise<PurchaseResult> {
  if (purchasing) return { outcome:'pending' };
  purchasing = true; let enteredStore = false; let markerCreated = false;
  try {
    if (await pendingPurchase(userId)) return { outcome:'pending' };
    const status = await fetchPlusStatus(userId);
    const catalog = await loadPaidCatalog(userId,status);
    const current = kind === 'subscription' ? catalog.subscription : catalog.tokens.find(p => p.productId === offer.productId);
    if (!status.appUserId || !current || current.productId !== offer.productId || current.price !== offer.price) throw new Error('plus_offer_unavailable');
    // Recovery marker only, never an entitlement or balance. A lost callback
    // must lead to reconciliation, not a second charge.
    let hint: PurchaseHint = { productId:current.productId, attemptedAt:new Date().toISOString() };
    await AsyncStorage.setItem(pendingKey(userId),JSON.stringify(hint));
    markerCreated = true;
    await recordPlusEvent('purchase_initiated');
    const result: any = await sdkOperation(userId,status.appUserId,sdk => {
      enteredStore = true;
      return sdk.purchasePackage(current.package);
    });
    const transactionId = result?.transaction?.transactionIdentifier;
    if (typeof transactionId === 'string' && transactionId.length > 0) {
      hint = {...hint,transactionId}; await AsyncStorage.setItem(pendingKey(userId),JSON.stringify(hint));
    }
    const verified = await fetchPlusStatus(userId, 'sync');
    const confirmed = receiptMatches(hint, verified.purchaseVerification);
    return { outcome:confirmed ? 'verified' : receiptResolves(hint,verified.purchaseVerification) ? 'error' : 'pending', status:verified };
  } catch (error) {
    const outcome = classifyPlusPurchaseError(error);
    if (outcome === 'cancelled' || (markerCreated && !enteredStore)) await AsyncStorage.removeItem(pendingKey(userId)).catch(() => undefined);
    if (outcome === 'cancelled') await recordPlusEvent('purchase_cancelled');
    return { outcome:outcome === 'cancelled' ? outcome : enteredStore ? 'pending' : outcome };
  } finally { purchasing = false; }
}
export async function purchasePlus(userId: string, offer: PlusOffer): Promise<PurchaseResult> { return purchase(userId,offer,'subscription'); }
export async function purchaseTokenPack(userId: string, offer: TokenOffer): Promise<PurchaseResult> { return purchase(userId,offer,'tokens'); }
export async function reconcilePurchase(userId: string): Promise<PlusStatus> { return fetchPlusStatus(userId,'sync'); }
export async function restorePlus(userId: string): Promise<PlusStatus> {
  const status = await fetchPlusStatus(userId, 'restore');
  if (status.releaseMode === 'free_only' || !status.restoreAvailable || !status.appUserId) throw new Error('plus_store_unavailable');
  await sdkOperation(userId, status.appUserId, async sdk => { await sdk.restorePurchases(); });
  const verified = await fetchPlusStatus(userId, 'restore'); await recordPlusEvent('restore_completed'); return verified;
}
export async function recordPlusEvent(event: string): Promise<void> {
  try { await supabase.functions.invoke('plus-api', { body: { action:'event', event, eventId:Crypto.randomUUID() } }); } catch { /* optional */ }
}
