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
import { extractStateFromFormattedAddress } from './locationGuards.ts';

export type PlacesCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  types?: string[];
  shortFormattedAddress?: string;
  primaryType?: string;
  primaryTypeDisplayName?: string;
  googleMapsTypeLabel?: string;
  containingPlaces?: Array<{ id?: string; name?: string }>;
  photos?: Array<{ name?: string }>;
  /** Google `business_status` (OPERATIONAL | CLOSED_TEMPORARILY |
   *  CLOSED_PERMANENTLY). Used to demote permanently-closed candidates. */
  businessStatus?: string;
};

export type SearchPlacesResult =
  | { ok: true; results: PlacesCandidate[] }
  | { ok: false; reason: 'http_error' | 'api_error'; status?: string; error?: string; retryAfterSeconds?: number };

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const PLACES_V1_SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_BASE =
  'https://maps.googleapis.com/maps/api/geocode/json';

export const PLACES_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.businessStatus',
  'places.photos',
].join(',');

export const ADDRESS_VERIFY_RADIUS_M = 150;
export const GEOCODE_TIMEOUT_MS = 4_000;
export const PLACES_SEARCH_TIMEOUT_MS = 6_000;

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(900, Math.ceil(seconds));
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.min(900, Math.max(0, Math.ceil((dateMs - Date.now()) / 1000)));
}

export async function searchPlaces(
  query: string,
  key: string,
  bias?: SearchBias,
): Promise<SearchPlacesResult> {
  const body: Record<string, unknown> = { textQuery: query, maxResultCount: 8 };
  if (bias) {
    body.locationBias = {
      circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50_000 },
    };
  }
  let json: any;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PLACES_SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(PLACES_V1_SEARCH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': PLACES_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errorJson = await res.clone().json().catch(() => null);
      const serviceBlocked = errorJson?.error?.details?.some(
        (detail: any) => detail?.reason === 'API_KEY_SERVICE_BLOCKED',
      );
      if (res.status === 403 && serviceBlocked) {
        return searchPlacesLegacy(query, key, bias, ctrl.signal);
      }
      return {
        ok: false,
        reason: 'http_error',
        status: String(res.status),
        error: `HTTP ${res.status}`,
        retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after')),
      };
    }
    json = await res.json();
  } catch (err) {
    return { ok: false, reason: 'http_error', error: ctrl.signal.aborted ? 'timeout' : (err as Error)?.message };
  } finally {
    clearTimeout(timer);
  }
  const results: PlacesCandidate[] = (json.places ?? []).slice(0, 8).map(mapPlacesV1Candidate);
  return { ok: true, results };
}

async function searchPlacesLegacy(
  query: string,
  key: string,
  bias: SearchBias | undefined,
  signal: AbortSignal,
): Promise<SearchPlacesResult> {
  const params = new URLSearchParams({ query, key });
  if (bias) {
    params.set('location', `${bias.lat},${bias.lng}`);
    params.set('radius', '50000');
  }
  const res = await fetch(`${PLACES_BASE}?${params}`, { signal });
  if (!res.ok) {
    return {
      ok: false,
      reason: 'http_error',
      status: String(res.status),
      error: `HTTP ${res.status}`,
      retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after')),
    };
  }
  const json = await res.json();
  if (json?.status !== 'OK' && json?.status !== 'ZERO_RESULTS') {
    return { ok: false, reason: 'api_error', status: json?.status };
  }
  return {
    ok: true,
    results: (json.results ?? []).slice(0, 8).map(mapPlacesLegacyCandidate),
  };
}

export function mapPlacesV1Candidate(r: any): PlacesCandidate {
  const typeLabel = typeof r?.primaryTypeDisplayName?.text === 'string'
    ? r.primaryTypeDisplayName.text
    : undefined;
  return {
    googlePlaceId: r.id,
    name: r.displayName?.text ?? '',
    formattedAddress: r.formattedAddress ?? undefined,
    shortFormattedAddress: r.shortFormattedAddress ?? undefined,
    latitude: r.location?.latitude,
    longitude: r.location?.longitude,
    primaryType: typeof r.primaryType === 'string' ? r.primaryType : undefined,
    primaryTypeDisplayName: typeLabel,
    googleMapsTypeLabel: typeLabel,
    types: Array.isArray(r.types) ? r.types : undefined,
    businessStatus: typeof r.businessStatus === 'string' ? r.businessStatus : undefined,
    containingPlaces: Array.isArray(r.containingPlaces) ? r.containingPlaces : undefined,
    photos: Array.isArray(r.photos) ? r.photos : undefined,
  };
}

export function mapPlacesLegacyCandidate(r: any): PlacesCandidate {
  return {
    googlePlaceId: r.place_id,
    name: r.name ?? '',
    formattedAddress: r.formatted_address ?? undefined,
    latitude: r.geometry?.location?.lat,
    longitude: r.geometry?.location?.lng,
    // Legacy Places exposes only an unordered `types` array. Do not pretend
    // its first entry is the Places API (New) `primaryType` contract.
    primaryType: undefined,
    types: Array.isArray(r.types) ? r.types : undefined,
    businessStatus: typeof r.business_status === 'string' ? r.business_status : undefined,
    photos: Array.isArray(r.photos)
      ? r.photos.map((photo: any) => ({ name: photo?.photo_reference })).filter((photo: any) => photo.name)
      : undefined,
  };
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
): Promise<(SearchBias & { region?: string }) | null> {
  const trimmed = contextText.trim();
  if (!trimmed) return null;
  const result = await searchPlaces(trimmed, key);
  if (!result.ok || result.results.length === 0) return null;
  const first = result.results[0];
  const lat = first.latitude;
  const lng = first.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const region = extractStateFromFormattedAddress(first.formattedAddress ?? null);
  return { lat, lng, ...(region ? { region } : {}) };
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
