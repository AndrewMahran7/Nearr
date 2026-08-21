import {
  PLACE_RECOMMENDATIONS_CACHE_TTL_MS,
  PLACE_RECOMMENDATIONS_VERSION,
  rankPlaceRecommendations,
  recommendationQueryForCategory,
  type PlaceRecommendation,
  type PlaceRecommendationProviderCandidate,
  type PlaceRecommendationSource,
} from './placeRecommendations';

export type PlaceRecommendationsInput = {
  source: PlaceRecommendationSource;
  savedGooglePlaceIds?: Iterable<string>;
};

export type NearbyRecommendationLoader = (args: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  type?: string;
}) => Promise<PlaceRecommendationProviderCandidate[]>;

type CacheEntry = { expiresAt: number; candidates: PlaceRecommendationProviderCandidate[] };

function cacheKey(source: PlaceRecommendationSource): string {
  const identity = source.googlePlaceId?.trim()
    ? `google:${source.googlePlaceId.trim()}`
    : `coords:${source.latitude.toFixed(5)},${source.longitude.toFixed(5)}`;
  return `${PLACE_RECOMMENDATIONS_VERSION}:${identity}:${source.category}`;
}

/** Pure injectable loader: TTL cache, in-flight dedupe, quiet failure. */
export function createPlaceRecommendationsLoader(
  fetchNearby: NearbyRecommendationLoader,
  now: () => number = Date.now,
) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<PlaceRecommendationProviderCandidate[]>>();

  return async function loadPlaceRecommendations(
    input: PlaceRecommendationsInput,
  ): Promise<PlaceRecommendation[]> {
    const source = input.source;
    if (!Number.isFinite(source.latitude) || !Number.isFinite(source.longitude)) return [];
    const query = recommendationQueryForCategory(source.category);
    const key = cacheKey(source);
    let candidates: PlaceRecommendationProviderCandidate[];
    const cached = cache.get(key);

    if (cached && cached.expiresAt > now()) {
      candidates = cached.candidates;
    } else {
      let request = inFlight.get(key);
      if (!request) {
        request = fetchNearby({
          latitude: source.latitude,
          longitude: source.longitude,
          radiusMeters: query.radiusMeters,
          type: query.providerType,
        });
        inFlight.set(key, request);
      }
      try {
        candidates = await request;
        cache.set(key, { candidates, expiresAt: now() + PLACE_RECOMMENDATIONS_CACHE_TTL_MS });
      } catch (error) {
        console.debug('[places] recommendations unavailable', {
          source: source.googlePlaceId ? 'google_place_id' : 'coordinates',
          message: error instanceof Error ? error.message : String(error),
        });
        return [];
      } finally {
        inFlight.delete(key);
      }
    }

    return rankPlaceRecommendations(source, candidates, {
      savedGooglePlaceIds: input.savedGooglePlaceIds,
      radiusMeters: query.radiusMeters,
    });
  };
}
