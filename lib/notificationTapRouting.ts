/**
 * Pure notification-tap policy and exactly-once queue.
 *
 * This module deliberately has no React Native, Expo Router, auth, or I/O
 * imports. A response is captured once, reduced to a small structured intent,
 * and held in a bounded in-memory queue until the existing app shell is ready.
 * The queue never owns startup and can never prevent the root tree rendering.
 */

import { routeNearbyReminder } from './nearbyGroupRouting';
import { routeShareJobNotification } from './shareJobRouting';

export type NotificationTapOrigin = 'cold' | 'background' | 'foreground';

export type NotificationDestination =
  | {
      kind: 'saved_place';
      savedPlaceId: string;
      googlePlaceId?: string;
      reminder: boolean;
      nearbyCount?: number;
    }
  | { kind: 'saved_group'; savedPlaceIds: string[] }
  | { kind: 'nearby_group'; savedPlaceIds: string[] }
  | { kind: 'share_job'; jobId: string }
  | { kind: 'share_queue' }
  | { kind: 'map' }
  | { kind: 'action'; actionIdentifier: string; savedPlaceId?: string; placeId?: string }
  | { kind: 'none' };

export type NotificationRouteResolution = {
  destination: NotificationDestination;
  notificationType: string;
  payloadVersion: string;
  fallbackReason?: string;
};

export type NotificationTapInput = {
  notificationId: unknown;
  actionIdentifier: unknown;
  isDefaultTap: boolean;
  data: unknown;
  origin: NotificationTapOrigin;
};

export type PendingNotificationTap = {
  responseKey: string;
  notificationId: string;
  origin: NotificationTapOrigin;
  resolution: NotificationRouteResolution;
};

export type NotificationNavigationPlan =
  | { action: 'navigate' }
  | { action: 'replace'; reason: 'switch_share_job_detail' }
  | { action: 'none'; reason: 'not_navigation' | 'destination_already_open' };

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadVersion(data: Record<string, unknown>): string {
  return text(data.payloadVersion) ?? text(data.version) ?? 'unversioned';
}

function nearbyCount(data: Record<string, unknown>): number | undefined {
  const raw = data.nearbyCount;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.floor(raw));
  }
  const ids = Array.isArray(data.groupedSavedPlaceIds) ? data.groupedSavedPlaceIds : [];
  return ids.length > 0 ? ids.length : undefined;
}

/**
 * Preserve the historical nearby discriminator. Old delivered reminders had
 * `placeId` + `savedPlaceId`; grouped reminders add count/group ids. A lone
 * savedPlaceId is intentionally not guessed to be a reminder because it can
 * belong to an unrelated/unknown payload.
 */
export function isNearbyNotificationPayload(data: Record<string, unknown>): boolean {
  return (
    !!text(data.placeId) ||
    typeof data.nearbyCount === 'number' ||
    (Array.isArray(data.groupedSavedPlaceIds) && data.groupedSavedPlaceIds.length > 0)
  );
}

/** One structured-payload resolver for cold, background, and foreground taps. */
export function resolveNotificationDestination(input: {
  data: unknown;
  isDefaultTap: boolean;
  actionIdentifier?: unknown;
}): NotificationRouteResolution {
  const data = record(input.data);
  const version = payloadVersion(data);
  const declaredType = text(data.type);

  if (!input.isDefaultTap) {
    const actionIdentifier = text(input.actionIdentifier);
    return {
      notificationType: declaredType ?? 'notification_action',
      payloadVersion: version,
      destination: actionIdentifier
        ? {
            kind: 'action',
            actionIdentifier,
            ...(text(data.savedPlaceId) ? { savedPlaceId: text(data.savedPlaceId) } : {}),
            ...(text(data.placeId) ? { placeId: text(data.placeId) } : {}),
          }
        : { kind: 'none' },
      ...(!actionIdentifier ? { fallbackReason: 'missing_action_identifier' } : {}),
    };
  }

  const shareRoute = routeShareJobNotification(data);
  if (shareRoute) {
    const notificationType = declaredType ?? 'share_job';
    switch (shareRoute.kind) {
      case 'saved_place':
        return {
          notificationType,
          payloadVersion: version,
          destination: {
            kind: 'saved_place',
            savedPlaceId: shareRoute.savedPlaceId,
            ...(shareRoute.googlePlaceId ? { googlePlaceId: shareRoute.googlePlaceId } : {}),
            reminder: false,
          },
        };
      case 'saved_group':
        return {
          notificationType,
          payloadVersion: version,
          destination: { kind: 'saved_group', savedPlaceIds: shareRoute.savedPlaceIds },
        };
      case 'queue_item':
        return {
          notificationType,
          payloadVersion: version,
          destination: { kind: 'share_job', jobId: shareRoute.jobId },
        };
      case 'queue_root':
        return {
          notificationType,
          payloadVersion: version,
          destination: { kind: 'share_queue' },
          fallbackReason: 'missing_share_job_id',
        };
      case 'map':
        return {
          notificationType,
          payloadVersion: version,
          destination: { kind: 'map' },
          fallbackReason: 'missing_saved_place_id',
        };
    }
  }

  if (isNearbyNotificationPayload(data)) {
    const route = routeNearbyReminder(data);
    if (route.kind === 'group') {
      return {
        notificationType: declaredType ?? 'nearby_group',
        payloadVersion: version,
        destination: { kind: 'nearby_group', savedPlaceIds: route.savedPlaceIds },
      };
    }
    if (route.kind === 'single') {
      const count = nearbyCount(data);
      return {
        notificationType: declaredType ?? 'nearby_single',
        payloadVersion: version,
        destination: {
          kind: 'saved_place',
          savedPlaceId: route.savedPlaceId,
          reminder: true,
          ...(count ? { nearbyCount: count } : {}),
        },
      };
    }
    return {
      notificationType: declaredType ?? 'nearby',
      payloadVersion: version,
      destination: { kind: 'map' },
      fallbackReason: 'missing_nearby_saved_place',
    };
  }

  return {
    notificationType: declaredType ?? 'unknown',
    payloadVersion: version,
    destination: { kind: 'none' },
    fallbackReason: 'unsupported_or_invalid_payload',
  };
}

/** Stable response identity. Expo request ids distinguish legitimate pushes. */
export function notificationResponseKey(input: {
  notificationId: unknown;
  actionIdentifier: unknown;
}): string | null {
  const notificationId = text(input.notificationId);
  if (!notificationId) return null;
  const actionIdentifier = text(input.actionIdentifier) ?? 'default';
  return `${actionIdentifier}:${notificationId}`;
}

/**
 * Direct-navigation policy. It never plans back/dismiss/dismissAll/reset.
 * Replacing one share-job detail with another is the only replacement because
 * stacking two transparent candidate-review sheets has no useful Back state.
 */
export function decideNotificationRouterOperation(
  destination: NotificationDestination,
  currentPathname: string | null | undefined,
): NotificationNavigationPlan {
  const pathname = currentPathname ?? '';
  if (destination.kind === 'none' || destination.kind === 'action') {
    return { action: 'none', reason: 'not_navigation' };
  }
  if (destination.kind === 'map' && /\/(?:\(tabs\)\/)?map\/?$/.test(pathname)) {
    return { action: 'none', reason: 'destination_already_open' };
  }
  if (destination.kind === 'share_queue' && /^\/share-jobs\/?$/.test(pathname)) {
    return { action: 'none', reason: 'destination_already_open' };
  }
  if (destination.kind === 'share_job') {
    const escaped = destination.jobId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^/share-jobs/${escaped}/?$`).test(pathname)) {
      return { action: 'none', reason: 'destination_already_open' };
    }
    if (/^\/share-jobs\/[^/]+\/?$/.test(pathname)) {
      return { action: 'replace', reason: 'switch_share_job_detail' };
    }
  }
  return { action: 'navigate' };
}

/**
 * Bounded process-lifetime exactly-once ledger + pending-intent queue.
 * Capturing never waits. Readiness only controls when callers drain intents.
 */
export class NotificationTapQueue {
  private readonly handled = new Set<string>();
  private readonly pending: PendingNotificationTap[] = [];

  constructor(
    private readonly maxHandled = 128,
    private readonly maxPending = 16,
  ) {}

  capture(input: NotificationTapInput):
    | { status: 'accepted'; tap: PendingNotificationTap }
    | { status: 'duplicate'; responseKey: string }
    | { status: 'invalid_identity' } {
    const responseKey = notificationResponseKey(input);
    if (!responseKey) return { status: 'invalid_identity' };
    if (this.handled.has(responseKey)) return { status: 'duplicate', responseKey };

    this.handled.add(responseKey);
    while (this.handled.size > this.maxHandled) {
      const oldest = this.handled.values().next().value as string | undefined;
      if (!oldest) break;
      this.handled.delete(oldest);
    }

    const tap: PendingNotificationTap = {
      responseKey,
      notificationId: text(input.notificationId)!,
      origin: input.origin,
      resolution: resolveNotificationDestination(input),
    };
    this.pending.push(tap);
    while (this.pending.length > this.maxPending) this.pending.shift();
    return { status: 'accepted', tap };
  }

  /** Returns and removes pending taps only when the existing shell is ready. */
  drain(ready: boolean): PendingNotificationTap[] {
    if (!ready || this.pending.length === 0) return [];
    return this.pending.splice(0, this.pending.length);
  }

  pendingCount(): number {
    return this.pending.length;
  }

  reset(): void {
    this.handled.clear();
    this.pending.splice(0, this.pending.length);
  }
}

export const notificationTapQueue = new NotificationTapQueue();

/** Auth restoration and the existing startup owner decide when this is true. */
export function notificationShellReady(args: {
  authReady: boolean;
  pathname: string | null | undefined;
  rootSegment?: string | null;
}): boolean {
  if (!args.authReady) return false;
  if (
    !args.rootSegment ||
    ['(auth)', '(onboarding)', 'auth-callback', 'reset-password', 'activate'].includes(
      args.rootSegment,
    )
  ) return false;
  const pathname = args.pathname ?? '';
  if (!pathname || pathname === '/') return false;
  return true;
}
