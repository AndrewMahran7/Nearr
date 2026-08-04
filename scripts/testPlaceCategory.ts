import assert from 'node:assert/strict';
import {
  CATEGORY_FILTER_GROUPS,
  GOOGLE_PRIMARY_TYPE_CATEGORY_MAP,
  NEARR_CATEGORIES,
  categoryMatchesFilter,
  displayCategory,
  mapGoogleType,
  resolvePlaceCategory,
  savedPlaceCategory,
  isCategoryFilterGroup,
} from '../lib/placeCategory';

const expected: Record<string, string> = {
  restaurant: 'restaurant', japanese_restaurant: 'restaurant', cafe: 'cafe', coffee_shop: 'cafe',
  bakery: 'bakery', donut_shop: 'bakery', pub: 'bar', resort_hotel: 'hotel', national_park: 'park',
  hiking_area: 'hiking_trail', beach: 'beach', observation_deck: 'scenic_spot', art_museum: 'museum',
  tourist_attraction: 'attraction', clothing_store: 'shopping', gym: 'fitness', spa: 'wellness',
  night_club: 'nightlife', international_airport: 'transportation', university: 'education',
};
for (const [type, category] of Object.entries(expected)) {
  assert.equal(mapGoogleType(type), category, `${type} maps to ${category}`);
}

assert.equal(Object.keys(GOOGLE_PRIMARY_TYPE_CATEGORY_MAP).includes('restaurant'), true);
assert.equal(resolvePlaceCategory({ userOverride: 'beach', googlePrimaryType: 'restaurant' }).category, 'beach');
assert.equal(resolvePlaceCategory({ userOverride: 'beach', googlePrimaryType: 'restaurant' }).source, 'user');
assert.equal(resolvePlaceCategory({ googlePrimaryType: 'hotel', ai: { category: 'restaurant', confidence: 1, modelVersion: 'test' } }).category, 'hotel');
assert.equal(resolvePlaceCategory({ googleTypes: ['point_of_interest', 'city_park'] }).category, 'park');
assert.equal(resolvePlaceCategory({ ai: { category: 'campground' as never, confidence: 2, modelVersion: 'test' } }).category, 'other');
assert.equal(resolvePlaceCategory({ ai: { category: 'attraction', confidence: 2, modelVersion: 'test' } }).confidence, 1);
assert.equal(resolvePlaceCategory({}).category, 'other');
assert.equal(displayCategory(null), 'other');
assert.equal(categoryMatchesFilter('beach', 'outdoors'), true);
assert.equal(categoryMatchesFilter('restaurant', 'cafes'), false);
assert.equal(categoryMatchesFilter(null, 'other'), true);
assert.equal(CATEGORY_FILTER_GROUPS.all.length, NEARR_CATEGORIES.length);
assert.equal(savedPlaceCategory({ category: 'museum', place: { category: 'restaurant' } }), 'museum');
assert.equal(savedPlaceCategory({ place: { google_primary_type: 'hiking_area' } }), 'hiking_trail');
assert.equal(savedPlaceCategory({ place: { category: null } }), 'other');
assert.equal(isCategoryFilterGroup('fitness_wellness'), true);
assert.equal(isCategoryFilterGroup('visited'), false);
assert.equal(new Set(NEARR_CATEGORIES).size, NEARR_CATEGORIES.length);

console.log('PASS Nearr category taxonomy and mapping');