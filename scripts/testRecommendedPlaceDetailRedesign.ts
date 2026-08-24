import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RECOMMENDATION_GALLERY_MAX_PHOTOS,
  recommendationHeroHeight,
  visibleRecommendationPhotoUrls,
} from '../lib/recommendationDetailUi';
import { buildExternalMapsUrl } from '../lib/externalMapsUrl';

const photos = Array.from({ length: 7 }, (_, index) => `https://img/${index + 1}.jpg`);

// Provider order is stable, galleries are capped, and legacy first-photo data
// remains a clean fallback without becoming a duplicate gallery page.
assert.deepEqual(
  visibleRecommendationPhotoUrls({ photoUrls: photos, photoUrl: 'https://thumb/1.jpg' }),
  photos.slice(0, RECOMMENDATION_GALLERY_MAX_PHOTOS),
);
assert.deepEqual(
  visibleRecommendationPhotoUrls({ photoUrls: [photos[0]], photoUrl: 'https://thumb/1.jpg' }),
  [photos[0]],
);
assert.deepEqual(visibleRecommendationPhotoUrls({ photoUrls: [], photoUrl: null }), []);
assert.deepEqual(
  visibleRecommendationPhotoUrls(
    { photoUrls: photos.slice(0, 3), photoUrl: null },
    { [photos[0]!]: true, [photos[1]!]: true, [photos[2]!]: true },
  ),
  [],
);

// Current supported phone widths retain a large but bounded hero.
for (const viewportWidth of [375, 390, 430]) {
  const carouselWidth = viewportWidth - 32;
  const height = recommendationHeroHeight(carouselWidth);
  assert.ok(height >= 280 && height <= 360, `${viewportWidth}pt hero remains bounded`);
}
assert.equal(recommendationHeroHeight(Number.NaN), 280);

const directionsUrl = buildExternalMapsUrl({
  google_maps_url: null,
  google_place_id: 'provider-id',
  latitude: 34.05,
  longitude: -118.25,
  name: 'Correct Destination',
  formatted_address: '123 Test Street',
});
assert.ok(directionsUrl?.includes('query_place_id=provider-id'));
assert.equal(
  buildExternalMapsUrl({
    google_maps_url: null,
    google_place_id: null,
    latitude: Number.NaN,
    longitude: Number.NaN,
    name: '',
    formatted_address: null,
  }),
  null,
  'invalid coordinates with no honest fallback fail safely',
);

const component = readFileSync(
  join(process.cwd(), 'components/map/RecommendedPlaceDetails.tsx'),
  'utf8',
);
const selected = readFileSync(
  join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'),
  'utf8',
);
const provider = readFileSync(join(process.cwd(), 'services/placesService.ts'), 'utf8');
const recommendationsService = readFileSync(
  join(process.cwd(), 'services/placeRecommendationsService.ts'),
  'utf8',
);

// Native paging and bounded opened-detail image rendering. Compact cards keep
// using only `entry.photoUrl`; gallery URLs are not rendered for hidden rows.
assert.match(component, /<FlatList/);
assert.match(component, /horizontal\s+.*pagingEnabled/s);
assert.match(component, /initialNumToRender=\{1\}/);
assert.match(component, /maxToRenderPerBatch=\{2\}/);
assert.match(component, /windowSize=\{3\}/);
assert.match(component, /safePhotoIndex \+ 1\} \/ \{photoUrls\.length/);
assert.match(component, /styles\.paginationDots/);
assert.match(component, /photoUrls\.length > 1/);
assert.match(component, /No place photos yet/);
assert.match(selected, /photoUrl: entry\.photoUrl/);
assert.doesNotMatch(selected, /photoUrls: entry\.photoUrls/);

// One existing Nearby Search, no per-recommendation Place Details/Text Search
// enrichment, and a hard five-reference cap.
assert.match(provider, /\/nearbysearch\/json\?/);
assert.match(provider, /\.slice\(0, 5\)/);
assert.doesNotMatch(recommendationsService, /getPlaceDetails|searchPlaces|getPlaceRichDetails/);

// Opening, Directions, and every dismiss path stay read-only. Only the
// explicit Save button reaches `onSave`, and the current map owner remains the
// canonical conversion/save/select path.
assert.match(component, /if \(!recommendation\) return null/);
assert.match(component, /onRequestClose=\{onClose\}/);
assert.match(component, /onPress=\{onClose\}/);
assert.match(component, /void openExternalMaps\(\{/);
assert.match(component, /const saved = await onSave\(recommendation\)/);
assert.match(component, /title="Save place"/);
assert.doesNotMatch(component, /Not saved until you choose Save place/);

// Missing fields never create empty separators, and long copy remains inside
// the scrollable sheet with deliberate wrapping.
assert.match(component, /filter\(Boolean\)\.join\(' · '\)/);
assert.match(component, /formattedAddress\?\.trim\(\) \|\| null/);
assert.match(component, /numberOfLines=\{3\}/);
assert.match(component, /<Text style=\{styles\.address\}>\{address\}<\/Text>/);
assert.match(component, /<ScrollView/);

console.log(
  'PASS nearby recommendation detail: multi/single/zero/failed photos, bounded paging, read-only interactions, metadata and width contracts',
);
