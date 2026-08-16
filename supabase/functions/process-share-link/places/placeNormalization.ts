// supabase/functions/process-share-link/places/placeNormalization.ts
//
// Google Places type-set helpers. Behaviorally identical to
// ADDRESS_LIKE / LOCALITY_LIKE / BUSINESS_LIKE plus
// isAddressLikeTypes / isLocalityLikeTypes / pickCategory from the
// legacy index.ts.

export const ADDRESS_LIKE: ReadonlySet<string> = new Set([
  'street_address', 'premise', 'subpremise', 'route', 'intersection',
  'postal_code', 'postal_code_prefix', 'postal_code_suffix',
  'plus_code', 'geocode',
]);

export const LOCALITY_LIKE: ReadonlySet<string> = new Set([
  'locality', 'sublocality', 'sublocality_level_1', 'sublocality_level_2',
  'neighborhood', 'administrative_area_level_1',
  'administrative_area_level_2', 'administrative_area_level_3',
  'country', 'political',
]);

export const BUSINESS_LIKE: ReadonlySet<string> = new Set([
  'restaurant', 'cafe', 'bar', 'bakery', 'brewery', 'brewpub', 'winery',
  'vineyard', 'dessert_shop', 'ice_cream_shop', 'candy_store', 'food', 'meal_takeaway',
  'meal_delivery', 'store', 'shopping_mall', 'clothing_store',
  'book_store', 'grocery_or_supermarket', 'supermarket',
  'convenience_store', 'gym', 'spa', 'beauty_salon', 'lodging',
  'museum', 'art_gallery', 'movie_theater', 'night_club',
  'tourist_attraction', 'amusement_park', 'park', 'stadium',
  'liquor_store', 'pharmacy', 'pet_store',
  'hotel', 'motel', 'resort_hotel', 'hostel', 'inn',
  'city_park', 'state_park', 'national_park', 'dog_park',
  'hiking_area', 'hiking_trail', 'trailhead', 'trail_head', 'beach', 'waterfall',
  'lake', 'marina', 'island', 'nature_preserve', 'mountain_peak', 'scenic_spot',
  'observation_deck', 'cultural_landmark', 'historical_landmark', 'monument',
  'campground', 'theater', 'performing_arts_theater', 'fitness_center',
  'sports_activity_location', 'sports_complex', 'sports_club', 'wellness_center', 'yoga_studio',
  'airport', 'bus_station', 'train_station', 'transit_station', 'subway_station',
  'ferry_terminal', 'university', 'college', 'school', 'library',
]);

export function isAddressLikeTypes(types?: string[]): boolean {
  if (!types?.length) return false;
  if (types.some((t) => BUSINESS_LIKE.has(t))) return false;
  return types.some((t) => ADDRESS_LIKE.has(t));
}

export function isLocalityLikeTypes(types?: string[]): boolean {
  if (!types?.length) return false;
  if (types.some((t) => BUSINESS_LIKE.has(t))) return false;
  return types.some((t) => LOCALITY_LIKE.has(t));
}

/**
 * Whatever the caller has: a raw PlacesCandidate, a ResolvedCandidate, or a
 * persisted candidate row read back from JSON. Fields are `unknown` on purpose
 * — every caller in the pipeline hands us a slightly different shape, and the
 * classifier validates rather than trusts.
 */
type TypedCandidate =
  | { types?: unknown; primaryType?: unknown; [field: string]: unknown }
  | null
  | undefined;

function candidateTypeSet(candidate: TypedCandidate): string[] {
  const out: string[] = [];
  const primary = candidate?.primaryType;
  if (typeof primary === 'string' && primary) out.push(primary);
  const types = candidate?.types;
  if (Array.isArray(types)) {
    for (const t of types) if (typeof t === 'string' && t) out.push(t);
  }
  return out;
}

/**
 * True when a Google result describes WHERE something is rather than WHAT it
 * is — a city, neighborhood, county, state, country, postal code, or a bare
 * street-address/geocode row.
 *
 * This is the semantic candidate-validity boundary that keeps geographic
 * CONTEXT from becoming the saved DESTINATION. The historical failure it
 * prevents: weak evidence ("this place in Los Angeles is insane") produced a
 * single `locality` result, which then satisfied the exactly-one-plausible-
 * candidate auto-save rule and saved "Los Angeles" as a place.
 *
 * It is deliberately driven by Google's ENTITY TYPES, never by the words in a
 * candidate's name:
 *   - "California Pizza Kitchen" (restaurant)  -> false, a real destination
 *   - "New York Bagel Cafe" (cafe)             -> false
 *   - "Central Park" (park/tourist_attraction) -> false
 *   - "Venice Beach" (beach/natural_feature)   -> false
 *   - "Los Angeles" (locality/political)       -> TRUE, context only
 *   - "Orange County" (admin_area_level_2)     -> TRUE
 *
 * Any recognised destination type wins outright, so a park/beach/trail/landmark
 * is never filtered just because it is geographic in nature. An UNKNOWN or
 * absent type set returns false: we only reject on positive evidence that the
 * result is administrative, never on missing metadata (the legacy Places path
 * and older persisted candidates can lack `primaryType`).
 */
export function isGeographicContextOnly(candidate: TypedCandidate): boolean {
  return geographicContextTypeOf(candidate) !== null;
}

/**
 * The specific administrative/geocoding type that made a candidate
 * context-only, or null when it is a legitimate destination. Returned so the
 * rejection is explainable in diagnostics without logging free-form text.
 */
export function geographicContextTypeOf(candidate: TypedCandidate): string | null {
  const typeSet = candidateTypeSet(candidate);
  if (typeSet.length === 0) return null;
  // A real-world visitable entity is never "context only", even when its type
  // set also carries political/geographic markers (national parks do).
  if (typeSet.some((t) => BUSINESS_LIKE.has(t))) return null;
  return (
    typeSet.find((t) => LOCALITY_LIKE.has(t)) ??
    typeSet.find((t) => ADDRESS_LIKE.has(t)) ??
    null
  );
}

export function pickCategory(types?: string[]): string | null {
  if (!types?.length) return null;
  const skip = new Set(['point_of_interest', 'establishment', 'food']);
  const first = types.find((t) => !skip.has(t)) ?? types[0];
  return first ? first.replace(/_/g, ' ') : null;
}

// ---- Name matching primitives (legacy `normalizeName`/`STOP`/
//      `nameOverlapScore`/`hasMeaningfulNameMatch`/`hasStrongNameMatch`)

const STOP: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'restaurant', 'cafe', 'bar', 'food', 'place',
]);

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeQuery(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP.has(token));
}

export function nameOverlapScore(name: string, query: string): number {
  const tok = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(
      (x) => x.length >= 3 && !STOP.has(x),
    );
  const c = new Set(tok(name));
  let hits = 0;
  for (const t of tok(query)) if (c.has(t)) hits++;
  return hits;
}

export function hasMeaningfulNameMatch(name: string, query: string): boolean {
  const n = normalizeName(name);
  const q = normalizeName(query);
  if (!n || !q) return true;
  if (n === q || n.includes(q) || q.includes(n)) return true;
  const overlap = nameOverlapScore(name, query);
  const qTokens = q.split(' ').filter((t) => t.length >= 3 && !STOP.has(t));
  if (qTokens.length <= 2) return overlap >= 1;
  return overlap >= 2;
}

export function hasStrongNameMatch(name: string, query: string): boolean {
  const n = normalizeName(name);
  const q = normalizeName(query);
  if (!n || !q) return false;
  if (n === q || n.includes(q) || q.includes(n)) return true;
  const overlap = nameOverlapScore(name, query);
  const qTokens = tokenizeQuery(query);
  if (qTokens.length <= 2) return overlap >= 2;
  return overlap >= Math.min(3, qTokens.length);
}

export function haversineMeters(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
