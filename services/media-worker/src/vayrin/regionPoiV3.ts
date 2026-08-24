import type { VerificationCandidate } from './verificationV3.js';

export const REGION_POI_MAX_QUERIES = 2;
export const REGION_POI_MAX_CANDIDATES = 8;

export type StrongRegionEvidence = {
  detected: boolean;
  label: string | null;
  source: 'location_metadata' | 'coarse_candidate' | 'caption_hashtag' | 'none';
};

export type RegionPoi = {
  name: string;
  formattedAddress: string | null;
  canonicalPlaceId: string;
  coordinates: { latitude: number; longitude: number };
  googleTypes: string[];
};

export type RegionPoiExpansionResult = {
  candidates: VerificationCandidate[];
  places: RegionPoi[];
  externalCallCount: number;
  latencyMs: number;
  failureCode: 'not_configured' | 'no_region' | 'http_error' | 'empty' | null;
  confirmationOnly: true;
};

const NON_REGION_HASHTAGS = new Set([
  'travel', 'travelgram', 'wanderlust', 'vacation', 'adventure', 'nature', 'outdoors',
  'explore', 'viral', 'fyp', 'foryou', 'foryoupage', 'reels', 'tiktok', 'beautiful',
  'summer', 'weekend', 'hidden', 'hiddengem', 'bucketlist', 'cliffjumping', 'waterfall',
  'beach', 'hiking', 'swimming', 'food', 'restaurant',
]);

function clean(value: unknown, max = 240): string | null {
  if (typeof value !== 'string') return null;
  const out = value.replace(/\s+/g, ' ').trim().slice(0, max);
  return out || null;
}

function fold(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function detectStrongRegionEvidence(input: {
  locationMetadata?: string | null;
  caption?: string | null;
  coarseCandidates?: Array<{ name: string; specificity: 'AREA' | 'CITY' | 'REGION' }>;
}): StrongRegionEvidence {
  const metadata = clean(input.locationMetadata, 160);
  if (metadata) return { detected: true, label: metadata, source: 'location_metadata' };
  const coarse = input.coarseCandidates?.find((candidate) => candidate.name.trim());
  if (coarse) return { detected: true, label: coarse.name.trim(), source: 'coarse_candidate' };
  const hashtag = [...(input.caption ?? '').matchAll(/(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{2,60})/gu)]
    .map((match) => match[1]!)
    .find((value) => !NON_REGION_HASHTAGS.has(fold(value)));
  return hashtag
    ? { detected: true, label: hashtag.replace(/[_-]+/g, ' '), source: 'caption_hashtag' }
    : { detected: false, label: null, source: 'none' };
}

export function boundedSceneCategories(sceneCategory: string | null | undefined): string[] {
  const value = fold(sceneCategory ?? '');
  if (/waterfall|travertine/.test(value)) return ['waterfall', 'swimming hole'];
  if (/bridge/.test(value)) return ['bridge', 'scenic landmark'];
  if (/cliff|jump|div/.test(value)) return ['cliff', 'swimming hole'];
  if (/beach|coast|cove/.test(value)) return ['beach', 'coastal landmark'];
  if (/restaurant|cafe|bar|food/.test(value)) return ['restaurant', 'cafe'];
  return ['tourist attraction', 'natural landmark'];
}

function parsePlaces(raw: unknown, limit: number): RegionPoi[] {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const rows = Array.isArray(body.places) ? body.places : [];
  const output: RegionPoi[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const place = row as Record<string, unknown>;
    const id = clean(place.id, 200);
    const displayName = place.displayName && typeof place.displayName === 'object'
      ? clean((place.displayName as Record<string, unknown>).text, 200)
      : null;
    const location = place.location && typeof place.location === 'object'
      ? place.location as Record<string, unknown>
      : null;
    if (!id || !displayName || typeof location?.latitude !== 'number' || typeof location.longitude !== 'number') continue;
    output.push({
      name: displayName,
      formattedAddress: clean(place.formattedAddress, 300),
      canonicalPlaceId: id,
      coordinates: { latitude: location.latitude, longitude: location.longitude },
      googleTypes: Array.isArray(place.types)
        ? place.types.filter((item): item is string => typeof item === 'string').slice(0, 20)
        : [],
    });
    if (output.length >= limit) break;
  }
  return output;
}

export async function expandRegionToPoiCandidatesV3(input: {
  apiKey?: string | null;
  region: StrongRegionEvidence;
  sceneCategory?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  maxCandidates?: number;
}): Promise<RegionPoiExpansionResult> {
  const started = Date.now();
  if (!input.region.detected || !input.region.label) {
    return { candidates: [], places: [], externalCallCount: 0, latencyMs: 0, failureCode: 'no_region', confirmationOnly: true };
  }
  if (!input.apiKey?.trim()) {
    return { candidates: [], places: [], externalCallCount: 0, latencyMs: 0, failureCode: 'not_configured', confirmationOnly: true };
  }
  const limit = Math.max(1, Math.min(REGION_POI_MAX_CANDIDATES, input.maxCandidates ?? REGION_POI_MAX_CANDIDATES));
  const categories = boundedSceneCategories(input.sceneCategory).slice(0, REGION_POI_MAX_QUERIES);
  const fetchImpl = input.fetchImpl ?? fetch;
  let httpFailure = false;
  const responses = await Promise.all(categories.map(async (category): Promise<RegionPoi[]> => {
    try {
      const response = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': input.apiKey!.trim(),
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
        },
        body: JSON.stringify({ textQuery: `${category} near ${input.region.label}`, maxResultCount: limit }),
        signal: input.signal,
      });
      if (!response.ok) {
        httpFailure = true;
        return [];
      }
      return parsePlaces(await response.json(), limit);
    } catch {
      httpFailure = true;
      return [];
    }
  }));
  const seen = new Set<string>();
  const places = responses.flat().filter((place) => {
    if (seen.has(place.canonicalPlaceId)) return false;
    seen.add(place.canonicalPlaceId);
    return true;
  }).slice(0, limit);
  const candidates: VerificationCandidate[] = places.map((place, index) => ({
    candidateId: `places:${place.canonicalPlaceId}`,
    candidateName: place.name,
    initialRank: index + 1,
    source: 'region_poi',
    retrievalStrength: 'moderate',
    retrievalEvidence: [
      `Canonical Places result constrained to ${input.region.label}.`,
      `Scene-category query: ${categories.join(' or ')}.`,
    ],
    canonicalPlaceId: place.canonicalPlaceId,
    locality: place.formattedAddress,
    country: null,
    category: place.googleTypes[0] ?? null,
    regionConsistent: true,
    confirmationOnly: true,
  }));
  return {
    candidates,
    places,
    externalCallCount: categories.length,
    latencyMs: Date.now() - started,
    failureCode: places.length > 0 ? null : httpFailure ? 'http_error' : 'empty',
    confirmationOnly: true,
  };
}
