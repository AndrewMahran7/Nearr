/**
 * Nearr — OS-level geofencing for nearby reminders.
 *
 * This is a complement to the existing background location watch in
 * `lib/notifications.ts` (`LOCATION_TASK` / `syncProximityWatch`). The
 * background watch keeps running as a fallback; geofences fire ENTER
 * events from the OS itself, which is more reliable when the app is
 * fully suspended.
 *
 * Architecture:
 *   - One TaskManager task (`NEARR_GEOFENCE_TASK`) handles ENTER/EXIT.
 *   - On ENTER we call `maybeNotifyForSavedPlace(...)` which shares the
 *     same eligibility / cooldown / count-limit rules as the background
 *     proximity check. We never EXIT-notify.
 *   - `syncGeofencesForSavedPlaces()` (re)registers up to
 *     `MAX_GEOFENCE_REGIONS` regions for the highest-priority saved
 *     places. Calling it again replaces the active region set.
 *   - Selection and radius clamping live in `lib/reminderSelection.ts` so
 *     the online and offline paths provably apply the same rule. The
 *     user's displayed radius is never modified — only the registered
 *     region radius is clamped into the range iOS monitors reliably.
 *
 * Offline behaviour:
 *   - A SUCCESSFUL sync writes `lib/reminderSnapshot.ts`, which is what a
 *     later network-less wake-up reads.
 *   - A FAILED server read never tears regions down. We only stop
 *     monitoring when the server authoritatively says there is no user,
 *     when permissions are missing, or when there is genuinely nothing
 *     eligible. A dropped request leaves the existing regions alone.
 *
 * Platform notes:
 *   - Apple caps monitored regions at 20 per app; Android at 100. We use
 *     20 on both.
 *   - Geofencing requires Always location + notification permission.
 *   - iOS stops monitoring across a device reboot, so regions are
 *     re-registered on the next foreground — which the snapshot makes
 *     possible even with no network.
 *   - Cannot be tested in Expo Go or the iOS Simulator — must be a
 *     real device on a TestFlight / dev-client build.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { isDemoMode } from './demoMode';
import { logDebug, logInfo } from './logger';
import { isMapPreviewMode } from './mapPreview';
import { isLikelyOfflineError } from './savedPlacesCache';
import { supabase } from './supabase';
import {
  clampRegionRadius,
  MAX_MONITORED_REGIONS,
  selectMonitoredPlaces,
} from './reminderSelection';
import {
  readActiveReminderSnapshot,
  writeReminderSnapshot,
  type ReminderEligiblePlace,
} from './reminderSnapshot';
import {
  effectiveRadiusMeters,
  getNotificationPermissionState,
  maybeNotifyForSavedPlace,
} from './notifications';
import type { Profile, SavedPlaceWithPlace } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NEARR_GEOFENCE_TASK = 'NEARR_GEOFENCE_TASK';

const REGION_PREFIX = 'nearr_saved_place:';

/**
 * Apple: "Core Location prevents any single app from monitoring more than 20
 * conditions of any type simultaneously." Android allows 100. We use 20 on
 * both. Re-exported from the pure selection policy so there is exactly one
 * definition of the cap in the codebase.
 */
export const MAX_GEOFENCE_REGIONS = MAX_MONITORED_REGIONS;

// Coalesces concurrent sync calls (AppState 'active', save/update/delete,
// settings save can all fire within ms of each other). Without this guard
// each call would re-issue startGeofencingAsync, which on Android can leak
// region registrations and starve the native event dispatcher.
let geofenceSyncInFlight: Promise<GeofenceSyncStatus> | null = null;

// Stable signature of the last region set we successfully registered.
// Lets us skip startGeofencingAsync when nothing meaningful changed.
let lastRegionsSignature: string | null = null;

// ---------------------------------------------------------------------------
// Region id helpers
// ---------------------------------------------------------------------------

function regionIdFor(savedPlaceId: string): string {
  return `${REGION_PREFIX}${savedPlaceId}`;
}

function parseSavedPlaceIdFromRegion(identifier: string | undefined): string | null {
  if (!identifier || !identifier.startsWith(REGION_PREFIX)) return null;
  const id = identifier.slice(REGION_PREFIX.length);
  return id.length > 0 ? id : null;
}

// ---------------------------------------------------------------------------
// Task definition (must run at module import time)
// ---------------------------------------------------------------------------

try {
  if (!TaskManager.isTaskDefined(NEARR_GEOFENCE_TASK)) {
    logDebug('GEOFENCE_INIT', 'registering geofence task');
    TaskManager.defineTask(NEARR_GEOFENCE_TASK, async ({ data, error }) => {
      if (error) {
        console.warn('[geofence] task error', error.message);
        return;
      }

      const payload = (data ?? {}) as {
        eventType?: Location.GeofencingEventType;
        region?: Location.LocationRegion & { identifier?: string };
      };
      const eventType = payload.eventType;
      const region = payload.region;
      if (!region) return;

      const savedPlaceId = parseSavedPlaceIdFromRegion(region.identifier);
      if (!savedPlaceId) return;

      if (eventType === Location.GeofencingEventType.Enter) {
        logDebug('geofence', `GEOFENCE_ENTER savedPlaceId=${savedPlaceId}`);
        try {
          const result = await maybeNotifyForSavedPlace(savedPlaceId, 'geofence_enter', {
            latitude: region.latitude,
            longitude: region.longitude,
          });
          if (result.sent) {
            logInfo('geofence', `GEOFENCE_NOTIFY_SENT savedPlaceId=${savedPlaceId}`);
          } else {
            logDebug('geofence', `GEOFENCE_NOTIFY_SKIPPED reason=${result.reason}`);
          }
        } catch (e) {
          console.warn('[geofence] notify failed (non-fatal)', e);
        }
        return;
      }

      if (eventType === Location.GeofencingEventType.Exit) {
        logDebug('geofence', `GEOFENCE_EXIT savedPlaceId=${savedPlaceId}`);
        // No notification on exit — and never log user coordinates.
        return;
      }
    });
  }
} catch (e) {
  console.error('[GEOFENCE_INIT] defineTask failed (non-fatal)', e);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type GeofenceSyncStatus =
  | {
      state: 'started';
      eligible: number;
      registered: number;
      skipped: number;
    }
  | { state: 'stopped'; reason: string }
  | { state: 'skipped'; reason: string };

/**
 * Stop the registered geofence task. Safe to call when nothing is registered.
 */
export async function stopNearrGeofencing(): Promise<void> {
  try {
    const has = await Location.hasStartedGeofencingAsync(NEARR_GEOFENCE_TASK);
    if (has) {
      await Location.stopGeofencingAsync(NEARR_GEOFENCE_TASK);
      logDebug('geofence', 'stopped');
    }
  } catch (e) {
    logDebug('geofence', 'stop skipped', e instanceof Error ? e.message : String(e));
  }
  // Reset signature so the next sync forces a fresh registration.
  lastRegionsSignature = null;
}

/**
 * Lightweight status helper — useful for a dev/debug line in Settings.
 */
export async function getGeofenceStatus(): Promise<{
  active: boolean;
  taskName: string;
  maxRegions: number;
}> {
  let active = false;
  try {
    active = await Location.hasStartedGeofencingAsync(NEARR_GEOFENCE_TASK);
  } catch {
    active = false;
  }
  return { active, taskName: NEARR_GEOFENCE_TASK, maxRegions: MAX_GEOFENCE_REGIONS };
}

/**
 * Compute the highest-priority eligible saved places, register up to
 * `MAX_GEOFENCE_REGIONS` of them as OS-level geofences, and (re)start the
 * geofence task. Calling again replaces the previous region set.
 *
 * Never throws — returns a structured `GeofenceSyncStatus`.
 *
 * Selection priority:
 *   1. notifications_enabled = true
 *   2. valid latitude / longitude
 *   3. closest to current location (last-known fix, no prompt)
 *   4. otherwise most-recently saved
 */
export async function syncGeofencesForSavedPlaces(): Promise<GeofenceSyncStatus> {
  if (geofenceSyncInFlight) {
    logDebug('perf', 'geofence_sync_skipped', { reason: 'already_running' });
    return geofenceSyncInFlight;
  }
  geofenceSyncInFlight = (async () => {
    try {
      return await runSyncGeofencesForSavedPlaces();
    } finally {
      geofenceSyncInFlight = null;
    }
  })();
  return geofenceSyncInFlight;
}

/**
 * Resolve the places + profile to monitor.
 *
 * Server state is authoritative when reachable. When it is NOT reachable we
 * fall back to the last successfully synced snapshot rather than tearing
 * regions down — a phone in airplane mode must keep the geofences it already
 * has, and a phone rebooted offline must be able to re-register them (iOS
 * stops monitoring across a reboot, so re-registration is the only way the
 * user keeps their reminders until they are back on the network).
 *
 * Returns null only when we genuinely know there is nobody to monitor for.
 */
async function resolveGeofenceInputs(): Promise<
  | { kind: 'ready'; userId: string; profile: Profile | null; places: ReminderEligiblePlace[]; source: 'server' | 'snapshot' }
  | { kind: 'no_user' }
  | { kind: 'unavailable' }
> {
  try {
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (!userErr && userRes.user) {
      const userId = userRes.user.id;
      const [profileResult, savedResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase
          .from('saved_places')
          .select('*, place:places(*)')
          .eq('user_id', userId)
          .eq('notifications_enabled', true)
          .is('archived_at', null)
          .is('visited_at', null)
          .order('created_at', { ascending: false }),
      ]);
      if (!savedResult.error) {
        const profile = (profileResult.data as Profile | null) ?? null;
        const places = (savedResult.data ?? []) as SavedPlaceWithPlace[];
        // Persist the authoritative answer for the next offline wake-up.
        // Only a SUCCESSFUL fetch ever reaches this write.
        await writeReminderSnapshot({ userId, profile, places });
        return { kind: 'ready', userId, profile, places, source: 'server' };
      }
      console.warn('[geofence] saved_places fetch failed', savedResult.error.message);
    } else if (userErr && isLikelyOfflineError(userErr)) {
      // Fall through to the snapshot: an unreachable auth server tells us
      // nothing about whether the user is signed in.
    } else if (!userErr) {
      // Server answered and said: nobody is signed in. Authoritative.
      return { kind: 'no_user' };
    }
  } catch {
    // Treat an exception exactly like an unreachable server.
  }

  const snapshot = await readActiveReminderSnapshot();
  if (!snapshot) return { kind: 'unavailable' };
  logInfo(
    'geofence',
    `GEOFENCE_INPUTS_OFFLINE source=snapshot places=${snapshot.places.length} syncedAt=${snapshot.syncedAt}`,
  );
  return {
    kind: 'ready',
    userId: snapshot.userId,
    profile: snapshot.profile as Profile | null,
    places: snapshot.places,
    source: 'snapshot',
  };
}

async function runSyncGeofencesForSavedPlaces(): Promise<GeofenceSyncStatus> {
  if (isDemoMode() || isMapPreviewMode()) {
    return { state: 'skipped', reason: 'demo_or_preview' };
  }

  logDebug('geofence', 'GEOFENCE_SYNC_START');

  // --- permissions (local checks — no network involved) -------------------
  const [notif, bg] = await Promise.all([
    getNotificationPermissionState(),
    Location.getBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as const })),
  ]);
  if (notif !== 'granted' || bg.status !== 'granted') {
    await stopNearrGeofencing();
    logInfo(
      'geofence',
      `GEOFENCE_SYNC_DONE eligible=0 registered=0 reason=permissions notif=${notif} bg=${bg.status}`,
    );
    return { state: 'stopped', reason: 'permissions_missing' };
  }

  // --- inputs (server authoritative, snapshot fallback) -------------------
  const inputs = await resolveGeofenceInputs();
  if (inputs.kind === 'no_user') {
    await stopNearrGeofencing();
    return { state: 'stopped', reason: 'no_user' };
  }
  if (inputs.kind === 'unavailable') {
    // We could not confirm anything. Leave the currently registered regions
    // exactly as they are — stopping here would silently disable a user's
    // reminders because their coffee shop's wifi dropped a request.
    logInfo('geofence', 'GEOFENCE_SYNC_SKIPPED reason=inputs_unavailable regions_preserved');
    return { state: 'skipped', reason: 'inputs_unavailable' };
  }

  const { profile, places } = inputs;

  // --- profile master switches -------------------------------------------
  if (profile && (!profile.notifications_enabled || !profile.nearby_notifications_enabled)) {
    await stopNearrGeofencing();
    logInfo('geofence', 'GEOFENCE_SYNC_DONE eligible=0 registered=0 reason=master_or_nearby_off');
    return { state: 'stopped', reason: 'master_or_nearby_off' };
  }

  // --- ranking -----------------------------------------------------------
  // Use last-known location only (never prompt, never force a GPS fix — this
  // runs on every foreground and must not cost battery).
  let here: { latitude: number; longitude: number } | null = null;
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status === 'granted') {
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) {
        here = { latitude: last.coords.latitude, longitude: last.coords.longitude };
      }
    }
  } catch {
    // ignore — fall back to newest-first ordering
  }

  const selection = selectMonitoredPlaces(places, here, MAX_GEOFENCE_REGIONS);
  const { selected: top, eligible: eligibleCount, skipped } = selection;

  if (eligibleCount === 0) {
    await stopNearrGeofencing();
    logInfo('geofence', 'GEOFENCE_SYNC_DONE eligible=0 registered=0');
    return { state: 'stopped', reason: 'no_eligible' };
  }

  const regions: Location.LocationRegion[] = top.map((s) => ({
    identifier: regionIdFor(s.id),
    latitude: s.place.latitude,
    longitude: s.place.longitude,
    radius: clampRegionRadius(effectiveRadiusMeters(s, profile)),
    notifyOnEnter: true,
    notifyOnExit: false,
  }));

  // Skip the native call when the registered set hasn't changed. This
  // matters on Android — calling startGeofencingAsync repeatedly with the
  // same regions can leak native registrations and load the event
  // dispatcher.
  const signature = regions
    .map(
      (r) =>
        `${r.identifier}|${r.latitude.toFixed(6)}|${r.longitude.toFixed(6)}|${Math.round(r.radius ?? 0)}`,
    )
    .sort()
    .join(';');
  if (signature === lastRegionsSignature) {
    logInfo(
      'geofence',
      `GEOFENCE_SYNC_DONE eligible=${eligibleCount} registered=${regions.length} skipped=${skipped} reason=unchanged`,
    );
    return {
      state: 'started',
      eligible: eligibleCount,
      registered: regions.length,
      skipped,
    };
  }

  try {
    await Location.startGeofencingAsync(NEARR_GEOFENCE_TASK, regions);
    lastRegionsSignature = signature;
    logInfo(
      'geofence',
      `GEOFENCE_SYNC_DONE eligible=${eligibleCount} registered=${regions.length} skipped=${skipped}`,
    );
    return {
      state: 'started',
      eligible: eligibleCount,
      registered: regions.length,
      skipped,
    };
  } catch (e) {
    console.warn('[geofence] startGeofencingAsync failed (non-fatal)', e);
    return { state: 'skipped', reason: 'start_failed' };
  }
}

/**
 * Fire-and-forget convenience wrapper for callers that just want to trigger
 * a resync after mutating saved places. Never blocks the caller and never
 * throws back into the UI flow.
 */
export function triggerGeofenceResync(): void {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  syncGeofencesForSavedPlaces().catch((e) => {
    logDebug('geofence', 'triggerGeofenceResync swallowed error', e);
  });
}
