/**
 * lib/openSavedPlace.ts
 *
 * ONE canonical, validated contract for opening an EXISTING saved place on the
 * map — used by every "View place" / already-saved / post-save destination so
 * the identifier contract can never drift again.
 *
 * Why this exists (the already-saved crash / no-op):
 *   Several call sites navigated to `/(tabs)/map` with a `savedPlaceId`, but the
 *   map could only ever resolve by `saved_places.id`. When that row could not be
 *   found in the freshly-loaded list (a stale id, a deleted-then-re-saved place,
 *   or a cache that had not hydrated), the destination silently failed — and any
 *   downstream code that assumed the lookup succeeded was one unchecked deref
 *   away from the global error boundary. This module makes the destination
 *   resolve by `saved_places.id` FIRST and fall back to the canonical
 *   `google_place_id` (the stable identity of an already-saved place), so
 *   "View place" reliably opens the place that is actually on the user's map.
 *
 * PURE — no React Native / router imports, no I/O. Unit-tested from ts-node.
 * The screen supplies the router; this module only decides the validated route
 * and resolves the target row from a list.
 */

/** Where an "open existing place" navigation originated (breadcrumbs only). */
export type OpenSavedPlaceSource =
  | 'share_job_already_saved'
  | 'share_job_completed'
  | 'share_job_saved'
  | 'notification';

export type OpenSavedPlaceArgs = {
  /** Primary destination: the user's existing saved_places row id. */
  savedPlaceId?: string | null;
  /** Stable fallback identity when the saved_places id can't be resolved. */
  googlePlaceId?: string | null;
  source: OpenSavedPlaceSource;
};

/** A validated Expo Router target for the map tab. Always navigable. */
export type MapRouteTarget = {
  pathname: '/(tabs)/map';
  params: Record<string, string>;
};

/** Trim + reject empty / non-string ids (route params can be arrays/undefined). */
export function validId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build the validated map route for opening an existing saved place. NEVER
 * throws and ALWAYS returns a navigable target: a bare `/(tabs)/map` when no
 * usable identifier is present, so a malformed/backward-compatible payload can
 * never reach the global error boundary.
 */
export function resolveOpenSavedPlaceRoute(args: OpenSavedPlaceArgs): MapRouteTarget {
  const savedPlaceId = validId(args.savedPlaceId);
  const googlePlaceId = validId(args.googlePlaceId);
  const params: Record<string, string> = { placeSource: args.source };
  if (savedPlaceId) params.savedPlaceId = savedPlaceId;
  if (googlePlaceId) params.savedPlaceGoogleId = googlePlaceId;
  return { pathname: '/(tabs)/map', params };
}

/** True when a `placeSource` route param came from opening an existing place
 *  (so the map can show a friendly "no longer available" recovery instead of
 *  silently doing nothing when the row is gone). */
export function isOpenExistingPlaceSource(source: string | null | undefined): boolean {
  return (
    source === 'share_job_already_saved' ||
    source === 'share_job_completed' ||
    source === 'share_job_saved' ||
    source === 'notification'
  );
}

export function openSavedPlaceMessage(source: string | null | undefined): string | null {
  if (source === 'share_job_already_saved') return 'Already on your map';
  if (source === 'share_job_saved' || source === 'share_job_completed') {
    return 'Saved to your map';
  }
  return null;
}

/** Minimal shape the map needs to resolve a saved place for opening. */
type ResolvableSavedPlace = {
  id: string;
  place?: { google_place_id?: string | null } | null;
};

/**
 * Resolve the saved place to open from a list, by `saved_places.id` first and
 * the canonical `google_place_id` second. Returns null when neither matches —
 * the caller then shows a local "no longer available" state (never a crash).
 *
 * PURE — used by the map's deep-link focus effect and unit-tested directly, so
 * the already-saved resolution logic has one tested source of truth.
 */
export function findSavedPlaceForOpen<T extends ResolvableSavedPlace>(
  places: T[] | null | undefined,
  args: { savedPlaceId?: string | null; googlePlaceId?: string | null },
): T | null {
  if (!Array.isArray(places) || places.length === 0) return null;
  const savedPlaceId = validId(args.savedPlaceId);
  const googlePlaceId = validId(args.googlePlaceId);

  if (savedPlaceId) {
    const byId = places.find((p) => p?.id === savedPlaceId);
    if (byId) return byId;
  }
  if (googlePlaceId) {
    const byGoogle = places.find((p) => p?.place?.google_place_id === googlePlaceId);
    if (byGoogle) return byGoogle;
  }
  return null;
}
