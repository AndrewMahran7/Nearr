/**
 * Google Places service for Nearr.
 *
 * - All HTTP and shape-mapping is isolated here so we can swap in a
 *   server-side Edge Function later without touching screens.
 * - Returns normalized `PlaceCandidate` objects (camelCase, our shape)
 *   instead of raw Google responses.
 * - Throws `PlacesError` with a stable `code` so the UI can branch
 *   (e.g. show "no results" vs "quota exceeded").
 */

import Constants from 'expo-constants';

import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import { searchDemoPlaces, getDemoPlaceDetails } from '@/services/demo';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlaceCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  googleMapsUrl: string | null;
};

export type LocationBias = { lat: number; lng: number };

export type PlacesErrorCode =
  | 'MISSING_API_KEY'
  | 'NETWORK'
  | 'INVALID_REQUEST'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export class PlacesError extends Error {
  code: PlacesErrorCode;
  constructor(code: PlacesErrorCode, message: string) {
    super(message);
    this.name = 'PlacesError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

/**
 * Resolve the API key. Order of precedence:
 *   1. EXPO_PUBLIC_GOOGLE_MAPS_API_KEY  (preferred new name)
 *   2. EXPO_PUBLIC_GOOGLE_PLACES_KEY    (legacy)
 *   3. app.json `extra.googlePlacesKey` (legacy)
 *
 * Note: the Maps SDK keys (`GOOGLE_MAPS_IOS_KEY` / `GOOGLE_MAPS_ANDROID_KEY`)
 * live in `app.json` `ios.config` / `android.config` and are *not* read here.
 */
function resolveApiKey(): string {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
    process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY ??
    extra.googlePlacesKey ??
    ''
  );
}

const BASE = 'https://maps.googleapis.com/maps/api/place';

// Fields requested in `details`. Cost-aware (Place Details is billed by field).
const DETAILS_FIELDS = [
  'place_id',
  'name',
  'formatted_address',
  'geometry/location',
  'types',
  'url',
].join(',');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Free-text search. Returns up to 8 normalized candidates.
 * `locationBias` (lat/lng) nudges results toward the user's area.
 */
export async function searchPlaces(
  query: string,
  locationBias?: LocationBias,
): Promise<PlaceCandidate[]> {
  if (isDemoMode()) return await searchDemoPlaces(query, locationBias);
  if (isMapPreviewMode()) return await searchDemoPlaces(query, locationBias);
  const trimmed = query.trim();
  if (!trimmed) return [];

  const key = resolveApiKey();
  if (!key) throw new PlacesError('MISSING_API_KEY', 'Google Maps API key not configured.');

  const params = new URLSearchParams({ query: trimmed, key });
  if (locationBias) {
    params.set('location', `${locationBias.lat},${locationBias.lng}`);
    params.set('radius', '50000'); // 50 km bias
  }

  const url = `${BASE}/textsearch/json?${params.toString()}`;
  console.log('[placesService] textsearch', { q: trimmed, biased: !!locationBias });

  const json = await safeFetch(url);
  assertOk(json, true /* allow ZERO_RESULTS */);

  return (json.results ?? []).slice(0, 8).map(toCandidateFromTextSearch);
}

/** Get full details for one place. Throws PlacesError('NOT_FOUND') if missing. */
export async function getPlaceDetails(placeId: string): Promise<PlaceCandidate> {
  if (isDemoMode()) return await getDemoPlaceDetails(placeId);
  if (isMapPreviewMode()) return await getDemoPlaceDetails(placeId);
  if (!placeId) throw new PlacesError('INVALID_REQUEST', 'placeId is required');

  const key = resolveApiKey();
  if (!key) throw new PlacesError('MISSING_API_KEY', 'Google Maps API key not configured.');

  const params = new URLSearchParams({
    place_id: placeId,
    key,
    fields: DETAILS_FIELDS,
  });
  const url = `${BASE}/details/json?${params.toString()}`;
  console.log('[placesService] details', placeId);

  const json = await safeFetch(url);
  if (json.status === 'NOT_FOUND' || !json.result) {
    throw new PlacesError('NOT_FOUND', 'Place not found.');
  }
  assertOk(json, false);

  return toCandidateFromDetails(json.result);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function safeFetch(url: string): Promise<any> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new PlacesError('NETWORK', `Places HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof PlacesError) throw err;
    console.warn('[placesService] fetch failed', err);
    throw new PlacesError('NETWORK', 'Could not reach Google Places.');
  }
}

function assertOk(json: any, allowZeroResults: boolean) {
  const status: string = json?.status ?? 'UNKNOWN';
  if (status === 'OK') return;
  if (allowZeroResults && status === 'ZERO_RESULTS') return;

  const map: Record<string, PlacesErrorCode> = {
    INVALID_REQUEST: 'INVALID_REQUEST',
    OVER_QUERY_LIMIT: 'OVER_QUERY_LIMIT',
    REQUEST_DENIED: 'REQUEST_DENIED',
    NOT_FOUND: 'NOT_FOUND',
  };
  const code = map[status] ?? 'UNKNOWN';
  throw new PlacesError(code, `${status}${json.error_message ? `: ${json.error_message}` : ''}`);
}

function toCandidateFromTextSearch(r: any): PlaceCandidate {
  return {
    googlePlaceId: r.place_id,
    name: r.name,
    formattedAddress: r.formatted_address ?? null,
    latitude: r.geometry?.location?.lat,
    longitude: r.geometry?.location?.lng,
    category: pickCategory(r.types),
    googleMapsUrl: r.place_id ? `https://www.google.com/maps/place/?q=place_id:${r.place_id}` : null,
  };
}

function toCandidateFromDetails(r: any): PlaceCandidate {
  return {
    googlePlaceId: r.place_id,
    name: r.name,
    formattedAddress: r.formatted_address ?? null,
    latitude: r.geometry?.location?.lat,
    longitude: r.geometry?.location?.lng,
    category: pickCategory(r.types),
    googleMapsUrl: r.url ?? (r.place_id ? `https://www.google.com/maps/place/?q=place_id:${r.place_id}` : null),
  };
}

/** Pick the most useful "human" category from Google's `types` array. */
function pickCategory(types?: string[]): string | null {
  if (!types?.length) return null;
  const skip = new Set(['point_of_interest', 'establishment', 'food']);
  const first = types.find((t) => !skip.has(t)) ?? types[0];
  return first ? first.replace(/_/g, ' ') : null;
}
