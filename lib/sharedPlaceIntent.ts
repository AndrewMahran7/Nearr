import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildNearrPlaceUrl } from '@/lib/placeShare';
import { cleanReferralId, validPublicPlaceId } from '@/lib/publicPlace';

const PENDING_KEY = 'nearr.sharedPlace.pending.v1';
const ACQUISITION_KEY = 'nearr.sharedPlace.acquisition.v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type PendingSharedPlaceIntent = {
  publicPlaceId: string;
  referralId: string | null;
  placeName: string;
  action: 'save';
  authRequired: boolean;
  createdAt: string;
};

function parseIntent(raw: string | null): PendingSharedPlaceIntent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingSharedPlaceIntent>;
    if (!validPublicPlaceId(value.publicPlaceId)) return null;
    if (value.action !== 'save' || typeof value.createdAt !== 'string') return null;
    const created = Date.parse(value.createdAt);
    if (!Number.isFinite(created) || Date.now() - created > MAX_AGE_MS) return null;
    return {
      publicPlaceId: value.publicPlaceId.toLowerCase(),
      referralId: cleanReferralId(value.referralId),
      placeName: typeof value.placeName === 'string' ? value.placeName.slice(0, 160) : '',
      action: 'save',
      authRequired: value.authRequired === true,
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

export async function persistSharedPlaceIntent(
  input: Omit<PendingSharedPlaceIntent, 'action' | 'createdAt'>,
): Promise<void> {
  const intent: PendingSharedPlaceIntent = {
    publicPlaceId: input.publicPlaceId.toLowerCase(),
    referralId: cleanReferralId(input.referralId),
    placeName: input.placeName.slice(0, 160),
    action: 'save',
    authRequired: input.authRequired,
    createdAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(intent));
}

export async function getPendingSharedPlaceIntent(): Promise<PendingSharedPlaceIntent | null> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  const intent = parseIntent(raw);
  if (!intent && raw) await AsyncStorage.removeItem(PENDING_KEY);
  return intent;
}

export async function clearPendingSharedPlaceIntent(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}

export async function pendingSharedPlaceRoute(): Promise<`/p/${string}` | null> {
  const intent = await getPendingSharedPlaceIntent();
  if (!intent) return null;
  const publicUrl = buildNearrPlaceUrl(intent.publicPlaceId, intent.referralId);
  if (!publicUrl) return null;
  const parsed = new URL(publicUrl);
  parsed.searchParams.set('action', 'save');
  return `${parsed.pathname}${parsed.search}` as `/p/${string}`;
}

export async function rememberSharedPlaceAcquisition(referralId: string | null): Promise<void> {
  const ref = cleanReferralId(referralId);
  if (!ref) return;
  await AsyncStorage.setItem(ACQUISITION_KEY, JSON.stringify({ referralId: ref, firstShareTracked: false }));
}

export async function getUntrackedAcquisitionReferral(): Promise<string | null> {
  try {
    const value = JSON.parse((await AsyncStorage.getItem(ACQUISITION_KEY)) ?? '{}');
    return value.firstShareTracked === false ? cleanReferralId(value.referralId) : null;
  } catch {
    return null;
  }
}

export async function markAcquisitionFirstShareTracked(): Promise<void> {
  const referralId = await getUntrackedAcquisitionReferral();
  if (!referralId) return;
  await AsyncStorage.setItem(ACQUISITION_KEY, JSON.stringify({ referralId, firstShareTracked: true }));
}
