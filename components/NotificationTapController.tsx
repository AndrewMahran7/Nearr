import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePathname, useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { recordBreadcrumb } from '@/lib/breadcrumbs';
import { setLastNotificationId } from '@/lib/diagnosticContext';
import { createMapGroupFocusRequest } from '@/lib/mapGroupFocus';
import {
  notificationShellReady,
  notificationTapQueue,
  decideNotificationRouterOperation,
  type NotificationDestination,
  type NotificationTapOrigin,
  type PendingNotificationTap,
} from '@/lib/notificationTapRouting';
import { encodeGroupedSavedPlaceIds } from '@/lib/nearbyGroupRouting';
import { resolveOpenSavedPlaceRoute } from '@/lib/openSavedPlace';
import { sanitizeErrorText } from '@/lib/sanitizeError';
import { logInfo } from '@/lib/logger';
import { handleNotificationAction, registerNotificationCategories } from '@/services/notifications';
import { recordDiagnostic } from '@/lib/deviceDiagnostics';

type Props = { authReady: boolean };

function destinationRouteLabel(destination: NotificationDestination): string {
  switch (destination.kind) {
    case 'saved_place':
    case 'saved_group':
    case 'map':
      return '/(tabs)/map';
    case 'nearby_group':
      return '/opportunity/group';
    case 'share_job':
      return `/share-jobs/${destination.jobId}`;
    case 'share_queue':
      return '/share-jobs';
    case 'action':
      return `action:${destination.actionIdentifier}`;
    case 'none':
      return 'none';
  }
}

/**
 * Response capture/navigation adapter only. It renders nothing, owns no root
 * state, and cannot delay the Stack or auth shell. Cold taps wait in the pure,
 * bounded queue until AuthGate has restored a session and entered an app route.
 */
export function NotificationTapController({ authReady }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const pathnameRef = useRef(pathname);
  const readyRef = useRef(false);
  pathnameRef.current = pathname;
  readyRef.current = notificationShellReady({
    authReady,
    pathname,
    rootSegment: segments[0] ?? null,
  });

  const applyTap = useCallback((tap: PendingNotificationTap) => {
    const { destination } = tap.resolution;
    const route = destinationRouteLabel(destination);
    const plan = decideNotificationRouterOperation(destination, pathnameRef.current);

    recordBreadcrumb('intended_route', {
      notificationId: tap.notificationId,
      route,
      result: `${destination.kind}:${tap.resolution.fallbackReason ?? 'direct'}`,
    });

    if (destination.kind === 'action') {
      recordBreadcrumb('notification_route_applied', {
        notificationId: tap.notificationId,
        route,
        result: 'action_dispatched',
      });
      void handleNotificationAction(
        destination.actionIdentifier,
        destination.savedPlaceId,
        destination.placeId,
      );
      return;
    }

    if (plan.action === 'none') {
      recordBreadcrumb('notification_route_applied', {
        notificationId: tap.notificationId,
        route,
        result: plan.reason,
      });
      return;
    }

    try {
      let href: Parameters<typeof router.navigate>[0];
      switch (destination.kind) {
        case 'saved_place': {
          const target = resolveOpenSavedPlaceRoute({
            savedPlaceId: destination.savedPlaceId,
            googlePlaceId: destination.googlePlaceId,
            source: 'notification',
          });
          href = destination.reminder
            ? {
                pathname: target.pathname,
                params: {
                  ...target.params,
                  reminderOpen: 'true',
                  reminderSource: 'nearby',
                  ...(destination.nearbyCount
                    ? { nearbyCount: String(destination.nearbyCount) }
                    : {}),
                },
              }
            : target;
          break;
        }
        case 'saved_group': {
          const request = createMapGroupFocusRequest({
            savedPlaceIds: destination.savedPlaceIds,
            source: 'share_job_saved',
          });
          href = request
            ? {
                pathname: '/(tabs)/map',
                params: { mapGroupId: request.id, placeSource: request.source },
              }
            : '/(tabs)/map';
          break;
        }
        case 'nearby_group':
          href = {
            pathname: '/opportunity/group',
            params: { ids: encodeGroupedSavedPlaceIds(destination.savedPlaceIds) },
          };
          break;
        case 'share_job':
          href = { pathname: '/share-jobs/[jobId]', params: { jobId: destination.jobId } };
          break;
        case 'share_queue':
          href = '/share-jobs';
          break;
        case 'map':
          href = '/(tabs)/map';
          break;
        case 'none':
          return;
      }

      // `navigate` reuses/unwinds an existing destination when possible. The
      // one replace is narrowly scoped to switching transparent job details.
      if (plan.action === 'replace') router.replace(href);
      else router.navigate(href);

      recordBreadcrumb('notification_route_applied', {
        notificationId: tap.notificationId,
        route,
        result: plan.action,
      });
      logInfo(
        'notification-tap',
        `route_applied id=${tap.notificationId} origin=${tap.origin} type=${tap.resolution.notificationType} version=${tap.resolution.payloadVersion} destination=${destination.kind} action=${plan.action}`,
      );
    } catch (error) {
      const message = sanitizeErrorText(error);
      recordBreadcrumb('notification_route_applied', {
        notificationId: tap.notificationId,
        route,
        result: 'navigation_failed',
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: message,
      });
      void recordDiagnostic({
        errorCode: 'notification_route_failed',
        route,
        error,
      });
      // Never throw and never reset the root. The already-rendered screen is
      // the safe fallback if the router rejects a malformed/stale destination.
    }
  }, [router]);

  const flush = useCallback(() => {
    const taps = notificationTapQueue.drain(readyRef.current);
    for (const tap of taps) applyTap(tap);
  }, [applyTap]);

  const capture = useCallback((
    response: Notifications.NotificationResponse,
    origin: NotificationTapOrigin,
  ) => {
    const notificationId = response.notification.request.identifier;
    const actionIdentifier = response.actionIdentifier;
    const result = notificationTapQueue.capture({
      notificationId,
      actionIdentifier,
      isDefaultTap:
        !actionIdentifier || actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER,
      data: response.notification.request.content.data,
      origin,
    });

    if (result.status === 'duplicate') {
      recordBreadcrumb('notification_dedupe', {
        notificationId: typeof notificationId === 'string' ? notificationId : null,
        result: `duplicate_ignored:${origin}`,
      });
      return;
    }
    if (result.status === 'invalid_identity') {
      recordBreadcrumb('notification_dedupe', { result: 'missing_request_identifier' });
      return;
    }

    setLastNotificationId(result.tap.notificationId);
    recordBreadcrumb('notification_tapped', {
      notificationId: result.tap.notificationId,
      appState: AppState.currentState,
      result: `${origin}:${result.tap.resolution.notificationType}:${result.tap.resolution.payloadVersion}`,
    });
    if (!readyRef.current) {
      recordBreadcrumb('notification_route_applied', {
        notificationId: result.tap.notificationId,
        route: destinationRouteLabel(result.tap.resolution.destination),
        result: 'deferred_until_auth_route_ready',
      });
    }
    flush();
  }, [flush]);

  useEffect(() => {
    void registerNotificationCategories();
    logInfo('notification-tap', 'listener_registered');
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      capture(
        response,
        AppState.currentState === 'active' ? 'foreground' : 'background',
      );
    });

    // Register first so a response cannot land between cold retrieval and the
    // listener. Both delivery paths share the same process-lifetime ledger.
    void Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (response) capture(response, 'cold');
        // Prevent the OS-held response from replaying on a later ordinary
        // launch. Unsupported/older native runtimes fail open and remain safe
        // because the in-process ledger still catches listener/retrieval races.
        if (typeof Notifications.clearLastNotificationResponseAsync === 'function') {
          await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
        }
      })
      .catch(() => undefined);

    return () => {
      logInfo('notification-tap', 'listener_removed');
      subscription.remove();
    };
  }, [capture]);

  useEffect(() => {
    flush();
  }, [authReady, pathname, segments, flush]);

  return null;
}
