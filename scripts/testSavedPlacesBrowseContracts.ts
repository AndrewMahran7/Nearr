import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const screen = read('app/(tabs)/places.tsx');
const card = read('components/SavedPlaceBrowseCard.tsx');
const detail = read('app/place/[id].tsx');
const mapDetail = read('components/map/SelectedPlaceDetails.tsx');

// The main hierarchy stays deliberately small and the collection remains virtualized.
for (const copy of ['Saved Places', 'Search saved places', 'Sort', 'Filter']) {
  assert.ok(screen.includes(copy), `Saved Places hierarchy must include ${copy}`);
}
assert.match(screen, /<FlatList[\s\S]*keyExtractor=\{\(saved\) => saved\.id\}/);
assert.match(screen, /SavedPlaceBrowseCard saved=\{item\}/);
assert.match(screen, /router\.push\(`\/place\/\$\{savedPlaceId\}`\)/);
assert.ok(!screen.includes('horizontal\n'), 'main browsing controls must not be a horizontal chip strip');

// Only the requested primary sorts and the friendly, automatic filter taxonomy are exposed.
assert.ok(screen.includes('Recently saved'));
assert.ok(screen.includes('Nearest places first'));
for (const label of [
  'Restaurants', 'Cafes', 'Bakeries', 'Bars & Nightlife', 'Hotels', 'Outdoors',
  'Attractions', 'Shopping', 'Fitness & Wellness', 'Entertainment', 'Other',
]) assert.ok(read('lib/savedPlacesBrowse.ts').includes(`label: '${label}'`));
assert.ok(screen.includes('Has original video'));
assert.ok(screen.includes('Filter (${filterCount})'));

// Cards have fixed, prominent images; bounded copy; automatic category; and one tap target.
assert.match(card, /<PlaceImage[\s\S]*size=\{116\}/);
assert.match(card, /saved\.place\.name[\s\S]*numberOfLines=\{2\}/);
assert.ok(card.includes('numberOfLines={2}>{note.text}</Text>'));
assert.ok(card.includes('CATEGORY_LABELS[savedPlaceCategory(saved)]'));
assert.ok(card.includes("hasSource ? 'Original post attached'"));
assert.ok(card.includes('accessibilityHint="Opens saved place details"'));

// Category remains compatible in data but is read-only in the normal saved-place surfaces.
for (const source of [screen, card, detail, mapDetail]) {
  assert.ok(!source.includes('<PlaceCategoryPicker'), 'normal Saved Places UX must not ask users to classify places');
}
assert.ok(detail.includes('CATEGORY_LABELS[savedPlaceCategory(saved)]'));
assert.ok(mapDetail.includes('CATEGORY_LABELS[savedPlaceCategory(saved)]'));

// Required empty and permission states are present and Recent is preserved on failure.
for (const copy of [
  'No saved places yet', 'No matches', 'Nothing matches these filters',
  'Location is needed for Nearby', 'Recently saved remains selected',
]) assert.ok(screen.includes(copy));
assert.match(screen, /setSort\('recent'\);[\s\S]*setLocationNotice\(true\)/);

console.log('PASS Saved Places screen, card, accessibility, automatic-category, and empty-state contracts');
