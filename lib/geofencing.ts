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
 *   - Region radius is clamped to a reliable range
 *     (`MIN_REGION_RADIUS_M` .. `MAX_REGION_RADIUS_M`) — the user's
 *     displayed setting is unchanged, only the registered geofence
 *     radius is clamped.
 *
 * Platform notes:
 *   - iOS caps monitored regions at ~20 per app, so we cap at 20.
 *   - Geofencing requires Always location + notification permission.
 *   - Cannot be tested in Expo Go or the iOS Simulator — must be a
 *     real device on a TestFlight / dev-client build.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { isDemoMode } from './demoMode';
import { isMapPreviewMode } from './mapPreview';
import { supabase } from './supabase';
import { distanceMeters } from './geo';
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

/** iOS allows ~20 monitored regions per app. Stay under that. */
export const MAX_GEOFENCE_REGIONS = 20;

/** Geofences smaller than ~150m are unreliable on iOS in practice. */
const MIN_REGION_RADIUS_M = 150;

/** Avoid huge noisy regions that will fire from blocks away. */
const MAX_REGION_RADIUS_M = 5000;

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

function clampRegionRadius(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 0) return MIN_REGION_RADIUS_M;
  return Math.max(MIN_REGION_RADIUS_M, Math.min(MAX_REGION_RADIUS_M, meters));
}

// ---------------------------------------------------------------------------
// Task definition (must run at module import time)
// ---------------------------------------------------------------------------

try {
  if (!TaskManager.isTaskDefined(NEARR_GEOFENCE_TASK)) {
    if (__DEV__) {
      console.log('[GEOFENCE_INIT] registering geofence task');
    }
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
        if (__DEV__) {
          console.log(`[geofence] GEOFENCE_ENTER savedPlaceId=${savedPlaceId}`);
        }
        try {
          const result = await maybeNotifyForSavedPlace(savedPlaceId, 'geofence_enter', {
            latitude: region.latitude,
            longitude: region.longitude,
          });
          if (__DEV__) {
            if (result.sent) {
              console.log(`[geofence] GEOFENCE_NOTIFY_SENT savedPlaceId=${savedPlaceId}`);
            } else {
              console.log(`[geofence] GEOFENCE_NOTIFY_SKIPPED reason=${result.reason}`);
            }
          }
        } catch (e) {
          console.warn('[geofence] notify failed (non-fatal)', e);
        }
        return;
      }

      if (eventType === Location.GeofencingEventType.Exit) {
        if (__DEV__) {
          console.log(`[geofence] GEOFENCE_EXIT savedPlaceId=${savedPlaceId}`);
        }
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
      if (__DEV__) console.log('[geofence] stopped');
    }
  } catch (e) {
    if (__DEV__) {
      console.log(
        '[geofence] stop skipped',
        e instanceof Error ? e.message : String(e),
      );
    }
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
    if (__DEV__) console.log('[perf] geofence_sync_skipped reason=already_running');
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

async function runSyncGeofencesForSavedPlaces(): Promise<GeofenceSyncStatus> {
  if (isDemoMode() || isMapPreviewMode()) {
    return { state: 'skipped', reason: 'demo_or_preview' };
  }

  if (__DEV__) console.log('[geofence] GEOFENCE_SYNC_START');

  // --- auth ---------------------------------------------------------------
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    await stopNearrGeofencing();
    return { state: 'stopped', reason: 'no_user' };
  }
  const userId = userRes.user.id;

  // --- permissions --------------------------------------------------------
  const [notif, bg] = await Promise.all([
    getNotificationPermissionState(),
    Location.getBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as const })),
  ]);
  if (notif !== 'granted' || bg.status !== 'granted') {
    await stopNearrGeofencing();
    if (__DEV__) {
      console.log(
        `[geofence] GEOFENCE_SYNC_DONE eligible=0 registered=0 reason=permissions notif=${notif} bg=${bg.status}`,
      );
    }
    return { state: 'stopped', reason: 'permissions_missing' };
  }

  // --- profile master switches -------------------------------------------
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  const profile = (profileRow as Profile | null) ?? null;
  if (profile && (!profile.notifications_enabled || !profile.nearby_notifications_enabled)) {
    await stopNearrGeofencing();
    if (__DEV__) {
      console.log('[geofence] GEOFENCE_SYNC_DONE eligible=0 registered=0 reason=master_or_nearby_off');
    }
    return { state: 'stopped', reason: 'master_or_nearby_off' };
  }

  // --- saved places ------------------------------------------------------
  const { data: savedRows, error: savedErr } = await supabase
    .from('saved_places')
    .select('*, place:places(*)')
    .eq('user_id', userId)
    .eq('notifications_enabled', true)
    .is('archived_at', null)
    .is('visited_at', null)
    .order('created_at', { ascending: false });

  if (savedErr) {
    console.warn('[geofence] saved_places fetch failed', savedErr.message);
    return { state: 'skipped', reason: 'fetch_failed' };
  }

  const eligible = ((savedRows ?? []) as SavedPlaceWithPlace[]).filter(
    (s) =>
      s.place &&
      Number.isFinite(s.place.latitude) &&
      Number.isFinite(s.place.longitude),
  );

  if (eligible.length === 0) {
    await stopNearrGeofencing();
    if (__DEV__) {
      console.log('[geofence] GEOFENCE_SYNC_DONE eligible=0 registered=0');
    }
    return { state: 'stopped', reason: 'no_eligible' };
  }

  // --- ranking -----------------------------------------------------------
  // Use last-known location only (no prompt). If absent, keep DB order
  // (most-recently saved first).
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
    // ignore — fall back to DB order
  }

  let ranked = eligible.slice();
  if (here) {
    const h = here;
    ranked.sort(
      (a, b) =>
        distanceMeters(h, { latitude: a.place.latitude, longitude: a.place.longitude }) -
        distanceMeters(h, { latitude: b.place.latitude, longitude: b.place.longitude }),
    );
  }

  const top = ranked.slice(0, MAX_GEOFENCE_REGIONS);
  const skipped = eligible.length - top.length;

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
    if (__DEV__) {
      console.log(
        `[geofence] GEOFENCE_SYNC_DONE eligible=${eligible.length} registered=${regions.length} skipped=${skipped} reason=unchanged`,
      );
    }
    return {
      state: 'started',
      eligible: eligible.length,
      registered: regions.length,
      skipped,
    };
  }

  try {
    await Location.startGeofencingAsync(NEARR_GEOFENCE_TASK, regions);
    lastRegionsSignature = signature;
    if (__DEV__) {
      console.log(
        `[geofence] GEOFENCE_SYNC_DONE eligible=${eligible.length} registered=${regions.length} skipped=${skipped}`,
      );
    }
    return {
      state: 'started',
      eligible: eligible.length,
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
    if (__DEV__) {
      console.log('[geofence] triggerGeofenceResync swallowed error', e);
    }
  });
}
