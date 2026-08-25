import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLACE_RECOMMENDATIONS_CACHE_TTL_MS,
  rankPlaceRecommendations,
  recommendationPhotoUrls,
  recommendationQueryForCategory,
  type PlaceRecommendationProviderCandidate,
  type PlaceRecommendationSource,
} from '../lib/placeRecommendations';
import { createPlaceRecommendationsLoader } from '../lib/placeRecommendationsLoader';

const source = (overrides: Partial<PlaceRecommendationSource> = {}): PlaceRecommendationSource => ({
  googlePlaceId: 'source-google',
  name: 'Anchor Restaurant',
  latitude: 34,
  longitude: -118,
  category: 'restaurant',
  ...overrides,
});

const candidate = (
  id: string,
  type = 'restaurant',
  latOffset = 0.005,
  overrides: Partial<PlaceRecommendationProviderCandidate> = {},
): PlaceRecommendationProviderCandidate => ({
  googlePlaceId: id,
  name: `Place ${id}`,
  formattedAddress: '123 Test St',
  latitude: 34 + latOffset,
  longitude: -118,
  category: type.replace(/_/g, ' '),
  rawTypes: [type, 'point_of_interest', 'establishment'],
  primaryType: type,
  primaryTypeDisplayName: null,
  googleMapsTypeLabel: null,
  shortFormattedAddress: null,
  googleMapsUrl: null,
  businessStatus: 'OPERATIONAL',
  rating: 4.5,
  userRatingsTotal: 100,
  photoUrls: [],
  photoUrl: null,
  ...overrides,
});

async function main() {

// Current place, existing saves, and duplicate provider identities.
assert.deepEqual(rankPlaceRecommendations(source(), [candidate('source-google')]), []);
assert.deepEqual(
  rankPlaceRecommendations(source(), [candidate('saved'), candidate('new')], {
    savedGooglePlaceIds: ['saved'],
  }).map((entry) => entry.googlePlaceId),
  ['new'],
);
assert.equal(rankPlaceRecommendations(source(), [candidate('dupe'), candidate('dupe')]).length, 1);

// The full provider gallery survives ranking, while legacy first-photo data
// remains a clean fallback. Blank and duplicate URLs never become pages.
{
  const photos = ['https://img/one.jpg', 'https://img/two.jpg'];
  const [result] = rankPlaceRecommendations(source(), [
    candidate('gallery', 'restaurant', 0.005, { photoUrls: photos, photoUrl: photos[0]! }),
  ]);
  assert.deepEqual(result?.photoUrls, photos);
  assert.deepEqual(recommendationPhotoUrls(result), photos);
  assert.deepEqual(
    recommendationPhotoUrls({ photoUrls: [' ', photos[0], photos[0]], photoUrl: photos[1] }),
    [photos[0]],
  );
  assert.deepEqual(recommendationPhotoUrls({ photoUrl: photos[0] }), [photos[0]]);
  assert.deepEqual(recommendationPhotoUrls(null), []);
}

// A relevant restaurant beats (and filters out) an unrelated gas station.
{
  const result = rankPlaceRecommendations(source(), [
    candidate('gas', 'gas_station', 0.001, { rating: 5, userRatingsTotal: 10_000 }),
    candidate('food', 'restaurant', 0.02, { rating: null, userRatingsTotal: null }),
  ]);
  assert.deepEqual(result.map((entry) => entry.googlePlaceId), ['food']);
}

// Proximity matters among relevant options but is not the only signal.
{
  const result = rankPlaceRecommendations(source(), [
    candidate('far', 'restaurant', 0.03, { rating: 3.5, userRatingsTotal: 10 }),
    candidate('near', 'restaurant', 0.002, { rating: 4.5, userRatingsTotal: 500 }),
  ]);
  assert.equal(result[0]?.googlePlaceId, 'near');
}

// Unknown category fallback remains conservative.
assert.deepEqual(
  rankPlaceRecommendations(source({ category: 'other' }), [
    candidate('museum', 'museum'),
    candidate('utility', 'gas_station'),
  ]).map((entry) => entry.googlePlaceId),
  ['museum'],
);

// Never pad; omit closed or unsafe rows.
assert.equal(rankPlaceRecommendations(source(), [candidate('one'), candidate('two')]).length, 2);
assert.deepEqual(rankPlaceRecommendations(source(), [
  candidate('closed', 'restaurant', 0.002, { businessStatus: 'CLOSED_PERMANENTLY' }),
  candidate('missing-name', 'restaurant', 0.003, { name: '  ' }),
  candidate('poor', 'restaurant', 0.001, { rating: 2.5, userRatingsTotal: 50 }),
]), []);

// Coordinates-only sources work without inventing a provider identity, while
// same-name/same-point results are still recognized as the current place.
{
  const coordinatesOnly = source({ googlePlaceId: null, name: 'Anchor Restaurant' });
  const result = rankPlaceRecommendations(coordinatesOnly, [
    candidate('same', 'restaurant', 0, { name: 'Provider Alias For Anchor' }),
    candidate('nearby', 'restaurant', 0.004),
  ]);
  assert.deepEqual(result.map((entry) => entry.googlePlaceId), ['nearby']);
}

// Provider failure is quiet and nonfatal.
{
  const load = createPlaceRecommendationsLoader(async () => {
    throw new Error('offline');
  });
  assert.deepEqual(await load({ source: source() }), []);
}

// One provider call per cache window, including coordinates-only sources.
{
  let calls = 0;
  let clock = 1_000;
  const requests: Array<{ latitude: number; longitude: number; radiusMeters: number; type?: string }> = [];
  const load = createPlaceRecommendationsLoader(async (args) => {
    calls += 1;
    requests.push(args);
    return [candidate(`result-${calls}`)];
  }, () => clock);
  const coordinatesOnly = source({ googlePlaceId: null });
  await load({ source: coordinatesOnly });
  await load({ source: coordinatesOnly });
  assert.equal(calls, 1);
  assert.equal(requests[0]?.latitude, coordinatesOnly.latitude);
  assert.equal(requests[0]?.longitude, coordinatesOnly.longitude);
  clock += PLACE_RECOMMENDATIONS_CACHE_TTL_MS + 1;
  await load({ source: coordinatesOnly });
  assert.equal(calls, 2);
}

assert.deepEqual(recommendationQueryForCategory('restaurant'), {
  radiusMeters: 5_000,
  providerType: 'restaurant',
});
assert.deepEqual(recommendationQueryForCategory('beach'), {
  radiusMeters: 20_000,
  providerType: 'tourist_attraction',
});
assert.deepEqual(recommendationQueryForCategory('hotel'), { radiusMeters: 8_000 });
assert.deepEqual(recommendationQueryForCategory('attraction'), {
  radiusMeters: 8_000,
  providerType: 'tourist_attraction',
});

// Interaction contract: opening is read-only; only the explicit save control
// enters the existing canonical save-and-select path.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  const recommended = readFileSync(join(process.cwd(), 'components/map/RecommendedPlaceDetails.tsx'), 'utf8');
  const map = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
  assert.ok(detail.includes('setSelectedRecommendation(entry)'));
  assert.ok(detail.includes("trackEvent('recommendation_opened'"));
  assert.ok(!recommended.includes('Not saved until you choose Save place.'));
  assert.ok(recommended.includes('title="Save place"'));
  assert.ok(recommended.includes('pagingEnabled'));
  assert.ok(recommended.includes('initialNumToRender={1}'));
  assert.ok(recommended.includes('maxToRenderPerBatch={2}'));
  assert.ok(recommended.includes('windowSize={3}'));
  assert.ok(recommended.includes('visibleRecommendationPhotoUrls(recommendation, failedPhotoUrls)'));
  assert.ok(recommended.includes('onRequestClose={onClose}'));
  assert.ok(recommended.includes('void openExternalMaps({'));
  assert.ok(recommended.includes('const saved = await onSave(recommendation)'));
  assert.ok(recommended.includes('setFailedPhotoUrls'));
  assert.ok(recommended.includes('No place photos yet'));
  assert.ok(recommended.includes('numberOfLines={3}'));
  assert.ok(recommended.includes("filter(Boolean).join(' · ')"));
  assert.ok(map.includes("handleSavePlaceCandidate(candidate, 'recommendation')"));
  assert.ok(map.includes("selectPlace(result.saved, { focusCamera: flow === 'map_search' })"));
  assert.ok(!/onPress:\s*\(\)\s*=>\s*onSaveRecommendation/.test(detail));
}

// The row needs no per-candidate details enrichment.
{
  const provider = readFileSync(join(process.cwd(), 'services/placesService.ts'), 'utf8');
  const service = readFileSync(join(process.cwd(), 'services/placeRecommendationsService.ts'), 'utf8');
  assert.ok(provider.includes('/nearbysearch/json?'));
  assert.ok(provider.includes('user_ratings_total'));
  assert.ok(provider.includes('.slice(0, 5)'));
  assert.ok(provider.includes('photoUrls,'));
  assert.ok(!service.includes('getPlaceDetails('));
  assert.ok(!service.includes('getPlaceRichDetails('));
}

// Rollout contract: explicitly configured and default-off through the existing
// feature flag resolver; no EAS environment is changed by this branch.
{
  const flags = readFileSync(join(process.cwd(), 'lib/featureFlags.ts'), 'utf8');
  const config = readFileSync(join(process.cwd(), 'app.config.js'), 'utf8');
  assert.ok(flags.includes('EXPO_PUBLIC_PLACE_RECOMMENDATIONS_ENABLED'));
  assert.ok(flags.includes("readExtra('placeRecommendationsEnabled')"));
  assert.ok(config.includes('placeRecommendationsEnabled:'));
}

console.log('Place recommendations tests passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
