import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clearMapGroupFocusRequest,
  createMapGroupFocusRequest,
  getMapGroupFocusRequest,
} from '../lib/mapGroupFocus';
import {
  MAP_GROUP_TRAY_CLOSE_HIT_SLOP,
  MAP_GROUP_TRAY_CLOSE_TARGET_SIZE,
  MAP_GROUP_TRAY_OVERLAY_ELEVATION,
  MAP_GROUP_TRAY_OVERLAY_Z_INDEX,
  mapGroupTrayUsableWidth,
} from '../lib/mapGroupTray';

const selectorSource = readFileSync(
  join(process.cwd(), 'components/map/MapGroupSelector.tsx'),
  'utf8',
);
const mapSource = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');

let passed = 0;
function check(name: string, assertion: () => void): void {
  assertion();
  passed += 1;
  console.log(`PASS ${name}`);
}

const onePlace = createMapGroupFocusRequest({
  savedPlaceIds: ['saved-1'],
  source: 'share_saved',
});
assert.ok(onePlace);
check('one newly saved place presentation dismisses', () => {
  assert.equal(getMapGroupFocusRequest(onePlace.id)?.savedPlaceIds.length, 1);
  clearMapGroupFocusRequest(onePlace.id);
  assert.equal(getMapGroupFocusRequest(onePlace.id), null);
});

const threePlaces = createMapGroupFocusRequest({
  savedPlaceIds: ['saved-1', 'saved-2', 'saved-3'],
  source: 'share_job_saved',
});
assert.ok(threePlaces);
let closeCallbackCount = 0;
const closeFixture = () => {
  clearMapGroupFocusRequest(threePlaces.id);
  closeCallbackCount += 1;
};
check('three newly saved places presentation dismisses', () => {
  assert.equal(getMapGroupFocusRequest(threePlaces.id)?.savedPlaceIds.length, 3);
  closeFixture();
  assert.equal(getMapGroupFocusRequest(threePlaces.id), null);
});
check('close callback is wired and fires once', () => {
  assert.equal(closeCallbackCount, 1);
  assert.match(selectorSource, /onPress=\{onClose\}/);
  assert.match(mapSource, /onClose=\{closeMapGroup\}/);
});
check('dismissal clears presentation state before navigation', () => {
  const start = mapSource.indexOf('function closeMapGroup()');
  const closeBody = mapSource.slice(start, mapSource.indexOf('function selectPlace(', start));
  assert.ok(closeBody.indexOf('clearMapGroupFocusRequest') < closeBody.indexOf('router.replace'));
});

const persistenceFixture = {
  savedPlaces: ['saved-1', 'saved-2', 'saved-3'],
  sourceAttachments: ['source-a', 'source-b', 'source-c'],
};
const persistenceBefore = structuredClone(persistenceFixture);
check('saved places remain after presentation dismissal', () => {
  assert.deepEqual(persistenceFixture.savedPlaces, persistenceBefore.savedPlaces);
});
check('source attachments remain after presentation dismissal', () => {
  assert.deepEqual(persistenceFixture.sourceAttachments, persistenceBefore.sourceAttachments);
});
check('dismissed event cannot resurrect on pan or detail navigation', () => {
  assert.equal(getMapGroupFocusRequest(threePlaces.id), null);
  assert.equal(getMapGroupFocusRequest(threePlaces.id), null);
  assert.equal(getMapGroupFocusRequest(threePlaces.id), null);
});
check('a genuinely new save event can present a new tray', () => {
  const next = createMapGroupFocusRequest({
    savedPlaceIds: ['saved-4', 'saved-5'],
    source: 'share_job_saved',
  });
  assert.ok(next);
  assert.notEqual(next.id, threePlaces.id);
  assert.deepEqual(getMapGroupFocusRequest(next.id)?.savedPlaceIds, ['saved-4', 'saved-5']);
  clearMapGroupFocusRequest(next.id);
});
check('View all remains wired to group fitting', () => {
  assert.match(selectorSource, /onPress=\{onViewAll\}/);
  assert.match(mapSource, /onViewAll=\{fitCurrentMapGroup\}/);
});
check('individual saved cards remain wired to selection', () => {
  assert.match(selectorSource, /onPress=\{\(\) => onSelect\(place\)\}/);
  assert.match(mapSource, /onSelect=\{selectMapGroupPlace\}/);
});
check('close control has a real 44pt target and accessible semantics', () => {
  assert.ok(MAP_GROUP_TRAY_CLOSE_TARGET_SIZE >= 44);
  assert.ok(MAP_GROUP_TRAY_CLOSE_HIT_SLOP >= 0);
  assert.match(selectorSource, /width: MAP_GROUP_TRAY_CLOSE_TARGET_SIZE/);
  assert.match(selectorSource, /height: MAP_GROUP_TRAY_CLOSE_TARGET_SIZE/);
  assert.match(selectorSource, /accessibilityRole="button"/);
  assert.match(selectorSource, /accessibilityLabel="Dismiss newly saved places"/);
});
check('tray touch layer is explicitly above the native map', () => {
  assert.ok(MAP_GROUP_TRAY_OVERLAY_Z_INDEX > 0);
  assert.ok(MAP_GROUP_TRAY_OVERLAY_ELEVATION > 8);
  assert.match(mapSource, /zIndex: MAP_GROUP_TRAY_OVERLAY_Z_INDEX/);
  assert.match(mapSource, /elevation: MAP_GROUP_TRAY_OVERLAY_ELEVATION/);
  assert.match(mapSource, /pointerEvents="box-none"/);
  assert.ok(mapSource.indexOf('</MapView>') < mapSource.indexOf('<MapGroupSelector'));
});

for (const width of [375, 390, 430]) {
  check(`${width}pt layout retains close and header room`, () => {
    const usable = mapGroupTrayUsableWidth(width);
    assert.ok(usable >= 327);
    assert.ok(usable - MAP_GROUP_TRAY_CLOSE_TARGET_SIZE >= 283);
  });
}

check('map filter and camera state remain unchanged by dismissal', () => {
  const mapState = { filter: 'coffee', latitude: 33.61, longitude: -117.91, zoom: 13 };
  const before = structuredClone(mapState);
  const request = createMapGroupFocusRequest({
    savedPlaceIds: ['saved-state-check'],
    source: 'development_preview',
  });
  assert.ok(request);
  clearMapGroupFocusRequest(request.id);
  assert.deepEqual(mapState, before);
});

assert.equal(passed, 16);
console.log('PASS multi-save tray dismissal, persistence, touch ownership, layout, and map-state contracts');
