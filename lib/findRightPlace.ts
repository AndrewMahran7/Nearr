import { normalizeResolutionName, type GeoPoint } from './contextAwarePlacesResolution';

export type FindRightPlaceCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rawTypes?: readonly string[] | null;
  types?: readonly string[] | null;
  primaryType?: string | null;
  businessStatus?: string | null;
  contextReason?: string | null;
  distanceKm?: number | null;
  reasons?: readonly string[] | null;
};

export type FindRightPlacePlan<T extends FindRightPlaceCandidate> =
  | { action: 'auto_resolve'; candidate: T; defensible: T[] }
  | { action: 'choose'; candidate: null; defensible: T[] }
  | { action: 'no_match'; candidate: null; defensible: [] };

const BROAD_TYPES = new Set([
  'locality', 'sublocality', 'neighborhood', 'administrative_area_level_1',
  'administrative_area_level_2', 'country', 'political', 'postal_code', 'street_address',
  'route', 'intersection', 'premise',
]);
const BUSINESS_TYPES = new Set([
  'establishment', 'point_of_interest', 'restaurant', 'cafe', 'bar', 'bakery',
  'lodging', 'hotel', 'museum', 'tourist_attraction', 'park', 'natural_feature',
  'hiking_area', 'trail_head', 'beach', 'store', 'shopping_mall', 'stadium',
  'airport', 'transit_station',
]);
const BLOCKING_REASONS = new Set([
  'location_conflict', 'wrong_location_rejected', 'candidate_semantic_mismatch',
  'semantic_contradiction', 'provider_clearly_unrelated', 'platform_noise_rejected',
  'permanently_closed', 'provider_permanently_closed', 'category_only_candidate',
  'country_mismatch', 'outside_context_region',
]);
const STOP_WORDS = new Set(['the', 'and', 'for', 'from', 'this', 'that', 'with', 'place', 'near']);
const EXACT_FEATURE_WORDS = new Set([
  'falls', 'waterfall', 'trail', 'beach', 'island', 'museum', 'tower', 'bridge',
  'temple', 'church', 'cathedral', 'monument', 'viewpoint', 'palace', 'castle',
]);

function words(value: string | null | undefined): string[] {
  return normalizeResolutionName(value).split(' ').filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function validCoordinate(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function preservesSpecificity(expectedName: string, candidate: FindRightPlaceCandidate): boolean {
  const expected = words(expectedName);
  if (expected.length === 0) return true;
  const identityWords = new Set(words(candidate.name));
  const addressWords = new Set(words(candidate.formattedAddress));
  const covered = expected.filter((word) => identityWords.has(word) || addressWords.has(word));
  if (covered.length / expected.length < 2 / 3) return false;
  return expected
    .filter((word) => EXACT_FEATURE_WORDS.has(word))
    .every((word) => identityWords.has(word));
}

function geographicallyCompatible(candidate: FindRightPlaceCandidate, sourceCoordinates?: GeoPoint | null): boolean {
  if (!sourceCoordinates) return true;
  if (typeof candidate.distanceKm === 'number' && Number.isFinite(candidate.distanceKm)) {
    return candidate.distanceKm <= 200;
  }
  const lat = candidate.latitude;
  const lng = candidate.longitude;
  if (!validCoordinate(lat, -90, 90) || !validCoordinate(lng, -180, 180)) return false;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians((lat as number) - sourceCoordinates.lat);
  const dLng = radians((lng as number) - sourceCoordinates.lng);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(sourceCoordinates.lat)) * Math.cos(radians(lat as number)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a))) <= 200;
}

export function isSingleMatchDefensible(
  candidate: FindRightPlaceCandidate,
  args: {
    expectedName: string;
    sourceCoordinates?: GeoPoint | null;
  },
): boolean {
  if (!candidate.googlePlaceId?.trim() || !candidate.name?.trim()) return false;
  if (!validCoordinate(candidate.latitude, -90, 90) || !validCoordinate(candidate.longitude, -180, 180)) return false;
  if (candidate.businessStatus === 'CLOSED_PERMANENTLY') return false;
  const reasons = candidate.reasons ?? [];
  if (reasons.some((reason) => BLOCKING_REASONS.has(reason))) return false;
  const types = [...(candidate.rawTypes ?? candidate.types ?? [])].map((type) => type.toLowerCase());
  if (types.length > 0 && types.every((type) => BROAD_TYPES.has(type))) return false;
  if (types.some((type) => BROAD_TYPES.has(type)) && !types.some((type) => BUSINESS_TYPES.has(type))) return false;
  if (!preservesSpecificity(args.expectedName, candidate)) return false;
  return geographicallyCompatible(candidate, args.sourceCoordinates);
}

export function planFindRightPlace<T extends FindRightPlaceCandidate>(args: {
  query: string;
  expectedName?: string | null;
  candidates: readonly T[];
  sourceCoordinates?: GeoPoint | null;
}): FindRightPlacePlan<T> {
  const expectedName = args.expectedName?.trim() || args.query.trim();
  const seen = new Set<string>();
  const defensible = args.candidates.filter((candidate) => {
    const id = candidate.googlePlaceId?.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return isSingleMatchDefensible(candidate, { expectedName, sourceCoordinates: args.sourceCoordinates });
  });
  if (defensible.length === 1) return { action: 'auto_resolve', candidate: defensible[0]!, defensible };
  if (defensible.length > 1) return { action: 'choose', candidate: null, defensible };
  return { action: 'no_match', candidate: null, defensible: [] };
}
