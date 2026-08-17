/**
 * Nearr — which saved places get an OS-monitored region, and in what order.
 *
 * Extracted from `lib/geofencing.ts` so the policy is pure, deterministic and
 * testable, and so the ONLINE sync and the OFFLINE (snapshot-backed) sync
 * provably apply the identical rule. Two code paths that select different
 * places would be a silent correctness bug the user could only discover by
 * not being reminded.
 *
 * PLATFORM CAP
 * ------------
 * Apple: "Core Location prevents any single app from monitoring more than 20
 * conditions of any type simultaneously." (Monitoring the user's proximity to
 * geographic regions). Android allows up to 100 active geofences per app.
 * Expo surfaces both limits on `startGeofencingAsync`. We cap at the platform
 * value; there is no way to monitor an unbounded collection, so when the user
 * has more eligible places than the cap we monitor a deterministic subset.
 *
 * SELECTION RULE
 * --------------
 *   1. eligible   — notifications_enabled, not archived, not visited, valid
 *                   coordinates (already filtered upstream by the query /
 *                   snapshot validator)
 *   2. deduped    — one entry per saved_places.id
 *   3. ranked     — nearest to the user's last-known location first
 *   4. tie-break  — most recently created first, then id, so the order is
 *                   total and stable across runs
 *
 * Ranking is by PROXIMITY COVERAGE only. Never by rating, popularity,
 * category, or creator — those would change which reminders a user receives
 * based on judgements they never asked for.
 */

import { distanceMeters, type LatLng } from './geo';
import type { ReminderEligiblePlace } from './reminderSnapshot';

/**
 * iOS caps monitored regions at 20 per app; Android at 100. We use the
 * stricter value on both platforms: it keeps behaviour identical across
 * platforms and it is the number the product has always shipped.
 */
export const MAX_MONITORED_REGIONS = 20;

/** Geofences below ~150m are unreliable on iOS in practice. */
export const MIN_REGION_RADIUS_M = 150;

/** Avoid huge noisy regions that fire from blocks away. */
export const MAX_REGION_RADIUS_M = 5000;

/**
 * Clamp a user-configured radius into the range the OS can monitor reliably.
 *
 * IMPORTANT: this clamps only the REGISTERED REGION. The user's configured
 * radius is untouched and remains the value the in-app proximity check and
 * the settings UI use. A city-sized saved destination therefore still shows
 * the radius the user chose; it just cannot be monitored as a 40km geofence.
 */
export function clampRegionRadius(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 0) return MIN_REGION_RADIUS_M;
  return Math.max(MIN_REGION_RADIUS_M, Math.min(MAX_REGION_RADIUS_M, meters));
}

/**
 * True when a place can be handed to the OS as a monitored region.
 *
 * Mirrors the server query's filters for the fields the snapshot carries.
 * Archived/visited rows never enter the snapshot in the first place (the
 * query filters them), so this guards the remaining per-row invariants.
 */
export function isMonitorEligible(place: ReminderEligiblePlace): boolean {
  if (!place.notifications_enabled) return false;
  const { latitude, longitude } = place.place;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  // (0,0) is the null-island signature of a failed geocode, never a saved place.
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/**
 * Deduplicate by saved_places.id, keeping the first occurrence.
 *
 * Two rows with the same id would register the same region identifier twice
 * and could produce two notifications for one boundary crossing.
 */
export function dedupeBySavedPlaceId(
  places: ReminderEligiblePlace[],
): ReminderEligiblePlace[] {
  const seen = new Map<string, ReminderEligiblePlace>();
  for (const row of places) {
    if (!seen.has(row.id)) seen.set(row.id, row);
  }
  return Array.from(seen.values());
}

/**
 * Order eligible places for monitoring: nearest first when we know where the
 * user is, otherwise newest first. Always a TOTAL order — ties fall through
 * to created_at then id — so two runs over the same data pick the same subset
 * and we do not thrash region registrations.
 */
export function rankForMonitoring(
  places: ReminderEligiblePlace[],
  here: LatLng | null,
): ReminderEligiblePlace[] {
  const withDistance = places.map((row) => ({
    row,
    distance: here
      ? distanceMeters(here, {
          latitude: row.place.latitude,
          longitude: row.place.longitude,
        })
      : 0,
  }));
  withDistance.sort((left, right) => {
    if (here && left.distance !== right.distance) {
      return left.distance - right.distance;
    }
    // Newest first — matches the existing `order('created_at', desc)` the
    // online query has always used as its fallback ordering.
    const byCreated = right.row.created_at.localeCompare(left.row.created_at);
    if (byCreated !== 0) return byCreated;
    return left.row.id.localeCompare(right.row.id);
  });
  return withDistance.map((entry) => entry.row);
}

export type MonitoredSelection = {
  /** The places that will be registered as OS regions. */
  selected: ReminderEligiblePlace[];
  /** How many eligible places there were before the cap. */
  eligible: number;
  /** How many eligible places did NOT fit under the cap. */
  skipped: number;
  /** True when the platform cap forced a subset. */
  capped: boolean;
};

/**
 * The whole policy in one call: filter, dedupe, rank, cap.
 *
 * When `eligible <= MAX_MONITORED_REGIONS` every eligible place is monitored
 * and no ranking judgement is applied to the outcome. Above the cap we
 * monitor the nearest N, which is the subset most likely to actually be
 * crossed before the next sync recalculates.
 */
export function selectMonitoredPlaces(
  places: ReminderEligiblePlace[],
  here: LatLng | null,
  limit: number = MAX_MONITORED_REGIONS,
): MonitoredSelection {
  const eligible = dedupeBySavedPlaceId(places.filter(isMonitorEligible));
  const ranked = rankForMonitoring(eligible, here);
  const selected = ranked.slice(0, Math.max(0, limit));
  return {
    selected,
    eligible: eligible.length,
    skipped: eligible.length - selected.length,
    capped: eligible.length > selected.length,
  };
}
