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
  hasStrongVenueHandleMatch,
  isGeographicContextOnly,
} from './placeNormalization.ts';
import { extractStateFromFormattedAddress } from './locationGuards.ts';
import { isPlaceholderValue } from '../../../../lib/shareAgent/queryCleaner.ts';

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
  const results: PlacesCandidate[] = (json.places ?? [])
    .slice(0, 8)
    .map(mapPlacesV1Candidate)
    .filter(isUsableCandidate);
  return { ok: true, results };
}

/**
 * Reject a candidate at the EARLIEST point after the raw Google Places
 * response is normalized — before it ever reaches the resolver, the
 * candidate picker, or an auto-save decision. Google occasionally returns a
 * placeholder/absent-value literal for `displayName`/`formattedAddress`
 * itself (verified live: searching the garbage query "Null" — see
 * evidence/handleExtraction.ts — returned two `natural_feature` results
 * whose name AND formattedAddress both read literally `<Null>`). This is
 * independent of, and in addition to, never ISSUING a placeholder query in
 * the first place (lib/shareAgent/queryCleaner.ts `isPlaceholderValue` at
 * the `buildCleanPlacesQueries` boundary) — defense in depth, since a
 * placeholder result could in principle also come back for a legitimate
 * query if Google's own data has a gap.
 */
function isUsableCandidate(c: PlacesCandidate): boolean {
  if (isPlaceholderValue(c.name)) return false;
  // A formattedAddress that STARTS with a placeholder token (e.g.
  // "<Null>, South River, NM 87410, USA") is exactly as unusable as a
  // placeholder name even when name itself happens to be fine.
  const addressHead = (c.formattedAddress ?? '').split(',')[0];
  if (addressHead && isPlaceholderValue(addressHead)) return false;
  return true;
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
    results: (json.results ?? [])
      .slice(0, 8)
      .map(mapPlacesLegacyCandidate)
      .filter(isUsableCandidate),
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

/**
 * Which rung of the verification ladder produced the answer. Recorded so a
 * future failure report can tell "we never had a venue name to combine with
 * the address" apart from "we did, and it still found nothing".
 */
export type AddressVerifyStrategy = 'venue_plus_address' | 'address_only';

export type AddressVerification =
  | {
      status: 'verified';
      candidate: PlacesCandidate;
      geocoded: GeocodedAddress;
      distanceMeters: number;
      strategy: AddressVerifyStrategy;
    }
  | {
      status: 'ambiguous';
      candidates: PlacesCandidate[];
      geocoded: GeocodedAddress;
      strategy: AddressVerifyStrategy;
    }
  | {
      status: 'failed';
      reason:
        | 'geocode_failed'
        | 'no_candidates_near_address'
        | 'name_mismatch'
        | 'no_business_near_address'
        // The provider call itself failed (transport, timeout, or a non-OK
        // Google status). NOT a statement about whether a business exists —
        // callers must treat this as retryable, never as a no-match.
        | 'provider_error';
      geocoded: GeocodedAddress | null;
      /** Present only for `provider_error`; drives backoff. */
      retryAfterSeconds?: number;
    };

/**
 * Confirm that an extracted street address corresponds to a real, visitable
 * business — and, when an optional name is supplied, that the business at that
 * address has a strong name match.
 *
 * PROVIDER PATH. This runs through `searchPlaces`, the SAME shared client the
 * rest of the resolver uses (Places API (New) `places:searchText`, with the
 * existing legacy fallback for a key that is only authorized for the old
 * service). It previously issued its own direct call to the legacy
 * `maps/api/place/textsearch` endpoint with no v1 attempt and no fallback,
 * which made address verification — the single strongest evidence path — the
 * only part of the pipeline that hard-depended on legacy Places being
 * available. A key authorized for one generation but not the other broke
 * verification while ordinary search kept working.
 *
 * QUERY LADDER. Google is asked the most specific question we can form first:
 *
 *   1. "<venue>, <formatted address>"  — when caption evidence gave us both
 *   2. "<formatted address>"           — address alone
 *
 * Rung 1 matters because neither half works on its own. Verified live: the
 * name alone is ambiguous across a chain, and the address alone comes back as
 * the ADDRESS ITSELF — "30012 Crown Valley Pkwy # I" typed
 * [street_address, subpremise] — which is correctly rejected below as
 * geographic context, yielding no_business_near_address even though a real
 * restaurant sits at that address. Combined, the same provider returns
 * "Brooklyn City Pizzeria & Market" typed [restaurant, food, …].
 *
 * The first rung that yields a usable business wins; rung 2 is skipped. A rung
 * that provider-faults does not end the ladder — the next rung still runs, and
 * the fault is only reported if NO rung produced anything.
 */
export async function verifyPlaceAtAddressServer(
  address: string,
  optionalPlaceName: string | null,
  key: string,
  /**
   * Where `optionalPlaceName` came from. `tagged_venue_handle` additionally
   * permits handle-aware matching (see `hasStrongVenueHandleMatch`), because a
   * compact owner-asserted handle is the same identity in a different
   * alphabet, not a different business. Defaults to caption prose, so every
   * existing caller keeps strict name matching unchanged.
   */
  nameSource: 'caption_text' | 'tagged_venue_handle' = 'caption_text',
): Promise<AddressVerification> {
  const geocoded = await geocodeAddressServer(address, key);
  if (!geocoded) {
    return { status: 'failed', reason: 'geocode_failed', geocoded: null };
  }
  const anchor = (geocoded.formattedAddress || address).trim();
  const placeName = optionalPlaceName?.trim() ?? '';
  const bias: SearchBias = { lat: geocoded.latitude, lng: geocoded.longitude };

  const ladder: Array<{ query: string; strategy: AddressVerifyStrategy }> = [
    ...(placeName
      ? [{ query: `${placeName}, ${anchor}`, strategy: 'venue_plus_address' as const }]
      : []),
    { query: anchor, strategy: 'address_only' as const },
  ];

  let nearby: PlacesCandidate[] = [];
  let strategy: AddressVerifyStrategy = ladder[0].strategy;
  // Sticky across rungs: a fault on rung 1 must not be forgotten if rung 2
  // simply finds nothing — "we could not ask" is not "there is nothing there".
  let providerFault: { retryAfterSeconds?: number } | null = null;

  for (const rung of ladder) {
    const res = await searchPlaces(rung.query, key, bias);
    if (!res.ok) {
      providerFault = {
        ...(typeof res.retryAfterSeconds === 'number'
          ? { retryAfterSeconds: res.retryAfterSeconds }
          : {}),
      };
      continue;
    }
    const usable = res.results.filter((c) => {
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return false;
      // The semantic eligibility boundary: a street_address / premise /
      // subpremise / locality row describes WHERE, not WHAT. Never let an
      // address card become the destination. `isGeographicContextOnly` also
      // reads `primaryType` — which the old hand-rolled legacy mapping in this
      // function dropped entirely — and lets any recognised destination type
      // (park, trailhead, beach, …) through untouched.
      if (isGeographicContextOnly(c)) return false;
      const d = haversineMeters(
        geocoded.latitude, geocoded.longitude, c.latitude!, c.longitude!,
      );
      return d <= ADDRESS_VERIFY_RADIUS_M;
    });
    if (usable.length > 0) {
      nearby = usable;
      strategy = rung.strategy;
      break;
    }
  }

  if (nearby.length === 0) {
    // Every rung faulted → retryable. Distinguishing this from "Google
    // answered and there is no business here" is what keeps a provider outage
    // out of the user's manual-search queue (see process-share-jobs/
    // providerRetry.ts, which treats these two reasons oppositely).
    if (providerFault) {
      return {
        status: 'failed',
        reason: 'provider_error',
        geocoded,
        ...providerFault,
      };
    }
    return { status: 'failed', reason: 'no_business_near_address', geocoded };
  }

  const distanceTo = (c: PlacesCandidate) =>
    haversineMeters(geocoded.latitude, geocoded.longitude, c.latitude!, c.longitude!);

  if (placeName) {
    // Never blindly take result 0 — the provider may return the shopping
    // centre, the building, and the specific business for one address. The
    // caption's venue name is what picks between them.
    //
    // Strict name matching is always tried FIRST and is never weakened. Only
    // when the name is an owner-asserted @handle does the handle-aware rule
    // additionally apply, so a human-readable venue name can never be
    // downgraded and a compact handle is no longer judged as if it were prose.
    const matches = nearby.filter(
      (c) =>
        hasStrongNameMatch(c.name, placeName) ||
        (nameSource === 'tagged_venue_handle' &&
          hasStrongVenueHandleMatch(c.name, placeName).matched),
    );
    if (matches.length === 1) {
      return {
        status: 'verified',
        candidate: matches[0],
        geocoded,
        distanceMeters: distanceTo(matches[0]),
        strategy,
      };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', candidates: matches.slice(0, 5), geocoded, strategy };
    }
    // Businesses exist here, but none is the one the caption named. The
    // resolver retries bare (see resolveSharedPlace) so the real business at
    // the address can still surface.
    return { status: 'failed', reason: 'name_mismatch', geocoded };
  }

  if (nearby.length === 1) {
    return {
      status: 'verified',
      candidate: nearby[0],
      geocoded,
      distanceMeters: distanceTo(nearby[0]),
      strategy,
    };
  }
  return { status: 'ambiguous', candidates: nearby.slice(0, 5), geocoded, strategy };
}
