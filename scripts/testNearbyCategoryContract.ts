import assert from 'node:assert/strict';

import { nearbyPlacesForLocation } from '../lib/nearbyPlaces';
import { CATEGORY_FILTER_GROUPS, isNearrCategory } from '../lib/placeCategory';
import { OFFLINE_ONBOARDING_FIXTURES } from '../onboarding/fixtures/offlineOnboardingFixtures';
import type { SavedPlaceWithPlace } from '../types';

function saved(
  id: string,
  latitude: number,
  longitude: number,
  radiusValue = 1,
): SavedPlaceWithPlace {
  return {
    id,
    user_id: 'qa-user',
    place_id: `place-${id}`,
    radius_value: radiusValue,
    radius_unit: 'miles',
    notes: null,
    source_type: 'manual',
    source_url: null,
    notifications_enabled: true,
    last_notified_at: null,
    notification_count: 0,
    reminder_opportunity_count: 0,
    archived_at: null,
    visited_at: null,
    reminders_exhausted_at: null,
    category: 'restaurant',
    created_at: '2026-10-08T00:00:00.000Z',
    updated_at: '2026-10-08T00:00:00.000Z',
    place: {
      id: `place-${id}`,
      google_place_id: `google-${id}`,
      name: id,
      formatted_address: 'QA address',
      latitude,
      longitude,
      category: 'restaurant',
      google_maps_url: null,
      created_at: '2026-10-08T00:00:00.000Z',
    },
  };
}

const origin = { latitude: 34, longitude: -118 };
const results = nearbyPlacesForLocation([
  saved('far-away', 40.7128, -74.006),
  saved('nearer', 34.002, -118),
  saved('near', 34.006, -118),
  saved('ten-ish-miles', 34.145, -118, 15),
  saved('missing-coordinates', Number.NaN, Number.NaN, 15),
], origin);
assert.deepEqual(results.map((place) => place.id), ['nearer', 'near', 'ten-ish-miles']);
assert.ok(results[0].distanceMeters < results[1].distanceMeters);
assert.ok(results[2].distanceMeters <= 15 * 1609.344);
assert.equal(results.some((place) => place.id === 'far-away'), false, '322-mile outlier is excluded');
assert.equal(results.some((place) => place.id === 'missing-coordinates'), false);

const moved = nearbyPlacesForLocation([
  saved('old-location', 34.006, -118),
  saved('new-location', 37.775, -122.419),
], { latitude: 37.7749, longitude: -122.4194 });
assert.deepEqual(moved.map((place) => place.id), ['new-location'], 'membership recalculates from the new location');

assert.ok(CATEGORY_FILTER_GROUPS.food.includes('cafe'));
const madYolks = OFFLINE_ONBOARDING_FIXTURES.find((fixture) => fixture.assetKey === 'mad_yolks');
assert.equal(madYolks?.place.category, 'restaurant');
assert.equal(CATEGORY_FILTER_GROUPS.food.includes(madYolks!.place.category), true);
assert.equal(CATEGORY_FILTER_GROUPS.other.includes(madYolks!.place.category as never), false);
for (const fixture of OFFLINE_ONBOARDING_FIXTURES) {
  assert.equal(isNearrCategory(fixture.place.category), true, `${fixture.id} uses a canonical Nearr category`);
}

console.log('PASS Nearby radius, nearest-first ordering, food/cafe grouping, and fixture category contract');
