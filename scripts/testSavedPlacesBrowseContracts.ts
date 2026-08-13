import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CATEGORY_BROWSE_SECTIONS, NEARR_CATEGORIES } from '../lib/placeCategory';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const map = read('app/(tabs)/map.tsx');
const sheet = read('components/map/MapBottomSheet.tsx');
const library = read('components/map/SavedPlacesLibrary.tsx');
const card = read('components/SavedPlaceBrowseCard.tsx');
const tabs = read('app/(tabs)/_layout.tsx');
const detail = read('components/map/SelectedPlaceDetails.tsx');

// The physical path is Map tab -> MapBottomSheet -> SavedPlacesLibrary.
assert.match(map, /<MapBottomSheet[\s\S]*savedPlaces=\{validPlaces\}/);
assert.match(map, /locationState=\{locationState\}/);
assert.match(sheet, /<MemoizedSavedPlacesLibrary/);
assert.match(sheet, /mode === 'saved'\) snapTo\('full'\)/);
assert.ok(!tabs.includes('name="places"'), 'hidden presentation-only Places route must not survive');

// The real main hierarchy is compact and virtualized.
for (const copy of ['Saved Places', 'Search saved places', 'Sort', 'Filter']) {
  assert.ok(`${sheet}\n${library}`.includes(copy), `runtime Saved Places hierarchy must include ${copy}`);
}
assert.match(library, /<FlatList[\s\S]*keyExtractor=\{\(saved\) => saved\.id\}/);
assert.match(library, /SavedPlaceBrowseCard saved=\{item\}/);
assert.ok(library.includes('maintainVisibleContentPosition'));
for (const removed of ['All 85', 'Reminders', 'MapSheetFilterChips']) {
  assert.ok(!library.includes(removed), `old main filter ${removed} must be removed`);
}

// Sort and permission behavior are intentionally narrow.
assert.ok(library.includes('Recently saved'));
assert.ok(library.includes('Nearest places first'));
assert.match(library, /await requestLocationPermission\(\)/);
assert.match(library, /setSort\('recent'\);[\s\S]*setLocationNotice\(true\)/);

// Filter groups use every canonical category exactly once and no provider type.
const grouped = CATEGORY_BROWSE_SECTIONS.flatMap((section) => [...section.categories]);
assert.equal(grouped.length, NEARR_CATEGORIES.length);
assert.deepEqual([...new Set(grouped)].sort(), [...NEARR_CATEGORIES].sort());
for (const label of ['Food & drink', 'Stays', 'Outdoors', 'Things to do', 'Shopping', 'Fitness & wellness', 'Other']) {
  assert.ok(read('lib/placeCategory.ts').includes(`label: '${label}'`));
}
assert.ok(library.includes('Has original post'));
assert.ok(library.includes('Clear'));
assert.ok(library.includes('Apply'));
assert.ok(!library.includes('coffee_shop'));

// Cards have prominent fixed images, bounded copy, normalized category, one
// note preview, original-post affordance, and one full-card navigation target.
assert.match(card, /<PlaceImage[\s\S]*size=\{124\}/);
assert.match(card, /saved\.place\.name[\s\S]*numberOfLines=\{2\}/);
assert.ok(card.includes('numberOfLines={1}>{note.text}</Text>'));
assert.ok(card.includes('CATEGORY_LABELS[savedPlaceCategory(saved)]'));
assert.ok(card.includes("hasSource ? 'Original post attached'"));
assert.ok(card.includes('accessibilityHint="Opens saved place details"'));
assert.match(sheet, /onSelectPlace=\{onSelectPlace\}/);

// Required loading, empty, search, filter, and location states live in the
// actual runtime library.
for (const copy of [
  'Loading saved places', 'No saved places yet', 'No matches',
  'Nothing matches these filters', 'Location is needed for Nearby',
]) assert.ok(library.includes(copy));

// Category is automatic/read-only in the normal saved-place surfaces.
for (const source of [library, card, detail]) {
  assert.ok(!source.includes('<PlaceCategoryPicker'));
}

console.log('PASS physical MapBottomSheet Saved Places runtime, hierarchy, filters, cards, and empty states');
