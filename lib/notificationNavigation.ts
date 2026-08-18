/**
 * lib/notificationNavigation.ts
 *
 * ONE canonical answer to "the user tapped a Nearr notification — what does the
 * app look like next?".
 *
 * The invariant this module exists to enforce:
 *
 *   A notification tap OWNS the next visible UI state. Whatever transient UI
 *   happened to be on screen gets out of the way, and the exact destination the
 *   notification named is what the user ends up looking at.
 *
 * Why it exists (the bug):
 *   The root layout routed every notification with a bare `router.push(...)`.
 *   Expo Router resolves a push against the CURRENT navigation state, so when a
 *   transient route was already presented — the Queue (`share-jobs/index` is a
 *   transparentModal), a queue item, a grouped-opportunity screen, `/place/[id]`,
 *   the add-place / share / feedback modals — the push diverged at the ROOT
 *   stack and stacked a SECOND `(tabs)` navigator on top of the old one. The
 *   notified place did open, but underneath the still-mounted Queue, with the
 *   stale screen one Back gesture away. Transient state the MAP owns in React
 *   (the search dropdown, the selected place, the expanded detail sheet) was
 *   never told anything at all, so a notification could open place B behind an
 *   open search overlay, or behind place A's expanded sheet.
 *
 *   Separately, a nearby reminder navigated with a bare `savedPlaceId` and no
 *   `openRequestId`, so the map's legacy per-id latch swallowed the SECOND
 *   notification for the same place: tap A, close it, tap A again -> nothing.
 *
 * The shape of the fix:
 *   1. `resolveNotificationDestination` turns a raw payload into ONE typed
 *      destination (it delegates to the existing, already-tested
 *      `routeShareJobNotification` / `routeNearbyReminder` so no product
 *      routing behavior moves).
 *   2. `createNotificationOpenIntent` stamps that destination with a single-use
 *      `openRequestId` — the SAME id that becomes the route param — so two taps
 *      of the same place are two distinct intents.
 *   3. `claimUiForNotification` publishes "a notification destination is taking
 *      ownership" to whoever holds transient UI (the map). Route-level
 *      transient UI is torn down by the navigation plan itself.
 *   4. `planNotificationNavigation` decides the router action, INCLUDING
 *      whether transient routes must be dismissed first.
 *   5. A tiny in-memory pending slot lets a cold-start tap survive until the
 *      navigator is actually ready, with no timers anywhere.
 *
 * No React Native / expo-router imports and no I/O, so every decision here is
 * unit-tested from ts-node (scripts/testNotificationNavigation.ts). The root
 * layout supplies the router; this module only decides.
 */

import { routeNearbyReminder } from './nearbyGroupRouting';
import { routeShareJobNotification, shouldReplaceShareJobDetail } from './shareJobRouting';
import { nextOpenSavedPlaceRequestId, resolveOpenSavedPlaceRoute, validId } from './openSavedPlace';

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

/**
 * Where a tapped notification is going. `none` means "this tap is not a
 * navigation" (an action button such as "Give me 3 more chances", or a payload
 * with nothing routable in it) and the caller falls through to its existing
 * action handler — it is NOT an error and must never navigate anywhere.
 */
export type NotificationDestination =
  /** The exact saved place the notification named. `saved_places.id` is the
   *  canonical identity; `googlePlaceId` is only ever a fallback. */
  | {
      kind: 'saved_place';
      savedPlaceId: string;
      googlePlaceId?: string;
      /** A nearby proximity reminder (opens Place Detail expanded + labelled). */
      reminder: boolean;
      nearbyCount?: number;
    }
  /** A share job that saved several places at once -> framed together on the map. */
  | { kind: 'saved_group'; savedPlaceIds: string[] }
  /** "You're near 4 saved places" -> the grouped browse screen, NOT one place. */
  | { kind: 'nearby_group'; savedPlaceIds: string[] }
  | { kind: 'queue_item'; jobId: string }
  | { kind: 'queue_root' }
  | { kind: 'map' }
  | { kind: 'none' };

/** The one intent object. `openRequestId` is the navigation's identity — NOT
 *  the place's — which is what makes a repeated tap on the same place a new,
 *  honoured intent instead of a swallowed duplicate. */
export type NotificationOpenIntent = {
  destination: NotificationDestination;
  openRequestId: string;
  source: 'notification';
  notificationId: string | null;
};

/**
 * Normalize a raw notification payload into exactly one destination.
 *
 * Precedence is deliberately IDENTICAL to the handler this replaced:
 *   1. action-button taps are not navigations at all
 *   2. share-job payloads (they carry an explicit `type`)
 *   3. nearby-reminder payloads (grouped first, then single)
 *   4. anything else is not a navigation
 *
 * Never throws: a malformed payload resolves to `none` or `map`, never to a
 * guessed place. Ids are never fabricated — if the payload does not name a
 * saved place, no saved place is opened.
 */
export function resolveNotificationDestination(args: {
  /** True for the default "tapped the notification body" action. */
  isDefaultTap: boolean;
  data: Record<string, unknown> | null | undefined;
}): NotificationDestination {
  if (!args.isDefaultTap) return { kind: 'none' };
  const data = args.data ?? {};

  // --- share-job notifications (server-sent push) --------------------------
  const shareJob = routeShareJobNotification(data);
  if (shareJob) {
    switch (shareJob.kind) {
      case 'saved_place':
        return {
          kind: 'saved_place',
          savedPlaceId: shareJob.savedPlaceId,
          ...(shareJob.googlePlaceId ? { googlePlaceId: shareJob.googlePlaceId } : {}),
          reminder: false,
        };
      case 'saved_group':
        return { kind: 'saved_group', savedPlaceIds: shareJob.savedPlaceIds };
      case 'queue_item':
        return { kind: 'queue_item', jobId: shareJob.jobId };
      case 'queue_root':
        return { kind: 'queue_root' };
      case 'map':
        return { kind: 'map' };
    }
  }

  // --- nearby proximity reminders (local notifications) -------------------
  if (!isNearbyReminderPayload(data)) return { kind: 'none' };

  const nearbyRoute = routeNearbyReminder(data);
  if (nearbyRoute.kind === 'group') {
    // The grouped notification promised N places. Tapping it opens the GROUP —
    // that product behavior is preserved exactly. An exact place only wins when
    // the payload names exactly one.
    return { kind: 'nearby_group', savedPlaceIds: nearbyRoute.savedPlaceIds };
  }
  if (nearbyRoute.kind === 'single') {
    const count = nearbyCountFromPayload(data);
    return {
      kind: 'saved_place',
      savedPlaceId: nearbyRoute.savedPlaceId,
      reminder: true,
      ...(count ? { nearbyCount: count } : {}),
    };
  }
  return { kind: 'map' };
}

/** The pre-existing predicate for "this payload came from a nearby reminder",
 *  kept as-is so old scheduled notifications route as they always did. Note it
 *  does NOT accept a lone `savedPlaceId` — that shape has never been a nearby
 *  reminder. */
export function isNearbyReminderPayload(
  data: Record<string, unknown> | null | undefined,
): boolean {
  const d = data ?? {};
  const grouped = Array.isArray(d.groupedSavedPlaceIds) ? d.groupedSavedPlaceIds : [];
  return !!validId(d.placeId) || typeof d.nearbyCount === 'number' || grouped.length > 0;
}

/** "You're near N saved places" — the count the user was actually shown. */
export function nearbyCountFromPayload(
  data: Record<string, unknown> | null | undefined,
): number | undefined {
  const d = data ?? {};
  const raw = d.nearbyCount;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(1, Math.floor(raw));
  const grouped = Array.isArray(d.groupedSavedPlaceIds) ? d.groupedSavedPlaceIds : [];
  return grouped.length > 0 ? grouped.length : undefined;
}

/** Mint the intent. One tap -> one id, always, even for the same place. */
export function createNotificationOpenIntent(
  destination: NotificationDestination,
  notificationId?: string | null,
): NotificationOpenIntent {
  return {
    destination,
    openRequestId: nextOpenSavedPlaceRequestId(),
    source: 'notification',
    notificationId: validId(notificationId),
  };
}

/** Does this destination take over the whole visible surface? True for every
 *  destination that LANDS ON (or over) the map. Queue destinations deliberately
 *  do not: a "needs help" tap still pushes over the queue so Back returns to
 *  the queue, exactly as before. */
export function notificationOwnsVisibleSurface(
  destination: NotificationDestination,
): boolean {
  return (
    destination.kind === 'saved_place' ||
    destination.kind === 'saved_group' ||
    destination.kind === 'nearby_group' ||
    destination.kind === 'map'
  );
}

// ---------------------------------------------------------------------------
// Transient-UI ownership claim
// ---------------------------------------------------------------------------

/**
 * Published the instant a notification destination is accepted — BEFORE the
 * destination has resolved, so an open search overlay or a stale detail sheet
 * disappears immediately rather than after a saved-place fetch settles.
 *
 * Subscribers reset TRANSIENT UI ONLY. This is not an app reset: saved places,
 * the offline cache, auth, theme, onboarding, and user settings are untouched.
 */
export type NotificationUiClaim = {
  /** Monotonic. Subscribers that dedupe by generation see each claim once. */
  generation: number;
  openRequestId: string;
  destination: NotificationDestination;
  notificationId: string | null;
};

type ClaimListener = (claim: NotificationUiClaim) => void;

let claimGeneration = 0;
let lastClaim: NotificationUiClaim | null = null;
const claimListeners = new Set<ClaimListener>();

/** Announce that a notification destination owns the UI from now on. */
export function claimUiForNotification(
  intent: NotificationOpenIntent,
): NotificationUiClaim {
  claimGeneration += 1;
  const claim: NotificationUiClaim = {
    generation: claimGeneration,
    openRequestId: intent.openRequestId,
    destination: intent.destination,
    notificationId: intent.notificationId,
  };
  lastClaim = claim;
  for (const listener of [...claimListeners]) {
    // A screen that throws while tidying itself up must never stop the
    // navigation that follows — the destination still has to win.
    try {
      listener(claim);
    } catch {
      // deliberately swallowed
    }
  }
  return claim;
}

export function subscribeToNotificationUiClaim(listener: ClaimListener): () => void {
  claimListeners.add(listener);
  return () => {
    claimListeners.delete(listener);
  };
}

/** The most recent claim, for a screen that mounts AFTER one was published. */
export function getNotificationUiClaim(): NotificationUiClaim | null {
  return lastClaim;
}

// ---------------------------------------------------------------------------
// Pending navigation (cold start)
// ---------------------------------------------------------------------------
//
// A cold-start tap is delivered by `getLastNotificationResponseAsync()` while
// the root layout is still mounting. Navigating then throws ("Attempted to
// navigate before mounting the Root Layout component"), and the old handler
// swallowed that — the launch simply landed on the map with nothing open.
//
// The intent is parked here and replayed the moment the navigator reports
// ready. IN MEMORY ONLY, at module scope: it dies with the process, so a
// notification tapped in a previous launch can never resurrect itself in an
// unrelated one.

let pendingIntent: NotificationOpenIntent | null = null;

export function setPendingNotificationNavigation(intent: NotificationOpenIntent): void {
  pendingIntent = intent;
}

export function peekPendingNotificationNavigation(): NotificationOpenIntent | null {
  return pendingIntent;
}

/** Claim the pending intent for navigation. Returns null when there is none. */
export function takePendingNotificationNavigation(): NotificationOpenIntent | null {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}

export function clearPendingNotificationNavigation(): void {
  pendingIntent = null;
}

// ---------------------------------------------------------------------------
// Navigation plan
// ---------------------------------------------------------------------------

/**
 * What the router should actually do.
 *
 *   dismissTransient — tear down transient ROUTES (Queue, queue item, grouped
 *     opportunity, /place/[id], add-place / share / feedback modals) before
 *     landing. Never applies to the tab itself and never unwinds auth.
 *
 *   action 'navigate' — the map destinations. A NAVIGATE to an already-present
 *     `(tabs)` route pops everything stacked above it AND replaces its params in
 *     ONE dispatch, which is precisely "clear transient UI, then open the exact
 *     place". A `push` here is what created the duplicate tab navigator.
 */
/** Every route a notification can land on. A closed union (not `string`) so the
 *  router call site stays typed and a typo cannot reach a device. */
export type NotificationRoutePathname =
  | '/(tabs)/map'
  | '/opportunity/group'
  | '/share-jobs'
  | '/share-jobs/[jobId]';

export type NotificationNavigationPlan =
  | { action: 'none' }
  | {
      action: 'navigate' | 'push' | 'replace';
      dismissTransient: boolean;
      pathname: NotificationRoutePathname;
      params: Record<string, string>;
    };

export type NotificationNavigationContext = {
  /** The route the app is on right now (a queue detail replaces itself). */
  pathname?: string | null;
  /** Registers a map-group focus request and returns its id (side-effecting in
   *  the app, trivially stubbed in tests). Null when the group is unusable. */
  createMapGroupRequestId?: (savedPlaceIds: string[]) => string | null;
};

export function planNotificationNavigation(
  intent: NotificationOpenIntent,
  ctx: NotificationNavigationContext = {},
): NotificationNavigationPlan {
  const destination = intent.destination;

  switch (destination.kind) {
    case 'saved_place': {
      // The ONE validated exact-place contract: resolves by `saved_places.id`
      // first and by the canonical `google_place_id` second. The intent's own
      // request id is threaded through, so the map consumes exactly the
      // navigation this tap created.
      const route = resolveOpenSavedPlaceRoute({
        savedPlaceId: destination.savedPlaceId,
        googlePlaceId: destination.googlePlaceId,
        source: 'notification',
        openRequestId: intent.openRequestId,
      });
      const params: Record<string, string> = { ...route.params };
      if (destination.reminder) {
        params.reminderOpen = 'true';
        params.reminderSource = 'nearby';
        if (destination.nearbyCount) params.nearbyCount = String(destination.nearbyCount);
      }
      return { action: 'navigate', dismissTransient: true, pathname: route.pathname, params };
    }

    case 'saved_group': {
      const groupId = ctx.createMapGroupRequestId?.(destination.savedPlaceIds) ?? null;
      return {
        action: 'navigate',
        dismissTransient: true,
        pathname: '/(tabs)/map',
        // No usable group -> the bare map. Never a guessed single place.
        params: groupId ? { mapGroupId: groupId, placeSource: 'share_job_saved' } : {},
      };
    }

    case 'nearby_group':
      return {
        action: 'push',
        // The grouped screen is itself a route ABOVE the tabs, so the transient
        // routes underneath still have to go — otherwise the Queue survives one
        // Back gesture away.
        dismissTransient: true,
        pathname: '/opportunity/group',
        params: {
          ids: destination.savedPlaceIds.join(','),
          // Distinguishes two taps of the SAME group so the second is a real
          // navigation rather than a byte-identical no-op.
          openRequestId: intent.openRequestId,
        },
      };

    case 'queue_item':
      // Unchanged: a queue item pushes so Back returns to the queue, and only
      // replaces when another queue detail is already presented.
      return {
        action: shouldReplaceShareJobDetail(ctx.pathname) ? 'replace' : 'push',
        dismissTransient: false,
        pathname: '/share-jobs/[jobId]',
        params: { jobId: destination.jobId },
      };

    case 'queue_root':
      return { action: 'push', dismissTransient: false, pathname: '/share-jobs', params: {} };

    case 'map':
      // Bare map: NAVIGATE with empty params, which also clears any focus
      // params a previous notification left in the route.
      return { action: 'navigate', dismissTransient: true, pathname: '/(tabs)/map', params: {} };

    case 'none':
    default:
      return { action: 'none' };
  }
}

/** Breadcrumb label for `intended_route`. Kept stable so existing diagnostic
 *  traces stay readable. */
export function notificationRouteLabel(destination: NotificationDestination): string {
  if (destination.kind === 'nearby_group') {
    return `nearby_group:${destination.savedPlaceIds.length}`;
  }
  return destination.kind;
}

/** Test-only. Never called from app code. */
export function resetNotificationNavigationState(): void {
  claimGeneration = 0;
  lastClaim = null;
  claimListeners.clear();
  pendingIntent = null;
}
