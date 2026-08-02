/**
 * lib/liveLocation.ts
 *
 * Pure logic for the map screen's live foreground user-location tracking.
 * Extracted from app/(tabs)/map.tsx so the tricky parts (staleness rejection,
 * subscription gating, follow-mode transitions) can be unit-tested from
 * ts-node WITHOUT React Native / expo-location.
 *
 * PURE — no imports, no side effects. The map screen is responsible for the
 * actual `Location.watchPositionAsync` subscription, the AppState listener,
 * and the imperative camera moves; this module only decides *what should
 * happen* given plain values.
 *
 * Battery note: the tuning constants below intentionally avoid
 * `BestForNavigation`/maximum-accuracy GPS. `High` accuracy with a distance
 * filter means the OS only wakes us after meaningful movement, so a stationary
 * phone produces almost no callbacks.
 */

/** A minimal lat/lng pair. */
export type LiveCoordinate = {
  latitude: number;
  longitude: number;
};

/**
 * A single location reading. `timestamp` is the device clock time (ms) the
 * fix was taken — used to reject stale / out-of-order readings that some
 * platforms deliver after a newer one.
 */
export type LocationSample = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

/** Inputs that decide whether the foreground watch should be running. */
export type WatchGateInput = {
  /** The map screen is the focused route (not just mounted in a hidden tab). */
  isFocused: boolean;
  /** The app is in the foreground (`AppState === 'active'`). */
  appActive: boolean;
  /** Foreground location permission has been granted. */
  permissionGranted: boolean;
};

/** What can flip follow mode on or off. */
export type FollowEvent = 'recenter' | 'user-gesture';

// ---------------------------------------------------------------------------
// Tuning constants (documented values for the final report).
// ---------------------------------------------------------------------------

/**
 * Minimum time between forwarded location callbacks. 4s is responsive enough
 * for a moving dot while driving without hammering the GPS/JS bridge.
 */
export const LIVE_LOCATION_TIME_INTERVAL_MS = 4_000;

/**
 * Minimum movement (meters) before the OS delivers a new reading. While the
 * user is stationary this suppresses callbacks entirely (battery win); ~25m is
 * roughly a few seconds of driving.
 */
export const LIVE_LOCATION_DISTANCE_INTERVAL_M = 25;

/**
 * Duration (ms) of the follow-mode camera glide. Short enough to keep up with
 * movement, long enough not to feel jumpy.
 */
export const LIVE_LOCATION_FOLLOW_ANIMATION_MS = 500;

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/**
 * True only for a finite, in-range WGS84 coordinate. Guards the map against
 * `NaN`/`Infinity` (which crash `react-native-maps`) and obviously-bogus
 * out-of-range values delivered by a flaky provider.
 */
export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return true;
}

/**
 * Decide whether `next` should replace `previous`.
 *
 * Accepts when the new reading has valid coordinates AND is strictly newer
 * than the last accepted one. Rejects:
 *   - invalid / out-of-range coordinates,
 *   - a non-finite timestamp,
 *   - an older OR equal timestamp (stale / duplicate / out-of-order delivery).
 *
 * `previous === null` means "no reading yet", so any valid sample is accepted.
 */
export function shouldAcceptSample(
  previous: LocationSample | null,
  next: LocationSample,
): boolean {
  if (!isValidCoordinate(next.latitude, next.longitude)) return false;
  if (typeof next.timestamp !== 'number' || !Number.isFinite(next.timestamp)) return false;
  if (previous === null) return true;
  return next.timestamp > previous.timestamp;
}

/**
 * Whether the foreground location watch should currently be running. Used to
 * start the subscription when the map is focused + foregrounded + permitted,
 * and to tear it down on blur, background, or permission loss.
 */
export function shouldWatchLocation(input: WatchGateInput): boolean {
  return input.isFocused && input.appActive && input.permissionGranted;
}

/**
 * Whether it is safe to START a new subscription. Prevents a second, duplicate
 * `watchPositionAsync` when one is already active.
 */
export function canStartWatch(hasActiveSubscription: boolean): boolean {
  return !hasActiveSubscription;
}

/**
 * Follow-mode state machine.
 *   - `recenter`     → follow ON  (tapping the recenter button re-locks onto
 *                      the user and lets the camera track new readings).
 *   - `user-gesture` → follow OFF (manually panning/zooming the map hands
 *                      control back to the user; the dot keeps updating but the
 *                      camera stops chasing it).
 */
export function nextFollowMode(_current: boolean, event: FollowEvent): boolean {
  return event === 'recenter';
}

/**
 * Whether the camera should move to a freshly-accepted reading. The camera
 * only follows when follow mode is enabled AND the reading was accepted; the
 * marker/dot itself updates independently of this decision.
 */
export function shouldFollowCamera(followEnabled: boolean, sampleAccepted: boolean): boolean {
  return followEnabled && sampleAccepted;
}
