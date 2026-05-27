// supabase/functions/process-share-link/places/googlePlaces.ts
//
// Server-side Google Places client. Behaviorally identical to the
// `searchPlaces`, `geocodeAddressServer`, `geocodeContextText`, and
// `verifyPlaceAtAddressServer` helpers in the legacy index.ts.

// @ts-nocheck — Deno runtime.

import type { SearchBias } from '../types.ts';
import {
  haversineMeters,
  hasStrongNameMatch,
  isAddressLikeTypes,
  isLocalityLikeTypes,
} from './placeNormalization.ts';

export type PlacesCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  types?: string[];
};

export type SearchPlacesResult =
  | { ok: true; results: PlacesCandidate[] }
  | { ok: false; reason: 'http_error' | 'api_error'; status?: string; error?: string };

const PLACES_BASE =
  'https://maps.googleapis.com/maps/api/place/textsearch/json';
const GEOCODE_BASE =
  'https://maps.googleapis.com/maps/api/geocode/json';

export const ADDRESS_VERIFY_RADIUS_M = 150;
export const GEOCODE_TIMEOUT_MS = 4_000;

export async function searchPlaces(
  query: string,
  key: string,
  bias?: SearchBias,
): Promise<SearchPlacesResult> {
  const params = new URLSearchParams({ query, key });
  if (bias) {
    params.set('location', `${bias.lat},${bias.lng}`);
    params.set('radius', '50000');
  }
  let json: any;
  try {
    const res = await fetch(`${PLACES_BASE}?${params}`);
    if (!res.ok) {
      return { ok: false, reason: 'http_error', error: `HTTP ${res.status}` };
    }
    json = await res.json();
  } catch (err) {
    return { ok: false, reason: 'http_error', error: (err as Error)?.message };
  }
  const status = json?.status as string;
  if (status !== 'OK' && status !== 'ZERO_RESULTS') {
    return {
      ok: false,
      reason: 'api_error',
      status,
      error: json?.error_message ?? status,
    };
  }
  const results: PlacesCandidate[] = (json.results ?? []).slice(0, 8).map((r: any) => ({
    googlePlaceId: r.place_id,
    name: r.name,
    formattedAddress: r.formatted_address ?? undefined,
    latitude: r.geometry?.location?.lat,
    longitude: r.geometry?.location?.lng,
    types: Array.isArray(r.types) ? r.types : undefined,
  }));
  return { ok: true, results };
}

export type GeocodedAddress = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  placeId?: string;
  locationType?: string;
};

export async function geocodeAddressServer(
  address: string,
  key: string,
): Promise<GeocodedAddress | null> {
  const trimmed = (address ?? '').trim();
  if (!trimmed || !key) return null;
  const params = new URLSearchParams({ address: trimmed, key });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEOCODE_TIMEOUT_MS);
  let json: any;
  try {
    const res = await fetch(`${GEOCODE_BASE}?${params}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    json = await res.json();
  } catch (err) {
    console.warn('[share-geocode] fetch failed', (err as Error)?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
  if ((json?.status ?? 'UNKNOWN') !== 'OK') return null;
  const raw = Array.isArray(json.results) ? json.results : [];
  if (raw.length === 0) return null;
  const first = raw[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
    formattedAddress:
      typeof first.formatted_address === 'string'
        ? first.formatted_address
        : trimmed,
    placeId: typeof first.place_id === 'string' ? first.place_id : undefined,
    locationType:
      typeof first.geometry?.location_type === 'string'
        ? first.geometry.location_type
        : undefined,
  };
}

export async function geocodeContextText(
  contextText: string,
  key: string,
): Promise<SearchBias | null> {
  const trimmed = contextText.trim();
  if (!trimmed) return null;
  const params = new URLSearchParams({ query: trimmed, key });
  let json: any;
  try {
    const res = await fetch(`${PLACES_BASE}?${params}`);
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }
  const status = json?.status as string;
  if (status !== 'OK' && status !== 'ZERO_RESULTS') return null;
  const raw = Array.isArray(json.results) ? json.results : [];
  if (raw.length === 0) return null;
  const first = raw[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export type AddressVerification =
  | {
      status: 'verified';
      candidate: PlacesCandidate;
      geocoded: GeocodedAddress;
      distanceMeters: number;
    }
  | {
      status: 'ambiguous';
      candidates: PlacesCandidate[];
      geocoded: GeocodedAddress;
    }
  | {
      status: 'failed';
      reason:
        | 'geocode_failed'
        | 'no_candidates_near_address'
        | 'name_mismatch'
        | 'no_business_near_address';
      geocoded: GeocodedAddress | null;
    };

/**
 * Mirror of services/placesService.ts `verifyPlaceAtAddress`. Used
 * by the address-first resolver to confirm that an extracted street
 * address actually corresponds to a real business — and, when an
 * optional name is supplied, that the business at that address has
 * a strong name match.
 */
export async function verifyPlaceAtAddressServer(
  address: string,
  optionalPlaceName: string | null,
  key: string,
): Promise<AddressVerification> {
  const geocoded = await geocodeAddressServer(address, key);
  if (!geocoded) {
    return { status: 'failed', reason: 'geocode_failed', geocoded: null };
  }
  const query = (optionalPlaceName?.trim() || geocoded.formattedAddress || address).trim();
  const params = new URLSearchParams({
    query,
    location: `${geocoded.latitude},${geocoded.longitude}`,
    radius: '200',
    key,
  });
  let json: any;
  try {
    const res = await fetch(`${PLACES_BASE}?${params}`);
    if (!res.ok) {
      return { status: 'failed', reason: 'no_business_near_address', geocoded };
    }
    json = await res.json();
  } catch {
    return { status: 'failed', reason: 'no_business_near_address', geocoded };
  }
  const status: string = json?.status ?? 'UNKNOWN';
  if (status !== 'OK' && status !== 'ZERO_RESULTS') {
    return { status: 'failed', reason: 'no_business_near_address', geocoded };
  }
  const raw: any[] = Array.isArray(json.results) ? json.results : [];
  const all: PlacesCandidate[] = raw.map((r: any) => ({
    googlePlaceId: r.place_id,
    name: r.name,
    formattedAddress: r.formatted_address ?? undefined,
    latitude: r.geometry?.location?.lat,
    longitude: r.geometry?.location?.lng,
    types: Array.isArray(r.types) ? r.types : undefined,
  }));

  const nearby = all.filter((c) => {
    if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return false;
    if (isAddressLikeTypes(c.types)) return false;
    if (isLocalityLikeTypes(c.types)) return false;
    const d = haversineMeters(
      geocoded.latitude, geocoded.longitude, c.latitude!, c.longitude!,
    );
    return d <= ADDRESS_VERIFY_RADIUS_M;
  });

  if (nearby.length === 0) {
    return { status: 'failed', reason: 'no_business_near_address', geocoded };
  }

  if (optionalPlaceName && optionalPlaceName.trim()) {
    const matches = nearby.filter((c) => hasStrongNameMatch(c.name, optionalPlaceName));
    if (matches.length === 1) {
      const distanceMeters = haversineMeters(
        geocoded.latitude, geocoded.longitude,
        matches[0].latitude!, matches[0].longitude!,
      );
      return { status: 'verified', candidate: matches[0], geocoded, distanceMeters };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', candidates: matches.slice(0, 5), geocoded };
    }
    return { status: 'failed', reason: 'name_mismatch', geocoded };
  }

  if (nearby.length === 1) {
    const distanceMeters = haversineMeters(
      geocoded.latitude, geocoded.longitude,
      nearby[0].latitude!, nearby[0].longitude!,
    );
    return { status: 'verified', candidate: nearby[0], geocoded, distanceMeters };
  }
  return { status: 'ambiguous', candidates: nearby.slice(0, 5), geocoded };
}
