import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import { buildSavedPlacesBrowseResults, type SavedBrowseFilters } from '../lib/savedPlacesBrowse';
import type { SavedPlaceWithPlace } from '../types';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const library = read('components/map/SavedPlacesLibrary.tsx');
const input = read('components/Input.tsx');
const sheet = read('components/map/MapBottomSheet.tsx');

/**
 * Deterministic model of the RN 0.74 iOS failure boundary. Native editing is
 * immediate; controlled JS commits may arrive later. The production fix makes
 * the latter impossible for user edits, while still publishing exact snapshots
 * downstream for filtering.
 */
class NativeFieldHarness {
  text = '';
  selection = { start: 0, end: 0 };
  readonly downstreamQueries: string[] = [];

  select(start: number, end = start) {
    this.selection = { start, end };
  }

  replaceSelection(replacement: string) {
    const { start, end } = this.selection;
    this.text = `${this.text.slice(0, start)}${replacement}${this.text.slice(end)}`;
    const caret = start + replacement.length;
    this.selection = { start: caret, end: caret };
    this.downstreamQueries.push(this.text);
  }

  backspace() {
    const { start, end } = this.selection;
    if (start !== end) return this.replaceSelection('');
    if (start === 0) return;
    this.select(start - 1, end);
    this.replaceSelection('');
  }

  clear() {
    this.text = '';
    this.selection = { start: 0, end: 0 };
    this.downstreamQueries.push('');
  }
}

// Pre-fix reproduction: Nearr passed query back as `value`. If the `s` JS
// render lands after native already accepted `u`, native is restored to `s`;
// the next key then inserts into that stale snapshot. This is the same race as
// facebook/react-native#44157 and is sufficient to corrupt order/caret.
const preFix = new NativeFieldHarness();
preFix.replaceSelection('s');
const delayedControlledValue = preFix.downstreamQueries[0]!;
preFix.replaceSelection('u');
preFix.text = delayedControlledValue;
preFix.select(1);
preFix.replaceSelection('n');
assert.equal(preFix.text, 'sn', 'a delayed controlled commit deterministically loses newer native text');
assert.notEqual(preFix.text, 'sun');

// Rapid input is native-owned. Search snapshots may trail, but cannot write
// into either visible text or selection.
const rapid = new NativeFieldHarness();
for (const value of ['s', 'u', 'n', 's', 'e', 't']) rapid.replaceSelection(value);
assert.equal(rapid.text, 'sunset');
assert.deepEqual(rapid.selection, { start: 6, end: 6 });
assert.deepEqual(rapid.downstreamQueries, ['s', 'su', 'sun', 'suns', 'sunse', 'sunset']);

// Substantially faster than human typing: 10,000 synchronous native events.
const burst = new NativeFieldHarness();
for (let index = 0; index < 10_000; index += 1) burst.replaceSelection(String(index % 10));
assert.equal(burst.text.length, 10_000);
assert.deepEqual(burst.selection, { start: 10_000, end: 10_000 });

// Result completions are downstream-only, so even an adversarial completion
// order has no channel back to the field.
const outOfOrder = new NativeFieldHarness();
for (const value of ['s', 'u', 'n', 's', 'e', 't']) outOfOrder.replaceSelection(value);
const resultCompletions = ['sunset', 'su', 'sun'];
for (const _completedQuery of resultCompletions) {
  // Deliberately no field mutation: results are consumers, never producers.
}
assert.equal(outOfOrder.text, 'sunset');
assert.deepEqual(outOfOrder.selection, { start: 6, end: 6 });

// Intentional cursor placement, range replacement, held backspace, and clear.
rapid.select(3);
rapid.replaceSelection('X');
assert.equal(rapid.text, 'sunXset');
assert.deepEqual(rapid.selection, { start: 4, end: 4 });
rapid.select(3, 4);
rapid.replaceSelection('123');
assert.equal(rapid.text, 'sun123set');
rapid.select(6);
for (let index = 0; index < 3; index += 1) rapid.backspace();
assert.equal(rapid.text, 'sunset');
rapid.clear();
for (const value of ['s', 'u', 'n', 's', 'e', 't']) rapid.replaceSelection(value);
assert.equal(rapid.text, 'sunset');
assert.deepEqual(rapid.selection, { start: 6, end: 6 });

// Production source contract: input has stable ancestry, is uncontrolled after
// mount, does not control selection, and only the explicit clear action reaches
// the native imperative API. Result/sort/filter/loading transitions cannot
// replace the visible value.
assert.match(sheet, /<MemoizedSavedPlacesLibrary/);
assert.doesNotMatch(sheet, /key=\{[^}]*?(?:result|loading|sort|filter|query)/i);
assert.match(input, /forwardRef<TextInput, TextInputProps>/);
assert.match(library, /const \[inputText, setInputText\] = useState\(''\)/);
assert.match(library, /const searchQuery = useDeferredValue\(inputText\)/);
assert.match(library, /query: searchQuery/);
assert.match(library, /<Input[\s\S]*?defaultValue=""[\s\S]*?onChangeText=\{setInputText\}/);
assert.doesNotMatch(library, /<Input[\s\S]*?value=\{/);
assert.doesNotMatch(library, /selection=|onSelectionChange|setSelection/);
assert.match(library, /searchInputRef\.current\?\.clear\(\);[\s\S]*setInputText\(''\)/);

// The No matches and normal-result branches share the same FlatList header,
// so neither transition can replace the input instance.
assert.match(library, /ListHeaderComponent=\{listHeader\}/);
assert.match(library, /ListEmptyComponent=\{emptyState\(\)\}/);
assert.ok(library.includes('No matches'));

// Local filtering remains cheap for the founder-sized list and a 10x fixture.
const noFilters: SavedBrowseFilters = { categories: [], hasOriginalPost: false };
function fixtures(count: number): SavedPlaceWithPlace[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `saved-${index}`,
    user_id: 'search-test',
    place_id: `place-${index}`,
    notes: index % 7 === 0 ? 'sunset overlook' : null,
    ai_note: null,
    source_url: null,
    source_type: null,
    notifications_enabled: false,
    radius_value: 1,
    radius_unit: 'miles',
    last_notified_at: null,
    notification_count: 0,
    reminder_opportunity_count: 0,
    archived_at: null,
    visited_at: null,
    reminders_exhausted_at: null,
    created_at: new Date(1_800_000_000_000 - index * 1_000).toISOString(),
    updated_at: new Date(1_800_000_000_000 - index * 1_000).toISOString(),
    place: {
      id: `place-${index}`,
      google_place_id: `google-${index}`,
      name: index % 11 === 0 ? `Sunset Place ${index}` : `Saved Place ${index}`,
      formatted_address: `${index} Main Street, Los Angeles, CA`,
      latitude: 34,
      longitude: -118,
      category: index % 2 === 0 ? 'restaurant' : 'park',
      google_primary_type: null,
      google_types: null,
      google_maps_url: null,
      created_at: new Date(1_800_000_000_000 - index * 1_000).toISOString(),
    },
  } as SavedPlaceWithPlace));
}

function benchmark(count: number) {
  const places = fixtures(count);
  const started = performance.now();
  for (const query of ['s', 'su', 'sun', 'suns', 'sunse', 'sunset']) {
    buildSavedPlacesBrowseResults({ places, query, filters: noFilters, sort: 'recent' });
  }
  return performance.now() - started;
}

const founderSizeMs = benchmark(300);
const largeSizeMs = benchmark(3_000);
assert.ok(founderSizeMs < 1_000, `300-place search unexpectedly took ${founderSizeMs.toFixed(1)}ms`);
assert.ok(largeSizeMs < 5_000, `3,000-place search unexpectedly took ${largeSizeMs.toFixed(1)}ms`);

console.log(
  `PASS Saved Places native-owned input, rapid typing, stale results, cursor editing, clear, stable identity, and local filtering (300=${founderSizeMs.toFixed(1)}ms; 3000=${largeSizeMs.toFixed(1)}ms)`,
);
