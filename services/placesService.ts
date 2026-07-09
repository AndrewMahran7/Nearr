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
  /**
   * Raw Google Places `types` array (e.g. ['restaurant', 'food', 'establishment']
   * or ['street_address']). Optional because demo / legacy code paths may
   * not populate it. Used by `isAddressLikePlace` to detect when Google
   * returned a geocoded address instead of the actual business so the
   * share flow can resolve to a nearby establishment.
   */
  rawTypes?: string[];
};

export type PlaceRichDetails = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  googleMapsUrl: string | null;
  websiteUrl: string | null;
  formattedPhoneNumber: string | null;
  internationalPhoneNumber: string | null;
  photoUrls: string[];
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
const LATIN_LETTER_CLASS = 'A-Za-z\\u00C0-\\u024F\\u1E00-\\u1EFF';
const LATIN_NAME_CHAR_CLASS = `${LATIN_LETTER_CLASS}.'\\u2019-`;
const CAPITALIZED_WORD_RE = `[A-Z][${LATIN_NAME_CHAR_CLASS}]+`;
const LOCATION_PIN_RE = /[📍📌]/;
const HASHTAG_RE = /#[^\s#@]+/g;
const CITY_STATE_CONTEXT_RE = new RegExp(
  `\\b(${CAPITALIZED_WORD_RE}(?:\\s+${CAPITALIZED_WORD_RE}){0,3}),\\s*([A-Z]{2})\\b`,
);
const TRAILING_CONTEXT_RE = new RegExp(
  `,\\s*(${CAPITALIZED_WORD_RE}(?:[\\s,]+${CAPITALIZED_WORD_RE}){0,4})\\s*[.!?]?\\s*$`,
);

// Fields requested in `details`. Cost-aware (Place Details is billed by field).
const DETAILS_FIELDS = [
  'place_id',
  'name',
  'formatted_address',
  'geometry/location',
  'types',
  'url',
].join(',');

const RICH_DETAILS_FIELDS = [
  'place_id',
  'name',
  'formatted_address',
  'geometry/location',
  'types',
  'url',
  'website',
  'formatted_phone_number',
  'international_phone_number',
  'photos',
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

/**
 * Enriched details for optional map-sheet UI extras (photos / call / website).
 * This is intentionally separate from `getPlaceDetails` so existing flows keep
 * their current field footprint and behavior.
 */
export async function getPlaceRichDetails(
  placeId: string,
  options?: { maxPhotos?: number; maxPhotoWidth?: number },
): Promise<PlaceRichDetails> {
  if (isDemoMode() || isMapPreviewMode()) {
    const demo = await getDemoPlaceDetails(placeId);
    return {
      googlePlaceId: demo.googlePlaceId,
      name: demo.name,
      formattedAddress: demo.formattedAddress,
      latitude: demo.latitude,
      longitude: demo.longitude,
      category: demo.category,
      googleMapsUrl: demo.googleMapsUrl,
      websiteUrl: null,
      formattedPhoneNumber: null,
      internationalPhoneNumber: null,
      photoUrls: [],
    };
  }
  if (!placeId) throw new PlacesError('INVALID_REQUEST', 'placeId is required');

  const key = resolveApiKey();
  if (!key) throw new PlacesError('MISSING_API_KEY', 'Google Maps API key not configured.');

  const params = new URLSearchParams({
    place_id: placeId,
    key,
    fields: RICH_DETAILS_FIELDS,
  });
  const url = `${BASE}/details/json?${params.toString()}`;
  console.log('[placesService] rich-details', placeId);

  const json = await safeFetch(url);
  if (json.status === 'NOT_FOUND' || !json.result) {
    throw new PlacesError('NOT_FOUND', 'Place not found.');
  }
  assertOk(json, false);

  const result = json.result;
  const maxPhotos = Math.max(1, Math.min(options?.maxPhotos ?? 5, 5));
  const maxPhotoWidth = Math.max(240, Math.min(options?.maxPhotoWidth ?? 1200, 1200));
  const photoUrls = Array.isArray(result.photos)
    ? result.photos
        .map((p: any) => {
          const photoRef =
            typeof p?.photo_reference === 'string' && p.photo_reference.trim()
              ? p.photo_reference.trim()
              : null;
          if (!photoRef) return null;
          return buildPlacePhotoUrl(photoRef, key, maxPhotoWidth);
        })
        .filter((v: string | null): v is string => !!v)
        .slice(0, maxPhotos)
    : [];

  return {
    googlePlaceId: result.place_id,
    name: result.name,
    formattedAddress: result.formatted_address ?? null,
    latitude: result.geometry?.location?.lat,
    longitude: result.geometry?.location?.lng,
    category: pickCategory(result.types),
    googleMapsUrl: typeof result.url === 'string' && result.url.length > 0 ? result.url : null,
    websiteUrl:
      typeof result.website === 'string' && result.website.trim()
        ? result.website.trim()
        : null,
    formattedPhoneNumber:
      typeof result.formatted_phone_number === 'string' && result.formatted_phone_number.trim()
        ? result.formatted_phone_number.trim()
        : null,
    internationalPhoneNumber:
      typeof result.international_phone_number === 'string' && result.international_phone_number.trim()
        ? result.international_phone_number.trim()
        : null,
    photoUrls,
  };
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

// NOTE on `googleMapsUrl`:
//   The Google Places `details` endpoint returns a real, openable canonical
//   URL on the `url` field (e.g. https://maps.google.com/?cid=...). textsearch
//   does NOT. We deliberately leave `googleMapsUrl` null for textsearch
//   results rather than synthesising the legacy
//   `https://www.google.com/maps/place/?q=place_id:<ID>` form, which Google
//   Maps treats as free-text and reports as "No results found." The runtime
//   helper in lib/externalMaps.ts always falls back to a lat/lng URL with
//   `query_place_id`, which is the format Google actually documents.
function toCandidateFromTextSearch(r: any): PlaceCandidate {
  return {
    googlePlaceId: r.place_id,
    name: r.name,
    formattedAddress: r.formatted_address ?? null,
    latitude: r.geometry?.location?.lat,
    longitude: r.geometry?.location?.lng,
    category: pickCategory(r.types),
    googleMapsUrl: null,
    rawTypes: Array.isArray(r.types) ? r.types : undefined,
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
    // `r.url` is Google's official canonical maps URL for the place. Only
    // use it when present; never synthesise the broken `place_id:` form.
    googleMapsUrl: typeof r.url === 'string' && r.url.length > 0 ? r.url : null,
    rawTypes: Array.isArray(r.types) ? r.types : undefined,
  };
}

/** Pick the most useful "human" category from Google's `types` array. */
function pickCategory(types?: string[]): string | null {
  if (!types?.length) return null;
  const skip = new Set(['point_of_interest', 'establishment', 'food']);
  const first = types.find((t) => !skip.has(t)) ?? types[0];
  return first ? first.replace(/_/g, ' ') : null;
}

function buildPlacePhotoUrl(photoReference: string, apiKey: string, maxWidth: number): string {
  const params = new URLSearchParams({
    maxwidth: String(maxWidth),
    photo_reference: photoReference,
    key: apiKey,
  });
  return `${BASE}/photo?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Address-vs-business detection + nearby business resolution
// ---------------------------------------------------------------------------

/**
 * Google Place `types` that mean "this is a geocoded address / region",
 * NOT an actual business. When the top textsearch hit has only these
 * types we should NOT save it as the "place name" -- the user expects to
 * see a business name on their map, not "355 S Atlantic Blvd".
 */
const ADDRESS_LIKE_TYPES = new Set<string>([
  'street_address',
  'premise',
  'subpremise',
  'route',
  'intersection',
  'postal_code',
  'postal_code_prefix',
  'postal_code_suffix',
  'locality',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'neighborhood',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'country',
  'plus_code',
  'geocode',
]);

const BUSINESS_LIKE_TYPES = new Set<string>([
  'restaurant', 'cafe', 'bar', 'bakery', 'food', 'meal_takeaway',
  'meal_delivery', 'store', 'shopping_mall', 'clothing_store', 'book_store',
  'grocery_or_supermarket', 'supermarket', 'convenience_store', 'shoe_store',
  'jewelry_store', 'florist', 'department_store', 'electronics_store',
  'gym', 'spa', 'beauty_salon', 'hair_care', 'lodging', 'museum',
  'art_gallery', 'movie_theater', 'night_club', 'tourist_attraction',
  'amusement_park', 'park', 'stadium', 'liquor_store', 'pharmacy',
  'pet_store', 'hardware_store', 'home_goods_store',
]);

// Heuristic: "<digits> <word(s)>" or contains street suffixes -- looks like
// a postal address printed as a name.
const ADDRESS_NAME_RE =
  /^\s*\d{1,6}\s+\S+/i;
const STREET_SUFFIX_RE =
  /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|ter|terrace|pl|place)\b\.?/i;

/**
 * True if this candidate looks like a raw geocoded address rather than an
 * actual business / point of interest. Conservative: when in doubt, return
 * false so we don't second-guess a real business named "100 Wines" etc.
 */
export function isAddressLikePlace(candidate: PlaceCandidate): boolean {
  const types = candidate.rawTypes ?? [];
  if (types.length > 0) {
    const hasBusiness = types.some((t) => BUSINESS_LIKE_TYPES.has(t));
    if (hasBusiness) return false;
    const hasEstablishment = types.includes('establishment') || types.includes('point_of_interest');
    const allAddress = types.every((t) => ADDRESS_LIKE_TYPES.has(t));
    if (allAddress) return true;
    // 'establishment' alone with otherwise address-y types -> still address.
    if (!hasEstablishment && types.some((t) => ADDRESS_LIKE_TYPES.has(t))) return true;
  }

  // No types available (e.g. demo path): fall back to name shape.
  const name = (candidate.name ?? '').trim();
  if (!name) return false;
  // Name == address (or starts with a street number AND mentions a suffix).
  if (
    candidate.formattedAddress &&
    name.toLowerCase() === candidate.formattedAddress.toLowerCase()
  ) {
    return true;
  }
  if (ADDRESS_NAME_RE.test(name) && STREET_SUFFIX_RE.test(name)) return true;
  return false;
}

/**
 * Subset of address-like types that specifically mean "this is a region"
 * (neighborhood / city / state / country) rather than a street address.
 * Used by the share flow to reject silently saving \"Highland Park\" when
 * the original query referenced a real business.
 */
const LOCALITY_LIKE_TYPES = new Set<string>([
  'locality',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'neighborhood',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'country',
  'political',
  'postal_code',
  'postal_code_prefix',
  'postal_code_suffix',
  'plus_code',
]);

/**
 * True if this candidate is a region (neighborhood / city / state /
 * postal code), not a business or street address. The share flow uses
 * this to refuse auto-saving a neighborhood when the user/AI query
 * clearly named a business.
 */
export function isLocalityLikePlace(candidate: PlaceCandidate): boolean {
  const types = candidate.rawTypes ?? [];
  if (types.length === 0) return false;
  const hasBusiness = types.some((t) => BUSINESS_LIKE_TYPES.has(t));
  if (hasBusiness) return false;
  return types.some((t) => LOCALITY_LIKE_TYPES.has(t));
}

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

const STOP_TOKENS = new Set([
  'the', 'and', 'for', 'restaurant', 'cafe', 'bar', 'food', 'place',
  'street', 'avenue', 'road', 'blvd', 'boulevard', 'drive', 'lane', 'way',
  'east', 'west', 'north', 'south', 'los', 'angeles', 'new', 'york',
]);

function nameOverlapScore(candidateName: string, query: string): number {
  const c = new Set(tokenize(candidateName).filter((t) => !STOP_TOKENS.has(t)));
  const q = tokenize(query).filter((t) => !STOP_TOKENS.has(t));
  if (c.size === 0 || q.length === 0) return 0;
  let hits = 0;
  for (const t of q) if (c.has(t)) hits++;
  return hits;
}

/**
 * Given an address-like candidate (from a previous textsearch) and the
 * original query the user/AI provided, try to find the actual business at
 * that address by issuing another textsearch *biased to the address's
 * lat/lng* with a tight radius. Picks the best establishment by name
 * overlap with the original query, falling back to the nearest
 * establishment.
 *
 * Returns the resolved business candidate, or `null` if nothing better than
 * the address itself was found. Never throws -- callers can safely ignore
 * the result and keep the address candidate.
 */
export async function resolveBusinessNearAddress(
  addressCandidate: PlaceCandidate,
  originalQuery: string,
): Promise<PlaceCandidate | null> {
  if (isDemoMode() || isMapPreviewMode()) return null;
  const lat = addressCandidate.latitude;
  const lng = addressCandidate.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = resolveApiKey();
  if (!key) return null;

  // Strategy: re-issue the user/AI query as a textsearch but BIASED to the
  // address's lat/lng with a tight 200m radius. This reuses the same API
  // surface (no new endpoint, no extra billing tier) and gives Google the
  // best chance to surface the actual business at that address.
  const params = new URLSearchParams({
    query: originalQuery.trim() || addressCandidate.formattedAddress || addressCandidate.name,
    location: `${lat},${lng}`,
    radius: '200',
    key,
  });
  const url = `${BASE}/textsearch/json?${params.toString()}`;
  if (__DEV__) {
    console.debug('[places] resolving address -> nearby business', {
      from: addressCandidate.name,
      query: originalQuery,
      lat,
      lng,
    });
  }

  let json: any;
  try {
    json = await safeFetch(url);
  } catch (err) {
    console.warn('[places] resolveBusinessNearAddress fetch failed', err);
    return null;
  }
  const status: string = json?.status ?? 'UNKNOWN';
  if (status !== 'OK' && status !== 'ZERO_RESULTS') {
    console.warn('[places] resolveBusinessNearAddress non-OK', status);
    return null;
  }

  const raw: any[] = Array.isArray(json.results) ? json.results : [];
  const candidates = raw.map(toCandidateFromTextSearch);

  // Filter to actual businesses near the address coordinate. We require:
  //   - not address-like itself
  //   - within ~250m of the address (textsearch sometimes ignores radius)
  const nearby = candidates.filter((c) => {
    if (isAddressLikePlace(c)) return false;
    if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return false;
    return haversineMeters(lat, lng, c.latitude, c.longitude) <= 250;
  });

  if (nearby.length === 0) {
    if (__DEV__) console.debug('[places] no nearby businesses found');
    return null;
  }

  // Score: prefer name overlap with originalQuery, break ties by proximity.
  const scored = nearby.map((c) => ({
    candidate: c,
    score: nameOverlapScore(c.name, originalQuery),
    distance: haversineMeters(lat, lng, c.latitude, c.longitude),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.distance - b.distance;
  });

  const best = scored[0];
  // Confidence floor: if no name overlap AND the closest business is more
  // than 75m away, prefer to show candidates rather than auto-pick.
  if (best.score === 0 && best.distance > 75) {
    if (__DEV__) {
      console.debug('[places] best nearby business too uncertain', {
        name: best.candidate.name,
        distance: best.distance,
      });
    }
    return null;
  }

  if (__DEV__) {
    console.debug('[places] resolved address to business', {
      from: addressCandidate.name,
      to: best.candidate.name,
      score: best.score,
      distance: Math.round(best.distance),
    });
  }
  return best.candidate;
}

/** Great-circle distance in meters. */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---------------------------------------------------------------------------
// Franchise / multi-location detection + ranking
// ---------------------------------------------------------------------------

/**
 * Known chain / franchise names. Lower-cased, normalized (no apostrophes /
 * punctuation). We don't try to be exhaustive -- this list is a fast
 * positive signal; the `multiple-similar-results` check below catches
 * franchises we don't know about.
 *
 * Add cautiously: only well-known multi-location brands. Independent
 * restaurants with one location should NOT go here.
 */
const KNOWN_CHAIN_NAMES: string[] = [
  'starbucks', 'mcdonalds', 'in n out', 'in n out burger', 'chipotle',
  'taco bell', 'subway', 'kfc', 'wendys', 'burger king', 'shake shack',
  'five guys', 'chick fil a', 'panera', 'panera bread', 'dominos',
  'pizza hut', 'papa johns', 'trader joes', 'whole foods', 'cvs',
  'walgreens', 'rite aid', 'salt and straw', 'sidecar doughnuts',
  'dunkin', 'jamba juice', 'jamba', 'panda express', 'sweetgreen', 'cava',
  'blue bottle', 'blue bottle coffee', 'philz', 'philz coffee',
  'peets coffee', 'crumbl', 'crumbl cookies', 'jollibee', 'el pollo loco',
  'jersey mikes', 'noahs bagels', 'einstein bagels', 'baskin robbins',
  'cold stone', 'coldstone', 'pinkberry', 'menchies', 'tatte', 'levain',
  'levain bakery', 'porto s', 'portos', 'din tai fung', 'pieology',
  'mendocino farms', 'tender greens', 'erewhon',
];

function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Heuristic: does this query + result set look like a franchise / chain
 * lookup? True if any of:
 *   - the normalized query matches a known chain name
 *   - 2+ candidates share the same normalized name
 *   - 2+ candidates share the same first-two-tokens AND have different
 *     city/address strings (e.g. "Villa's Tacos" with a Highland Park
 *     branch and a Grand Central Market branch)
 *
 * Conservative: a single result is never multi-location.
 */
export function isLikelyMultiLocationPlace(
  query: string,
  candidates: PlaceCandidate[],
): boolean {
  const q = normalizeName(query);
  if (q) {
    for (const chain of KNOWN_CHAIN_NAMES) {
      // word-boundary-ish match so "starbucks" matches "starbucks reserve"
      // but "barstool" does not match "bar".
      if (q === chain || q.startsWith(chain + ' ') || q.includes(' ' + chain + ' ') || q.endsWith(' ' + chain)) {
        return true;
      }
    }
  }
  if (candidates.length < 2) return false;

  const exact = new Map<string, number>();
  for (const c of candidates) {
    const k = normalizeName(c.name);
    if (!k) continue;
    exact.set(k, (exact.get(k) ?? 0) + 1);
  }
  for (const v of exact.values()) {
    if (v >= 2) return true;
  }

  // Same first-2-token name across different addresses.
  const byPrefix = new Map<string, Set<string>>();
  for (const c of candidates) {
    const tokens = normalizeName(c.name).split(' ').filter(Boolean);
    if (tokens.length === 0) continue;
    const prefix = tokens.slice(0, 2).join(' ');
    if (!prefix) continue;
    const addr = normalizeName(c.formattedAddress ?? '');
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
    byPrefix.get(prefix)!.add(addr);
  }
  for (const addrs of byPrefix.values()) {
    if (addrs.size >= 2) return true;
  }

  return false;
}

export type RankContext = {
  /** The business name we believe the user wants (e.g. "Starbucks"). */
  extractedBusinessName?: string;
  /** Lat/lng derived from caption text (e.g. "Highland Park"). */
  contextLatLng?: LocationBias;
  /** Free-text location context (e.g. "Highland Park, Los Angeles"). */
  contextText?: string;
  /** User device location (used only when no contextLatLng is available). */
  userLatLng?: LocationBias;
};

export type ShareCandidateRejectionReason =
  | 'far_from_source_context'
  | 'name_mismatch';

/**
 * Sort candidates best-first using a small additive scoring model. Higher
 * score = better match. Pure function -- no API calls, no side effects.
 *
 * Priority (descending):
 *   1. Penalize locality / address-only results heavily. We almost never
 *      want a neighborhood saved as the "place" when the query named a
 *      business.
 *   2. Reward business-typed results.
 *   3. Reward name overlap with `extractedBusinessName`.
 *   4. Penalize distance to `contextLatLng` (preferred) or `userLatLng`
 *      (fallback). 1 point per km, capped at 50.
 */
export function rankPlaceCandidates(
  candidates: PlaceCandidate[],
  ctx: RankContext,
): PlaceCandidate[] {
  const target: LocationBias | null =
    ctx.contextLatLng ?? ctx.userLatLng ?? null;
  const businessName = ctx.extractedBusinessName?.trim() ?? '';

  function score(c: PlaceCandidate): number {
    let s = 0;
    if (isLocalityLikePlace(c)) s -= 100;
    else if (isAddressLikePlace(c)) s -= 40;
    const types = c.rawTypes ?? [];
    if (types.some((t) => BUSINESS_LIKE_TYPES.has(t))) s += 25;

    if (businessName) {
      s += nameOverlapScore(c.name, businessName) * 12;
      if (hasMeaningfulNameMatch(c, businessName)) s += 18;
    }

    if (
      target &&
      Number.isFinite(c.latitude) &&
      Number.isFinite(c.longitude)
    ) {
      const km =
        haversineMeters(target.lat, target.lng, c.latitude, c.longitude) /
        1000;
      if (ctx.contextLatLng) {
        // Source context should dominate: very far results become strongly
        // disfavored even if Google surfaced them due to a device-biased query.
        if (km > 250) s -= 220;
        else if (km > 100) s -= 120;
        else if (km > 40) s -= 60;
        else s -= Math.min(30, km * 0.75);
      } else {
        // Device proximity is only a fallback nudge.
        s -= Math.min(20, km * 0.35);
      }
    }

    return s;
  }

  return [...candidates]
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s)
    .map(({ c }) => c);
}

/**
 * Pull a likely "location context" string out of share metadata: the
 * neighborhood / city / address hint that should bias the search but is
 * NOT the venue name itself.
 *
 * Sources, in priority order:
 *   1. Text immediately after a 📍 pin emoji.
 *   2. Trailing ", City, ST" pattern.
 *   3. Substrings recognized as known neighborhood / city names.
 *
 * Returns null when nothing useful is found. Caller can pass the raw
 * concatenated title + description as `text`.
 */
export function extractLocationContext(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleanedText = text.replace(/\s+/g, ' ').trim();

  const pinIdx = text.search(LOCATION_PIN_RE);
  if (pinIdx >= 0) {
    const tail = text.slice(pinIdx + 2, pinIdx + 200).split(/[\n\r]/)[0];
    const cleaned = tail
      .replace(HASHTAG_RE, ' ')
      .replace(/["\u201C\u201D'`]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Stop at "also" / "and" / "or" / "+" — pin text often runs on
    // ("📍 Highland Park, Los Angeles, CA also a location in Grand Central").
    const stopMatch = cleaned.split(/\b(?:also|and|or|plus)\b|[+|]/i)[0].trim();
    if (stopMatch && stopMatch.length >= 3 && stopMatch.length <= 80) {
      return normalizeLocationContext(stopMatch);
    }
  }

  const addressMatch = cleanedText.match(
    /\b\d{1,5}\s+[A-Za-z0-9.'\- ]{2,60}\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|ct|court|pl|place)\b[^\n,;]*?(?:,\s*[A-Za-z.'\- ]+)?(?:,\s*[A-Z]{2})?/i,
  );
  if (addressMatch?.[0]) return normalizeLocationContext(addressMatch[0]);

  const cityState = cleanedText.match(CITY_STATE_CONTEXT_RE);
  if (cityState?.[0]) return normalizeLocationContext(cityState[0]);

  const trailing = text.match(TRAILING_CONTEXT_RE);
  if (trailing && trailing[1]) return normalizeLocationContext(trailing[1]);

  for (const alias of LOCATION_CONTEXT_ALIASES) {
    if (alias.pattern.test(cleanedText)) {
      return alias.value;
    }
  }

  return null;
}

export function hasMeaningfulNameMatch(
  candidate: PlaceCandidate,
  extractedBusinessName: string | null | undefined,
): boolean {
  if (!extractedBusinessName) return true;

  const normalizedCandidate = normalizeName(candidate.name);
  const normalizedQuery = normalizeName(extractedBusinessName);
  if (!normalizedCandidate || !normalizedQuery) return true;

  if (
    normalizedCandidate === normalizedQuery ||
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  ) {
    return true;
  }

  const overlap = nameOverlapScore(candidate.name, extractedBusinessName);
  const queryTokens = tokenize(extractedBusinessName).filter((t) => !STOP_TOKENS.has(t));
  if (queryTokens.length <= 2) return overlap >= 1;
  return overlap >= 2;
}

export function hasStrongNameMatch(
  candidate: PlaceCandidate,
  extractedBusinessName: string | null | undefined,
): boolean {
  if (!extractedBusinessName) return false;

  const normalizedCandidate = normalizeName(candidate.name);
  const normalizedQuery = normalizeName(extractedBusinessName);
  if (!normalizedCandidate || !normalizedQuery) return false;

  if (
    normalizedCandidate === normalizedQuery ||
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  ) {
    return true;
  }

  const overlap = nameOverlapScore(candidate.name, extractedBusinessName);
  const queryTokens = tokenize(extractedBusinessName).filter((t) => !STOP_TOKENS.has(t));
  if (queryTokens.length <= 2) return overlap >= 2;
  return overlap >= Math.min(3, queryTokens.length);
}

export function getShareCandidateRejectionReason(
  candidate: PlaceCandidate,
  ctx: RankContext,
): ShareCandidateRejectionReason | null {
  const businessName = ctx.extractedBusinessName?.trim() ?? '';
  if (businessName && !hasMeaningfulNameMatch(candidate, businessName)) {
    return 'name_mismatch';
  }

  if (
    ctx.contextLatLng &&
    Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude)
  ) {
    const km =
      haversineMeters(
        ctx.contextLatLng.lat,
        ctx.contextLatLng.lng,
        candidate.latitude,
        candidate.longitude,
      ) / 1000;
    const overlap = businessName ? nameOverlapScore(candidate.name, businessName) : 0;
    if (km > 250 && overlap < 2) {
      return 'far_from_source_context';
    }
  }

  return null;
}

const LOCATION_CONTEXT_ALIASES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\bNYC\b/i, value: 'New York, NY' },
  { pattern: /\bNY\b/i, value: 'New York, NY' },
  { pattern: /\bNew York\b/i, value: 'New York, NY' },
  { pattern: /\bBrooklyn\b/i, value: 'Brooklyn, NY' },
  { pattern: /\bManhattan\b/i, value: 'Manhattan, NY' },
  { pattern: /\bLos Angeles\b/i, value: 'Los Angeles, CA' },
  { pattern: /\bLA\b/i, value: 'Los Angeles, CA' },
  { pattern: /\bOrange County\b/i, value: 'Orange County, CA' },
  { pattern: /\bOC\b/i, value: 'Orange County, CA' },
  { pattern: /\bSanta Cruz\b/i, value: 'Santa Cruz, CA' },
];

function normalizeLocationContext(value: string): string {
  const trimmed = value.replace(/[.!?]+$/g, '').trim();
  for (const alias of LOCATION_CONTEXT_ALIASES) {
    if (alias.pattern.test(trimmed)) return alias.value;
  }
  return trimmed;
}

/**
 * Geocode a free-text location like "Highland Park, Los Angeles" to a
 * single lat/lng using the existing Places textsearch endpoint. Returns
 * null when the API key is missing, the call fails, or no usable
 * locality result comes back. Never throws.
 */
export async function geocodeContextText(
  contextText: string,
): Promise<LocationBias | null> {
  const trimmed = contextText.trim();
  if (!trimmed) return null;
  if (isDemoMode() || isMapPreviewMode()) return null;
  const key = resolveApiKey();
  if (!key) return null;
  const params = new URLSearchParams({ query: trimmed, key });
  const url = `${BASE}/textsearch/json?${params.toString()}`;
  let json: any;
  try {
    json = await safeFetch(url);
  } catch (err) {
    if (__DEV__) console.debug('[places] geocodeContextText failed', err);
    return null;
  }
  const status: string = json?.status ?? 'UNKNOWN';
  if (status !== 'OK' && status !== 'ZERO_RESULTS') return null;
  const raw: any[] = Array.isArray(json.results) ? json.results : [];
  if (raw.length === 0) return null;
  // Prefer the first locality / political / geocode result; otherwise
  // fall back to the first hit (any place center is good enough as bias).
  const first =
    raw.find((r) => {
      const t: string[] = Array.isArray(r.types) ? r.types : [];
      return t.some((x) =>
        ['locality', 'sublocality', 'neighborhood', 'political', 'administrative_area_level_1', 'administrative_area_level_2'].includes(x),
      );
    }) ?? raw[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// ---------------------------------------------------------------------------
// Address-first geocoding + verification
//
// Why this exists:
//   `geocodeContextText` above resolves free-text city/neighborhood hints
//   to a *city-scale* lat/lng (it intentionally prefers locality results).
//   That bias is fine for franchise ranking, but it is NOT a substitute
//   for a real rooftop geocode when the share contains a literal street
//   address. Without a rooftop coordinate we can't guarantee the candidate
//   we're about to silently save actually sits at that address — Google's
//   text search routinely returns a wrong business near the city center.
//
//   `geocodeAddress` hits the dedicated Geocoding API (no locality bias),
//   and `verifyPlaceAtAddress` uses the resulting coordinate to constrain
//   the Places search and enforce a hard distance + name-match gate before
//   anyone is allowed to silent-save.
//
// Requires the Geocoding API to be enabled on the same key
// (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) used elsewhere in this file.
// ---------------------------------------------------------------------------

/** Maximum distance (meters) a Places candidate may sit from the geocoded
 *  address point and still be treated as "the place at this address". */
const ADDRESS_VERIFY_RADIUS_M = 150;

const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';
const GEOCODE_TIMEOUT_MS = 4_000;

export type GeocodedAddress = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  placeId?: string;
  /** Google's `geometry.location_type`: ROOFTOP | RANGE_INTERPOLATED |
   *  GEOMETRIC_CENTER | APPROXIMATE. ROOFTOP / RANGE_INTERPOLATED are the
   *  only ones we trust as a true address coordinate. */
  locationType?: string;
};

/**
 * Geocode a free-text street address to lat/lng using the Google Geocoding
 * API. Never throws — returns null on missing key, network/HTTP failure,
 * non-OK status, or no usable result. Hard timeout via AbortController so
 * the share flow can never stall on a slow geocode.
 */
export async function geocodeAddress(
  address: string,
): Promise<GeocodedAddress | null> {
  const trimmed = (address ?? '').trim();
  if (!trimmed) return null;
  if (isDemoMode() || isMapPreviewMode()) return null;
  const key = resolveApiKey();
  if (!key) return null;

  const params = new URLSearchParams({ address: trimmed, key });
  const url = `${GEOCODE_BASE}?${params.toString()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEOCODE_TIMEOUT_MS);
  let json: any;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    json = await res.json();
  } catch (err) {
    if (__DEV__) console.debug('[share-geocode] fetch failed', (err as Error)?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }

  const status: string = json?.status ?? 'UNKNOWN';
  if (status !== 'OK') return null;
  const raw: any[] = Array.isArray(json.results) ? json.results : [];
  if (raw.length === 0) return null;
  const first = raw[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
    formattedAddress: typeof first.formatted_address === 'string' ? first.formatted_address : trimmed,
    placeId: typeof first.place_id === 'string' ? first.place_id : undefined,
    locationType:
      typeof first.geometry?.location_type === 'string'
        ? first.geometry.location_type
        : undefined,
  };
}

export type AddressVerification =
  | {
      status: 'verified';
      candidate: PlaceCandidate;
      geocoded: GeocodedAddress;
      distanceMeters: number;
    }
  | {
      status: 'ambiguous';
      candidates: PlaceCandidate[];
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
 * Address-first verification gate. Geocodes the address, runs a Places
 * text search biased to that exact point with a tight radius, filters to
 * real businesses within ADDRESS_VERIFY_RADIUS_M of the geocoded point,
 * and (when a place name was provided) enforces a strong name match
 * before declaring a single candidate "verified".
 *
 * Decision matrix:
 *   - Exactly one strong-name-match business within the radius → verified
 *   - >1 strong-name candidates OR no name provided + >=1 nearby business
 *     → ambiguous (caller should show the picker)
 *   - Geocode failed                                          → failed (geocode_failed)
 *   - Geocode ok, but no business within radius               → failed (no_business_near_address)
 *   - Place name provided but no candidate matches it nearby  → failed (name_mismatch)
 *
 * Never throws. Caller is responsible for honoring the result — most
 * importantly, "failed" must NOT silently save a random nearby place.
 */
export async function verifyPlaceAtAddress(
  address: string,
  optionalPlaceName: string | null,
): Promise<AddressVerification> {
  const geocoded = await geocodeAddress(address);
  if (!geocoded) {
    return { status: 'failed', reason: 'geocode_failed', geocoded: null };
  }

  if (isDemoMode() || isMapPreviewMode()) {
    // No live Places lookup in demo/preview — degrade safely.
    return { status: 'failed', reason: 'no_business_near_address', geocoded };
  }

  const key = resolveApiKey();
  if (!key) {
    return { status: 'failed', reason: 'no_business_near_address', geocoded };
  }

  // Bias to the geocoded point with a tight 200 m radius. Reuses the same
  // textsearch endpoint the rest of this file uses (no new billing tier).
  const query = (optionalPlaceName?.trim() || geocoded.formattedAddress || address).trim();
  const params = new URLSearchParams({
    query,
    location: `${geocoded.latitude},${geocoded.longitude}`,
    radius: '200',
    key,
  });
  const url = `${BASE}/textsearch/json?${params.toString()}`;

  let json: any;
  try {
    json = await safeFetch(url);
  } catch (err) {
    if (__DEV__) console.debug('[share-geocode] verify fetch failed', err);
    return { status: 'failed', reason: 'no_business_near_address', geocoded };
  }
  const status: string = json?.status ?? 'UNKNOWN';
  if (status !== 'OK' && status !== 'ZERO_RESULTS') {
    return { status: 'failed', reason: 'no_business_near_address', geocoded };
  }
  const raw: any[] = Array.isArray(json.results) ? json.results : [];
  const all = raw.map(toCandidateFromTextSearch);

  // Keep only real businesses within the strict radius. Reject address-
  // only and locality-only candidates outright — saving "Highland Park"
  // or "355 S Atlantic Blvd" as the place name is never the goal.
  const nearby = all.filter((c) => {
    if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return false;
    if (isAddressLikePlace(c)) return false;
    if (isLocalityLikePlace(c)) return false;
    const d = haversineMeters(geocoded.latitude, geocoded.longitude, c.latitude, c.longitude);
    return d <= ADDRESS_VERIFY_RADIUS_M;
  });

  if (nearby.length === 0) {
    return { status: 'failed', reason: 'no_business_near_address', geocoded };
  }

  if (optionalPlaceName && optionalPlaceName.trim()) {
    const nameMatches = nearby.filter((c) => hasStrongNameMatch(c, optionalPlaceName));
    if (nameMatches.length === 1) {
      const distanceMeters = haversineMeters(
        geocoded.latitude,
        geocoded.longitude,
        nameMatches[0].latitude,
        nameMatches[0].longitude,
      );
      return { status: 'verified', candidate: nameMatches[0], geocoded, distanceMeters };
    }
    if (nameMatches.length > 1) {
      return { status: 'ambiguous', candidates: nameMatches.slice(0, 5), geocoded };
    }
    // Name was specified but nothing nearby matches it.
    return { status: 'failed', reason: 'name_mismatch', geocoded };
  }

  // No name provided. If exactly one business sits at the address, that's
  // a clean address-only verification. Otherwise let the user pick.
  if (nearby.length === 1) {
    const distanceMeters = haversineMeters(
      geocoded.latitude,
      geocoded.longitude,
      nearby[0].latitude,
      nearby[0].longitude,
    );
    return { status: 'verified', candidate: nearby[0], geocoded, distanceMeters };
  }
  return { status: 'ambiguous', candidates: nearby.slice(0, 5), geocoded };
}
