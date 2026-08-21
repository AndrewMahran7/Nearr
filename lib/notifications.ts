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
 *   - `profiles`            (master + nearby toggles, quiet hours)
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
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { trackEvent } from './analytics';
import { isDemoMode } from './demoMode';
import { isDebugLoggingEnabled, logDebug, logInfo } from './logger';
import { isMapPreviewMode } from './mapPreview';
import {
  evaluateNearbyNotificationEligibility,
  getEffectiveNearbyNotificationRadiusMeters,
  getNearbyNotificationRadiusBucket,
  isPlaceReliablyClosed,
  resolveReminderPlaceCategory,
  selectNearbyNotificationWinner,
} from './nearbyEligibility';
import {
  createPlaceNotificationDedupeGate,
  PLACE_NOTIFICATION_DEDUPE_WINDOW_MS,
  type PlaceNotificationGateResult,
} from './placeNotificationDedupe';
import { supabase } from './supabase';
import { distanceMeters, type LatLng } from './geo';
import {
  readActiveReminderSnapshot,
  readReminderSnapshot,
  recordLocalNotification,
  type ReminderEligiblePlace as ReminderPlace,
  type ReminderProfile,
} from './reminderSnapshot';

// ---------------------------------------------------------------------------
// Constants & module state
// ---------------------------------------------------------------------------

export const LOCATION_TASK = 'nearr-location-task';

type LocationTaskStartStatus = 'started' | 'already_started' | 'skipped';

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined';

/** How long to wait before re-notifying for the *same* saved place. */
const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * In-memory short-circuit so the same task tick doesn't double-fire.
 * The DB's `last_notified_at` is the source of truth across app restarts.
 */
const lastAlertAtMem = new Map<string, number>();

/**
 * Group-level cooldown so duplicate saved_places rows for the same real
 * place do not send separate notifications in the same run.
 */
const lastAlertAtGroupMem = new Map<string, number>();

/**
 * Per-place inside/outside radius state. Used to detect the outside→inside
 * crossing that triggers a notification. Absent = first check this session
 * (we never notify on cold-start regardless of position).
 *
 * Reset on every app launch — the DB's last_notified_at handles cross-restart
 * cooldowns, so this only needs to track the current run.
 */
const insideStateMap = new Map<string, boolean>();

const placeNotificationDedupeGate = createPlaceNotificationDedupeGate(AsyncStorage);

const ADDRESS_LABEL_RE = /^\s*\d{1,6}\s+\S+/i;
const STREET_SUFFIX_RE =
  /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|ter|terrace|pl|place)\b\.?/i;

function normalizeNotificationText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAddressLikePlaceName(place: Pick<ReminderPlace['place'], 'name' | 'formatted_address'>): boolean {
  const name = (place.name ?? '').trim();
  if (!name) return true;
  if (
    place.formatted_address &&
    normalizeNotificationText(name) === normalizeNotificationText(place.formatted_address)
  ) {
    return true;
  }
  return ADDRESS_LABEL_RE.test(name) && STREET_SUFFIX_RE.test(name);
}

function notificationPrimaryLabel(saved: ReminderPlace): string {
  return isAddressLikePlaceName(saved.place)
    ? 'a saved place'
    : saved.place.name.trim();
}

function notificationDedupKey(saved: ReminderPlace): string {
  if (saved.place.google_place_id) {
    return `google:${saved.place.google_place_id}`;
  }
  const normalizedName = normalizeNotificationText(saved.place.name);
  const normalizedAddress = normalizeNotificationText(saved.place.formatted_address);
  if (normalizedName && normalizedAddress) {
    return `nameaddr:${normalizedName}|${normalizedAddress}`;
  }
  if (normalizedName) {
    return `name:${normalizedName}`;
  }
  if (saved.place_id) {
    return `place:${saved.place_id}`;
  }
  return `saved:${saved.id}`;
}

type NotificationIdentityGroup = {
  key: string;
  representative: ReminderPlace;
  members: ReminderPlace[];
};

type NotificationAreaGroup = {
  key: string;
  representative: ReminderPlace;
  identities: NotificationIdentityGroup[];
  members: ReminderPlace[];
  allSavedPlaceIds: string[];
  labels: string[];
};

function pickNotificationRepresentative(
  group: ReminderPlace[],
  here?: LatLng,
): ReminderPlace {
  const sorted = [...group].sort((left, right) => {
    const leftAddressLike = isAddressLikePlaceName(left.place) ? 1 : 0;
    const rightAddressLike = isAddressLikePlaceName(right.place) ? 1 : 0;
    if (leftAddressLike !== rightAddressLike) {
      return leftAddressLike - rightAddressLike;
    }
    const leftGoogle = left.place.google_place_id ? 0 : 1;
    const rightGoogle = right.place.google_place_id ? 0 : 1;
    if (leftGoogle !== rightGoogle) {
      return leftGoogle - rightGoogle;
    }
    if (here) {
      const leftDistance = distanceMeters(here, {
        latitude: left.place.latitude,
        longitude: left.place.longitude,
      });
      const rightDistance = distanceMeters(here, {
        latitude: right.place.latitude,
        longitude: right.place.longitude,
      });
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
    }
    return left.created_at.localeCompare(right.created_at);
  });
  return sorted[0];
}

function latestGroupLastNotifiedAt(group: ReminderPlace[]): number {
  let latest = 0;
  for (const saved of group) {
    if (!saved.last_notified_at) continue;
    const ts = Date.parse(saved.last_notified_at);
    if (Number.isFinite(ts)) {
      latest = Math.max(latest, ts);
    }
  }
  return latest;
}

function maxGroupNotificationCount(group: ReminderPlace[]): number {
  let count = 0;
  for (const saved of group) {
    count = Math.max(count, saved.notification_count ?? 0);
  }
  return count;
}

function buildNearbyCopy(label: string): { title: string; body: string } {
  if (label === 'a saved place') {
    return {
      title: "You're near a saved place",
      body: 'One of your saved places is nearby.',
    };
  }
  return {
    title: `You're near ${label}`,
    body: `${label} is nearby.`,
  };
}

function buildGroupNotificationCopy(labels: string[]): { title: string; body: string } {
  if (labels.length <= 1) {
    return buildNearbyCopy(labels[0] ?? 'a saved place');
  }
  if (labels.length === 2) {
    return {
      title: "You're near 2 saved places",
      body: `${labels[0]} and ${labels[1]} are nearby.`,
    };
  }
  if (labels.length === 3) {
    return {
      title: "You're near 3 saved places",
      body: `${labels[0]}, ${labels[1]}, and ${labels[2]} are nearby.`,
    };
  }
  return {
    title: `You're near ${labels.length} saved places`,
    body: `${labels[0]}, ${labels[1]}, and ${labels.length - 2} more are nearby.`,
  };
}

function groupSavedPlacesByIdentity(
  saved: ReminderPlace[],
  here?: LatLng,
): NotificationIdentityGroup[] {
  const groups = new Map<string, ReminderPlace[]>();
  for (const row of saved) {
    const key = notificationDedupKey(row);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }
  return Array.from(groups.entries()).map(([key, members]) => ({
    key,
    members,
    representative: pickNotificationRepresentative(members, here),
  }));
}

function getIdentityGroupCooldownReason(
  identity: NotificationIdentityGroup,
  now: number,
): 'cooldown_mem' | 'cooldown_db' | 'count_limit' | null {
  const memLast = lastAlertAtMem.get(identity.representative.id) ?? 0;
  if (now - memLast < ALERT_COOLDOWN_MS) {
    return 'cooldown_mem';
  }
  const dbLast = latestGroupLastNotifiedAt(identity.members);
  if (dbLast > 0 && now - dbLast < ALERT_COOLDOWN_MS) {
    return 'cooldown_db';
  }
  if (maxGroupNotificationCount(identity.members) >= 3) {
    return 'count_limit';
  }
  return null;
}

function buildNotificationAreaGroup(params: {
  triggered: ReminderPlace;
  allSaved: ReminderPlace[];
  triggerPoint: LatLng;
  now: number;
}): NotificationAreaGroup {
  const { triggered, allSaved, triggerPoint, now } = params;
  const identities = groupSavedPlacesByIdentity(allSaved, triggerPoint);
  const triggeredIdentityKey = notificationDedupKey(triggered);
  const triggeredIdentity =
    identities.find((identity) => identity.key === triggeredIdentityKey) ?? {
      key: triggeredIdentityKey,
      representative: triggered,
      members: [triggered],
    };
  const triggerRadius = effectiveRadiusMeters(triggeredIdentity.representative);

  const overlapping = identities
    .filter((identity) => getIdentityGroupCooldownReason(identity, now) === null)
    .filter((identity) => {
      if (identity.key === triggeredIdentity.key) return true;
      const placeRadius = effectiveRadiusMeters(identity.representative);
      const distance = distanceMeters(triggerPoint, {
        latitude: identity.representative.place.latitude,
        longitude: identity.representative.place.longitude,
      });
      return distance <= triggerRadius + placeRadius;
    })
    .sort((left, right) => {
      if (left.key === triggeredIdentity.key) return -1;
      if (right.key === triggeredIdentity.key) return 1;
      const leftDistance = distanceMeters(triggerPoint, {
        latitude: left.representative.place.latitude,
        longitude: left.representative.place.longitude,
      });
      const rightDistance = distanceMeters(triggerPoint, {
        latitude: right.representative.place.latitude,
        longitude: right.representative.place.longitude,
      });
      return leftDistance - rightDistance;
    });

  const allSavedPlaceIds = overlapping
    .flatMap((identity) => identity.members.map((member) => member.id))
    .sort();
  const members = overlapping.flatMap((identity) => identity.members);
  const labels = overlapping.map((identity) => notificationPrimaryLabel(identity.representative));
  return {
    key: allSavedPlaceIds.join('|'),
    representative: triggeredIdentity.representative,
    identities: overlapping,
    members,
    allSavedPlaceIds,
    labels,
  };
}

// ---------------------------------------------------------------------------
// Notification categories (action buttons on iOS / Android)
// ---------------------------------------------------------------------------

/** Category identifier used for notifications 1 and 2 (standard actions). */
export const NOTIFY_CATEGORY_STANDARD = 'NEARR_NEARBY_STANDARD';
/** Category identifier used for notification 3 (final chance actions). */
export const NOTIFY_CATEGORY_FINAL = 'NEARR_NEARBY_FINAL';

// Foreground display config. Without this, notifications can be silently
// suppressed when the app is in the foreground on iOS.
logDebug('NOTIFICATIONS_INIT', 'setting notification handler');
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
  logDebug('notifications', 'permission', { granted: ok });
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
    logDebug('notifications', 'demo mode, skipping background watch');
    return;
  }
  const ok = await ensureBackgroundLocationPermission();
  if (!ok) {
    console.warn('[notifications] background location not granted — watch not started');
    return;
  }
  const status = await startLocationUpdatesTask();
  if (status === 'started' || status === 'already_started') {
    logDebug('notifications', 'proximity watch started', { status });
    return;
  }
  console.warn('[notifications] proximity watch skipped — native Android foreground service config missing or start rejected');
}

function isAndroidForegroundServiceConfigError(error: unknown): boolean {
  if (Platform.OS !== 'android') return false;
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return false;
  return (
    message.includes("Couldn't start the foreground service") ||
    message.includes('Foreground service permissions were not found in the manifest')
  );
}

async function startLocationUpdatesTask(): Promise<LocationTaskStartStatus> {
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (already) return 'already_started';

  try {
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
    return 'started';
  } catch (error) {
    if (isAndroidForegroundServiceConfigError(error)) {
      console.warn(
        '[notifications] background watch skipped — Android foreground service permission/config missing; install a new native build after manifest changes',
      );
      return 'skipped';
    }
    console.warn('[notifications] startLocationUpdatesAsync failed (non-fatal)', error);
    return 'skipped';
  }
}

export async function stopProximityWatch(): Promise<void> {
  if (isDemoMode()) return;
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    logDebug('notifications', 'proximity watch stopped');
  }
}

let proximityWatchSyncInFlight: Promise<'started' | 'stopped' | 'skipped'> | null = null;

export async function syncProximityWatch(): Promise<'started' | 'stopped' | 'skipped'> {
  // Coalesce concurrent callers (AppState 'active' + foreground check +
  // saved-place mutations can all arrive within a few ms). Without this,
  // each caller fires a fresh chain of Supabase + Location queries which
  // pile work onto the JS thread and contributed to a native event
  // dispatcher backlog observed during idle on Android.
  if (proximityWatchSyncInFlight) {
    logDebug('perf', 'proximity_sync_skipped', { reason: 'already_running' });
    return proximityWatchSyncInFlight;
  }
  proximityWatchSyncInFlight = (async () => {
    logDebug('perf', 'proximity_sync_start');
    try {
      return await runSyncProximityWatch();
    } finally {
      proximityWatchSyncInFlight = null;
    }
  })();
  return proximityWatchSyncInFlight;
}

async function runSyncProximityWatch(): Promise<'started' | 'stopped' | 'skipped'> {
  if (isDemoMode() || isMapPreviewMode()) return 'skipped';

  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);

  // Identity and preferences, server first and durable snapshot second — the
  // same rule the notify path uses.
  //
  // The tear-down below is the dangerous part. Before this, an unreachable
  // auth server or a failed profile read looked exactly like "signed out" or
  // "notifications disabled", and the watch was STOPPED. A user who lost
  // signal would silently lose their background proximity watch and only get
  // it back on a later successful foreground sync. A failed request must
  // never disable a feature the user turned on.
  const context = await loadReminderContext();
  if (!context) {
    // No server answer AND no local snapshot: we know nothing. Leave whatever
    // is running exactly as it is.
    return 'skipped';
  }

  const profile = context.profile;
  // Only an ANSWER (server or snapshot) may switch the watch off. A missing
  // profile from the snapshot means "we never learned the preference", which
  // is not the same as "the user turned it off".
  if (profile && (!profile.notifications_enabled || !profile.nearby_notifications_enabled)) {
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

  const startStatus = await startLocationUpdatesTask();
  return startStatus === 'skipped' ? 'skipped' : 'started';
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
    logDebug('notifications', 'categories registered');
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
      logInfo('notifications', `NOTIFICATION_COUNT_RESET savedPlaceId=${savedPlaceId}`);
    }
    return;
  }

  if (actionIdentifier === 'going') {
    // TODO(notification-actions): open external maps directions to this place.
    // Fetch the place row (lat/lng/google_maps_url) via supabase and call
    // buildExternalMapsUrl from lib/externalMaps.ts, then Linking.openURL.
    logDebug('notifications', `TODO action=going savedPlaceId=${savedPlaceId} placeId=${placeId ?? 'unknown'}`);
    return;
  }

  if (actionIdentifier === 'reduce_radius') {
    // TODO(notification-actions): navigate to place/[id] settings.
    // Requires router.push — pass a callback or navigate from the calling component.
    logDebug('notifications', `TODO action=reduce_radius savedPlaceId=${savedPlaceId}`);
    return;
  }
}

// ---------------------------------------------------------------------------
// Effective-radius / quiet-hours helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective radius (in meters) for a saved place:
 *   - per-place override wins (user explicitly chose this radius)
 *   - otherwise a category-aware default (see `lib/nearbyEligibility.ts`)
 *
 * The profile-wide legacy default is deliberately not an input. The pure V2
 * policy in `lib/nearbyEligibility.ts` is shared by polling, native
 * geofencing, and the map display.
 */
export function effectiveRadiusMeters(saved: ReminderPlace): number {
  return getEffectiveNearbyNotificationRadiusMeters(saved);
}

/**
 * Are we currently inside the user's quiet-hours window?
 *
 * Returns false if quiet hours are disabled or if either bound is missing.
 * Handles windows that wrap past midnight (e.g. 22:00 → 07:00).
 *
 * Inputs are stored as Postgres `time` (`HH:MM` or `HH:MM:SS`).
 */
export function inQuietHours(profile: ReminderProfile | null, now: Date = new Date()): boolean {
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
  saved: ReminderPlace,
  profile: ReminderProfile | null,
  now: number,
): ProximityDecision {
  if (!saved.notifications_enabled) {
    return { kind: 'skip', reason: 'place-notifications-off' };
  }

  const distance = distanceMeters(here, {
    latitude: saved.place.latitude,
    longitude: saved.place.longitude,
  });
  const radius = effectiveRadiusMeters(saved);

  const memLast = lastAlertAtMem.get(saved.id) ?? 0;
  const dbLastMs = saved.last_notified_at ? Date.parse(saved.last_notified_at) : NaN;
  const isRecentlyNotified =
    now - memLast < ALERT_COOLDOWN_MS ||
    (Number.isFinite(dbLastMs) && now - dbLastMs < ALERT_COOLDOWN_MS);

  const eligibility = evaluateNearbyNotificationEligibility({
    distanceMeters: distance,
    radiusMeters: radius,
    isReliablyClosed: isPlaceReliablyClosed(saved.place.business_status),
    isRecentlyNotified,
  });

  if (!eligibility.eligible) {
    return { kind: 'skip', reason: eligibility.reason };
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
  triggerType: NotifyReason = 'background_location',
): Promise<void> {
  // --- context (server first, durable snapshot when the server is gone) ---
  const context = await loadReminderContext();
  if (!context) {
    return; // signed out with no local snapshot — nothing to do
  }
  const { userId, profile } = context;

  if (profile && !profile.notifications_enabled) {
    logDebug('checkProximity', 'master notifications off, skipping');
    return;
  }
  if (profile && !profile.nearby_notifications_enabled) {
    logDebug('checkProximity', 'nearby notifications off, skipping');
    return;
  }
  if (inQuietHours(profile)) {
    logDebug('checkProximity', 'inside quiet hours, skipping');
    return;
  }

  // --- saved places (only those with notifications enabled, not visited, not archived) ---
  const saved = context.places;
  if (saved.length === 0) return;

  // --- evaluate ---
  // Radius entry means ELIGIBLE, not automatic send: pass 1 below collects
  // every identity that just crossed outside->inside and cleared the base
  // eligibility bar (radius, closed, per-place cooldown) into `candidates`.
  // Multiple identities can collect in one tick — e.g. the user's GPS jumps
  // and they're suddenly inside two unrelated places' radii at once. Pass 2
  // picks at most one winner; everyone else is logged as lost, never sent.
  const here: LatLng = { latitude, longitude };
  const now = Date.now();
  const identities = groupSavedPlacesByIdentity(saved, here);
  const summary = {
    checked: identities.length,
    inside: 0,
    notified: 0,
    skippedCooldown: 0,
    skippedOutside: 0,
  };

  type NearbyCandidate = {
    identity: NotificationIdentityGroup;
    s: ReminderPlace;
    label: string;
    distanceMeters: number;
  };
  const candidates: NearbyCandidate[] = [];

  for (const identity of identities) {
    const s = identity.representative;
    const radius = effectiveRadiusMeters(s);
    const dist = distanceMeters(here, {
      latitude: s.place.latitude,
      longitude: s.place.longitude,
    });
    const isCurrentlyInside = dist <= radius;
    const wasInside = insideStateMap.get(identity.key);
    const label = notificationPrimaryLabel(s);

    // Always record current state for the next tick regardless of other checks.
    insideStateMap.set(identity.key, isCurrentlyInside);

    if (!isCurrentlyInside) {
      summary.skippedOutside += 1;
      continue;
    }

    summary.inside += 1;

    if (wasInside === undefined) {
      // First check this session — establish baseline; never notify on cold-start.
      continue;
    }

    if (wasInside === true) {
      continue;
    }

    // wasInside === false → outside->inside transition. Run the base
    // eligibility checks (radius, closed, per-place cooldown).
    const decision = decideProximity(here, s, profile, now);
    const categoryBucket = getNearbyNotificationRadiusBucket(resolveReminderPlaceCategory(s));
    if (decision.kind === 'skip') {
      if (decision.reason === 'recently_notified') {
        summary.skippedCooldown += 1;
      }
      logDebug('checkProximity', 'skipped after transition', {
        place: label,
        reason: decision.reason,
      });
      void trackEvent('nearby_suppressed', {
        category_bucket: categoryBucket,
        radius_meters: Math.round(radius),
        reason: decision.reason,
      });
      continue;
    }

    void trackEvent('nearby_eligible', {
      category_bucket: categoryBucket,
      radius_meters: Math.round(decision.radiusMeters),
    });
    candidates.push({ identity, s, label, distanceMeters: decision.distanceMeters });
  }

  const { winner, losers } = selectNearbyNotificationWinner(candidates);
  for (const loser of losers) {
    logDebug('checkProximity', 'lost_to_nearer_candidate', { place: loser.label });
  }

  if (winner) {
    const overlapGroup = buildNotificationAreaGroup({
      triggered: winner.s,
      allSaved: saved,
      triggerPoint: here,
      now,
    });

    if (overlapGroup.allSavedPlaceIds.length === 0) {
      summary.skippedCooldown += 1;
      logDebug('checkProximity', 'skipped overlap group', { place: winner.label });
    } else {
      const groupMemLast = lastAlertAtGroupMem.get(overlapGroup.key) ?? 0;
      const groupDbLast = latestGroupLastNotifiedAt(
        overlapGroup.identities.flatMap((groupIdentity) => groupIdentity.members),
      );
      const groupOnCooldown =
        now - groupMemLast < ALERT_COOLDOWN_MS ||
        (groupDbLast > 0 && now - groupDbLast < ALERT_COOLDOWN_MS);

      if (groupOnCooldown) {
        summary.skippedCooldown += 1;
      } else {
        const copy = buildGroupNotificationCopy(overlapGroup.labels);
        const sendResult = await sendPlaceReminderNotificationOnce({
          userId,
          saved: overlapGroup.representative,
          distance: winner.distanceMeters,
          triggerType,
          copyOverride: copy,
          groupedSavedPlaces: overlapGroup.members,
          preferredLabel: overlapGroup.labels[0] ?? winner.label,
        });
        if (sendResult.status === 'sent') {
          lastAlertAtMem.set(winner.s.id, now);
          lastAlertAtGroupMem.set(overlapGroup.key, now);
          summary.notified += 1;
          void trackEvent('nearby_notified', {
            category_bucket: getNearbyNotificationRadiusBucket(
              resolveReminderPlaceCategory(winner.s),
            ),
            grouped_count: overlapGroup.members.length,
          });
        } else if (sendResult.status === 'skipped_duplicate') {
          summary.skippedCooldown += 1;
        }
      }
    }
  }

  const summaryMessage = `summary checked=${summary.checked} inside=${summary.inside} notified=${summary.notified} skippedCooldown=${summary.skippedCooldown} skippedOutside=${summary.skippedOutside}`;
  if (summary.notified > 0) {
    logInfo('checkProximity', summaryMessage);
  } else if (isDebugLoggingEnabled()) {
    logDebug('checkProximity', summaryMessage);
  }
}

// ---------------------------------------------------------------------------
// Shared per-place notify (used by background-location path + geofence ENTER)
// ---------------------------------------------------------------------------

/**
 * Reasons a notify attempt was made. Kept short — used in dev logs only.
 */
export type NotifyReason =
  | 'geofence_enter'
  | 'background_location'
  | 'foreground_check';

export type MaybeNotifyResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | 'demo_or_preview'
        | 'no_user'
        | 'place_missing'
        | 'place_off'
        | 'master_off'
        | 'nearby_off'
        | 'quiet_hours'
        | 'closed'
        | 'cooldown_mem'
        | 'cooldown_db'
        | 'count_limit'
        | 'skipped_duplicate'
        | 'skipped_disabled'
        | 'dedupe_failed'
        | 'send_failed';
    };

type PlaceReminderSendResult =
  | { status: 'sent' }
  | { status: 'skipped_duplicate'; savedPlaceId: string; ageMs: number }
  | { status: 'skipped_disabled'; reason: 'missing_saved_place_id' }
  | { status: 'failed'; reason: 'dedupe_failed' | 'send_failed' };

async function shouldSendPlaceNotification(params: {
  savedPlaceId: string | undefined;
  triggerType: NotifyReason;
  now: number;
  cooldownMs?: number;
}): Promise<PlaceNotificationGateResult> {
  const { savedPlaceId, triggerType, now, cooldownMs } = params;
  const id = savedPlaceId?.trim() ?? '';
  logInfo(
    'notification-dedupe',
    `check saved_place_id=${id || 'missing'} trigger=${triggerType}`,
  );

  const result = await placeNotificationDedupeGate.checkAndRecord({
    savedPlaceId,
    triggerType,
    now,
    cooldownMs: cooldownMs ?? PLACE_NOTIFICATION_DEDUPE_WINDOW_MS,
  });

  if (result.status === 'skipped_duplicate') {
    logInfo(
      'notification-dedupe',
      `skipped_duplicate saved_place_id=${result.savedPlaceId} trigger=${result.triggerType} age_ms=${result.ageMs}`,
    );
  } else if (result.status === 'skipped_disabled') {
    logInfo('notification-dedupe', `missing_saved_place_id trigger=${result.triggerType}`);
  } else if (result.status === 'failed') {
    console.warn(
      `[notification-dedupe] failed saved_place_id=${result.savedPlaceId ?? 'unknown'} trigger=${result.triggerType} reason=${result.reason}`,
    );
  }

  return result;
}

async function rollbackPlaceNotificationReservations(
  savedPlaceIds: string[],
  triggerType: NotifyReason,
): Promise<void> {
  for (const savedPlaceId of savedPlaceIds) {
    if (!savedPlaceId) continue;
    await placeNotificationDedupeGate.rollback(savedPlaceId, triggerType);
  }
}

// ---------------------------------------------------------------------------
// Global arbitration — at most one nearby notification per short window,
// across BOTH send paths (background poll and native geofence ENTER).
//
// `checkProximity`'s two-pass winner selection already limits the POLLING
// path to one send attempt per tick. It cannot limit the NATIVE geofence
// path: iOS/Android can deliver ENTER events for two different,
// non-overlapping saved places as independent async invocations of the
// `NEARR_GEOFENCE_TASK` callback (see lib/geofencing.ts), and since JS is
// single-threaded but non-blocking, two such calls can genuinely interleave
// at their `await` points — each reading the per-place cooldown state
// before either one has written its result. Per-place cooldown cannot catch
// this because the two places are, by definition, different places with
// independent cooldown keys.
//
// The fix reuses the SAME dedupe gate (and its existing promise-chained
// mutex — see `withLock` in lib/placeNotificationDedupe.ts, which already
// serializes concurrent `checkAndRecord` calls so two interleaved callers
// cannot both pass) with one extra, globally-scoped key and a much shorter
// window than the per-place 5-minute one. It is claimed at the same point
// and rolled back on the same failure paths as every other reservation in
// this function, so a failed send never wrongly blocks a later, unrelated
// notification.
// ---------------------------------------------------------------------------
const NEARBY_ARBITRATION_KEY = '__nearby_global_arbitration__';
/**
 * Long enough to absorb near-simultaneous native ENTER delivery for a
 * cluster of saved places; short enough to never meaningfully delay a
 * genuinely separate, later notification.
 */
const NEARBY_ARBITRATION_WINDOW_MS = 5_000;

async function reserveGlobalNearbyArbitrationSlot(
  now: number,
): Promise<PlaceNotificationGateResult> {
  return placeNotificationDedupeGate.checkAndRecord({
    savedPlaceId: NEARBY_ARBITRATION_KEY,
    triggerType: 'global',
    now,
    cooldownMs: NEARBY_ARBITRATION_WINDOW_MS,
    dedupeAcrossTriggers: false,
  });
}

async function releaseGlobalNearbyArbitrationSlot(): Promise<void> {
  await placeNotificationDedupeGate.rollback(NEARBY_ARBITRATION_KEY, 'global');
}

async function sendPlaceReminderNotificationOnce(params: {
  userId: string;
  saved: ReminderPlace;
  distance: number;
  triggerType: NotifyReason;
  copyOverride?: { title: string; body: string };
  groupedSavedPlaces?: ReminderPlace[];
  preferredLabel?: string;
}): Promise<PlaceReminderSendResult> {
  const {
    userId,
    saved,
    distance,
    triggerType,
    copyOverride,
    groupedSavedPlaces = [saved],
    preferredLabel,
  } = params;
  const now = Date.now();

  const arbitration = await reserveGlobalNearbyArbitrationSlot(now);
  if (arbitration.status !== 'allow') {
    if (arbitration.status === 'skipped_duplicate') {
      logInfo(
        'notification-dedupe',
        `skipped_arbitration saved_place_id=${saved.id} trigger=${triggerType} age_ms=${arbitration.ageMs}`,
      );
      return {
        status: 'skipped_duplicate',
        savedPlaceId: saved.id,
        ageMs: arbitration.ageMs,
      };
    }
    return { status: 'failed', reason: 'dedupe_failed' };
  }

  const uniqueSavedPlaceIds = Array.from(
    new Set(groupedSavedPlaces.map((grouped) => grouped.id).filter((id) => !!id)),
  );
  const reservedIds: string[] = [];

  for (const savedPlaceId of uniqueSavedPlaceIds) {
    const gate = await shouldSendPlaceNotification({
      savedPlaceId,
      triggerType,
      now,
    });

    if (gate.status === 'allow') {
      reservedIds.push(savedPlaceId);
      continue;
    }

    await rollbackPlaceNotificationReservations(reservedIds, triggerType);
    await releaseGlobalNearbyArbitrationSlot();

    if (gate.status === 'skipped_duplicate') {
      return {
        status: 'skipped_duplicate',
        savedPlaceId: gate.savedPlaceId,
        ageMs: gate.ageMs,
      };
    }
    if (gate.status === 'skipped_disabled') {
      return { status: 'skipped_disabled', reason: gate.reason };
    }
    return { status: 'failed', reason: 'dedupe_failed' };
  }

  const sent = await fireNotification(
    userId,
    saved,
    distance,
    copyOverride,
    groupedSavedPlaces,
    preferredLabel,
  );

  if (!sent) {
    await rollbackPlaceNotificationReservations(reservedIds, triggerType);
    await releaseGlobalNearbyArbitrationSlot();
    return { status: 'failed', reason: 'send_failed' };
  }

  for (const savedPlaceId of uniqueSavedPlaceIds) {
    logInfo(
      'notification-dedupe',
      `sent saved_place_id=${savedPlaceId} trigger=${triggerType}`,
    );
  }

  return { status: 'sent' };
}

// ---------------------------------------------------------------------------
// Reminder context resolution (server first, durable snapshot as fallback)
// ---------------------------------------------------------------------------

/**
 * Everything the notify decision needs, and where it came from.
 *
 * `source` exists so logs can tell an offline delivery apart from an online
 * one during device validation. It never changes the decision itself — the
 * rules are identical either way, which is precisely the point: there is ONE
 * reminder engine, fed from two interchangeable data sources.
 */
type ReminderContext = {
  userId: string;
  profile: ReminderProfile | null;
  /** All currently eligible places: notifications on, not archived, not visited. */
  places: ReminderPlace[];
  source: 'server' | 'snapshot';
};

/**
 * How long the server is given to answer before we fall back to the snapshot.
 *
 * iOS hands a region-monitoring wake-up only a few seconds of background
 * execution. A request that HANGS — captive portal, half-open socket, dead
 * VPN — is worse than one that fails, because RN's fetch has no default
 * timeout and would burn the entire window before the fallback ever ran. The
 * user would get no notification despite having perfectly good local data.
 * Six seconds is generous for a healthy network and still leaves room to read
 * the snapshot and post the notification.
 */
const REMINDER_CONTEXT_TIMEOUT_MS = 6_000;

/** Resolve to null if `work` has not settled within `ms`. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Load the reminder context from Supabase.
 *
 * Returns null on ANY failure — signed out, network down, DNS, timeout, 5xx.
 * The caller then falls back to the local snapshot. We deliberately do not
 * distinguish failure modes here: from the reminder path's point of view,
 * "the server did not answer" is one condition with one response.
 */
async function loadReminderContextFromServer(): Promise<ReminderContext | null> {
  try {
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) return null;
    const userId = userRes.user.id;

    const [savedResult, profileResult] = await Promise.all([
      supabase
        .from('saved_places')
        .select('*, place:places(*)')
        .eq('user_id', userId)
        .eq('notifications_enabled', true)
        .is('archived_at', null)
        .is('visited_at', null),
      supabase
        .from('profiles')
        .select(
          'id, notifications_enabled, nearby_notifications_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end',
        )
        .eq('id', userId)
        .maybeSingle(),
    ]);

    if (savedResult.error) return null;

    return {
      userId,
      profile: (profileResult.data as ReminderProfile | null) ?? null,
      places: (savedResult.data ?? []) as ReminderPlace[],
      source: 'server',
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the reminder context, preferring authoritative server state and
 * falling back to the last successfully synced snapshot.
 *
 * THIS IS THE FUNCTION THAT MAKES OFFLINE REMINDERS WORK. When the OS wakes
 * the app for a region ENTER with no network, the server load fails in a few
 * seconds and we answer from disk instead of dropping the event.
 *
 * The snapshot path never consults Supabase auth: identity comes from the
 * active-user pointer written at the last successful sync, so a cold,
 * OS-relaunched process with an expired access token still knows whose
 * reminders it holds. Sign-out clears that pointer, so a logged-out account
 * can no longer produce notifications.
 */
async function loadReminderContext(): Promise<ReminderContext | null> {
  const server = await withTimeout(
    loadReminderContextFromServer(),
    REMINDER_CONTEXT_TIMEOUT_MS,
  );
  if (server) return server;

  const snapshot = await readActiveReminderSnapshot();
  if (!snapshot) return null;
  logInfo(
    'notifications',
    `REMINDER_CONTEXT_OFFLINE source=snapshot places=${snapshot.places.length} syncedAt=${snapshot.syncedAt}`,
  );
  return {
    userId: snapshot.userId,
    profile: snapshot.profile,
    places: snapshot.places,
    source: 'snapshot',
  };
}

/**
 * Eligibility check + send for a single saved place, identified by id.
 *
 * Centralizes the spam-prevention rules so the background-location task and
 * the geofence ENTER handler stay in lockstep:
 *   - master / nearby switches
 *   - quiet hours
 *   - per-place toggle
 *   - 12-hour cooldown (in-memory + DB)
 *   - 3-notification lifetime cap per place
 *
 * On success: schedules a local notification, bumps `last_notified_at` and
 * `notification_count`, and inserts a `notification_events` audit row.
 *
 * Never throws — always returns a structured result.
 */
export async function maybeNotifyForSavedPlace(
  savedPlaceId: string,
  reason: NotifyReason,
  triggerPoint?: LatLng,
): Promise<MaybeNotifyResult> {
  if (isDemoMode() || isMapPreviewMode()) {
    return { sent: false, reason: 'demo_or_preview' };
  }

  try {
    // Server first, durable snapshot second. Offline this is what keeps the
    // OS wake-up from being wasted.
    const context = await loadReminderContext();
    if (!context) return { sent: false, reason: 'no_user' };
    const { userId, profile } = context;
    const allSaved = context.places;

    // The eligible set already encodes "notifications on, not archived, not
    // visited", so presence in it IS the per-place eligibility check.
    const saved = allSaved.find((row) => row.id === savedPlaceId) ?? null;
    if (!saved || !saved.place) return { sent: false, reason: 'place_missing' };
    if (!saved.notifications_enabled) return { sent: false, reason: 'place_off' };

    if (profile && !profile.notifications_enabled) {
      return { sent: false, reason: 'master_off' };
    }
    if (profile && !profile.nearby_notifications_enabled) {
      return { sent: false, reason: 'nearby_off' };
    }
    if (inQuietHours(profile)) return { sent: false, reason: 'quiet_hours' };

    const categoryBucket = getNearbyNotificationRadiusBucket(resolveReminderPlaceCategory(saved));
    if (isPlaceReliablyClosed(saved.place.business_status)) {
      void trackEvent('nearby_suppressed', { category_bucket: categoryBucket, reason: 'closed' });
      return { sent: false, reason: 'closed' };
    }

    const now = Date.now();
    const trigger = triggerPoint ?? {
      latitude: saved.place.latitude,
      longitude: saved.place.longitude,
    };
    const identities = groupSavedPlacesByIdentity(allSaved, trigger);
    const triggeredIdentity =
      identities.find((identity) => identity.key === notificationDedupKey(saved)) ?? {
        key: notificationDedupKey(saved),
        representative: saved,
        members: [saved],
      };
    const identityReason = getIdentityGroupCooldownReason(triggeredIdentity, now);
    if (identityReason) {
      void trackEvent('nearby_suppressed', {
        category_bucket: categoryBucket,
        reason: 'recently_notified',
      });
      return { sent: false, reason: identityReason };
    }

    const overlapGroup = buildNotificationAreaGroup({
      triggered: saved,
      allSaved,
      triggerPoint: trigger,
      now,
    });
    if (overlapGroup.allSavedPlaceIds.length === 0) {
      void trackEvent('nearby_suppressed', {
        category_bucket: categoryBucket,
        reason: 'recently_notified',
      });
      return { sent: false, reason: 'count_limit' };
    }

    const groupMemLast = lastAlertAtGroupMem.get(overlapGroup.key) ?? 0;
    if (now - groupMemLast < ALERT_COOLDOWN_MS) {
      void trackEvent('nearby_suppressed', {
        category_bucket: categoryBucket,
        reason: 'recently_notified',
      });
      return { sent: false, reason: 'cooldown_mem' };
    }
    const groupDbLast = latestGroupLastNotifiedAt(
      overlapGroup.identities.flatMap((identity) => identity.members),
    );
    if (groupDbLast > 0 && now - groupDbLast < ALERT_COOLDOWN_MS) {
      void trackEvent('nearby_suppressed', {
        category_bucket: categoryBucket,
        reason: 'recently_notified',
      });
      return { sent: false, reason: 'cooldown_db' };
    }

    // For geofence ENTER we only know the trigger region center, not the
    // exact user coordinate. Use the triggered place radius as an upper bound.
    const radius = effectiveRadiusMeters(overlapGroup.representative);
    const copyOverride = buildGroupNotificationCopy(overlapGroup.labels);

    const sendResult = await sendPlaceReminderNotificationOnce({
      userId,
      saved: overlapGroup.representative,
      distance: radius,
      triggerType: reason,
      copyOverride,
      groupedSavedPlaces: overlapGroup.members,
      preferredLabel:
        overlapGroup.labels[0] ?? notificationPrimaryLabel(overlapGroup.representative),
    });
    if (sendResult.status === 'skipped_duplicate') {
      return { sent: false, reason: 'skipped_duplicate' };
    }
    if (sendResult.status === 'skipped_disabled') {
      return { sent: false, reason: 'skipped_disabled' };
    }
    if (sendResult.status === 'failed') {
      return {
        sent: false,
        reason: sendResult.reason === 'dedupe_failed' ? 'dedupe_failed' : 'send_failed',
      };
    }

    lastAlertAtMem.set(overlapGroup.representative.id, now);
    lastAlertAtGroupMem.set(overlapGroup.key, now);
    void trackEvent('nearby_notified', {
      category_bucket: categoryBucket,
      grouped_count: overlapGroup.members.length,
    });
    return { sent: true };
  } catch (e) {
    console.warn('[notifications] maybeNotifyForSavedPlace failed', e);
    return { sent: false, reason: 'send_failed' };
  }
}

// ---------------------------------------------------------------------------
// Side effects: schedule notification + persist event
// ---------------------------------------------------------------------------

async function fireNotification(
  userId: string,
  saved: ReminderPlace,
  distance: number,
  copyOverride?: { title: string; body: string },
  groupedSavedPlaces: ReminderPlace[] = [saved],
  preferredLabel?: string,
): Promise<boolean> {
  const groupedSavedPlaceIds = groupedSavedPlaces.map((grouped) => grouped.id);
  const count = Math.max(...groupedSavedPlaces.map((grouped) => grouped.notification_count ?? 0));
  // Notification 3 (count already at 2) uses the "Give me 3 more chances" category.
  const categoryIdentifier = count >= 2 ? NOTIFY_CATEGORY_FINAL : NOTIFY_CATEGORY_STANDARD;
  const label = preferredLabel ?? notificationPrimaryLabel(saved);
  const defaultCopy = buildNearbyCopy(label);

  logInfo(
    'notifications',
    `NOTIFICATION_TRIGGERED place=${label} dist=${Math.round(distance)}m count=${count} category=${categoryIdentifier}`,
  );

  const title = copyOverride?.title ?? defaultCopy.title;
  const body = copyOverride?.body ?? defaultCopy.body;

  // 1. Local notification.
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          savedPlaceId: saved.id,
          placeId: saved.place.id,
          nearbyCount: groupedSavedPlaceIds.length,
          groupedSavedPlaceIds,
        },
        categoryIdentifier,
      },
      trigger: null, // fire immediately
    });
    logInfo('notifications', `NOTIFICATION_SENT_SUCCESS place=${label}`);
  } catch (e) {
    console.warn(`[notifications] NOTIFICATION_SEND_FAILED place=${label}`, e);
    // Don't update DB if the notification itself didn't go out.
    return false;
  }

  // 2. Record the delivery LOCALLY first.
  //
  // Ordering matters. The server writes below are what normally enforce the
  // 12-hour cooldown and the 3-reminder lifetime cap, and offline they all
  // fail. Writing the local ledger first means that even if every server
  // write fails — and even if the process is killed immediately after — a
  // restart still knows this place was just alerted and will not repeat it.
  // Readers merge server and local state by MAX, so this can only ever
  // suppress a duplicate, never manufacture an extra notification.
  await recordLocalNotification(groupedSavedPlaceIds);

  // 3. Bump last_notified_at and increment notification_count for all
  // included saved places in the group. This keeps the 3-reminder limit
  // aligned with what the user actually saw.
  //
  // Every server write from here down is best-effort and wrapped: offline
  // they will fail, and that must not undo a notification the user has
  // already seen, nor throw out of a background task the OS woke.
  try {
    const nowIso = new Date().toISOString();
    for (const grouped of groupedSavedPlaces) {
      const { error: upErr } = await supabase
        .from('saved_places')
        .update({
          last_notified_at: nowIso,
          notification_count: (grouped.notification_count ?? 0) + 1,
        })
        .eq('id', grouped.id);
      if (upErr) {
        console.warn('[notifications] saved_places update failed', upErr.message);
      }
    }
    logInfo(
      'notifications',
      `NOTIFICATION_COUNT_INCREMENTED place=${label} group_size=${groupedSavedPlaceIds.length}`,
    );

    // 3b. Bump reminder_opportunity_count atomically for every grouped row.
    // The RPC runs `where id = any($ids) and user_id = auth.uid()` so it's
    // race-safe and RLS-safe. Failure is non-fatal: the user already saw
    // the notification, and the next opportunity will catch up.
    const { error: bumpErr } = await supabase.rpc('bump_reminder_opportunity_count', {
      saved_place_ids: groupedSavedPlaceIds,
    });
    if (bumpErr) {
      console.warn(
        '[notifications] bump_reminder_opportunity_count failed (non-fatal)',
        bumpErr.message,
      );
    }

    // 3c. Append to notification_events (audit log, insert-only per RLS).
    const { error: evErr } = await supabase.from('notification_events').insert(
      groupedSavedPlaceIds.map((savedPlaceId) => ({
        user_id: userId,
        saved_place_id: savedPlaceId,
        event_type: 'nearby',
        distance_meters: distance,
      })),
    );
    if (evErr) {
      console.warn('[notifications] event insert failed', evErr.message);
    }
  } catch (e) {
    console.warn('[notifications] post-send server writes failed (offline?)', e);
  }

  return true;
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
    logDebug('notifications', 'one-shot skipped: permission not granted');
    return { ok: false, reason: 'permission_denied' };
  }

  // Confirm the OS-level location services switch is on. On Android emulators
  // without a mock location this is the most common cause of the
  // "Current location is unavailable" error.
  try {
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      logDebug('notifications', 'one-shot skipped: location services disabled');
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
    await checkProximity(loc.coords.latitude, loc.coords.longitude, 'foreground_check');
    return { ok: true };
  } catch (e) {
    if (isExpectedLocationUnavailableError(e)) {
      logDebug(
        'notifications',
        'one-shot skipped: location unavailable',
        e instanceof Error ? e.message : e,
      );
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
    logDebug('NOTIFICATIONS_INIT', 'registering background location task');
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
        await checkProximity(last.coords.latitude, last.coords.longitude, 'background_location');
      } catch (e) {
        console.warn('[locationTask] checkProximity failed', e);
      }
    });
  }
} catch (e) {
  console.error('[NOTIFICATIONS_INIT] defineTask failed (non-fatal)', e);
}
