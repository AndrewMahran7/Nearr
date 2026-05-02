/**
 * Nearr — nearby notifications.
 *
 * What this module does:
 *   1. Asks for foreground + background location permission and notification
 *      permission (`ensureLocationPermission`, `ensureNotificationPermission`).
 *   2. Starts / stops a background location task that pings every ~60s and,
 *      on each ping, runs `checkProximity()`.
 *   3. `checkProximity()` is the heart of the feature: for the current user,
 *      it pulls all `saved_places` that have notifications enabled, computes
 *      distance to each, and — if within the effective radius and outside
 *      the per-place cooldown / quiet hours — fires a local notification,
 *      updates `saved_places.last_notified_at`, and writes a
 *      `notification_events` row.
 *
 * Schema this module reads/writes:
 *   - `profiles`            (default radius, master + nearby toggles, quiet hours)
 *   - `saved_places`        (per-place radius, notifications_enabled,
 *                            last_notified_at)
 *   - `places`              (lat / lng / name / address)
 *   - `notification_events` (audit log; insert-only)
 *
 * --------------------------------------------------------------------------
 * BACKGROUND BEHAVIOR — IMPORTANT LIMITATIONS
 * --------------------------------------------------------------------------
 * `expo-location`'s `startLocationUpdatesAsync` runs the registered
 * `TaskManager` task in the background, but with constraints:
 *
 *   • iOS: requires the `UIBackgroundModes` `location` entitlement.
 *     Expo adds this automatically when "Always" location permission is
 *     declared in `app.json`. The task only fires periodically (the OS
 *     coalesces; "every 60s" is a request, not a guarantee).
 *   • Android: requires `ACCESS_BACKGROUND_LOCATION` (Android 10+). On
 *     Android 12+ the OS also gates this behind a separate prompt. We use
 *     a foreground-service notification ("Watching for places nearby") so
 *     the OS keeps the task alive when the app is backgrounded.
 *   • **Expo Go does not support background location.** True background
 *     behavior requires an EAS dev/prod build.
 *
 * For better proximity behavior in production, switch to
 * `Location.startGeofencingAsync` (true OS-level geofences) once the saved
 * places per user are small enough (Android caps ~100 active geofences).
 * That is intentionally out of scope for this task.
 *
 * --------------------------------------------------------------------------
 */

import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { isDemoMode } from './demoMode';
import { isMapPreviewMode } from './mapPreview';
import { supabase } from './supabase';
import {
  distanceMeters,
  milesToMeters,
  minutesToMeters,
  type LatLng,
} from './geo';
import type { Profile, SavedPlaceWithPlace } from '@/types';

// ---------------------------------------------------------------------------
// Constants & module state
// ---------------------------------------------------------------------------

export const LOCATION_TASK = 'nearr-location-task';

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined';

/** How long to wait before re-notifying for the *same* saved place. */
const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * In-memory short-circuit so the same task tick doesn't double-fire.
 * The DB's `last_notified_at` is the source of truth across app restarts.
 */
const lastAlertAtMem = new Map<string, number>();

/**
 * Per-place inside/outside radius state. Used to detect the outside→inside
 * crossing that triggers a notification. Absent = first check this session
 * (we never notify on cold-start regardless of position).
 *
 * Reset on every app launch — the DB's last_notified_at handles cross-restart
 * cooldowns, so this only needs to track the current run.
 */
const insideStateMap = new Map<string, boolean>();

// ---------------------------------------------------------------------------
// Notification categories (action buttons on iOS / Android)
// ---------------------------------------------------------------------------

/** Category identifier used for notifications 1 and 2 (standard actions). */
export const NOTIFY_CATEGORY_STANDARD = 'NEARR_NEARBY_STANDARD';
/** Category identifier used for notification 3 (final chance actions). */
export const NOTIFY_CATEGORY_FINAL = 'NEARR_NEARBY_FINAL';

// Foreground display config. Without this, notifications can be silently
// suppressed when the app is in the foreground on iOS.
console.log('[NOTIFICATIONS_INIT] setting notification handler');
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (e) {
  console.error('[NOTIFICATIONS_INIT] setNotificationHandler failed (non-fatal)', e);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export async function ensureNotificationPermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.status === 'granted') return true;
  const req = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
    },
  });
  const ok = req.status === 'granted';
  console.log('[notifications] permission =', ok);
  return ok;
}

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.status === 'granted') return 'granted';
  if (cur.status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Foreground-only location permission. Sufficient for the in-app map and
 * for a one-shot proximity check while the app is open. For the background
 * watch use `ensureBackgroundLocationPermission()`.
 */
export async function ensureForegroundLocationPermission(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  return fg.status === 'granted';
}

/**
 * Foreground + background location. Required for `startProximityWatch` to
 * actually fire while the app is backgrounded.
 *
 * TODO(eas): On iOS this requires `NSLocationAlwaysAndWhenInUseUsageDescription`
 * and on Android `ACCESS_BACKGROUND_LOCATION`; both are configured via
 * `app.json` and only effective in an EAS dev/prod build (not Expo Go).
 */
export async function ensureBackgroundLocationPermission(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted';
}

// ---------------------------------------------------------------------------
// Watch lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the background proximity watch. No-op if it's already running, or
 * if the user denies permission.
 *
 * TODO(background): The 60s `timeInterval` is a *request*. iOS in particular
 * coalesces background ticks aggressively; expect intervals up to several
 * minutes when the app isn't active.
 */
export async function startProximityWatch(): Promise<void> {
  if (isDemoMode()) {
    console.log('[notifications] demo mode — skipping background watch');
    return;
  }
  const ok = await ensureBackgroundLocationPermission();
  if (!ok) {
    console.warn('[notifications] background location not granted — watch not started');
    return;
  }
  await startLocationUpdatesTask();
  console.log('[notifications] proximity watch started');
}

async function startLocationUpdatesTask(): Promise<void> {
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (already) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 60_000,
    distanceInterval: 100,
    showsBackgroundLocationIndicator: false,
    // Android: a foreground-service notification keeps the task alive.
    foregroundService: {
      notificationTitle: 'Nearr',
      notificationBody: 'Watching for saved places nearby',
    },
  });
}

export async function stopProximityWatch(): Promise<void> {
  if (isDemoMode()) return;
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    console.log('[notifications] proximity watch stopped');
  }
}

export async function syncProximityWatch(): Promise<'started' | 'stopped' | 'skipped'> {
  if (isDemoMode() || isMapPreviewMode()) return 'skipped';

  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    if (started) {
      await stopProximityWatch();
      return 'stopped';
    }
    return 'skipped';
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('notifications_enabled, nearby_notifications_enabled')
    .eq('id', userRes.user.id)
    .maybeSingle();

  const profile = profileData as Pick<Profile, 'notifications_enabled' | 'nearby_notifications_enabled'> | null;
  if (!profile?.notifications_enabled || !profile.nearby_notifications_enabled) {
    if (started) {
      await stopProximityWatch();
      return 'stopped';
    }
    return 'skipped';
  }

  const [notificationPermission, backgroundLocation] = await Promise.all([
    getNotificationPermissionState(),
    Location.getBackgroundPermissionsAsync(),
  ]);

  if (notificationPermission !== 'granted' || backgroundLocation.status !== 'granted') {
    if (started) {
      await stopProximityWatch();
      return 'stopped';
    }
    return 'skipped';
  }

  await startLocationUpdatesTask();
  return 'started';
}

export async function sendTestNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Nearr test reminder',
      body: 'You are all set for nearby reminders.',
    },
    trigger: null,
  });
}

/**
 * Register notification action categories with the OS. Call once on app
 * startup from the root layout. Idempotent and wrapped in try/catch —
 * failure must never prevent notification delivery.
 *
 * TODO(ios-actions): Notification actions require a production / TestFlight
 * build with push-notification entitlements on iOS. They are silently ignored
 * in Expo Go and Simulator. Verify on a real device before shipping.
 */
export async function registerNotificationCategories(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(NOTIFY_CATEGORY_STANDARD, [
      {
        identifier: 'going',
        buttonTitle: "I'm going",
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'next_time',
        buttonTitle: 'Next time',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'reduce_radius',
        buttonTitle: 'Reduce radius',
        options: { opensAppToForeground: true },
      },
    ]);
    await Notifications.setNotificationCategoryAsync(NOTIFY_CATEGORY_FINAL, [
      {
        identifier: 'going',
        buttonTitle: "I'm going",
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'reset_count',
        buttonTitle: 'Give me 3 more chances',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'reduce_radius',
        buttonTitle: 'Reduce radius',
        options: { opensAppToForeground: true },
      },
    ]);
    console.log('[notifications] categories registered');
  } catch (e) {
    console.warn('[notifications] registerNotificationCategories failed (non-fatal)', e);
  }
}

/**
 * Handle a notification action tap. Called from the root layout's
 * `addNotificationResponseReceivedListener`. Navigation TODOs are logged
 * so they're easy to find when implementing deep-link routing.
 */
export async function handleNotificationAction(
  actionIdentifier: string,
  savedPlaceId: string | undefined,
  placeId: string | undefined,
): Promise<void> {
  if (!savedPlaceId) return;

  if (actionIdentifier === 'reset_count') {
    // "Give me 3 more chances" — reset the notification count to 0.
    const { error } = await supabase
      .from('saved_places')
      .update({ notification_count: 0 })
      .eq('id', savedPlaceId);
    if (error) {
      console.warn('[notifications] reset_count update failed', error.message);
    } else {
      console.log(`[notifications] NOTIFICATION_COUNT_RESET savedPlaceId=${savedPlaceId}`);
    }
    return;
  }

  if (actionIdentifier === 'going') {
    // TODO(notification-actions): open external maps directions to this place.
    // Fetch the place row (lat/lng/google_maps_url) via supabase and call
    // buildExternalMapsUrl from lib/externalMaps.ts, then Linking.openURL.
    console.log(`[notifications] TODO action=going savedPlaceId=${savedPlaceId} placeId=${placeId ?? 'unknown'}`);
    return;
  }

  if (actionIdentifier === 'reduce_radius') {
    // TODO(notification-actions): navigate to place/[id] settings.
    // Requires router.push — pass a callback or navigate from the calling component.
    console.log(`[notifications] TODO action=reduce_radius savedPlaceId=${savedPlaceId}`);
    return;
  }
}

// ---------------------------------------------------------------------------
// Effective-radius / quiet-hours helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective radius (in meters) for a saved place:
 *   - per-place override wins
 *   - otherwise fall back to the profile default
 *   - otherwise fall back to 1 mile
 */
export function effectiveRadiusMeters(
  saved: SavedPlaceWithPlace,
  profile: Profile | null,
): number {
  if (saved.radius_value != null && saved.radius_unit) {
    return saved.radius_unit === 'minutes'
      ? minutesToMeters(saved.radius_value)
      : milesToMeters(saved.radius_value);
  }
  if (profile) {
    return profile.default_radius_unit === 'minutes'
      ? minutesToMeters(profile.default_radius_value)
      : milesToMeters(profile.default_radius_value);
  }
  return milesToMeters(1);
}

/**
 * Are we currently inside the user's quiet-hours window?
 *
 * Returns false if quiet hours are disabled or if either bound is missing.
 * Handles windows that wrap past midnight (e.g. 22:00 → 07:00).
 *
 * Inputs are stored as Postgres `time` (`HH:MM` or `HH:MM:SS`).
 */
export function inQuietHours(profile: Profile | null, now: Date = new Date()): boolean {
  if (!profile?.quiet_hours_enabled) return false;
  if (!profile.quiet_hours_start || !profile.quiet_hours_end) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = parseHhmm(profile.quiet_hours_start);
  const end = parseHhmm(profile.quiet_hours_end);
  if (start == null || end == null) return false;

  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

function parseHhmm(t: string): number | null {
  const m = t.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// ---------------------------------------------------------------------------
// Core proximity check
// ---------------------------------------------------------------------------

/**
 * Decide whether to notify for a single saved place. Pure / synchronous,
 * easy to unit-test once we have a harness.
 */
export type ProximityDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'notify'; distanceMeters: number; radiusMeters: number };

export function decideProximity(
  here: LatLng,
  saved: SavedPlaceWithPlace,
  profile: Profile | null,
  now: number,
): ProximityDecision {
  if (!saved.notifications_enabled) {
    return { kind: 'skip', reason: 'place-notifications-off' };
  }

  const distance = distanceMeters(here, {
    latitude: saved.place.latitude,
    longitude: saved.place.longitude,
  });
  const radius = effectiveRadiusMeters(saved, profile);
  if (distance > radius) {
    return { kind: 'skip', reason: 'out-of-range' };
  }

  // In-memory cooldown check.
  const memLast = lastAlertAtMem.get(saved.id) ?? 0;
  if (now - memLast < ALERT_COOLDOWN_MS) {
    return { kind: 'skip', reason: 'cooldown-mem' };
  }

  // Persisted cooldown check.
  if (saved.last_notified_at) {
    const ts = Date.parse(saved.last_notified_at);
    if (Number.isFinite(ts) && now - ts < ALERT_COOLDOWN_MS) {
      return { kind: 'skip', reason: 'cooldown-db' };
    }
  }

  return { kind: 'notify', distanceMeters: distance, radiusMeters: radius };
}

/**
 * One-shot proximity check. Pulls everything it needs, decides per place,
 * and fires + records notifications.
 *
 * Safe to call from foreground and from the background task.
 */
export async function checkProximity(
  latitude: number,
  longitude: number,
): Promise<void> {
  // --- auth ---
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return; // signed out — nothing to do
  }
  const userId = userRes.user.id;

  // --- profile (master switches + quiet hours + default radius) ---
  const { data: profileData } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  const profile = (profileData as Profile | null) ?? null;

  if (profile && !profile.notifications_enabled) {
    console.log('[checkProximity] master notifications off, skipping');
    return;
  }
  if (profile && !profile.nearby_notifications_enabled) {
    console.log('[checkProximity] nearby notifications off, skipping');
    return;
  }
  if (inQuietHours(profile)) {
    console.log('[checkProximity] inside quiet hours, skipping');
    return;
  }

  // --- saved places (only those with notifications enabled) ---
  const { data: savedRows, error: savedErr } = await supabase
    .from('saved_places')
    .select('*, place:places(*)')
    .eq('user_id', userId)
    .eq('notifications_enabled', true);

  if (savedErr) {
    console.warn('[checkProximity] saved_places fetch failed', savedErr.message);
    return;
  }
  const saved = (savedRows ?? []) as SavedPlaceWithPlace[];
  if (saved.length === 0) return;

  // --- evaluate ---
  const here: LatLng = { latitude, longitude };
  const now = Date.now();
  for (const s of saved) {
    const radius = effectiveRadiusMeters(s, profile);
    const dist = distanceMeters(here, {
      latitude: s.place.latitude,
      longitude: s.place.longitude,
    });
    const isCurrentlyInside = dist <= radius;
    const wasInside = insideStateMap.get(s.id);

    // Always record current state for the next tick regardless of other checks.
    insideStateMap.set(s.id, isCurrentlyInside);

    if (!isCurrentlyInside) {
      console.log(
        `[checkProximity] NOTIFICATION_SKIPPED_OUTSIDE place=${s.place.name} dist=${Math.round(dist)}m radius=${Math.round(radius)}m`,
      );
      continue;
    }

    if (wasInside === undefined) {
      // First check this session — establish baseline; never notify on cold-start.
      continue;
    }

    if (wasInside === true) {
      console.log(`[checkProximity] NOTIFICATION_SKIPPED_ALREADY_INSIDE place=${s.place.name}`);
      continue;
    }

    // wasInside === false → outside→inside transition. Run cooldown + settings checks.
    const decision = decideProximity(here, s, profile, now);
    if (decision.kind === 'skip') {
      // decideProximity will re-check range (redundantly) and then check cooldown/settings.
      console.log(
        `[checkProximity] NOTIFICATION_TRIGGERED place=${s.place.name} skipped_reason=${decision.reason}`,
      );
      continue;
    }

    // Feature 2: notification count limit.
    const count = s.notification_count ?? 0;
    if (count >= 3) {
      console.log(
        `[checkProximity] NOTIFICATION_LIMIT_REACHED place=${s.place.name} count=${count}`,
      );
      continue;
    }

    await fireNotification(userId, s, here, decision.distanceMeters);
    lastAlertAtMem.set(s.id, now);
  }
}

// ---------------------------------------------------------------------------
// Side effects: schedule notification + persist event
// ---------------------------------------------------------------------------

async function fireNotification(
  userId: string,
  saved: SavedPlaceWithPlace,
  here: LatLng,
  distance: number,
): Promise<void> {
  const count = saved.notification_count ?? 0;
  // Notification 3 (count already at 2) uses the "Give me 3 more chances" category.
  const categoryIdentifier = count >= 2 ? NOTIFY_CATEGORY_FINAL : NOTIFY_CATEGORY_STANDARD;

  console.log(
    `[notifications] NOTIFICATION_TRIGGERED place=${saved.place.name} dist=${Math.round(distance)}m count=${count} category=${categoryIdentifier}`,
  );

  // 1. Local notification.
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `You're near ${saved.place.name}`,
        body: saved.place.formatted_address ?? 'Saved in Nearr',
        data: { savedPlaceId: saved.id, placeId: saved.place.id },
        categoryIdentifier,
      },
      trigger: null, // fire immediately
    });
    console.log(`[notifications] NOTIFICATION_SENT_SUCCESS place=${saved.place.name}`);
  } catch (e) {
    console.warn(`[notifications] NOTIFICATION_SEND_FAILED place=${saved.place.name}`, e);
    // Don't update DB if the notification itself didn't go out.
    return;
  }

  // 2. Bump last_notified_at and increment notification_count.
  const nowIso = new Date().toISOString();
  const { error: upErr } = await supabase
    .from('saved_places')
    .update({ last_notified_at: nowIso, notification_count: count + 1 })
    .eq('id', saved.id);
  if (upErr) {
    console.warn('[notifications] saved_places update failed', upErr.message);
  } else {
    console.log(
      `[notifications] NOTIFICATION_COUNT_INCREMENTED place=${saved.place.name} new_count=${count + 1}`,
    );
  }

  // 3. Append to notification_events (audit log, insert-only per RLS).
  const { error: evErr } = await supabase.from('notification_events').insert({
    user_id: userId,
    saved_place_id: saved.id,
    event_type: 'nearby',
    distance_meters: distance,
  });
  if (evErr) {
    console.warn('[notifications] event insert failed', evErr.message);
  }
}

// ---------------------------------------------------------------------------
// Foreground convenience: one-shot "check right now"
// ---------------------------------------------------------------------------

/**
 * Run a single proximity check using the current location. Used by the app
 * (e.g. on foregrounding) without needing the background task to be live.
 *
 * Safe to call repeatedly; cooldowns prevent spam.
 */
/**
 * Result of a one-shot proximity check. Callers can ignore it (the function
 * is `void`-safe), but tests / debugging benefit from a structured reason.
 */
export type CheckProximityOnceResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'demo_mode'
        | 'map_preview_mode'
        | 'permission_denied'
        | 'location_services_disabled'
        | 'location_unavailable'
        | 'unexpected_error';
      error?: unknown;
    };

/**
 * Detect "current location is unavailable" style errors that are expected on
 * emulators, in airplane mode, or when the OS hasn't produced a fix yet.
 * These are non-fatal: we just skip the proximity check.
 */
function isExpectedLocationUnavailableError(error: unknown): boolean {
  if (!error) return false;
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('current location is unavailable') ||
    lower.includes('location is unavailable') ||
    lower.includes('location services are disabled') ||
    lower.includes('location provider is unavailable') ||
    lower.includes('location request timed out') ||
    // expo-location's E_LOCATION_UNAVAILABLE / E_LOCATION_TIMEOUT codes
    lower.includes('e_location_unavailable') ||
    lower.includes('e_location_timeout') ||
    lower.includes('e_location_settings_unsatisfied')
  );
}

/**
 * Run a single proximity check using the current location. Used by the app
 * (e.g. on foregrounding) without needing the background task to be live.
 *
 * Safe to call repeatedly; cooldowns prevent spam. Returns a structured
 * result instead of throwing — callers may ignore it.
 *
 * Skips silently (no LogBox warning) when:
 *   - Demo Mode or Map Preview Mode is active
 *   - Foreground location permission is not granted
 *   - Device location services are disabled
 *   - The OS reports "current location is unavailable" (common on emulators)
 *
 * Real / unexpected errors still surface via `console.warn`.
 */
export async function checkProximityOnce(): Promise<CheckProximityOnceResult> {
  // Demo Mode and Map Preview Mode never use real device location.
  if (isDemoMode()) return { ok: false, reason: 'demo_mode' };
  if (isMapPreviewMode()) return { ok: false, reason: 'map_preview_mode' };

  // Confirm permission *without* prompting. Prompting is reserved for the
  // explicit Settings flow when the user enables nearby alerts.
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    if (__DEV__) {
      console.debug('[notifications] one-shot skipped: permission not granted');
    }
    return { ok: false, reason: 'permission_denied' };
  }

  // Confirm the OS-level location services switch is on. On Android emulators
  // without a mock location this is the most common cause of the
  // "Current location is unavailable" error.
  try {
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      if (__DEV__) {
        console.debug('[notifications] one-shot skipped: location services disabled');
      }
      return { ok: false, reason: 'location_services_disabled' };
    }
  } catch {
    // Treat a failure of the services-check itself as "unavailable" — skip
    // quietly rather than warn.
    return { ok: false, reason: 'location_services_disabled' };
  }

  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await checkProximity(loc.coords.latitude, loc.coords.longitude);
    return { ok: true };
  } catch (e) {
    if (isExpectedLocationUnavailableError(e)) {
      if (__DEV__) {
        console.debug(
          '[notifications] one-shot skipped: location unavailable',
          e instanceof Error ? e.message : e,
        );
      }
      return { ok: false, reason: 'location_unavailable', error: e };
    }
    console.warn('[notifications] one-shot check failed', e);
    return { ok: false, reason: 'unexpected_error', error: e };
  }
}

// ---------------------------------------------------------------------------
// Background task definition
// ---------------------------------------------------------------------------
//
// TaskManager tasks must be defined at module import time, before
// `Location.startLocationUpdatesAsync` is called.
//
// TODO(background): If you add new task names (e.g. for geofencing), keep
// their definitions here so they're registered on every cold start.
// ---------------------------------------------------------------------------

try {
  if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
    console.log('[NOTIFICATIONS_INIT] registering background location task');
    TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
      if (error) {
        console.warn('[locationTask] error', error.message);
        return;
      }
      const locs = (data as { locations?: Location.LocationObject[] } | undefined)
        ?.locations;
      const last = locs?.[locs.length - 1];
      if (!last) return;
      try {
        await checkProximity(last.coords.latitude, last.coords.longitude);
      } catch (e) {
        console.warn('[locationTask] checkProximity failed', e);
      }
    });
  }
} catch (e) {
  console.error('[NOTIFICATIONS_INIT] defineTask failed (non-fatal)', e);
}
