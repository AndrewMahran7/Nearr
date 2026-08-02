/**
 * scripts/testLiveLocation.ts
 *
 * Unit tests for lib/liveLocation.ts — the pure logic behind the map screen's
 * live foreground user-location tracking. Covers the behaviours the product
 * spec calls out:
 *   - newer reading replaces older reading
 *   - older / equal timestamp is ignored (stale / out-of-order)
 *   - invalid coordinates are rejected
 *   - duplicate subscription is prevented
 *   - app-background transition stops tracking
 *   - foreground transition restarts tracking
 *   - a map gesture disables camera follow
 *   - the marker (reading) keeps updating when camera follow is disabled
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testLiveLocation.ts
 */

import {
  isValidCoordinate,
  shouldAcceptSample,
  shouldWatchLocation,
  canStartWatch,
  nextFollowMode,
  shouldFollowCamera,
  type LocationSample,
} from '../lib/liveLocation';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---- isValidCoordinate -----------------------------------------------------
check('valid coordinate accepted', isValidCoordinate(37.7749, -122.4194));
check('equator/prime-meridian accepted', isValidCoordinate(0, 0));
check('boundary lat/lng accepted', isValidCoordinate(90, 180) && isValidCoordinate(-90, -180));
check('NaN latitude rejected', !isValidCoordinate(NaN, -122));
check('Infinity longitude rejected', !isValidCoordinate(37, Infinity));
check('out-of-range latitude rejected', !isValidCoordinate(120, 0));
check('out-of-range longitude rejected', !isValidCoordinate(0, 200));
check('non-number rejected', !isValidCoordinate('37' as unknown, -122));

// ---- shouldAcceptSample ----------------------------------------------------
const base: LocationSample = { latitude: 37.7749, longitude: -122.4194, timestamp: 1_000 };

check('first reading (no previous) accepted', shouldAcceptSample(null, base));

// newer reading replaces older reading
const newer: LocationSample = { latitude: 37.78, longitude: -122.42, timestamp: 2_000 };
check('newer reading replaces older reading', shouldAcceptSample(base, newer));

// older timestamp is ignored
const older: LocationSample = { latitude: 37.9, longitude: -122.5, timestamp: 500 };
check('older timestamp is ignored', !shouldAcceptSample(base, older));

// equal timestamp is ignored (duplicate / out-of-order)
const equal: LocationSample = { latitude: 37.9, longitude: -122.5, timestamp: 1_000 };
check('equal timestamp is ignored', !shouldAcceptSample(base, equal));

// invalid coordinates are rejected even if newer
const invalid: LocationSample = { latitude: NaN, longitude: -122, timestamp: 9_999 };
check('invalid coordinates rejected even when newer', !shouldAcceptSample(base, invalid));

// non-finite timestamp rejected
const badTs: LocationSample = { latitude: 37.78, longitude: -122.42, timestamp: NaN };
check('non-finite timestamp rejected', !shouldAcceptSample(base, badTs));

// ---- shouldWatchLocation (lifecycle) --------------------------------------
check(
  'watch runs when focused + active + permitted',
  shouldWatchLocation({ isFocused: true, appActive: true, permissionGranted: true }),
);
// app-background transition stops tracking
check(
  'app-background transition stops tracking',
  !shouldWatchLocation({ isFocused: true, appActive: false, permissionGranted: true }),
);
// foreground transition restarts tracking
check(
  'foreground transition restarts tracking',
  shouldWatchLocation({ isFocused: true, appActive: true, permissionGranted: true }),
);
check(
  'blurred screen stops tracking',
  !shouldWatchLocation({ isFocused: false, appActive: true, permissionGranted: true }),
);
check(
  'denied permission never tracks',
  !shouldWatchLocation({ isFocused: true, appActive: true, permissionGranted: false }),
);

// ---- canStartWatch (single subscription) ----------------------------------
check('can start when no active subscription', canStartWatch(false));
check('duplicate subscription is prevented', !canStartWatch(true));

// ---- follow-mode transitions ----------------------------------------------
// map gesture disables camera follow
check('user gesture disables follow (from on)', nextFollowMode(true, 'user-gesture') === false);
check('user gesture keeps follow off', nextFollowMode(false, 'user-gesture') === false);
// recenter button enables follow
check('recenter enables follow (from off)', nextFollowMode(false, 'recenter') === true);
check('recenter keeps follow on', nextFollowMode(true, 'recenter') === true);

// ---- shouldFollowCamera ----------------------------------------------------
check('camera follows when follow on + accepted', shouldFollowCamera(true, true));
// marker continues updating when camera follow is disabled:
// the reading is still accepted (marker updates) but the camera does NOT move.
check('camera does NOT move when follow disabled', !shouldFollowCamera(false, true));
check('camera does NOT move on rejected sample even if following', !shouldFollowCamera(true, false));

if (failures > 0) {
  console.error(`\n${failures} live-location test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll live-location tests passed.');
