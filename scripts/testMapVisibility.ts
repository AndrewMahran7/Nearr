/**
 * scripts/testMapVisibility.ts
 *
 * Map visibility rules (lib/mapVisibility.ts): category filtering of markers
 * and the zone-circle density policy. Both are presentation-only — nothing
 * here may mutate a saved place or change reminder semantics.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAP_FILTER_ALL,
  ZONE_CIRCLE_DENSITY_LIMIT,
  filterPlacesForMap,
  isMapFilterActive,
  mapFilterEmptyMessage,
  mapFilterGroupForPlace,
  mapFilterLabel,
  mapFilterOptions,
  shouldRenderZoneCircle,
} from '../lib/mapVisibility';
import type { SavedPlaceWithPlace } from '../types';

let seq = 0;
function place(category: string, patch: Partial<SavedPlaceWithPlace> = {}): SavedPlaceWithPlace {
  seq += 1;
  return {
    id: `saved-${seq}`,
    category,
    archived_at: null,
    visited_at: null,
    place: {
      id: `place-${seq}`,
      name: `Place ${seq}`,
      latitude: 33.4 + seq * 0.01,
      longitude: -117.6 - seq * 0.01,
      category,
    },
    ...patch,
  } as unknown as SavedPlaceWithPlace;
}

const restaurant = place('restaurant');
const cafe = place('cafe');
const beach = place('beach');
const hotel = place('hotel');
const museum = place('museum');
const collection = [restaurant, cafe, beach, hotel, museum];

// --- 1. All shows every eligible place --------------------------------------
{
  assert.equal(filterPlacesForMap(collection, MAP_FILTER_ALL).length, 5);
  assert.equal(isMapFilterActive(MAP_FILTER_ALL), false);
  assert.equal(mapFilterLabel(MAP_FILTER_ALL), 'All places');
  // Returns a copy — the map must never mutate the array it was handed.
  const out = filterPlacesForMap(collection, MAP_FILTER_ALL);
  out.pop();
  assert.equal(collection.length, 5, 'source collection is never mutated');
}

// --- 2 + 3. One group filter, categories grouped by the browse sections -----
{
  const food = filterPlacesForMap(collection, 'food_drink');
  assert.deepEqual(food.map((p) => p.id), [restaurant.id, cafe.id], 'restaurant and cafe group together');
  assert.equal(isMapFilterActive('food_drink'), true);
  assert.equal(mapFilterLabel('food_drink'), 'Food & drink');

  assert.deepEqual(filterPlacesForMap(collection, 'outdoors').map((p) => p.id), [beach.id]);
  assert.deepEqual(filterPlacesForMap(collection, 'stays').map((p) => p.id), [hotel.id]);
  assert.deepEqual(filterPlacesForMap(collection, 'things_to_do').map((p) => p.id), [museum.id]);

  assert.equal(mapFilterGroupForPlace(restaurant), 'food_drink');
  assert.equal(mapFilterGroupForPlace(beach), 'outdoors');
  assert.equal(mapFilterGroupForPlace(hotel), 'stays');
}

// Chip options: only groups with places, All first, counts correct.
{
  const options = mapFilterOptions(collection);
  assert.equal(options[0]?.id, MAP_FILTER_ALL);
  assert.equal(options[0]?.count, 5);
  assert.deepEqual(
    options.slice(1).map((o) => o.id),
    ['food_drink', 'stays', 'outdoors', 'things_to_do'],
    'only non-empty groups, in browse-section order',
  );
  assert.equal(options.find((o) => o.id === 'food_drink')?.count, 2);
  assert.ok(!options.some((o) => o.id === 'shopping'), 'a group with no places is never offered');
}

// A collection that is entirely one group offers no chips — filtering would be
// a guaranteed no-op, so the row stays out of the way for small collections.
{
  assert.deepEqual(mapFilterOptions([restaurant, cafe]), []);
  assert.deepEqual(mapFilterOptions([]), []);
  assert.deepEqual(mapFilterOptions(null), []);
}

// --- 4. Empty filter result -------------------------------------------------
{
  assert.deepEqual(filterPlacesForMap([restaurant], 'outdoors'), []);
  assert.equal(mapFilterEmptyMessage('outdoors'), 'Nothing saved under outdoors yet');
  assert.equal(mapFilterEmptyMessage(MAP_FILTER_ALL), 'No saved places yet');
}

// --- 5. Unknown / Other category behavior -----------------------------------
{
  const weird = place('definitely-not-a-category');
  const missing = { id: 'x', place: null } as unknown as SavedPlaceWithPlace;
  assert.equal(mapFilterGroupForPlace(weird), 'other', 'unknown categories land in Other');
  assert.doesNotThrow(() => mapFilterGroupForPlace(missing));
  assert.deepEqual(filterPlacesForMap([weird], 'other').map((p) => p.id), [weird.id]);
  // An unknown filter id is treated as All rather than hiding the whole map.
  assert.equal(isMapFilterActive('not_a_group'), false);
  assert.equal(filterPlacesForMap(collection, 'not_a_group').length, 5);
}

// --- 6. Archived / visited stay intentional ---------------------------------
{
  const archived = place('restaurant', { archived_at: '2026-01-01T00:00:00Z' });
  const visited = place('restaurant', { visited_at: '2026-01-01T00:00:00Z' });
  // Filtering is category-only; it must not quietly change archive semantics.
  assert.equal(filterPlacesForMap([archived, visited], 'food_drink').length, 2);
  // Archived places never draw a reminder zone, matching prior behavior.
  assert.equal(
    shouldRenderZoneCircle({ isSelected: false, hasSelection: false, isArchived: true, visibleCount: 1 }),
    false,
  );
  assert.equal(
    shouldRenderZoneCircle({ isSelected: true, hasSelection: true, isArchived: true, visibleCount: 1 }),
    false,
    'even selected, an archived place draws no zone',
  );
}

// --- 7. Selected / deep-linked place under an incompatible filter -----------
{
  const kept = filterPlacesForMap(collection, 'food_drink', beach.id);
  assert.ok(kept.some((p) => p.id === beach.id), 'the focused place stays visible under any filter');
  assert.equal(kept.length, 3, 'and the filter still applies to everything else');
  // Without a pinned id it is correctly hidden.
  assert.ok(!filterPlacesForMap(collection, 'food_drink').some((p) => p.id === beach.id));
  // A pinned id that is not in the collection changes nothing.
  assert.equal(filterPlacesForMap(collection, 'food_drink', 'ghost').length, 2);
}

// --- 8. Reset to All --------------------------------------------------------
{
  assert.equal(filterPlacesForMap(collection, MAP_FILTER_ALL).length, collection.length);
  assert.equal(isMapFilterActive(MAP_FILTER_ALL), false);
}

// --- zone-circle density policy --------------------------------------------
{
  const base = { isSelected: false, hasSelection: false, isArchived: false };
  // Small collections keep the zone-bubble look.
  assert.equal(shouldRenderZoneCircle({ ...base, visibleCount: 1 }), true);
  assert.equal(shouldRenderZoneCircle({ ...base, visibleCount: ZONE_CIRCLE_DENSITY_LIMIT }), true);
  // Dense maps drop the wash of overlapping circles.
  assert.equal(shouldRenderZoneCircle({ ...base, visibleCount: ZONE_CIRCLE_DENSITY_LIMIT + 1 }), false);
  assert.equal(shouldRenderZoneCircle({ ...base, visibleCount: 200 }), false);
  // The selected place ALWAYS shows its zone, at any density.
  assert.equal(
    shouldRenderZoneCircle({ isSelected: true, hasSelection: true, isArchived: false, visibleCount: 200 }),
    true,
    'selected place keeps its reminder zone',
  );
  // While something is selected, the others stand down so focus reads clearly.
  assert.equal(
    shouldRenderZoneCircle({ isSelected: false, hasSelection: true, isArchived: false, visibleCount: 3 }),
    false,
  );
}

// --- map wiring contracts ---------------------------------------------------
const map = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');

assert.match(map, /<MapCategoryFilterBar/, 'the map renders the category filter row');
assert.doesNotMatch(map, /MapFilterChips/, 'the Nearby/Recent/Saved chips are gone');
assert.match(map, /visiblePlaces\.map\(\(p\) => \(\s*\n\s*<NearrMapMarker/, 'markers render the filtered set');
assert.match(map, /shouldRenderZoneCircle\(\{/, 'zone circles go through the density policy');
assert.match(map, /onFitAll=\{visiblePlaces\.length > 0/, 'fit-all lives on the same control row');
assert.match(map, /setMapCategoryFilter\(MAP_FILTER_ALL\);\s*\n\s*if \(reminderOpen\)/, 'deep links reset the filter');
assert.match(map, /filterPlacesForMap\(validPlaces, mapCategoryFilter, selected\?\.id \?\? null\)/);
assert.match(map, /trackEvent\('map_filter_changed'/, 'filter changes are tracked');
// Filtering must never trigger data work.
assert.doesNotMatch(map, /mapCategoryFilter[\s\S]{0,200}refresh\(\)/, 'changing a filter never refetches');

console.log('PASS map category visibility, zone-circle density, and map wiring contracts');
