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

export const BUSINESS_OR_VENUE_LIKE: ReadonlySet<string> = new Set([
  'restaurant', 'cafe', 'bar', 'bakery', 'brewery', 'brewpub', 'winery',
  'vineyard', 'dessert_shop', 'ice_cream_shop', 'candy_store', 'food', 'meal_takeaway',
  'meal_delivery', 'store', 'shopping_mall', 'clothing_store',
  'book_store', 'grocery_or_supermarket', 'supermarket',
  'convenience_store', 'gym', 'spa', 'beauty_salon', 'lodging',
  'museum', 'art_gallery', 'movie_theater', 'night_club',
  'amusement_park', 'stadium',
  'liquor_store', 'pharmacy', 'pet_store',
  'hotel', 'motel', 'resort_hotel', 'hostel', 'inn',
  'campground', 'theater', 'performing_arts_theater', 'fitness_center',
  'sports_activity_location', 'sports_complex', 'sports_club', 'wellness_center', 'yoga_studio',
  'airport', 'bus_station', 'train_station', 'transit_station', 'subway_station',
  'ferry_terminal', 'university', 'college', 'school', 'library',
]);

/** Physical natural destinations. Google may combine any of these with
 * `establishment`, `point_of_interest`, `political`, or no useful primary type.
 * Those generic additions never change the semantic kind. */
export const NATURAL_FEATURE_LIKE: ReadonlySet<string> = new Set([
  'natural_feature', 'geographic_feature', 'park', 'city_park', 'state_park',
  'national_park', 'nature_preserve', 'nature_reserve', 'wildlife_refuge',
  'hiking_area', 'hiking_trail', 'trail', 'trailhead', 'trail_head', 'beach',
  'waterfall', 'lake', 'river', 'island', 'gorge', 'canyon', 'cliff', 'cave',
  'cenote', 'quarry', 'swimming_hole', 'mountain_peak', 'scenic_spot',
  'scenic_area', 'marina', 'campground',
]);

export const LANDMARK_LIKE: ReadonlySet<string> = new Set([
  'tourist_attraction', 'observation_deck', 'cultural_landmark',
  'historical_landmark', 'historical_place', 'monument', 'memorial', 'bridge',
]);

export const VISITABLE_DESTINATION_LIKE: ReadonlySet<string> = new Set([
  ...BUSINESS_OR_VENUE_LIKE,
  ...NATURAL_FEATURE_LIKE,
  ...LANDMARK_LIKE,
]);

/** Back-compatible name used by existing scoring. It now means "visitable
 * destination", not business; new semantic code should use the narrower sets. */
export const BUSINESS_LIKE: ReadonlySet<string> = VISITABLE_DESTINATION_LIKE;

export type NormalizedProviderEntityKind =
  | 'business_or_venue'
  | 'named_natural_feature'
  | 'landmark'
  | 'administrative_geography'
  | 'address'
  | 'unknown';

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

/** Normalize Places New and Legacy typing without treating the generic
 * `establishment` marker as proof of business semantics. */
export function normalizeProviderEntityKind(candidate: TypedCandidate): NormalizedProviderEntityKind {
  const types = candidateTypeSet(candidate);
  if (types.some((type) => NATURAL_FEATURE_LIKE.has(type))) return 'named_natural_feature';
  if (types.some((type) => LANDMARK_LIKE.has(type))) return 'landmark';
  if (types.some((type) => BUSINESS_OR_VENUE_LIKE.has(type))) return 'business_or_venue';
  if (types.some((type) => LOCALITY_LIKE.has(type))) return 'administrative_geography';
  if (types.some((type) => ADDRESS_LIKE.has(type))) return 'address';
  // `establishment` and `point_of_interest` are deliberately UNKNOWN: Google
  // uses them for reserves, waterfalls and landmarks as well as businesses.
  return 'unknown';
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
  if (typeSet.some((t) => VISITABLE_DESTINATION_LIKE.has(t))) return null;
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

// ---- Tagged-venue-handle matching ----------------------------------------
//
// A social handle is not a business name. It is the SAME identity written in a
// different alphabet: spaces and punctuation removed, casing flattened, and a
// brand suffix (commonly the founding year) sometimes appended. Meanwhile the
// provider often appends a BRANCH to the business name.
//
//   handle     @santafeimporters1947
//   candidate   Santa Fe Importers Seal Beach
//
// `hasStrongNameMatch` correctly rejects that pair: it is token-overlap based,
// and the compact handle tokenizes to one token matching none of the
// candidate's. Loosening it to bridge the gap would also equate "Santa Fe
// Foodies" with "Santa Fe Importers", so this is deliberately a SEPARATE rule
// that applies only to evidence already classified as a tagged venue handle --
// never to caption prose, a poster/creator handle, or a model guess.
//
// SAFETY BOUNDARY. This is only ever reached from `verifyPlaceAtAddressServer`,
// where every candidate has already been filtered to within
// ADDRESS_VERIFY_RADIUS_M of the geocoded street address and screened for
// geographic-context types. A handle therefore can never identify a business on
// its own -- the explicit address has already constrained the universe to what
// physically sits there.

export type VenueHandleMatch = {
  matched: boolean;
  /** Explainable reason codes, in the repo's diagnostic style. */
  reasons: string[];
};

/** Fold case and accents so "Café" and "Cafe" compare identically. Diacritics
 *  must go BEFORE any split on non-alphanumerics, or a decomposed accent would
 *  act as a separator and cut "café" into "caf" + "e". */
function foldForHandle(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '');
}

/** Compact a string the way a handle is written: lowercase alphanumerics only. */
function compactForHandle(value: string): string {
  return foldForHandle(value).replace(/[^a-z0-9]+/g, '');
}

/** Candidate name -> compacted tokens, e.g. "85C Bakery" -> ["85c","bakery"]. */
function compactTokens(value: string): string[] {
  return foldForHandle(value).split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * A trailing FOUR-DIGIT YEAR-LIKE suffix (18xx/19xx/20xx) -- the "since 1947"
 * branding convention. Deliberately NOT a general digit strip: numerals carry
 * real identity in business names (Studio 54, 7-Eleven, Area 15, 85C Bakery),
 * and removing them would let a handle match the wrong brand. Anything that is
 * not a plausible founding year stays part of the stem.
 */
const TRAILING_YEAR_RE = /^(.*?)((?:18|19|20)\d{2})$/;

/** Minimum stem length before a PARTIAL (brand-prefix) match is allowed. */
const MIN_PARTIAL_STEM_LENGTH = 8;

/**
 * Is `handle` strongly compatible with `candidateName` as the same business?
 *
 * The handle stem must align to a WHOLE-TOKEN prefix of the candidate name, so
 * a partial word can never match ("santafeimport" is rejected). Beyond that:
 *
 *   - full coverage: the stem spells the entire candidate name. Accepted at any
 *     length, which is what keeps short numeric brands working
 *     (`@7eleven` <-> "7-Eleven").
 *   - prefix coverage: the stem spells the candidate's leading tokens and the
 *     provider appended a branch ("... Seal Beach"). Requires >=2 covered
 *     tokens and >=8 characters, so a single generic leading token cannot claim
 *     a brand: `@starbucks` does NOT match "Starbucks Reserve Roastery", and
 *     `@santafe` does not match "Santa Fe Importers".
 *
 * The unmodified handle is tried FIRST so a genuine numeric brand matches on
 * its own terms; only if that fails is a trailing year reconsidered.
 */
export function hasStrongVenueHandleMatch(
  candidateName: string,
  handle: string,
): VenueHandleMatch {
  const rawStem = compactForHandle((handle ?? '').replace(/^@/, ''));
  const tokens = compactTokens(candidateName ?? '');
  if (!rawStem || tokens.length === 0) return { matched: false, reasons: [] };

  // Cumulative whole-token prefixes: "santa", "santafe", "santafeimporters", ...
  const prefixes: string[] = [];
  let acc = '';
  for (const token of tokens) {
    acc += token;
    prefixes.push(acc);
  }
  const full = prefixes[prefixes.length - 1];

  const attempt = (stem: string, extraReasons: string[]): VenueHandleMatch | null => {
    const covered = prefixes.indexOf(stem);
    if (covered < 0) return null;
    const tokensCovered = covered + 1;
    if (stem === full) {
      return { matched: true, reasons: [...extraReasons, 'handle_spells_full_candidate_name'] };
    }
    if (tokensCovered >= 2 && stem.length >= MIN_PARTIAL_STEM_LENGTH) {
      return {
        matched: true,
        reasons: [
          ...extraReasons,
          'handle_brand_stem_matches_candidate_prefix',
          'candidate_branch_suffix_ignored',
        ],
      };
    }
    return null;
  };

  const direct = attempt(rawStem, []);
  if (direct) return direct;

  const year = rawStem.match(TRAILING_YEAR_RE);
  if (year && year[1]) {
    const withoutYear = attempt(year[1], ['trailing_year_suffix_ignored']);
    if (withoutYear) return withoutYear;
  }

  return { matched: false, reasons: [] };
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
