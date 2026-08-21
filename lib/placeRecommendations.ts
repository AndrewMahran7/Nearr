/**
 * Pure filtering and ranking for Place Recommendations V1.
 *
 * This module deliberately has no provider, storage, React, or analytics code.
 * Google results enter as a small normalized shape; deterministic rules remove
 * unsafe/irrelevant candidates and return at most five useful suggestions.
 */

import { distanceMeters } from './geo';
import {
  resolvePlaceCategory,
  type NearrCategory,
} from './placeCategory';

export const PLACE_RECOMMENDATIONS_VERSION = 'v1';
export const PLACE_RECOMMENDATIONS_LIMIT = 5;
export const PLACE_RECOMMENDATIONS_CACHE_TTL_MS = 10 * 60 * 1000;

const FOOD = new Set<NearrCategory>([
  'restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert',
]);
const OUTDOORS = new Set<NearrCategory>([
  'hiking_trail', 'park', 'beach', 'waterfall', 'lake', 'marina', 'island',
  'scenic_spot',
]);
const THINGS_TO_DO = new Set<NearrCategory>([
  'attraction', 'museum', 'entertainment', 'nightlife', 'sports',
]);
const STAYS = new Set<NearrCategory>(['hotel', 'resort']);
const LOW_VALUE_FALLBACK = new Set<NearrCategory>([
  'transportation', 'education', 'service', 'other',
]);

export type PlaceRecommendationSource = {
  googlePlaceId?: string | null;
  name: string;
  latitude: number;
  longitude: number;
  category: NearrCategory;
};

export type PlaceRecommendationProviderCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  rawTypes?: string[];
  primaryType?: string | null;
  primaryTypeDisplayName?: string | null;
  googleMapsTypeLabel?: string | null;
  shortFormattedAddress?: string | null;
  googleMapsUrl: string | null;
  businessStatus?: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  photoUrl: string | null;
};

export type PlaceRecommendation = PlaceRecommendationProviderCandidate & {
  nearrCategory: NearrCategory;
  distanceMeters: number;
  relevanceTier: number;
  score: number;
};

export type PlaceRecommendationQuery = {
  radiusMeters: number;
  providerType?: string;
};

/** One category-derived radius and at most one provider type = one query. */
export function recommendationQueryForCategory(
  category: NearrCategory,
): PlaceRecommendationQuery {
  if (OUTDOORS.has(category)) {
    return { radiusMeters: 20_000, providerType: 'tourist_attraction' };
  }
  if (STAYS.has(category)) {
    // Hotels benefit from a mixed nearby result set: stays, food, and things
    // to do. Omitting `type` is intentional and still produces one request.
    return { radiusMeters: 8_000 };
  }
  if (category === 'restaurant') return { radiusMeters: 5_000, providerType: 'restaurant' };
  if (category === 'cafe') return { radiusMeters: 5_000, providerType: 'cafe' };
  if (category === 'bakery' || category === 'dessert') {
    return { radiusMeters: 5_000, providerType: 'bakery' };
  }
  if (['bar', 'brewery', 'winery', 'nightlife'].includes(category)) {
    return { radiusMeters: 5_000, providerType: 'bar' };
  }
  if (THINGS_TO_DO.has(category)) {
    return { radiusMeters: 8_000, providerType: 'tourist_attraction' };
  }
  if (category === 'shopping') return { radiusMeters: 5_000, providerType: 'shopping_mall' };
  if (category === 'fitness') return { radiusMeters: 5_000, providerType: 'gym' };
  if (category === 'wellness') return { radiusMeters: 5_000, providerType: 'spa' };
  return { radiusMeters: 5_000 };
}

function categoryForCandidate(candidate: PlaceRecommendationProviderCandidate): NearrCategory {
  return resolvePlaceCategory({
    placeName: candidate.name,
    googlePrimaryType: candidate.primaryType,
    googleTypes: candidate.rawTypes,
  }).category;
}

/**
 * 3 = same category, 2 = strongly compatible, 1 = useful secondary match,
 * 0 = unrelated and therefore excluded for a known category.
 */
export function recommendationRelevanceTier(
  source: NearrCategory,
  candidate: NearrCategory,
): number {
  if (source === candidate && source !== 'other') return 3;
  if (FOOD.has(source)) return FOOD.has(candidate) ? 2 : 0;
  if (OUTDOORS.has(source)) return OUTDOORS.has(candidate) || candidate === 'attraction' ? 2 : 0;
  if (STAYS.has(source)) {
    if (STAYS.has(candidate)) return 2;
    if (FOOD.has(candidate) || OUTDOORS.has(candidate) || THINGS_TO_DO.has(candidate)) return 1;
    return 0;
  }
  if (THINGS_TO_DO.has(source)) {
    if (THINGS_TO_DO.has(candidate) || OUTDOORS.has(candidate)) return 2;
    if (FOOD.has(candidate)) return 1;
    return 0;
  }
  if (source === 'fitness' || source === 'wellness') {
    return candidate === 'fitness' || candidate === 'wellness' ? 2 : 0;
  }
  if (source === 'shopping') return candidate === 'shopping' ? 2 : candidate === 'cafe' ? 1 : 0;

  // Unknown/utility anchors get a conservative, quality-and-distance fallback.
  // Gas stations and similar utility results resolve to one of these buckets
  // (or `other`) and are intentionally not discovery filler.
  return LOW_VALUE_FALLBACK.has(candidate) ? 0 : 1;
}

function finiteCoordinate(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSameCoordinatesOnlyPlace(
  source: PlaceRecommendationSource,
  meters: number,
): boolean {
  if (source.googlePlaceId) return false;
  // With no provider identity, a result effectively on the anchor coordinate
  // is the safest available current-place match. Do not invent an identity or
  // risk recommending the source back to the user under a provider alias.
  return meters <= 25;
}

function qualityScore(candidate: PlaceRecommendationProviderCandidate): number {
  const rating = candidate.rating;
  const ratingPoints = typeof rating === 'number' && Number.isFinite(rating)
    ? Math.max(0, Math.min(12, (rating / 5) * 12))
    : 0;
  const reviews = candidate.userRatingsTotal;
  const reviewPoints = typeof reviews === 'number' && Number.isFinite(reviews) && reviews > 0
    ? Math.min(8, Math.log10(reviews + 1) * 2.5)
    : 0;
  return ratingPoints + reviewPoints;
}

function isClearlyLowQuality(candidate: PlaceRecommendationProviderCandidate): boolean {
  return (
    typeof candidate.rating === 'number' &&
    Number.isFinite(candidate.rating) &&
    candidate.rating < 3 &&
    typeof candidate.userRatingsTotal === 'number' &&
    Number.isFinite(candidate.userRatingsTotal) &&
    candidate.userRatingsTotal >= 10
  );
}

/**
 * Score weights (kept exact and readable):
 *   category relevance: tier * 40 (40 / 80 / 120)
 *   proximity:          35 down to 0 across the query radius
 *   rating:             up to 12
 *   review count:       up to 8 (log scaled)
 */
export function rankPlaceRecommendations(
  source: PlaceRecommendationSource,
  candidates: readonly PlaceRecommendationProviderCandidate[],
  options?: {
    savedGooglePlaceIds?: Iterable<string>;
    radiusMeters?: number;
    limit?: number;
  },
): PlaceRecommendation[] {
  if (
    !finiteCoordinate(source.latitude) ||
    !finiteCoordinate(source.longitude) ||
    Math.abs(source.latitude) > 90 ||
    Math.abs(source.longitude) > 180
  ) return [];

  const query = recommendationQueryForCategory(source.category);
  const radiusMeters = Math.max(1, options?.radiusMeters ?? query.radiusMeters);
  const limit = Math.max(0, Math.min(PLACE_RECOMMENDATIONS_LIMIT, Math.floor(
    options?.limit ?? PLACE_RECOMMENDATIONS_LIMIT,
  )));
  if (limit === 0) return [];

  const excludedIds = new Set<string>();
  for (const id of options?.savedGooglePlaceIds ?? []) {
    if (typeof id === 'string' && id.trim()) excludedIds.add(id.trim());
  }
  if (source.googlePlaceId?.trim()) excludedIds.add(source.googlePlaceId.trim());

  const seenIds = new Set<string>();
  const ranked: PlaceRecommendation[] = [];
  for (const candidate of candidates) {
    const id = candidate?.googlePlaceId?.trim();
    if (!id || seenIds.has(id) || excludedIds.has(id)) continue;
    seenIds.add(id);
    if (!candidate.name?.trim()) continue;
    if (
      !finiteCoordinate(candidate.latitude) ||
      !finiteCoordinate(candidate.longitude) ||
      Math.abs(candidate.latitude) > 90 ||
      Math.abs(candidate.longitude) > 180
    ) continue;
    if (candidate.businessStatus && candidate.businessStatus !== 'OPERATIONAL') continue;
    // A lone low rating can be noise. Ten or more reviews below 3.0 is a
    // strong enough V1 signal to omit rather than padding the row with junk.
    if (isClearlyLowQuality(candidate)) continue;

    const meters = distanceMeters(
      { latitude: source.latitude, longitude: source.longitude },
      { latitude: candidate.latitude, longitude: candidate.longitude },
    );
    if (!Number.isFinite(meters) || meters > radiusMeters) continue;
    if (isSameCoordinatesOnlyPlace(source, meters)) continue;

    const nearrCategory = categoryForCandidate(candidate);
    const relevanceTier = recommendationRelevanceTier(source.category, nearrCategory);
    if (relevanceTier === 0) continue;

    const proximityScore = 35 * Math.max(0, 1 - meters / radiusMeters);
    const score = relevanceTier * 40 + proximityScore + qualityScore(candidate);
    ranked.push({ ...candidate, nearrCategory, distanceMeters: meters, relevanceTier, score });
  }

  return ranked
    .sort((a, b) =>
      b.score - a.score ||
      a.distanceMeters - b.distanceMeters ||
      a.googlePlaceId.localeCompare(b.googlePlaceId),
    )
    .slice(0, limit);
}
