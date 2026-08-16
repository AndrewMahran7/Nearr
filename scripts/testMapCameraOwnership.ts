/**
 * scripts/testMapCameraOwnership.ts
 *
 * Map camera OWNERSHIP: who is allowed to move the camera, and when.
 *
 * The product invariant this locks down:
 *
 *   User gestures own the camera until the user explicitly asks Nearr to move
 *   it, or a deliberate navigation action targets a specific place.
 *   Closing UI is not a reason to move the camera.
 *   A GPS update is not a reason to move the camera.
 *
 * The regression being prevented: closing a place card used to animate back to
 * the viewport captured when the place was opened. For every deep-link entry
 * (queue row, notification, "Show on map") that captured viewport was wherever
 * the camera sat BEFORE the focus — normally the user's own location — so
 * closing the card threw the user across the state. It also discarded any pan
 * made while the card was open.
 *
 * The harness below mirrors app/(tabs)/map.tsx's camera authorities and drives
 * the REAL pure follow-mode/location helpers from lib/liveLocation.ts, so a
 * behavioural regression fails here rather than on a physical device.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMapCameraOwnership.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  nextFollowMode,
  shouldAcceptSample,
  shouldFollowCamera,
  type LocationSample,
} from '../lib/liveLocation';

type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
type Place = { id: string; latitude: number; longitude: number };

/** Every camera command the map can issue, with the authority that issued it. */
type CameraCommand = {
  authority:
    | 'initial_location_fix'
    | 'follow_location_update'
    | 'explicit_recenter'
    | 'place_focus'
    | 'group_focus'
    | 'fit_all_places';
  target: string;
};

const SANTA_CRUZ: Region = {
  latitude: 36.9741,
  longitude: -122.0308,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};
const ORANGE_COUNTY: Region = {
  latitude: 33.7175,
  longitude: -117.8311,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};
const SAN_DIEGO: Region = {
  latitude: 32.7157,
  longitude: -117.1611,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};
const TUXEDO_CAT: Place = { id: 'sp-coffee', latitude: 33.7455, longitude: -117.8677 };

/**
 * Faithful stand-in for the map screen's camera authorities. Mirrors
 * app/(tabs)/map.tsx: the follow-mode transitions and the GPS acceptance gate
 * come from the real lib/liveLocation.ts helpers.
 */
class MapCamera {
  commands: CameraCommand[] = [];
  followMode = true; // the map opens in a "here I am" state
  mapReady = true;
  selected: Place | null = null;
  userRegion: Region | null = null;
  private lastSample: LocationSample | null = null;
  private didFit = false;
  private hasUserMoved = false;
  /** The visible region, tracked the way onRegionChangeComplete tracks it. */
  private lastRegion: Region | null = null;

  constructor(initialRegion: Region) {
    this.lastRegion = initialRegion;
  }

  private issue(authority: CameraCommand['authority'], target: string): void {
    this.commands.push({ authority, target });
  }

  /** A GPS reading arrives. Updates location STATE; only moves the camera when
   *  an authority explicitly owns it. */
  gpsUpdate(region: Region, timestamp: number): void {
    const sample: LocationSample = {
      latitude: region.latitude,
      longitude: region.longitude,
      timestamp,
    };
    if (!shouldAcceptSample(this.lastSample, sample)) return;
    this.lastSample = sample;
    this.userRegion = region; // the dot always updates

    // One-time "here I am" framing, skipped once the user has explored or a
    // deliberate target already set the camera.
    if (this.mapReady && !this.didFit && !this.hasUserMoved) {
      this.didFit = true;
      this.issue('initial_location_fix', 'user');
      this.lastRegion = region;
      return;
    }
    // Otherwise the camera only tracks the user while follow mode is on.
    if (shouldFollowCamera(this.followMode, true)) {
      this.issue('follow_location_update', 'user');
      this.lastRegion = region;
    }
  }

  /** Manual pan/zoom: onPanDrag + onRegionChangeComplete. */
  userPansTo(region: Region): void {
    this.hasUserMoved = true;
    if (this.followMode) this.followMode = nextFollowMode(this.followMode, 'user-gesture');
    this.lastRegion = region;
  }

  /** Marker tap / deep-link / queue focus — a deliberate destination. */
  selectPlace(place: Place): void {
    this.followMode = false;
    this.selected = place;
    this.issue('place_focus', place.id);
    this.lastRegion = {
      latitude: place.latitude,
      longitude: place.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }

  /** Queue / notification deep link: marks the camera as deliberately targeted. */
  deepLinkFocus(place: Place): void {
    this.didFit = true;
    this.selectPlace(place);
  }

  /** Closing the card, the X button, tapping the map, swiping the sheet down.
   *  MUST NOT issue any camera command. */
  dismissSelectedPlace(): void {
    if (!this.selected) return;
    this.selected = null;
    // Deliberately nothing else. Closing UI does not move the camera.
  }

  /** The explicit recenter / current-location control. */
  recenter(): void {
    this.followMode = nextFollowMode(this.followMode, 'recenter');
    this.issue('explicit_recenter', 'user');
    if (this.userRegion) this.lastRegion = this.userRegion;
  }

  visibleRegion(): Region | null {
    return this.lastRegion;
  }

  commandsSince(mark: number): CameraCommand[] {
    return this.commands.slice(mark);
  }
}

function near(a: Region | null, b: Region): boolean {
  if (!a) return false;
  return Math.abs(a.latitude - b.latitude) < 0.001 && Math.abs(a.longitude - b.longitude) < 0.001;
}

// ---------------------------------------------------------------------------
// 1. Manual exploration: pan away -> open place -> close -> no recenter
// ---------------------------------------------------------------------------
{
  const map = new MapCamera(SANTA_CRUZ);
  map.gpsUpdate(SANTA_CRUZ, 1000); // initial "here I am"
  map.userPansTo(ORANGE_COUNTY);
  assert.equal(map.followMode, false, 'a manual pan hands the camera back to the user');

  const mark = map.commands.length;
  map.selectPlace(TUXEDO_CAT);
  map.dismissSelectedPlace();

  const after = map.commandsSince(mark);
  assert.deepEqual(
    after.map((c) => c.authority),
    ['place_focus'],
    'opening framed the place; CLOSING issued no camera command at all',
  );
  assert.ok(
    !after.some((c) => c.target === 'user'),
    'closing never recenters on the user',
  );
}

// ---------------------------------------------------------------------------
// 2. The Santa Cruz -> Orange County scenario, end to end
// ---------------------------------------------------------------------------
{
  const map = new MapCamera(SANTA_CRUZ);
  map.gpsUpdate(SANTA_CRUZ, 1000);
  map.userPansTo(ORANGE_COUNTY);
  map.selectPlace(TUXEDO_CAT);
  map.dismissSelectedPlace();

  const visible = map.visibleRegion();
  assert.ok(
    Math.abs(visible!.latitude - TUXEDO_CAT.latitude) < 0.1,
    'the camera stays around the Orange County place it was showing',
  );
  assert.ok(
    !near(visible, SANTA_CRUZ),
    'the camera does NOT jump back to the physical location in Santa Cruz',
  );
}

// ---------------------------------------------------------------------------
// 3. GPS update after exploring: state updates, camera does not move
// ---------------------------------------------------------------------------
{
  const map = new MapCamera(SANTA_CRUZ);
  map.gpsUpdate(SANTA_CRUZ, 1000);
  map.userPansTo(ORANGE_COUNTY);

  const mark = map.commands.length;
  const moved: Region = { ...SANTA_CRUZ, latitude: SANTA_CRUZ.latitude + 0.01 };
  map.gpsUpdate(moved, 2000);

  assert.deepEqual(map.commandsSince(mark), [], 'a GPS update is not a camera command');
  assert.equal(map.userRegion?.latitude, moved.latitude, 'but the user dot still updates');
  assert.ok(near(map.visibleRegion(), ORANGE_COUNTY), 'the explored viewport is untouched');
}

// ---------------------------------------------------------------------------
// 4. Open place far away -> GPS update -> close: no yank to the user
// ---------------------------------------------------------------------------
{
  const map = new MapCamera(SANTA_CRUZ);
  map.gpsUpdate(SANTA_CRUZ, 1000);
  map.userPansTo(ORANGE_COUNTY);
  map.selectPlace(TUXEDO_CAT);

  const mark = map.commands.length;
  map.gpsUpdate({ ...SANTA_CRUZ, latitude: SANTA_CRUZ.latitude + 0.02 }, 3000);
  map.dismissSelectedPlace();

  assert.deepEqual(
    map.commandsSince(mark),
    [],
    'neither the GPS update nor the dismiss moved the camera',
  );
}

// ---------------------------------------------------------------------------
// 5. Explicit recenter still works, and re-arms follow
// ---------------------------------------------------------------------------
{
  const map = new MapCamera(SANTA_CRUZ);
  map.gpsUpdate(SANTA_CRUZ, 1000);
  map.userPansTo(ORANGE_COUNTY);
  assert.equal(map.followMode, false);

  const mark = map.commands.length;
  map.recenter();
  const after = map.commandsSince(mark);
  assert.equal(after.length, 1);
  assert.equal(after[0].authority, 'explicit_recenter');
  assert.equal(after[0].target, 'user', 'recenter deliberately targets the user');
  assert.equal(map.followMode, true, 'recenter re-enters follow mode');

  // ...and follow mode then legitimately tracks new readings again.
  const followMark = map.commands.length;
  map.gpsUpdate({ ...SANTA_CRUZ, latitude: SANTA_CRUZ.latitude + 0.03 }, 4000);
  assert.deepEqual(
    map.commandsSince(followMark).map((c) => c.authority),
    ['follow_location_update'],
    'follow mode is not permanently disabled by the fix',
  );
}

// ---------------------------------------------------------------------------
// 6. Queue / deep-link focus still frames its target, and closing stays put
// ---------------------------------------------------------------------------
{
  const map = new MapCamera(SANTA_CRUZ);
  map.gpsUpdate(SANTA_CRUZ, 1000);

  const mark = map.commands.length;
  map.deepLinkFocus(TUXEDO_CAT); // Queue -> Place A (commit 82eac44)
  assert.deepEqual(
    map.commandsSince(mark).map((c) => c.authority),
    ['place_focus'],
    'the queue deep link still focuses its exact target',
  );
  assert.equal(map.commands[map.commands.length - 1].target, TUXEDO_CAT.id);

  const closeMark = map.commands.length;
  map.dismissSelectedPlace();
  assert.deepEqual(map.commandsSince(closeMark), [], 'closing after a queue focus moves nothing');
  assert.ok(
    !near(map.visibleRegion(), SANTA_CRUZ),
    'the camera stays around the saved place, not the current location',
  );

  // Same-place navigation from 82eac44 must still re-focus.
  const againMark = map.commands.length;
  map.deepLinkFocus(TUXEDO_CAT);
  assert.deepEqual(
    map.commandsSince(againMark).map((c) => c.authority),
    ['place_focus'],
    'Queue -> A -> close -> Queue -> A again still focuses A',
  );
}

// ---------------------------------------------------------------------------
// 7. Manual pan WHILE the card is open: the latest viewport wins
// ---------------------------------------------------------------------------
{
  const map = new MapCamera(SANTA_CRUZ);
  map.gpsUpdate(SANTA_CRUZ, 1000);
  map.userPansTo(ORANGE_COUNTY);
  map.selectPlace(TUXEDO_CAT);

  // The user drags off to San Diego while the card is still up.
  map.userPansTo(SAN_DIEGO);
  const mark = map.commands.length;
  map.dismissSelectedPlace();

  assert.deepEqual(map.commandsSince(mark), [], 'closing does not undo the new pan');
  assert.ok(
    near(map.visibleRegion(), SAN_DIEGO),
    'the latest manual viewport is retained, not the pre-open one',
  );
}

// ---------------------------------------------------------------------------
// 8. The initial "here I am" framing is preserved (and happens only once)
// ---------------------------------------------------------------------------
{
  const map = new MapCamera(SANTA_CRUZ);
  map.gpsUpdate(SANTA_CRUZ, 1000);
  assert.deepEqual(
    map.commands.map((c) => c.authority),
    ['initial_location_fix'],
    'the map still opens on the user',
  );

  // A user who explores first must never be dragged back by a late first fix.
  const fresh = new MapCamera(SANTA_CRUZ);
  fresh.userPansTo(ORANGE_COUNTY);
  fresh.gpsUpdate(SANTA_CRUZ, 1000);
  assert.deepEqual(fresh.commands, [], 'a late GPS fix cannot reclaim an explored camera');
}

// ---------------------------------------------------------------------------
// 9. Follow-mode state machine, directly (the ownership primitives)
// ---------------------------------------------------------------------------
{
  assert.equal(nextFollowMode(true, 'user-gesture'), false, 'a gesture always drops follow');
  assert.equal(nextFollowMode(false, 'user-gesture'), false);
  assert.equal(nextFollowMode(false, 'recenter'), true, 'only an explicit recenter re-arms it');
  assert.equal(nextFollowMode(true, 'recenter'), true);
  // A GPS reading never moves the camera on its own.
  assert.equal(shouldFollowCamera(false, true), false, 'accepted sample + no follow = no move');
  assert.equal(shouldFollowCamera(true, false), false);
  assert.equal(shouldFollowCamera(true, true), true);
}

// ---------------------------------------------------------------------------
// 10. Source wiring — the dismiss path must contain no camera command
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');

  const start = src.indexOf('const dismissSelectedPlace = useCallback(');
  assert.ok(start > -1, 'dismissSelectedPlace still exists');
  const end = src.indexOf('}, [previewTranslateY, selected]);', start);
  assert.ok(end > start, 'dismissSelectedPlace body located');
  const body = src.slice(start, end);

  for (const command of ['animateToRegion', 'animateCamera', 'fitToCoordinates', 'setCamera']) {
    assert.ok(!body.includes(command), `dismiss must not call ${command}`);
  }
  assert.ok(!body.includes('setFollowMode'), 'dismiss must not re-arm follow mode');

  // The restore mechanism is gone entirely, so no call site can opt back in.
  assert.ok(!src.includes('previousRegionRef'), 'the pre-open viewport ref is removed');
  assert.ok(!src.includes('restoreRegion'), 'the restoreRegion option is removed');
  assert.doesNotMatch(src, /setTimeout\([\s\S]{0,120}animateToRegion/, 'no timing hacks');

  // The deliberate authorities must all still be present.
  for (const marker of [
    'const recenterOnUser',
    'function focusZone(',
    'const fitVisiblePlaces',
    'function fitCurrentMapGroup(',
  ]) {
    assert.ok(src.includes(marker), `${marker} is preserved`);
  }
  // GPS -> camera stays gated on follow mode.
  assert.match(src, /shouldFollowCamera\(followModeRef\.current, true\)/, 'follow gate intact');
  // The one-time initial fix stays gated on "user has not explored yet".
  assert.match(src, /if \(hasUserMovedRef\.current\) return;/, 'explored camera is protected');
}

console.log('PASS map camera ownership: closing a place never moves the camera');
