/**
 * Shared, provider-agnostic context model and deterministic Places ranker.
 *
 * This file deliberately has no React Native, Node, or Deno dependencies so
 * the app, Edge resolver, worker fixtures, and benchmark all use the same
 * semantics. Google Place IDs remain the only identity key: context changes
 * search/ranking, never semantic identity merging.
 */

export const MAX_VISIBLE_CONTEXTUAL_CANDIDATES = 3;
export const MAX_CONTEXTUAL_SEARCH_CALLS = 3;

export const CONTEXT_DISTANCE_TIERS_KM = [25, 75, 200] as const;
export type ContextDistanceTierKm = (typeof CONTEXT_DISTANCE_TIERS_KM)[number];

export type GeoPoint = { lat: number; lng: number };
export type ResolutionConfidence = 'exact' | 'strong' | 'medium' | 'weak' | 'none';

export type ResolutionEvidenceSource =
  | 'exact_source_evidence'
  | 'video_region'
  | 'nearby_resolved_video_place'
  | 'creator_caption_geo'
  | 'user_location'
  | 'none';

export type NearbyResolvedMention = {
  googlePlaceId: string;
  name?: string | null;
  coordinates: GeoPoint;
  locality?: string | null;
  region?: string | null;
  country?: string | null;
  mentionTimestamp?: number | null;
};

/** Structured context for one name -> Places resolution. All fields optional. */
export type PlacesResolutionContext = {
  /** `source` for a place from a post/video; `manual` for an ordinary user search. */
  mode: 'source' | 'manual';
  inferredRegion?: string | null;
  inferredLocality?: string | null;
  inferredCountry?: string | null;
  inferredCoordinates?: GeoPoint | null;
  regionConfidence?: ResolutionConfidence;
  /** Closed vocabulary only. Never put raw captions/transcripts here. */
  sourceEvidence?: ResolutionEvidenceSource[];
  mentionTimestamp?: number | null;
  userLocation?: GeoPoint | null;
  videoGeoHints?: Array<{
    locality?: string | null;
    region?: string | null;
    country?: string | null;
    coordinates?: GeoPoint | null;
    confidence?: ResolutionConfidence;
  }>;
  nearbyResolvedMentions?: NearbyResolvedMention[];
  expectedCategory?: string | null;
  /** True only after the user explicitly asks to search beyond source context. */
  manualExpansionRequested?: boolean;
};

export type ContextualPlaceCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  types?: readonly string[] | null;
  rawTypes?: readonly string[] | null;
  primaryType?: string | null;
  category?: string | null;
  businessStatus?: string | null;
};

export type ContextReason =
  | 'exact_source_evidence'
  | 'source_locality'
  | 'source_region'
  | 'source_country'
  | 'near_resolved_video_place'
  | 'video_geo_hint'
  | 'user_proximity'
  | 'no_geographic_context';

export type CandidateContextMetadata = {
  contextReason: ContextReason;
  contextLabel: string | null;
  distanceKm: number | null;
  localityMatch: boolean;
  regionMatch: boolean;
  countryMatch: boolean | null;
  wideningTierKm: ContextDistanceTierKm | null;
};

export type ContextualRankedCandidate<T extends ContextualPlaceCandidate> = {
  candidate: T;
  score: number;
  metadata: CandidateContextMetadata;
  reasons: string[];
};

export type AmbiguityAnalysis = {
  ambiguous: boolean;
  repeatedNormalizedName: boolean;
  highMultiplicity: boolean;
  geographicallySpread: boolean;
  genericTokenComposition: boolean;
};

export type ContextualResolutionTelemetry = {
  queryType: 'chain_or_generic' | 'specific' | 'manual';
  contextAvailable: boolean;
  contextSource: ResolutionEvidenceSource;
  initialSearchRadiusKm: number | null;
  widenCount: number;
  resultCount: number;
  visibleResultCount: number;
  topCandidateDistanceTier: '0_25' | '25_75' | '75_200' | 'over_200' | 'unknown';
  countryMismatchFiltered: number;
  categoryMismatchFiltered: number;
  manualExpansionRequested: boolean;
  placesCallCount: number;
};

export type ContextualRankingResult<T extends ContextualPlaceCandidate> = {
  ranked: Array<ContextualRankedCandidate<T>>;
  visible: Array<ContextualRankedCandidate<T>>;
  ambiguity: AmbiguityAnalysis;
  noNearbyMatch: boolean;
  filteredCountryMismatch: number;
  filteredTooFar: number;
  categoryMismatchCount: number;
  telemetry: ContextualResolutionTelemetry;
};

const GENERIC_NAME_TOKENS = new Set([
  'bar', 'beach', 'cafe', 'café', 'central', 'city', 'club', 'coffee', 'creek',
  'grill', 'hotel', 'house', 'inn', 'lagoon', 'lake', 'main', 'market', 'park',
  'place', 'restaurant', 'river', 'road', 'spot', 'street', 'the', 'trail',
]);

const TYPE_FAMILIES: Record<string, string> = {
  restaurant: 'food', food: 'food', cafe: 'food', bakery: 'food', bar: 'food',
  meal_takeaway: 'food', meal_delivery: 'food', dessert_shop: 'food',
  lodging: 'lodging', hotel: 'lodging', resort_hotel: 'lodging', motel: 'lodging',
  park: 'nature', natural_feature: 'nature', hiking_area: 'nature', trail_head: 'nature',
  beach: 'nature', lake: 'nature', waterfall: 'nature', campground: 'nature',
  golf_course: 'golf', museum: 'culture', art_gallery: 'culture',
  tourist_attraction: 'attraction', amusement_park: 'attraction',
  store: 'shopping', shopping_mall: 'shopping', supermarket: 'shopping',
};

const COUNTRY_ALIASES: Record<string, string> = {
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US',
  canada: 'CA', mexico: 'MX', switzerland: 'CH', schweiz: 'CH', suisse: 'CH', svizzera: 'CH',
  france: 'FR', germany: 'DE', deutschland: 'DE', italy: 'IT', italia: 'IT',
  spain: 'ES', españa: 'ES', portugal: 'PT', 'united kingdom': 'GB', uk: 'GB',
  england: 'GB', scotland: 'GB', ireland: 'IE', austria: 'AT', australia: 'AU',
  japan: 'JP', china: 'CN', india: 'IN', brazil: 'BR', brasil: 'BR',
  nicaragua: 'NI', 'costa rica': 'CR', colombia: 'CO', greece: 'GR',
  netherlands: 'NL', belgium: 'BE', denmark: 'DK', norway: 'NO', sweden: 'SE',
};

const COUNTRY_SUFFIXES: Array<[RegExp, string]> = Object.entries(COUNTRY_ALIASES)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([label, code]) => [new RegExp(`(?:^|,\\s*)${escapeRegExp(label)}\\.?$`, 'i'), code]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeResolutionName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value: string | null | undefined): string[] {
  return normalizeResolutionName(value).split(' ').filter(Boolean);
}

export function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const radiusKm = 6_371;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * sinLng * sinLng;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validPoint(point: GeoPoint | null | undefined): point is GeoPoint {
  return !!point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
    Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

function candidatePoint(candidate: ContextualPlaceCandidate): GeoPoint | null {
  const lat = candidate.latitude;
  const lng = candidate.longitude;
  return typeof lat === 'number' && typeof lng === 'number' && validPoint({ lat, lng })
    ? { lat, lng }
    : null;
}

function confidenceAtLeastStrong(value: ResolutionConfidence | undefined): boolean {
  return value === 'exact' || value === 'strong';
}

function nearbyWeight(mentionTimestamp: number | null | undefined, nearbyTimestamp: number | null | undefined): number {
  if (!Number.isFinite(mentionTimestamp) || !Number.isFinite(nearbyTimestamp)) return 0.6;
  const delta = Math.abs((mentionTimestamp as number) - (nearbyTimestamp as number));
  if (delta <= 30) return 1;
  if (delta <= 120) return 0.7;
  if (delta <= 600) return 0.4;
  return 0.2;
}

export type ResolutionAnchor = {
  coordinates: GeoPoint | null;
  source: ResolutionEvidenceSource;
  weight: number;
  label: string | null;
};

/** Selects one anchor using source/video context before user location. */
export function selectResolutionAnchor(context: PlacesResolutionContext): ResolutionAnchor {
  if (validPoint(context.inferredCoordinates)) {
    return {
      coordinates: context.inferredCoordinates,
      source: 'exact_source_evidence',
      weight: 1,
      label: contextLabel(context),
    };
  }

  const strongHint = context.videoGeoHints?.find((hint) =>
    validPoint(hint.coordinates) && confidenceAtLeastStrong(hint.confidence));
  if (strongHint && validPoint(strongHint.coordinates)) {
    return {
      coordinates: strongHint.coordinates,
      source: 'video_region',
      weight: strongHint.confidence === 'exact' ? 1 : 0.9,
      label: [strongHint.locality, strongHint.region, strongHint.country].filter(Boolean).join(', ') || null,
    };
  }

  const nearby = (context.nearbyResolvedMentions ?? [])
    .filter((mention) => validPoint(mention.coordinates))
    .map((mention) => ({ mention, weight: nearbyWeight(context.mentionTimestamp, mention.mentionTimestamp) }))
    .sort((a, b) => b.weight - a.weight || a.mention.googlePlaceId.localeCompare(b.mention.googlePlaceId))[0];
  if (nearby) {
    return {
      coordinates: nearby.mention.coordinates,
      source: 'nearby_resolved_video_place',
      weight: nearby.weight,
      label: [nearby.mention.locality, nearby.mention.region, nearby.mention.country].filter(Boolean).join(', ') || null,
    };
  }

  // A source search with textual geo still outranks the user, even before the
  // caller geocodes it. Returning no coordinate prevents accidental fallback.
  if (context.mode === 'source' && contextLabel(context)) {
    return {
      coordinates: null,
      source: context.sourceEvidence?.includes('creator_caption_geo')
        ? 'creator_caption_geo'
        : 'video_region',
      weight: confidenceAtLeastStrong(context.regionConfidence) ? 0.9 : 0.65,
      label: contextLabel(context),
    };
  }

  if (validPoint(context.userLocation)) {
    return { coordinates: context.userLocation, source: 'user_location', weight: 0.35, label: null };
  }
  return { coordinates: null, source: 'none', weight: 0, label: null };
}

export function contextLabel(context: PlacesResolutionContext): string | null {
  return [context.inferredLocality, context.inferredRegion, context.inferredCountry]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(', ') || null;
}

export function countryCodeForContext(value: string | null | undefined): string | null {
  const normalized = normalizeResolutionName(value);
  if (!normalized) return null;
  if (/^[a-z]{2}$/.test(normalized)) return normalized.toUpperCase();
  return COUNTRY_ALIASES[normalized] ?? null;
}

export function countryCodeFromAddress(address: string | null | undefined): string | null {
  const trimmed = (address ?? '').trim();
  if (!trimmed) return null;
  for (const [pattern, code] of COUNTRY_SUFFIXES) {
    if (pattern.test(trimmed)) return code;
  }
  return null;
}

function countryLabelFromAddress(address: string | null | undefined): string | null {
  const last = (address ?? '').split(',').map((part) => part.trim()).filter(Boolean).pop() ?? '';
  if (!last || /\d/.test(last) || /^[A-Z]{2}$/i.test(last)) return null;
  return normalizeResolutionName(last) || null;
}

/** Parse a bounded provider/UI locality label into structured fields. */
export function geographicFieldsFromLabel(label: string | null | undefined): {
  locality: string | null;
  region: string | null;
  country: string | null;
} {
  const parts = (label ?? '').split(',').map((part) => part.trim()).filter(Boolean).slice(0, 4);
  if (parts.length === 0) return { locality: null, region: null, country: null };
  const last = parts[parts.length - 1]!;
  const lastIsCountry = countryCodeForContext(last) !== null;
  if (parts.length === 1) {
    return lastIsCountry
      ? { locality: null, region: null, country: last }
      : { locality: last, region: null, country: null };
  }
  if (lastIsCountry) {
    return {
      locality: parts[0] ?? null,
      region: parts.length >= 3 ? parts[parts.length - 2] ?? null : null,
      country: last,
    };
  }
  return {
    locality: parts[0] ?? null,
    region: parts.slice(1).join(', ') || null,
    country: null,
  };
}

function includesGeoLabel(address: string | null | undefined, label: string | null | undefined): boolean {
  const foldedAddress = ` ${normalizeResolutionName(address)} `;
  const foldedLabel = normalizeResolutionName(label);
  return !!foldedLabel && foldedAddress.includes(` ${foldedLabel} `);
}

function categoryFamily(value: string | null | undefined): string | null {
  const normalized = normalizeResolutionName(value).replace(/ /g, '_');
  if (!normalized) return null;
  return TYPE_FAMILIES[normalized] ?? normalized;
}

function candidateCategoryFamily(candidate: ContextualPlaceCandidate): string | null {
  for (const value of [candidate.primaryType, candidate.category, ...(candidate.types ?? candidate.rawTypes ?? [])]) {
    const family = categoryFamily(value);
    if (family) return family;
  }
  return null;
}

function queryNameScore(query: string, candidateName: string): { score: number; exact: boolean; overlap: number } {
  const queryName = normalizeResolutionName(query);
  const name = normalizeResolutionName(candidateName);
  if (!queryName || !name) return { score: 0, exact: false, overlap: 0 };
  if (name === queryName) return { score: 72, exact: true, overlap: words(query).length };
  if (name.includes(queryName) || queryName.includes(name)) return { score: 48, exact: false, overlap: Math.min(words(query).length, words(candidateName).length) };
  const candidateWords = new Set(words(candidateName));
  const queryWords = words(query).filter((word) => word.length > 1);
  const overlap = queryWords.filter((word) => candidateWords.has(word)).length;
  return { score: overlap * 14, exact: false, overlap };
}

export function analyzePlacesAmbiguity(
  query: string,
  candidates: readonly ContextualPlaceCandidate[],
): AmbiguityAnalysis {
  const names = new Map<string, number>();
  for (const candidate of candidates) {
    const name = normalizeResolutionName(candidate.name);
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
  }
  const repeatedNormalizedName = [...names.values()].some((count) => count >= 2);
  const highMultiplicity = candidates.length >= 5;
  let geographicallySpread = false;
  const points = candidates.map(candidatePoint).filter((point): point is GeoPoint => !!point);
  outer: for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      if (haversineDistanceKm(points[left]!, points[right]!) > 250) {
        geographicallySpread = true;
        break outer;
      }
    }
  }
  const queryWords = words(query);
  const genericCount = queryWords.filter((word) => GENERIC_NAME_TOKENS.has(word)).length;
  const genericTokenComposition = queryWords.length > 0 &&
    (queryWords.length === 1 || genericCount / queryWords.length >= 0.5);
  return {
    ambiguous: repeatedNormalizedName || geographicallySpread || (highMultiplicity && genericTokenComposition),
    repeatedNormalizedName,
    highMultiplicity,
    geographicallySpread,
    genericTokenComposition,
  };
}

function reasonForAnchor(anchor: ResolutionAnchor, context: PlacesResolutionContext): ContextReason {
  if (anchor.source === 'exact_source_evidence') return 'exact_source_evidence';
  if (anchor.source === 'nearby_resolved_video_place') return 'near_resolved_video_place';
  if (anchor.source === 'user_location') return 'user_proximity';
  if (anchor.source === 'video_region' || anchor.source === 'creator_caption_geo') return 'video_geo_hint';
  if (context.inferredLocality) return 'source_locality';
  if (context.inferredRegion) return 'source_region';
  if (context.inferredCountry) return 'source_country';
  return 'no_geographic_context';
}

function tierForDistance(distanceKm: number | null): ContextDistanceTierKm | null {
  if (distanceKm == null) return null;
  return CONTEXT_DISTANCE_TIERS_KM.find((tier) => distanceKm <= tier) ?? null;
}

function distanceTelemetryTier(distanceKm: number | null): ContextualResolutionTelemetry['topCandidateDistanceTier'] {
  if (distanceKm == null) return 'unknown';
  if (distanceKm <= 25) return '0_25';
  if (distanceKm <= 75) return '25_75';
  if (distanceKm <= 200) return '75_200';
  return 'over_200';
}

/**
 * Deterministically rank and gate one provider result set.
 *
 * Country and >200 km exclusions require strong SOURCE context. User location
 * never hard-filters, and a distant nearby-mention signal is weighted rather
 * than treated as proof.
 */
export function rankContextAwareCandidates<T extends ContextualPlaceCandidate>(args: {
  query: string;
  candidates: readonly T[];
  context: PlacesResolutionContext;
  searchTierKm?: ContextDistanceTierKm | null;
  widenCount?: number;
  placesCallCount?: number;
}): ContextualRankingResult<T> {
  const ambiguity = analyzePlacesAmbiguity(args.query, args.candidates);
  const anchor = selectResolutionAnchor(args.context);
  const expectedCountry = countryCodeForContext(args.context.inferredCountry);
  const expectedCountryLabel = normalizeResolutionName(args.context.inferredCountry);
  const strongSourceGeo = args.context.mode === 'source' &&
    confidenceAtLeastStrong(args.context.regionConfidence) && !args.context.manualExpansionRequested;
  const expectedCategory = categoryFamily(args.context.expectedCategory);
  const seenIds = new Set<string>();
  const ranked: Array<ContextualRankedCandidate<T> & { index: number }> = [];
  let filteredCountryMismatch = 0;
  let filteredTooFar = 0;
  let categoryMismatchCount = 0;

  args.candidates.forEach((candidate, index) => {
    const providerId = candidate.googlePlaceId?.trim();
    if (!providerId || seenIds.has(providerId) || !candidate.name?.trim()) return;
    seenIds.add(providerId);
    if (candidate.businessStatus === 'CLOSED_PERMANENTLY') return;

    const addressCountry = countryCodeFromAddress(candidate.formattedAddress);
    const addressCountryLabel = countryLabelFromAddress(candidate.formattedAddress);
    const countryMatch = expectedCountry && addressCountry
      ? expectedCountry === addressCountry
      : expectedCountryLabel && addressCountryLabel && expectedCountryLabel === addressCountryLabel
        ? true
        : null;
    if (strongSourceGeo && countryMatch === false) {
      filteredCountryMismatch += 1;
      return;
    }

    const point = candidatePoint(candidate);
    const distanceKm = anchor.coordinates && point ? haversineDistanceKm(anchor.coordinates, point) : null;
    // A sibling place is evidence, never a geofence. It may reorder plausible
    // candidates but cannot exclude a place that has its own explicit country
    // or represents a separate travel segment.
    const hardDistanceContext = anchor.source !== 'nearby_resolved_video_place';
    if (strongSourceGeo && ambiguity.ambiguous && hardDistanceContext && distanceKm != null && distanceKm > 200) {
      filteredTooFar += 1;
      return;
    }

    const reasons: string[] = [];
    const name = queryNameScore(args.query, candidate.name);
    let score = name.score;
    if (name.exact) reasons.push('exact_normalized_name');
    else if (name.overlap > 0) reasons.push('textual_name_overlap');

    const localityMatch = includesGeoLabel(candidate.formattedAddress, args.context.inferredLocality);
    const regionMatch = includesGeoLabel(candidate.formattedAddress, args.context.inferredRegion);
    if (localityMatch) { score += 36; reasons.push('same_locality'); }
    if (regionMatch) { score += 24; reasons.push('same_region'); }
    if (countryMatch === true) { score += 18; reasons.push('same_country'); }
    else if (countryMatch === false) { score -= 90; reasons.push('country_mismatch'); }

    if (distanceKm != null) {
      if (anchor.source === 'user_location') {
        score -= Math.min(28, distanceKm * 0.4);
        reasons.push('user_proximity');
      } else {
        const weightedDistance = distanceKm * Math.max(0.2, anchor.weight);
        if (weightedDistance <= 25) { score += 38; reasons.push('distance_tier_city'); }
        else if (weightedDistance <= 75) { score += 18; reasons.push('distance_tier_metro'); }
        else if (weightedDistance <= 200) { score += 2; reasons.push('distance_tier_region'); }
        else { score -= 120; reasons.push('outside_context_region'); }
      }
    }

    const resolvedCategory = candidateCategoryFamily(candidate);
    if (expectedCategory && resolvedCategory === expectedCategory) {
      score += 20;
      reasons.push('category_match');
    } else if (expectedCategory && resolvedCategory && resolvedCategory !== expectedCategory) {
      categoryMismatchCount += 1;
      // Exact identity stays authoritative: category is evidence, not identity.
      score -= name.exact ? 8 : ambiguity.ambiguous ? 34 : 20;
      reasons.push('category_mismatch');
    }

    if (ambiguity.ambiguous) reasons.push('ambiguity_context_weighted');
    ranked.push({
      candidate,
      score,
      index,
      reasons,
      metadata: {
        contextReason: reasonForAnchor(anchor, args.context),
        contextLabel: anchor.label ?? contextLabel(args.context),
        distanceKm: distanceKm == null ? null : Math.round(distanceKm * 10) / 10,
        localityMatch,
        regionMatch,
        countryMatch,
        wideningTierKm: args.searchTierKm ?? tierForDistance(distanceKm),
      },
    });
  });

  ranked.sort((left, right) =>
    right.score - left.score || left.index - right.index ||
    left.candidate.googlePlaceId.localeCompare(right.candidate.googlePlaceId));
  const publicRanked = ranked.map(({ index: _index, ...item }) => item);
  const noNearbyMatch = strongSourceGeo && ambiguity.ambiguous && publicRanked.length === 0 &&
    (filteredTooFar > 0 || filteredCountryMismatch > 0);
  const topDistance = publicRanked[0]?.metadata.distanceKm ?? null;
  const contextAvailable = anchor.source !== 'none' || !!contextLabel(args.context);
  const telemetry: ContextualResolutionTelemetry = {
    queryType: args.context.mode === 'manual' ? 'manual' : ambiguity.ambiguous ? 'chain_or_generic' : 'specific',
    contextAvailable,
    contextSource: anchor.source,
    initialSearchRadiusKm: anchor.coordinates && args.context.mode === 'source' ? 25 : null,
    widenCount: Math.max(0, Math.min(2, Math.floor(args.widenCount ?? 0))),
    resultCount: publicRanked.length,
    visibleResultCount: Math.min(MAX_VISIBLE_CONTEXTUAL_CANDIDATES, publicRanked.length),
    topCandidateDistanceTier: distanceTelemetryTier(topDistance),
    countryMismatchFiltered: filteredCountryMismatch,
    categoryMismatchFiltered: categoryMismatchCount,
    manualExpansionRequested: args.context.manualExpansionRequested === true,
    placesCallCount: Math.max(0, Math.min(MAX_CONTEXTUAL_SEARCH_CALLS, Math.floor(args.placesCallCount ?? 1))),
  };
  return {
    ranked: publicRanked,
    visible: publicRanked.slice(0, MAX_VISIBLE_CONTEXTUAL_CANDIDATES),
    ambiguity,
    noNearbyMatch,
    filteredCountryMismatch,
    filteredTooFar,
    categoryMismatchCount,
    telemetry,
  };
}

export type WideningDecision = {
  tierKm: ContextDistanceTierKm | null;
  shouldSearch: boolean;
  exhausted: boolean;
};

/** Lazy widening: never schedule all tiers eagerly. */
export function contextualWideningDecision(args: {
  context: PlacesResolutionContext;
  completedCalls: number;
  plausibleCandidateCount: number;
}): WideningDecision {
  const anchor = selectResolutionAnchor(args.context);
  const boundedCalls = Math.max(0, Math.floor(args.completedCalls));
  if (args.plausibleCandidateCount > 0 || boundedCalls >= MAX_CONTEXTUAL_SEARCH_CALLS) {
    return { tierKm: null, shouldSearch: false, exhausted: boundedCalls >= MAX_CONTEXTUAL_SEARCH_CALLS };
  }
  if (!anchor.coordinates || args.context.mode !== 'source' || args.context.manualExpansionRequested) {
    return { tierKm: boundedCalls === 0 ? 200 : null, shouldSearch: boundedCalls === 0, exhausted: boundedCalls > 0 };
  }
  const tierKm = CONTEXT_DISTANCE_TIERS_KM[boundedCalls] ?? null;
  return { tierKm, shouldSearch: tierKm !== null, exhausted: tierKm === null };
}

/** Privacy assertion used by tests and telemetry boundaries. */
export function isPrivacySafeResolutionTelemetry(value: unknown): value is ContextualResolutionTelemetry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const forbidden = /caption|transcript|latitude|longitude|address|auth|token|rawQuery|queryText/i;
  return Object.keys(value as Record<string, unknown>).every((key) => !forbidden.test(key)) &&
    Object.values(value as Record<string, unknown>).every((item) =>
      item == null || ['string', 'number', 'boolean'].includes(typeof item));
}
