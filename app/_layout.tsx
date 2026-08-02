import { Component, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';
import { useAuth } from '@/hooks/useAuth';
import { isOnboardingPreviewActive } from '@/lib/onboarding';
import { LegalAgreementModal, SetupReminderModal } from '@/components';
import { getLocationStatus } from '@/components/SetupChecklist';
import { handleAuthDeepLink, parseAuthCallbackUrl } from '@/lib/authDeepLink';
import { AuthLinkStatusContext } from '@/lib/authLinkStatus';
import {
  createAuthLinkDuplicateGuard,
  type AuthLinkStatus,
} from '@/lib/authDeepLinkCore';
import { clearDevAuth } from '@/lib/devAuth';
import { trackEvent } from '@/lib/analytics';
import { sanitizeErrorText, sanitizeStack } from '@/lib/sanitizeError';
import { recordDiagnostic } from '@/lib/deviceDiagnostics';
import { routeShareJobNotification } from '@/lib/shareJobRouting';
import {
  deactivatePushTokenForCurrentUser,
  registerPushTokenForCurrentUser,
} from '@/lib/pushTokens';
import { logDebug, logInfo } from '@/lib/logger';
import { LEGAL_ACCEPTANCE_REQUIRED, LEGAL_VERSION } from '@/constants';
import {
  checkProximityOnce,
  ensureNotificationPermission,
  getNotificationPermissionState,
  handleNotificationAction,
  registerNotificationCategories,
  syncProximityWatch,
} from '@/services/notifications';
import { acceptLegalTerms, getLegalAcceptanceStatus } from '@/services/profileService';
import * as Notifications from 'expo-notifications';
import '@/lib/notifications'; // registers background location task
import '@/lib/geofencing'; // registers geofence task
import { syncGeofencesForSavedPlaces } from '@/lib/geofencing';
import { Colors } from '@/constants';
import { ThemeProvider, useTheme } from '@/lib/theme';

logInfo('APP_START', '_layout module loaded');

// ---------------------------------------------------------------------------
// Crash-safe Error Boundary — catches render exceptions that would otherwise
// produce a blank screen in production. Shows a minimal recovery UI instead.
// ---------------------------------------------------------------------------

type ErrorBoundaryState = { hasError: boolean; message: string };

class AppErrorBoundary extends Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = sanitizeErrorText(error);
    console.error('[APP_ERROR_BOUNDARY] caught render error:', message);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    // Sanitized so production/device logs never contain tokens, URL
    // credentials, or user private data — while still capturing enough to
    // diagnose the next physical-device crash.
    console.error('[APP_ERROR_BOUNDARY] componentDidCatch', sanitizeErrorText(error));
    console.error('[APP_ERROR_BOUNDARY] stack', sanitizeStack(info?.componentStack));
    // Persist a sanitized diagnostic (surfaced via Settings → Copy diagnostic).
    void recordDiagnostic({
      errorCode: 'app_error_boundary',
      route: 'global',
      error,
      componentStack: info?.componentStack ?? null,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>Something went wrong</Text>
          <Text style={errorStyles.body}>
            The app encountered an unexpected error. Please force-quit and reopen.
          </Text>
          {__DEV__ && (
            <Text style={errorStyles.detail}>{this.state.message}</Text>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: Colors.bg,
  },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12, color: Colors.text },
  body: { fontSize: 15, textAlign: 'center', color: Colors.textSecondary, marginBottom: 16 },
  detail: { fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
});

function AuthGate({
  children,
  authLinkPending,
}: {
  children: React.ReactNode;
  authLinkPending: boolean;
}) {
  const { session, loading, isDevSession } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inOnboarding = segments[0] === '(onboarding)';
  const inAuthCallback = segments[0] === 'auth-callback';
  const inTabs = segments[0] === '(tabs)';
  // Only surface the setup reminder once the user has fully landed in the app
  // (on the tabs route) AND no magic-link exchange is still in flight. This
  // keeps the transparent modal from ever being presented over the
  // auth-callback / auth / onboarding routes or during the post-login
  // navigation transition — on iOS, presenting a modal mid-transition can
  // leave an invisible modal that swallows every touch. Reaching the tabs
  // route with a real session already implies auth + the pre-auth onboarding
  // intro are complete.
  const suppressSetupReminder = !inTabs || authLinkPending;
  const [setupReminderVisible, setSetupReminderVisible] = useState(false);
  const [needsNotifications, setNeedsNotifications] = useState(false);
  const [needsLocation, setNeedsLocation] = useState(false);
  const [setupReminderDismissedThisSession, setSetupReminderDismissedThisSession] = useState(false);
  const [legalAgreementVisible, setLegalAgreementVisible] = useState(false);
  const [acceptingLegal, setAcceptingLegal] = useState(false);
  const previousUserIdRef = useRef<string | null>(null);

  // Fire `session_started` once per real Supabase session (id changes when
  // the user signs in, signs out + back in, or the JWT identity changes).
  // Skipped for dev/demo sessions so we don't pollute production analytics.
  useEffect(() => {
    if (!session || isDevSession) return;
    void trackEvent('session_started', { user_id: session.user.id });
    // Intentionally keyed on user id only — an access-token refresh on the
    // same user must not re-fire this event.
  }, [session?.user.id, isDevSession]);

  useEffect(() => {
    const prev = previousUserIdRef.current;
    const next = session?.user.id ?? null;
    if (prev && prev !== next) {
      void deactivatePushTokenForCurrentUser();
    }
    previousUserIdRef.current = next;
  }, [session?.user.id]);

  useEffect(() => {
    let cancelled = false;

    if (!session || isDevSession || !LEGAL_ACCEPTANCE_REQUIRED) {
      setLegalAgreementVisible(false);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      let status: Awaited<ReturnType<typeof getLegalAcceptanceStatus>> = null;
      try {
        status = await getLegalAcceptanceStatus(session.user.id);
      } catch (err) {
        // Network/RLS error here used to leave the legal modal hidden but
        // also gated the HowNearr modal indefinitely if the effect deps
        // shifted. Fail-open: assume accepted so the rest of onboarding
        // can proceed. Logged so we can spot it in support traces.
        console.warn('[onboarding] getLegalAcceptanceStatus failed, failing open', err);
        if (!cancelled) setLegalAgreementVisible(false);
        return;
      }
      if (cancelled) return;
      setLegalAgreementVisible(!status?.acceptedCurrentVersion);
    })();

    return () => {
      cancelled = true;
    };
  }, [session, session?.user.id, isDevSession]);

  const refreshSetupReminder = useCallback(async (force = false) => {
    if (!session || isDevSession) {
      setSetupReminderVisible(false);
      setNeedsNotifications(false);
      setNeedsLocation(false);
      return;
    }
    if (LEGAL_ACCEPTANCE_REQUIRED && legalAgreementVisible) return;
    if (suppressSetupReminder) return;
    if (setupReminderDismissedThisSession && !force) return;

    const [notificationStatus, locationStatus] = await Promise.all([
      getNotificationPermissionState(),
      getLocationStatus(),
    ]);

    const missingNotifications = notificationStatus !== 'granted';
    const missingLocation = locationStatus !== 'always';

    setNeedsNotifications(missingNotifications);
    setNeedsLocation(missingLocation);
    setSetupReminderVisible(missingNotifications || missingLocation);
  }, [suppressSetupReminder, isDevSession, legalAgreementVisible, session, setupReminderDismissedThisSession]);

  async function handleAcceptLegal() {
    if (!session) return;
    setAcceptingLegal(true);
    try {
      await acceptLegalTerms(session.user.id, LEGAL_VERSION);
      setLegalAgreementVisible(false);
    } finally {
      setAcceptingLegal(false);
    }
  }

  async function handleEnableNotifications() {
    if (!needsNotifications) return;

    const current = await getNotificationPermissionState();
    if (current === 'denied') {
      await Linking.openSettings().catch(() => undefined);
      return;
    }

    await ensureNotificationPermission();
    await refreshSetupReminder(true);
  }

  async function handleOpenLocationSettings() {
    await Linking.openSettings().catch(() => undefined);
  }

  function dismissSetupReminder() {
    setSetupReminderDismissedThisSession(true);
    setSetupReminderVisible(false);
  }

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    logDebug('AuthGate', 'decide', {
      hasSession: !!session,
      inAuth,
      inOnboarding,
      inAuthCallback,
      authLinkPending,
      isDevSession,
      segments: segments.join('/'),
    });

    // Logged out: onboarding is the PUBLIC landing. Allow the auth and
    // onboarding groups; send everything else into the intro flow.
    if (!session) {
      // Critical: when a magic-link callback is being processed, keep the
      // callback route in place so auth exchange can finish deterministically.
      if (authLinkPending || inAuthCallback) {
        return;
      }
      if (!inAuth && !inOnboarding) {
        logDebug('AuthGate', '-> /(onboarding)');
        router.replace('/(onboarding)');
      }
      return;
    }

    // Signed in: onboarding is NOT a gate. Pull the user out of the auth and
    // onboarding groups into the app — EXCEPT a deliberate dev preview
    // (Settings button, dev builds only). Normal app routes (map, /share,
    // savedPlaceId focus, place detail) are left untouched.
    const previewingOnboarding =
      __DEV__ && inOnboarding && isOnboardingPreviewActive();
    if ((inAuth || inOnboarding) && !previewingOnboarding) {
      logDebug('AuthGate', '-> /(tabs)/map');
      router.replace('/(tabs)/map');
    }
  }, [
    session,
    loading,
    segments,
    router,
    isDevSession,
    inOnboarding,
    inAuthCallback,
    authLinkPending,
  ]);

  // Run a one-shot proximity check on sign-in and on app foreground. The
  // background task does the heavy lifting; this just makes sure we react
  // promptly when the user opens the app. Skipped in dev-session mode
  // because there's no real Supabase auth — the query would just return
  // empty and we'd needlessly trigger the location prompt.
  useEffect(() => {
    if (!session || isDevSession) return;
    void syncProximityWatch();
    void checkProximityOnce();
    // Register this device's Expo push token for server-sent share-job
    // notifications. No-op unless the async flag is on + permission granted.
    void registerPushTokenForCurrentUser();
    // Register OS-level geofences alongside the background-location
    // fallback. Failure is non-fatal — geofencing only works on real
    // devices and only with Always location + notification permission.
    void syncGeofencesForSavedPlaces();
    logInfo('notification-dedupe', 'listener_registered name=app_state_proximity_sync');
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setSetupReminderDismissedThisSession(false);
        void syncProximityWatch();
        void checkProximityOnce();
        void registerPushTokenForCurrentUser();
        void syncGeofencesForSavedPlaces();
        void refreshSetupReminder();
      } else if (state === 'background' || state === 'inactive') {
        setSetupReminderDismissedThisSession(false);
      }
    });
    return () => {
      logInfo('notification-dedupe', 'listener_cleanup name=app_state_proximity_sync');
      sub.remove();
    };
  }, [session, isDevSession, refreshSetupReminder]);

  useEffect(() => {
    if (!session || isDevSession) {
      setSetupReminderVisible(false);
      setNeedsNotifications(false);
      setNeedsLocation(false);
      setSetupReminderDismissedThisSession(false);
      return;
    }
    if (suppressSetupReminder) {
      setSetupReminderVisible(false);
      return;
    }
    void refreshSetupReminder();
  }, [session, isDevSession, suppressSetupReminder, refreshSetupReminder]);

  return (
    <>
      {children}
      <LegalAgreementModal
        visible={LEGAL_ACCEPTANCE_REQUIRED && legalAgreementVisible}
        onViewTerms={() => router.push('/legal/terms')}
        onViewPrivacy={() => router.push('/legal/privacy')}
        onAgree={() => void handleAcceptLegal()}
        agreeing={acceptingLegal}
      />
      <SetupReminderModal
        visible={setupReminderVisible && !suppressSetupReminder && !legalAgreementVisible}
        needs={{ notifications: needsNotifications, location: needsLocation }}
        onEnableNotifications={() => void handleEnableNotifications()}
        onOpenLocationSettings={() => void handleOpenLocationSettings()}
        onDismiss={dismissSetupReminder}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
}

function RootLayoutContent() {
  const router = useRouter();
  const { colors, resolvedTheme } = useTheme();
  // Terminal-state model for magic-link handling. `idle` before any link,
  // `processing` during the exchange, then a STICKY `succeeded`/`failed` that a
  // late-mounting auth-callback screen can always read — this closes the
  // warm-link race where a transient boolean could flip back to false before
  // the screen's effects observed it.
  const [authLinkStatus, setAuthLinkStatus] = useState<AuthLinkStatus>('idle');
  const authLinkStatusRef = useRef<AuthLinkStatus>('idle');
  const publishAuthLinkStatus = useCallback((next: AuthLinkStatus) => {
    authLinkStatusRef.current = next;
    setAuthLinkStatus(next);
  }, []);
  // Pre-filter duplicate auth links at the layout boundary so repeated URL
  // events cannot restart processing or flap status.
  const incomingAuthLinkGuardRef = useRef(createAuthLinkDuplicateGuard());
  // Monotonic run id: only the latest incoming auth-link attempt is allowed to
  // publish a terminal status. This prevents overlapping runs from older links
  // clobbering a newer attempt's state.
  const authLinkRunIdRef = useRef(0);
  const lastNotificationResponseKeyRef = useRef<string | null>(null);
  // Routing/modal gating only care about the in-flight state.
  const authLinkPending = authLinkStatus === 'processing';

  // Single responsibility: exchange the magic-link URL for a session and
  // publish the terminal status. Navigation is owned SOLELY by the
  // auth-callback screen (success -> app; failed -> sign-in), so login has
  // exactly ONE navigation authority and no competing router.replace calls.
  const processIncomingUrl = useCallback(async (url: string) => {
    const preview = parseAuthCallbackUrl(url);
    if (!preview.matches) return;

    if (incomingAuthLinkGuardRef.current.shouldIgnore(url, preview.params)) {
      console.log('[auth-link] layout_ignored_duplicate=true');
      return;
    }

    const previousStatus = authLinkStatusRef.current;
    const runId = authLinkRunIdRef.current + 1;
    authLinkRunIdRef.current = runId;

    // Reset to `processing` for every fresh/warm link so a repeated link
    // resolves against its own outcome instead of a stale terminal state.
    publishAuthLinkStatus('processing');
    try {
      const result = await handleAuthDeepLink(url);
      // Ignore stale completions from superseded runs.
      if (authLinkRunIdRef.current !== runId) return;

      if (result.sessionEstablished) {
        publishAuthLinkStatus('succeeded');
        return;
      }

      if (result.failed) {
        publishAuthLinkStatus('failed');
        return;
      }

      // Defensive fallback: ignored/non-auth responses should never strand the
      // callback route on `processing`. Restore the previous stable status.
      publishAuthLinkStatus(previousStatus);
    } catch {
      if (authLinkRunIdRef.current !== runId) return;
      publishAuthLinkStatus('failed');
    }
  }, [publishAuthLinkStatus]);

  // One-shot wipe of any leftover Local UI Mode flag. Old installs may have
  // ``nearr.devAuthEnabled=1`` persisted from before the UI entry point was
  // removed; without this, sign-out would silently re-enter Local UI Mode.
  useEffect(() => {
    void clearDevAuth();
  }, []);

  // Handle deep links (magic-link callback + share-incoming).
  useEffect(() => {
    // Cold-start: app launched by tapping the link.
    ExpoLinking.getInitialURL().then(async (url) => {
      if (!url) return;
      logDebug('deeplink', 'received URL', url.replace(/[?#].*$/, ''));
      await processIncomingUrl(url);
    });
    // Warm-start: app already open (e.g. tapping link while app is in background).
    const sub = ExpoLinking.addEventListener('url', async ({ url }) => {
      logDebug('deeplink', 'received URL', url.replace(/[?#].*$/, ''));
      await processIncomingUrl(url);
    });
    return () => sub.remove();
  }, [processIncomingUrl]);

  // Register notification action categories once per launch, and handle
  // action taps (e.g. "Give me 3 more chances" resets notification_count).
  useEffect(() => {
    void registerNotificationCategories();

    function routeFromResponse(response: Notifications.NotificationResponse) {
      try {
      const notificationId = response.notification.request.identifier;
      const responseKey = `${response.actionIdentifier ?? 'default'}:${notificationId}`;
      if (lastNotificationResponseKeyRef.current === responseKey) {
        return;
      }
      lastNotificationResponseKeyRef.current = responseKey;

      const { actionIdentifier, notification } = response;
      const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
      const savedPlaceId = data.savedPlaceId as string | undefined;
      const placeId = data.placeId as string | undefined;
      const nearbyCountRaw = data.nearbyCount;
      const groupedSavedPlaceIds = Array.isArray(data.groupedSavedPlaceIds)
        ? data.groupedSavedPlaceIds
        : [];
      const nearbyCountFromArray = groupedSavedPlaceIds.length;
      const nearbyCount =
        typeof nearbyCountRaw === 'number' && Number.isFinite(nearbyCountRaw)
          ? Math.max(1, Math.floor(nearbyCountRaw))
          : nearbyCountFromArray > 0
            ? nearbyCountFromArray
            : undefined;

      // Action-button taps keep their existing handler (reset_count, going,
      // reduce_radius, next_time). Default tap routes nearby reminders into
      // the map with the relevant saved place selected.
      const isDefaultTap =
        !actionIdentifier ||
        actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER;
      const isNearbyReminderPayload =
        !!placeId ||
        typeof nearbyCountRaw === 'number' ||
        nearbyCountFromArray > 0;

      // Async share-job notifications route by OUTCOME through one typed, pure
      // function (never throws): completed / already-saved → the existing saved
      // place; needs_help → the queue item (the detail route itself redirects
      // safely if that job has since become terminal). Old payloads without an
      // `outcome` field still route correctly by `data.type`.
      if (isDefaultTap) {
        const sjRoute = routeShareJobNotification(data);
        if (sjRoute) {
          switch (sjRoute.kind) {
            case 'saved_place':
              router.push({
                pathname: '/(tabs)/map',
                params: { savedPlaceId: sjRoute.savedPlaceId },
              });
              break;
            case 'queue_item':
              router.push({ pathname: '/share-jobs/[jobId]', params: { jobId: sjRoute.jobId } });
              break;
            case 'queue_root':
              router.push('/share-jobs');
              break;
            case 'map':
              router.push('/(tabs)/map');
              break;
          }
          return;
        }
      }

      if (isDefaultTap && isNearbyReminderPayload && savedPlaceId) {
        router.push({
          pathname: '/(tabs)/map',
          params: {
            savedPlaceId,
            reminderOpen: 'true',
            reminderSource: 'nearby',
            nearbyCount: nearbyCount ? String(nearbyCount) : undefined,
          },
        });
        return;
      }

      if (isDefaultTap && isNearbyReminderPayload) {
        router.push('/(tabs)/map');
        return;
      }

      void handleNotificationAction(actionIdentifier, savedPlaceId, placeId);
      } catch (err) {
        // A malformed payload or a navigation failure must NEVER reach the
        // global error boundary. Record a sanitized diagnostic and fall back to
        // the map instead of crashing the app.
        void recordDiagnostic({
          errorCode: 'notification_route_failed',
          route: 'notification',
          error: err,
        });
        try {
          router.push('/(tabs)/map');
        } catch {
          // give up silently — never rethrow from a notification handler
        }
      }
    }

    // Cold-start: app was launched by tapping a notification.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) routeFromResponse(response);
      })
      .catch(() => undefined);

    // Warm-start: app already open.
    logInfo('notification-dedupe', 'listener_registered name=notification_response');
    const sub = Notifications.addNotificationResponseReceivedListener(routeFromResponse);
    return () => {
      logInfo('notification-dedupe', 'listener_cleanup name=notification_response');
      sub.remove();
    };
  }, [router]);

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthLinkStatusContext.Provider value={authLinkStatus}>
          <AuthGate authLinkPending={authLinkPending}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                headerStyle: { backgroundColor: colors.bg },
                headerTitleStyle: { color: colors.text },
                headerTintColor: colors.text,
                headerShadowVisible: false,
                headerBackTitleVisible: false,
              }}
            >
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="auth-callback" />
              <Stack.Screen
                name="add-place"
                options={{ presentation: 'modal', headerShown: true, title: 'Save place' }}
              />
              <Stack.Screen
                name="share"
                options={{
                  presentation: 'modal',
                  headerShown: true,
                  title: 'Save from link',
                  // iOS: allow swipe-down to dismiss the modal. Android has no
                  // swipe gesture for native-stack modals, so the screen also
                  // renders an explicit "Close" header button (see app/share.tsx).
                  gestureEnabled: true,
                }}
              />
              <Stack.Screen
                name="feedback"
                options={{ presentation: 'modal', headerShown: true, title: 'Send feedback' }}
              />
              <Stack.Screen
                name="share-jobs/index"
                options={{ headerShown: false, title: 'Share queue' }}
              />
              <Stack.Screen
                name="share-jobs/[jobId]"
                options={{ headerShown: false, title: 'Finish saving' }}
              />
              <Stack.Screen name="legal/terms" options={{ headerShown: true, title: 'Terms of Service' }} />
              <Stack.Screen name="legal/privacy" options={{ headerShown: true, title: 'Privacy Policy' }} />
              <Stack.Screen name="place/[id]" options={{ headerShown: true, title: 'Place' }} />
            </Stack>
          </AuthGate>
          </AuthLinkStatusContext.Provider>
          <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
