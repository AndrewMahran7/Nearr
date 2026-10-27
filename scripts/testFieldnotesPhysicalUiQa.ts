import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveFieldnotesMapPresentation } from '../lib/fieldnotesPresentation';
import {
  IOS_SWITCH_VISUAL_HEIGHT,
  IOS_SWITCH_VISUAL_WIDTH,
  REMINDER_SWITCH_SLOT_WIDTH,
  REMINDER_SWITCH_TRAILING_CLEARANCE,
  rectContains,
  rectsIntersect,
} from '../lib/nativeLayoutGeometry';
import { mapUsableViewport, planSavedPinsCamera } from '../lib/mapViewportGeometry';
import { reminderDistanceLabel } from '../lib/placeDetailUi';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const base = {
  searchVisible: false,
  nearbyExplorerActive: false,
  hasSelectedPlace: false,
  expandedPlace: false,
  savedLibraryExpanded: false,
  sourceGroupActive: false,
  onboardingOwnsMap: false,
};

const normal = resolveFieldnotesMapPresentation(base);
assert.equal(normal.owner, 'normal_map');
assert.equal(normal.showActivity, true);
assert.equal(normal.showDock, true);

const compact = resolveFieldnotesMapPresentation({ ...base, hasSelectedPlace: true });
assert.equal(compact.owner, 'compact_place');
assert.equal(compact.showActivity, true);
assert.equal(compact.showDock, true);

const expanded = resolveFieldnotesMapPresentation({
  ...base,
  hasSelectedPlace: true,
  expandedPlace: true,
});
assert.equal(expanded.owner, 'expanded_place');
assert.equal(expanded.showActivity, false);
assert.equal(expanded.activityPointerEvents, 'none');
assert.equal(expanded.showDock, false);
assert.equal(expanded.showTopChrome, false);

for (const owned of [
  resolveFieldnotesMapPresentation({ ...base, searchVisible: true }),
  resolveFieldnotesMapPresentation({ ...base, nearbyExplorerActive: true }),
]) {
  assert.equal(owned.showActivity, false);
  assert.equal(owned.showDock, false);
  assert.equal(owned.showEmptyFeedback, false);
}
assert.equal(resolveFieldnotesMapPresentation({ ...base, savedLibraryExpanded: true }).showDock, true);

const activityRect = { x: 320, y: 54, width: 44, height: 44 };
const moreRect = { x: 320, y: 54, width: 44, height: 44 };
assert.equal(rectsIntersect(activityRect, moreRect), true, 'recording geometry overlaps if both controls render');
assert.equal(expanded.showActivity, false, 'ownership removes the underlying target instead of moving it');

const switchSlot = { x: 0, y: 0, width: REMINDER_SWITCH_SLOT_WIDTH, height: 48 };
const nativeSwitch = {
  x: REMINDER_SWITCH_TRAILING_CLEARANCE,
  y: (48 - IOS_SWITCH_VISUAL_HEIGHT) / 2,
  width: IOS_SWITCH_VISUAL_WIDTH,
  height: IOS_SWITCH_VISUAL_HEIGHT,
};
assert.equal(REMINDER_SWITCH_SLOT_WIDTH, 67);
assert.equal(rectContains(switchSlot, nativeSwitch, REMINDER_SWITCH_TRAILING_CLEARANCE), true);
for (const cardWidth of [280, 320, 390]) {
  assert.ok(cardWidth - REMINDER_SWITCH_SLOT_WIDTH - 16 >= 160, `${cardWidth}pt card leaves wrapping copy space`);
}

const viewport = mapUsableViewport({
  width: 390,
  height: 844,
  top: 170,
  bottom: 280,
  markerInsets: { top: 42, right: 86, bottom: 72, left: 86 },
});
const newSave = planSavedPinsCamera({
  coordinates: [{ latitude: 33.8121, longitude: -117.9190 }],
  viewport,
  maxZoom: 15,
});
assert.equal(newSave.kind, 'camera');
if (newSave.kind === 'camera') {
  assert.equal(newSave.zoom, 15);
  assert.ok(newSave.region.latitudeDelta < 0.1, 'new save uses local context, not continent scale');
  assert.ok(newSave.edgePadding.left >= 86 && newSave.edgePadding.right >= 86);
}

assert.equal(reminderDistanceLabel({ mode: 'default', milesText: '', minutesText: '' }), 'Automatic');

const map = read('app/(tabs)/map.tsx');
const detail = read('components/map/SelectedPlaceDetails.tsx');
const search = read('components/map/MapPlaceSearchDropdown.tsx');
const activity = read('app/share-jobs/index.tsx');
const layout = read('app/_layout.tsx');

assert.match(map, /fieldnotesPresentation\.showActivity/);
assert.match(map, /pointerEvents=\{fieldnotesPresentation\.activityPointerEvents/);
assert.match(map, /fieldnotesPresentation\.showDock/);
assert.match(map, /style=\{\[styles\.emptyPill, \{ top: emptyStateTop \}\]\}/);
assert.match(map, /handleSelectMapCategory[\s\S]{0,320}setSnackbar\(null\)[\s\S]{0,160}setMapCategoryFilter\(next\)/);
assert.match(map, /reason: 'new_save'/);
assert.match(map, /persistence_ms:/);
assert.match(map, /<StatusBar style=\{resolvedTheme === 'dark' \? 'light' : 'dark'\}/);

assert.match(detail, /width: REMINDER_SWITCH_SLOT_WIDTH/);
assert.match(detail, /paddingHorizontal: REMINDER_SWITCH_TRAILING_CLEARANCE/);
assert.match(detail, /onLayout=\{verifyReminderSwitchBounds\}/);
assert.match(detail, /transitionHeroUri/);
assert.match(detail, />\{t\("Mark visited"\)\}<\/Text>/);
assert.match(detail, />\{t\("Not yet"\)\}<\/Text>/);
assert.match(detail, /title=\{t\("Near this place"\)\}/);
assert.match(detail, /animationType="none" statusBarTranslucent/);

assert.match(search, />\{t\("Saving…"\)\}<\/Text>/);
assert.match(search, />\{t\("Try again"\)\}<\/Text>/);
assert.match(search, /readSavedPlaceSnapshot/);
assert.match(search, /hydrationPolicy="saved_snapshot"/);
const savedImageBlock = search.slice(search.indexOf('function SavedSearchPlaceImage'), search.indexOf('/** Local memory search'));
assert.ok(!/getSavedPlaceGoogleDisplayDetails|hydrateSavedPlace/.test(savedImageBlock));

assert.match(activity, /function returnToNormalMap\(\)/);
assert.match(activity, /mapResetId: `activity-/);
assert.match(activity, /title=\{t\("Back to your map"\)\} onPress=\{returnToNormalMap\}/);
assert.equal((layout.match(/animation: 'fade'/g) ?? []).length >= 2, true);

console.log('PASS Fieldnotes physical UI QA: ownership, switch bounds, filters, navigation, search, camera, imagery, status bar');
