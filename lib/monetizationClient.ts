import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

import { areDeveloperToolsVisible } from '@/lib/appEnvironment';
import { supabase } from '@/lib/supabase';
import type { PlaceFindPriceSource } from '@/lib/placeFindConfig';

export type MonetizationMode = 'disabled' | 'dev_mock' | 'storekit';

export type PlaceFindProduct = {
  productId: string;
  uses: number;
  displayPrice: string;
  priceSource: PlaceFindPriceSource;
};

export type PlaceFindSnapshot = {
  available: number;
  reserved: number;
  products: PlaceFindProduct[];
  mode: 'dev_mock' | 'storekit_unavailable';
  mockPurchaseAuthorized: boolean;
  purchaseUnavailableReason: string | null;
};

function extraValue(key: string): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  return typeof extra[key] === 'string' ? (extra[key] as string) : '';
}

export function monetizationMode(): MonetizationMode {
  const enabled =
    process.env.EXPO_PUBLIC_MONETIZATION_ENABLED || extraValue('monetizationEnabled');
  if (enabled !== 'true') return 'disabled';
  const configured =
    process.env.EXPO_PUBLIC_MONETIZATION_MODE || extraValue('monetizationMode');
  if (configured === 'dev_mock') {
    return areDeveloperToolsVisible() ? 'dev_mock' : 'disabled';
  }
  return configured === 'storekit' ? 'storekit' : 'disabled';
}

export function isMonetizationEnabled(): boolean {
  return monetizationMode() !== 'disabled';
}

type BalanceResponse = {
  ok?: boolean;
  error?: string;
  balance?: { available?: number; reserved?: number };
  products?: PlaceFindProduct[];
  mode?: PlaceFindSnapshot['mode'];
  mockPurchaseAuthorized?: boolean;
  purchaseUnavailableReason?: string | null;
};

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export async function fetchPlaceFindSnapshot(): Promise<PlaceFindSnapshot> {
  const { data, error } = await supabase.functions.invoke<BalanceResponse>('monetization', {
    body: { action: 'balance' },
  });
  if (error || !data?.ok || !data.balance) throw new Error(data?.error ?? 'balance_unavailable');
  return {
    available: safeCount(data.balance.available),
    reserved: safeCount(data.balance.reserved),
    products: Array.isArray(data.products)
      ? data.products.filter(
          (product) =>
            typeof product?.productId === 'string' &&
            typeof product?.uses === 'number' &&
            typeof product?.displayPrice === 'string' &&
            (product?.priceSource === 'storekit' || product?.priceSource === 'dev_mock_config'),
        )
      : [],
    mode: data.mode === 'dev_mock' ? 'dev_mock' : 'storekit_unavailable',
    mockPurchaseAuthorized: data.mockPurchaseAuthorized === true,
    purchaseUnavailableReason: data.purchaseUnavailableReason ?? null,
  };
}

export async function purchaseDevMockPack(args: {
  productId: string;
  jobId?: string | null;
  premiumJobId?: string | null;
  clientPurchaseId?: string;
}): Promise<{ available: number; grantedUses: number; replayed: boolean; resumed: boolean }> {
  if (monetizationMode() !== 'dev_mock') throw new Error('dev_mock_unavailable');
  const clientPurchaseId = args.clientPurchaseId ?? Crypto.randomUUID();
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    balance?: { available?: number };
    grantedUses?: number;
    replayed?: boolean;
    resumedJob?: { status?: string; premium_state?: string } | null;
  }>('monetization', {
    body: {
      action: 'mock_purchase',
      productId: args.productId,
      clientPurchaseId,
      jobId: args.jobId ?? undefined,
      premiumJobId: args.premiumJobId ?? undefined,
    },
  });
  if (error || !data?.ok) throw new Error(data?.error ?? 'purchase_failed');
  return {
    available: safeCount(data.balance?.available),
    grantedUses: safeCount(data.grantedUses),
    replayed: data.replayed === true,
    resumed: data.resumedJob?.status === 'queued' ||
      data.resumedJob?.premium_state === 'reserved' ||
      data.resumedJob?.premium_state === 'processing',
  };
}

export async function requestPremiumRecognition(jobId: string): Promise<{
  premiumRequestId: string | null;
  premiumState: string;
  available: number;
  requiresPurchase: boolean;
  replayed: boolean;
}> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    requiresPurchase?: boolean;
    balance?: { available?: number };
    job?: {
      premium_request_id?: string | null;
      premium_state?: string;
      replayed?: boolean;
    } | null;
  }>('monetization', { body: { action: 'request_premium', premiumJobId: jobId } });
  if (error || !data?.ok || !data.job) throw new Error(data?.error ?? 'premium_request_failed');
  return {
    premiumRequestId: data.job.premium_request_id ?? null,
    premiumState: data.job.premium_state ?? 'not_eligible',
    available: safeCount(data.balance?.available),
    requiresPurchase: data.requiresPurchase === true,
    replayed: data.job.replayed === true,
  };
}

export async function resumePendingPlaceFindJob(jobId: string): Promise<{ resumed: boolean; available: number }> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    job?: { status?: string };
    balance?: { available?: number };
  }>('monetization', { body: { action: 'resume_job', jobId } });
  if (error || !data?.ok) throw new Error(data?.error ?? 'resume_failed');
  return { resumed: data.job?.status === 'queued', available: safeCount(data.balance?.available) };
}
