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
 * Why the request id exists (the "tap the same place twice" no-op):
 *   The map latched the target by IDENTIFIER and kept that latch in a ref for
 *   the life of the (long-lived, already-mounted) map tab. Opening place A a
 *   second time therefore navigated with byte-identical params and was
 *   swallowed by the latch — the queue closed, the map appeared, and nothing
 *   was selected. Every navigation now mints a single-use `openRequestId`, so
 *   the intent — not the place — is what gets consumed exactly once.
 *
 * No React Native / router imports and no I/O. Unit-tested from ts-node. The
 * screen supplies the router; this module only decides the validated route,
 * resolves the target row from a list, and owns the consumed-request ledger.
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
 *
 * Every call mints a fresh single-use `openRequestId`. That is what makes
 * "open place A, close it, open place A again" work on an already-mounted map:
 * the params always differ from the previous navigation (so the tab actually
 * re-renders with a new target) and the map consumes the REQUEST rather than
 * the place id.
 */
export function resolveOpenSavedPlaceRoute(args: OpenSavedPlaceArgs): MapRouteTarget {
  const savedPlaceId = validId(args.savedPlaceId);
  const googlePlaceId = validId(args.googlePlaceId);
  const params: Record<string, string> = {
    placeSource: args.source,
    openRequestId: nextOpenSavedPlaceRequestId(),
  };
  if (savedPlaceId) params.savedPlaceId = savedPlaceId;
  if (googlePlaceId) params.savedPlaceGoogleId = googlePlaceId;
  return { pathname: '/(tabs)/map', params };
}

// ---------------------------------------------------------------------------
// Single-use open requests: the navigation INTENT, tracked separately from the
// place it points at.
// ---------------------------------------------------------------------------

let openRequestSequence = 0;

/** Mint a unique id for one "open this saved place" navigation. */
export function nextOpenSavedPlaceRequestId(): string {
  openRequestSequence += 1;
  return `open-${Date.now().toString(36)}-${openRequestSequence.toString(36)}`;
}

// Consumed requests live at MODULE level, not in a screen ref, so a stale
// `openRequestId` left in the route params cannot re-open the place after the
// map tab remounts. Bounded so a long session can never grow it without limit.
const MAX_HANDLED_REQUESTS = 32;
const handledOpenRequests = new Set<string>();

export function isOpenSavedPlaceRequestHandled(key: string | null | undefined): boolean {
  const id = validId(key);
  return id ? handledOpenRequests.has(id) : false;
}

/** Mark a request consumed — the map calls this once it has focused the place
 *  OR concluded the place genuinely no longer exists. Both are terminal. */
export function markOpenSavedPlaceRequestHandled(key: string | null | undefined): void {
  const id = validId(key);
  if (!id) return;
  handledOpenRequests.add(id);
  while (handledOpenRequests.size > MAX_HANDLED_REQUESTS) {
    const oldest = handledOpenRequests.values().next().value as string | undefined;
    if (!oldest) break;
    handledOpenRequests.delete(oldest);
  }
}

/** Test-only reset. Never called from app code. */
export function resetOpenSavedPlaceRequests(): void {
  handledOpenRequests.clear();
  openRequestSequence = 0;
}

/**
 * The key the map latches on. The single-use request id when the navigation
 * carries one; otherwise the identifier itself, which preserves the pre-existing
 * behavior for cold-start deep links that only ever supply `savedPlaceId`.
 */
export function savedPlaceFocusKey(args: {
  openRequestId?: string | null;
  savedPlaceId?: string | null;
  googlePlaceId?: string | null;
}): string | null {
  return (
    validId(args.openRequestId) ?? validId(args.savedPlaceId) ?? validId(args.googlePlaceId)
  );
}

/**
 * What the map should do with the current focus target, as one PURE decision.
 *
 *   idle    — nothing requested, or this request is already consumed
 *   wait    — the request stands; data (or the map itself) is not ready yet
 *   refresh — the target is not in the loaded list; force ONE refetch
 *   focus   — the exact saved place is available; select it
 *   missing — refreshed and settled, and the place genuinely is not there
 *
 * `refresh` fires at most once per request (the caller passes back
 * `refreshRequested`), so a deleted place can never produce a refetch loop.
 */
export type SavedPlaceFocusDecision = 'idle' | 'wait' | 'refresh' | 'focus' | 'missing';

export function decideSavedPlaceFocus(args: {
  requestKey: string | null;
  handled: boolean;
  mapReady: boolean;
  found: boolean;
  /** Saved places are being fetched right now (initial OR forced refresh). */
  loading: boolean;
  /** A refresh has already been asked for on behalf of THIS request. */
  refreshRequested: boolean;
  /** That refresh has finished (resolved or rejected). */
  refreshSettled: boolean;
}): SavedPlaceFocusDecision {
  if (!args.requestKey || args.handled) return 'idle';
  if (!args.mapReady) return 'wait';
  if (args.found) return 'focus';
  if (args.loading) return 'wait';
  if (!args.refreshRequested) return 'refresh';
  if (!args.refreshSettled) return 'wait';
  return 'missing';
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

/** Manual save completion opens full details; passive notification opens do not. */
export function shouldExpandSavedPlaceDetails(source: string | null | undefined): boolean {
  return source === 'share_job_saved' || source === 'share_job_already_saved';
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
