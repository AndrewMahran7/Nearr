import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF_RE = /^r_[A-Za-z0-9_-]{20,64}$/;

export type PublicPlace = {
  requestedPublicId: string;
  publicId: string;
  redirected: boolean;
  name: string;
  category: string | null;
  placeType: string | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  displayAddress: string | null;
  latitude: number;
  longitude: number;
  heroImage: string | null;
  originalVideoUrl: null;
  available: boolean;
};

export type SharedPlaceSaveResult = {
  savedPlaceId: string;
  publicPlaceId: string;
  created: boolean;
};

export type OwnedSavedPlaceSummary = {
  id: string;
  sourceUrl: string | null;
};

type PublicPlaceShareResult = {
  publicPlaceId: string;
  referralId: string | null;
};

function supabaseOrigin(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  const raw = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '').trim();
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

export function validPublicPlaceId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function cleanReferralId(value: unknown): string | null {
  return typeof value === 'string' && REF_RE.test(value) ? value : null;
}

export async function loadPublicPlace(
  publicPlaceId: string,
  referralId?: string | null,
): Promise<PublicPlace> {
  if (!validPublicPlaceId(publicPlaceId)) throw new Error('place_not_found');
  const origin = supabaseOrigin();
  if (!origin) throw new Error('service_unavailable');
  const url = new URL(`/functions/v1/public-place/${publicPlaceId.toLowerCase()}`, origin);
  url.searchParams.set('channel', 'app');
  const ref = cleanReferralId(referralId);
  if (ref) url.searchParams.set('ref', ref);

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404 || response.status === 400) throw new Error('place_not_found');
  if (!response.ok) throw new Error('service_unavailable');
  const data = await response.json() as PublicPlace;
  if (!validPublicPlaceId(data.publicId) || typeof data.name !== 'string') {
    throw new Error('invalid_public_place_response');
  }
  return data;
}

export async function createPublicPlaceShare(
  placeId: string,
  sourceSurface = 'place_detail',
): Promise<PublicPlaceShareResult> {
  if (!validPublicPlaceId(placeId)) throw new Error('invalid_public_place_id');
  const { data, error } = await supabase.rpc('create_public_place_share', {
    p_place_id: placeId,
    p_source_surface: sourceSurface,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const publicPlaceId = row?.public_place_id;
  if (!validPublicPlaceId(publicPlaceId)) throw new Error('invalid_share_response');
  return {
    publicPlaceId,
    referralId: cleanReferralId(row?.referral_id),
  };
}

export async function saveSharedPlace(
  publicPlaceId: string,
  referralId?: string | null,
): Promise<SharedPlaceSaveResult> {
  if (!validPublicPlaceId(publicPlaceId)) throw new Error('invalid_public_place_id');
  const { data, error } = await supabase.rpc('save_shared_place', {
    p_public_id: publicPlaceId,
    p_referral_id: cleanReferralId(referralId),
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.saved_place_id || !validPublicPlaceId(row?.public_place_id)) {
    throw new Error('invalid_save_response');
  }
  return {
    savedPlaceId: row.saved_place_id,
    publicPlaceId: row.public_place_id,
    created: row.created === true,
  };
}

export async function getOwnedSaveForPublicPlace(
  publicPlaceId: string,
): Promise<OwnedSavedPlaceSummary | null> {
  if (!validPublicPlaceId(publicPlaceId)) return null;
  const { data, error } = await supabase
    .from('saved_places')
    .select('id, source_url')
    .eq('place_id', publicPlaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) return null;
  return { id: data.id, sourceUrl: data.source_url ?? null };
}
