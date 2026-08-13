import assert from 'node:assert/strict';
import {
  CATEGORY_FILTER_GROUPS,
  CATEGORY_LABELS,
  GOOGLE_PRIMARY_TYPE_CATEGORY_MAP,
  NEARR_CATEGORIES,
  categoryMatchesFilter,
  displayCategory,
  isCategoryFilterGroup,
  mapGoogleType,
  resolvePlaceCategory,
  savedPlaceCategory,
  type NearrCategory,
} from '../lib/placeCategory';

const providerCases: Record<string, NearrCategory> = {
  // Food and drink.
  restaurant: 'restaurant', japanese_restaurant: 'restaurant', cafe: 'cafe', coffee_shop: 'cafe',
  bakery: 'bakery', pub: 'bar', brewery: 'brewery', brewpub: 'brewery', winery: 'winery',
  vineyard: 'winery', ice_cream_shop: 'dessert', candy_store: 'dessert', donut_shop: 'dessert',
  // Stay.
  hotel: 'hotel', lodging: 'hotel', resort_hotel: 'resort',
  // Outdoors.
  hiking_area: 'hiking_trail', hiking_trail: 'hiking_trail', trailhead: 'hiking_trail',
  national_park: 'park', regional_park: 'park', beach: 'beach', waterfall: 'waterfall',
  lake: 'lake', marina: 'marina', island: 'island', scenic_spot: 'scenic_spot',
  // Things to do, health, and utility.
  art_museum: 'museum', tourist_attraction: 'attraction', clothing_store: 'shopping',
  movie_theater: 'entertainment', night_club: 'nightlife', stadium: 'sports',
  gym: 'fitness', yoga_studio: 'fitness', spa: 'wellness', sauna: 'wellness',
  international_airport: 'transportation', university: 'education', dentist: 'service',
};
for (const [type, category] of Object.entries(providerCases)) {
  assert.equal(mapGoogleType(type), category, `${type} maps to ${category}`);
}

assert.equal(mapGoogleType('establishment'), null);
assert.equal(mapGoogleType('point_of_interest'), null);
assert.equal(Object.keys(GOOGLE_PRIMARY_TYPE_CATEGORY_MAP).includes('restaurant'), true);

// Provider precedence: a trustworthy primary wins, generic primary types do
// not hide a better supporting type, and supporting types use specificity
// rather than Google's array order.
assert.equal(resolvePlaceCategory({ placeName: 'Bakery', googlePrimaryType: 'bakery', ai: { category: 'cafe', confidence: 1, modelVersion: 'test' } }).category, 'bakery');
assert.equal(resolvePlaceCategory({ googlePrimaryType: 'establishment', googleTypes: ['point_of_interest', 'city_park'] }).category, 'park');
assert.equal(resolvePlaceCategory({ googleTypes: ['restaurant', 'brewery', 'food'] }).category, 'brewery');
assert.equal(resolvePlaceCategory({ googleTypes: ['restaurant', 'ice_cream_shop'] }).category, 'dessert');
assert.equal(resolvePlaceCategory({ googleTypes: ['lodging', 'resort_hotel'] }).category, 'resort');
assert.equal(resolvePlaceCategory({ googlePrimaryType: 'tourist_attraction' }).category, 'attraction');

// Deterministic type/name refinement comes after specific provider data but
// before the existing structured-media category hint.
assert.equal(resolvePlaceCategory({ placeName: 'Santa Cruz Mountain Brewing', googlePrimaryType: 'food', googleTypes: ['food', 'establishment'] }).category, 'brewery');
assert.equal(resolvePlaceCategory({ placeName: 'Alma Winery', googleTypes: ['establishment'] }).category, 'winery');
assert.equal(resolvePlaceCategory({ placeName: 'Mr Tokyo Japanese Restaurant' }).category, 'restaurant');
assert.equal(resolvePlaceCategory({ placeName: 'Summit Spa Resort', googleTypes: ['lodging', 'establishment'] }).category, 'resort');
assert.equal(resolvePlaceCategory({ placeName: 'Mystery Venue', googlePrimaryType: 'point_of_interest', ai: { category: 'hiking_trail', confidence: 0.88, modelVersion: 'media-test' } }).category, 'hiking_trail');
assert.equal(resolvePlaceCategory({ placeName: 'Mystery Venue', googlePrimaryType: 'point_of_interest', ai: { category: 'hiking_trail', confidence: 0.88, modelVersion: 'media-test' } }).source, 'ai');

const naturalTypes = ['establishment', 'natural_feature'];
const regressionCases: Array<[string, NearrCategory, readonly string[] | undefined]> = [
  ['Corlieu Falls', 'waterfall', naturalTypes],
  ['Woods Cove', 'beach', naturalTypes],
  ['Escondido Falls', 'waterfall', ['establishment', 'point_of_interest', 'tourist_attraction']],
  ['Barrett-Stoddard Canyon Falls', 'waterfall', undefined],
  ['Point Lobos State Natural Reserve', 'park', ['park', 'tourist_attraction']],
  ['June Lake Marina', 'marina', undefined],
  ['Santiago Oaks Regional Park', 'park', undefined],
  ['Strawberry Peak', 'hiking_trail', naturalTypes],
  ['Josephine Peak', 'hiking_trail', undefined],
  ['Big Sur River Gorge', 'scenic_spot', undefined],
  ['Little Colorado River', 'scenic_spot', naturalTypes],
  ['Blue Cave', 'scenic_spot', ['natural_feature', 'tourist_attraction']],
  ['The Best Scenic Road in Kyrgyzstan', 'scenic_spot', ['establishment', 'point_of_interest']],
  ['Santa Paula Punch Bowls', 'scenic_spot', undefined],
  ['Santa Cruz Mountain Brewing', 'brewery', ['food', 'establishment']],
];
for (const [placeName, category, googleTypes] of regressionCases) {
  const resolution = resolvePlaceCategory({ placeName, googleTypes });
  assert.equal(resolution.category, category, `${placeName} becomes ${category}`);
  assert.equal(resolution.source, googleTypes?.some((type) => mapGoogleType(type)) ? resolution.source : 'deterministic');
}

// Lokrum's legacy provider data is only "natural_feature". Structured media
// evidence can safely refine that generic provider shape to Island.
assert.equal(resolvePlaceCategory({
  placeName: 'Lokrum',
  googleTypes: naturalTypes,
  ai: { category: 'island', confidence: 0.94, modelVersion: 'media-test', evidenceTags: ['visible_island'] },
}).category, 'island');

// Name heuristics are contextual and guarded against business-name traps.
assert.notEqual(resolvePlaceCategory({ placeName: 'Island Grill', googleTypes: ['establishment', 'point_of_interest'] }).category, 'island');
assert.notEqual(resolvePlaceCategory({ placeName: 'Falls Dental', googleTypes: ['establishment', 'point_of_interest'] }).category, 'waterfall');
assert.notEqual(resolvePlaceCategory({ placeName: 'Falls Church Cafe', googleTypes: ['establishment'] }).category, 'waterfall');
assert.equal(resolvePlaceCategory({ placeName: 'Island Grill', googlePrimaryType: 'restaurant' }).category, 'restaurant');
assert.equal(resolvePlaceCategory({ placeName: 'Falls Dental', googlePrimaryType: 'dentist' }).category, 'service');
assert.equal(resolvePlaceCategory({ googlePrimaryType: 'point_of_interest' }).category, 'other');

// Genuine legacy overrides remain durable, but no new save path supplies one.
assert.equal(resolvePlaceCategory({ userOverride: 'beach', googlePrimaryType: 'restaurant' }).category, 'beach');
assert.equal(resolvePlaceCategory({ userOverride: 'beach', googlePrimaryType: 'restaurant' }).source, 'user');
assert.equal(resolvePlaceCategory({ ai: { category: 'campground' as never, confidence: 2, modelVersion: 'test' } }).category, 'other');
assert.equal(resolvePlaceCategory({ ai: { category: 'attraction', confidence: 2, modelVersion: 'test' } }).confidence, 1);
assert.equal(resolvePlaceCategory({}).category, 'other');

// Presentation/filter contract contains every normalized category and no raw
// provider types.
assert.equal(displayCategory(null), 'other');
assert.equal(CATEGORY_LABELS.hiking_trail, 'Hiking');
assert.equal(CATEGORY_LABELS.scenic_spot, 'Scenic Spot');
assert.equal(categoryMatchesFilter('waterfall', 'outdoors'), true);
assert.equal(categoryMatchesFilter('marina', 'outdoors'), true);
assert.equal(categoryMatchesFilter('resort', 'hotels'), true);
assert.equal(categoryMatchesFilter('brewery', 'food'), true);
assert.equal(categoryMatchesFilter('restaurant', 'cafes'), false);
assert.equal(categoryMatchesFilter(null, 'other'), true);
assert.equal(CATEGORY_FILTER_GROUPS.all.length, NEARR_CATEGORIES.length);
assert.equal(savedPlaceCategory({ category: 'museum', place: { category: 'restaurant' } }), 'museum');
assert.equal(savedPlaceCategory({ place: { name: 'June Lake Marina', google_primary_type: 'establishment', google_types: naturalTypes as string[] } }), 'marina');
assert.equal(savedPlaceCategory({ place: { category: null } }), 'other');
assert.equal(isCategoryFilterGroup('fitness_wellness'), true);
assert.equal(isCategoryFilterGroup('visited'), false);
assert.equal(new Set(NEARR_CATEGORIES).size, NEARR_CATEGORIES.length);
assert.deepEqual(Object.keys(CATEGORY_LABELS).sort(), [...NEARR_CATEGORIES].sort());

console.log('PASS expanded Nearr taxonomy, provider precedence, guarded fallback, regressions, and filters');
