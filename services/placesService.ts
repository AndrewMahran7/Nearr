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
    }

    if (
      target &&
      Number.isFinite(c.latitude) &&
      Number.isFinite(c.longitude)
    ) {
      const km =
        haversineMeters(target.lat, target.lng, c.latitude, c.longitude) /
        1000;
      // Smooth penalty: 0km -> 0, 10km -> -10, 50km+ -> -50 cap.
      s -= Math.min(50, km);
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
  const pinIdx = text.search(/[\u{1F4CD}\u{1F4CC}]/u);
  if (pinIdx >= 0) {
    const tail = text.slice(pinIdx + 2, pinIdx + 200).split(/[\n\r]/)[0];
    const cleaned = tail
      .replace(/#[\p{L}\p{N}_]+/gu, ' ')
      .replace(/["\u201C\u201D'`]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Stop at "also" / "and" / "or" / "+" — pin text often runs on
    // ("📍 Highland Park, Los Angeles, CA also a location in Grand Central").
    const stopMatch = cleaned.split(/\b(?:also|and|or|plus)\b|[+|]/i)[0].trim();
    if (stopMatch && stopMatch.length >= 3 && stopMatch.length <= 80) {
      return stopMatch;
    }
  }
  const trailing = text.match(
    /,\s*([A-Z][\p{L}.'\u2019-]+(?:[\s,]+[A-Z][\p{L}.'\u2019-]+){0,4})\s*[.!?]?\s*$/u,
  );
  if (trailing && trailing[1]) return trailing[1].trim();
  return null;
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
