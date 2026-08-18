import { Component, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Stack,
  usePathname,
  useRootNavigationState,
  useRouter,
  useSegments,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
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
import { isPostAuthRoutingPending } from '@/lib/postAuthRouting';
import { trackEvent } from '@/lib/analytics';
import { sanitizeErrorText, sanitizeStack } from '@/lib/sanitizeError';
import { buildErrorDiagnostic, recordDiagnostic } from '@/lib/deviceDiagnostics';
import {
  hydrateBreadcrumbs,
  recordBreadcrumb,
} from '@/lib/breadcrumbs';
import {
  classifyInitialUrl,
  setDiagnosticAppState,
  setDiagnosticRoute,
  setInitialUrlClassification,
  setLastNotificationId,
} from '@/lib/diagnosticContext';
import { createMapGroupFocusRequest } from '@/lib/mapGroupFocus';
import { claimSaveCompletionSignal } from '@/lib/saveCompletionNavigation';
import {
  claimUiForNotification,
  clearPendingNotificationNavigation,
  createNotificationOpenIntent,
  notificationOwnsVisibleSurface,
  notificationRouteLabel,
  planNotificationNavigation,
  resolveNotificationDestination,
  setPendingNotificationNavigation,
  takePendingNotificationNavigation,
  type NotificationOpenIntent,
} from '@/lib/notificationNavigation';
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
import { AutoSaveUndoToast } from '@/components/AutoSaveUndoToast';

logInfo('APP_START', '_layout module loaded');

// ---------------------------------------------------------------------------
// Crash-safe Error Boundary — catches render exceptions that would otherwise
// produce a blank screen in production. Shows a minimal recovery UI instead.
// ---------------------------------------------------------------------------

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
  diagnostic: string;
  copied: boolean;
};

class AppErrorBoundary extends Component<
  { children: React.ReactNode; onReturnToMap: () => void },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; onReturnToMap: () => void }) {
    super(props);
    this.state = { hasError: false, message: '', diagnostic: '', copied: false };
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
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
    recordBreadcrumb('error_boundary_triggered', {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: sanitizeErrorText(error),
    });
    // Assemble the full copy-diagnostic block ONCE, now, while the pre-crash
    // context + breadcrumb trail are still intact.
    let diagnostic = '';
    try {
      diagnostic = buildErrorDiagnostic({
        error,
        componentStack: info?.componentStack ?? null,
      });
    } catch {
      diagnostic = sanitizeErrorText(error);
    }
    this.setState({ diagnostic });
    // Persist a sanitized diagnostic (also surfaced via Settings → Copy diagnostic).
    void recordDiagnostic({
      errorCode: 'app_error_boundary',
      route: 'global',
      error,
      componentStack: info?.componentStack ?? null,
    });
  }

  private reset = () =>
    this.setState({ hasError: false, message: '', diagnostic: '', copied: false });

  private handleReturnToMap = () => {
    // Reset the boundary FIRST so the broken subtree is unmounted, then ask the
    // owner to navigate to a known-good route. Never leaves the broken tree up.
    this.reset();
    try {
      this.props.onReturnToMap();
    } catch {
      // navigation failure must not re-crash the boundary
    }
  };

  private handleCopyDiagnostic = () => {
    void Clipboard.setStringAsync(this.state.diagnostic || this.state.message)
      .then(() => this.setState({ copied: true }))
      .catch(() => undefined);
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>Nearr hit a snag</Text>
          <Text style={errorStyles.body}>
            Your saved places are safe. Head back to your map and try again.
          </Text>
          <Pressable
            style={errorStyles.primaryButton}
            onPress={this.handleReturnToMap}
            accessibilityRole="button"
            accessibilityLabel="Back to map"
          >
            <Text style={errorStyles.primaryButtonText}>Back to map</Text>
          </Pressable>
          <Pressable
            style={errorStyles.secondaryButton}
            onPress={this.reset}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={errorStyles.secondaryButtonText}>Try again</Text>
          </Pressable>
          <Pressable
            style={errorStyles.tertiaryButton}
            onPress={this.handleCopyDiagnostic}
            accessibilityRole="button"
            accessibilityLabel="Copy diagnostic"
          >
            <Text style={errorStyles.tertiaryButtonText}>
              {this.state.copied ? 'Diagnostic copied' : 'Copy diagnostic'}
            </Text>
          </Pressable>
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
  body: {
    fontSize: 15,
    textAlign: 'center',
    color: Colors.textSecondary,
    marginBottom: 24,
    lineHeight: 21,
  },
  primaryButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    marginBottom: 12,
  },
  primaryButtonText: { color: Colors.textInverse, fontWeight: '700', fontSize: 16 },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 4,
  },
  secondaryButtonText: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  tertiaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  tertiaryButtonText: { color: Colors.textMuted, fontWeight: '500', fontSize: 14 },
  detail: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginTop: 16 },
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
  const inResetPassword = segments[0] === 'reset-password';
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
      // A recovery link whose session has already lapsed must be able to say so
      // on the reset screen rather than being bounced back to the intro.
      if (inResetPassword) return;
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
    // While a screen-initiated sign-in (Apple / Google / password) is still
    // resolving its save-aware destination, leave routing to that resolver —
    // otherwise a brand-new user flashes past the first-save activation step.
    if ((inAuth || inOnboarding) && !previewingOnboarding && !isPostAuthRoutingPending()) {
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
    inResetPassword,
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
      <AutoSaveUndoToast />
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
  const pathname = usePathname();
  const segments = useSegments();
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
        // A recovery link DOES create a session, but the user must land on the
        // reset-password screen rather than the normal save-aware destination.
        publishAuthLinkStatus(result.isRecovery ? 'recovery' : 'succeeded');
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

  // App launch: hydrate the persisted breadcrumb trail (so a crash that
  // restarted the app still yields the pre-crash trail), then record launch +
  // root-layout-ready. Also mirror AppState into the diagnostic context and
  // breadcrumbs for the "Copy diagnostic" export.
  useEffect(() => {
    void hydrateBreadcrumbs().then(() => {
      recordBreadcrumb('app_launch', { appState: AppState.currentState });
      recordBreadcrumb('root_layout_ready');
    });
    setDiagnosticAppState(AppState.currentState);
    const sub = AppState.addEventListener('change', (state) => {
      setDiagnosticAppState(state);
      recordBreadcrumb('appstate_change', { appState: state });
    });
    return () => sub.remove();
  }, []);

  // Keep the diagnostic route + a route breadcrumb in sync with navigation.
  useEffect(() => {
    const route = `/${segments.join('/')}`;
    setDiagnosticRoute(route);
    recordBreadcrumb('actual_navigation', { route });
  }, [segments]);

  // Handle deep links (magic-link callback + share-incoming).
  useEffect(() => {
    // Cold-start: app launched by tapping the link.
    ExpoLinking.getInitialURL().then(async (url) => {
      if (!url) return;
      setInitialUrlClassification(classifyInitialUrl(url));
      recordBreadcrumb('initial_url_received', {
        result: classifyInitialUrl(url),
      });
      logDebug('deeplink', 'received URL', url.replace(/[?#].*$/, ''));
      await processIncomingUrl(url);
    });
    // Warm-start: app already open (e.g. tapping link while app is in background).
    const sub = ExpoLinking.addEventListener('url', async ({ url }) => {
      recordBreadcrumb('warm_url_received', { result: classifyInitialUrl(url) });
      logDebug('deeplink', 'received URL', url.replace(/[?#].*$/, ''));
      await processIncomingUrl(url);
    });
    return () => sub.remove();
  }, [processIncomingUrl]);

  // ---- notification navigation ------------------------------------------
  // ONE authority for "a notification was tapped". Every response -- foreground,
  // background resume, and cold start -- funnels through the same three steps:
  //
  //   claim the UI  ->  dismiss transient routes  ->  open the exact destination
  //
  // The decisions live in lib/notificationNavigation (pure, unit-tested); this
  // effect only owns the router and the side effects that need it.

  // Read inside the response handler, which is registered ONCE per mount.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // Expo Router publishes a root navigation state with a key once the navigator
  // can accept actions. A cold-start tap arrives BEFORE that, so its intent is
  // parked and replayed the moment this flips -- readiness is the
  // synchronization, never a timer.
  const rootNavigationState = useRootNavigationState();
  const navigationReady = !!rootNavigationState?.key;

  const runNotificationNavigation = useCallback(
    (intent: NotificationOpenIntent) => {
      const plan = planNotificationNavigation(intent, {
        pathname: pathnameRef.current,
        createMapGroupRequestId: (savedPlaceIds) =>
          createMapGroupFocusRequest({ savedPlaceIds, source: 'share_job_saved' })?.id ?? null,
      });
      if (plan.action === 'none') return;

      // Transient ROUTES first. The Queue and the queue item are transparent
      // modals, and the grouped-opportunity screen, /place/[id], add-place,
      // share and feedback all sit above the tabs. `dismissAll` pops back to
      // the tab navigator; it never touches auth, onboarding, or persisted
      // state, and it is skipped entirely when there is nothing stacked.
      if (plan.dismissTransient && router.canDismiss()) {
        router.dismissAll();
      }

      const target = { pathname: plan.pathname, params: plan.params };
      // `navigate` -- not `push` -- for the map destinations. A push resolves
      // against the state BEFORE the dismissal and stacked a SECOND (tabs)
      // navigator behind the transient screen (the Queue then survived one Back
      // gesture away). NAVIGATE to an already-present (tabs) route pops
      // everything above it and replaces its params in a single dispatch, which
      // is exactly "clear transient UI, then open the exact place".
      if (plan.action === 'navigate') router.navigate(target);
      else if (plan.action === 'replace') router.replace(target);
      else router.push(target);
    },
    [router],
  );

  const flushPendingNotificationNavigation = useCallback(() => {
    if (!navigationReady) return;
    const intent = takePendingNotificationNavigation();
    if (!intent) return;
    try {
      runNotificationNavigation(intent);
    } catch (err) {
      // Never reach the global error boundary from a notification. The intent
      // is already consumed, so this cannot loop.
      recordBreadcrumb('error_boundary_triggered', {
        route: 'notification',
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: sanitizeErrorText(err),
      });
      void recordDiagnostic({
        errorCode: 'notification_route_failed',
        route: 'notification',
        error: err,
      });
      void trackEvent('notification_destination_failed', {
        destination: intent.destination.kind,
        reason: 'navigation_failed',
      });
    }
  }, [navigationReady, runNotificationNavigation]);

  const flushNotificationNavigationRef = useRef(flushPendingNotificationNavigation);
  flushNotificationNavigationRef.current = flushPendingNotificationNavigation;

  // Cold start: the parked intent is replayed as soon as the navigator reports
  // ready. A warm tap flushes in the same tick it was queued.
  useEffect(() => {
    flushPendingNotificationNavigation();
  }, [flushPendingNotificationNavigation]);

  // Register notification action categories once per launch, and handle
  // action taps (e.g. "Give me 3 more chances" resets notification_count).
  useEffect(() => {
    void registerNotificationCategories();

    function routeFromResponse(response: Notifications.NotificationResponse) {
      try {
        const notificationId = response.notification.request.identifier;
        const responseKey = `${response.actionIdentifier ?? 'default'}:${notificationId}`;
        recordBreadcrumb('notification_tapped', { notificationId });
        // Dedupes the SAME OS response arriving twice (the cold-start
        // `getLastNotificationResponseAsync` racing the live listener). Keyed on
        // the RESPONSE, never on the place -- two separate notifications for the
        // same place stay two separate navigations.
        if (lastNotificationResponseKeyRef.current === responseKey) {
          recordBreadcrumb('notification_dedupe', {
            notificationId,
            result: 'duplicate_ignored',
          });
          return;
        }
        lastNotificationResponseKeyRef.current = responseKey;
        setLastNotificationId(notificationId);

        const { actionIdentifier, notification } = response;
        const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
        const isDefaultTap =
          !actionIdentifier ||
          actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER;

        const destination = resolveNotificationDestination({ isDefaultTap, data });

        // Action-button taps (going, reset_count, reduce_radius, next_time) keep
        // their existing handler and never navigate.
        if (destination.kind === 'none') {
          void handleNotificationAction(
            actionIdentifier,
            data.savedPlaceId as string | undefined,
            data.placeId as string | undefined,
          );
          return;
        }

        // A completed-share notification and the in-app save-completion
        // navigation can both fire for the same save; whichever claims the
        // signal first owns the navigation.
        if (
          destination.kind === 'saved_place' &&
          !destination.reminder &&
          !claimSaveCompletionSignal([destination.savedPlaceId])
        ) {
          recordBreadcrumb('notification_dedupe', {
            notificationId,
            result: 'save_completion_already_navigated',
          });
          return;
        }

        const intent = createNotificationOpenIntent(destination, notificationId);
        recordBreadcrumb('intended_route', {
          notificationId,
          result: notificationRouteLabel(destination),
        });
        // Destination KIND only -- never the place id, the job id, or any
        // notification copy.
        void trackEvent('notification_tapped', {
          destination: destination.kind,
          owns_visible_surface: notificationOwnsVisibleSurface(destination),
        });

        // Published BEFORE navigating, so the map's own transient state (search
        // dropdown, selected place, expanded detail sheet, grouped selector,
        // snackbar) is already gone by the time the destination lands -- even
        // when resolving the destination has to wait for saved places to load.
        claimUiForNotification(intent);
        setPendingNotificationNavigation(intent);
        flushNotificationNavigationRef.current();
      } catch (err) {
        // A malformed payload must NEVER reach the global error boundary.
        // Record a sanitized diagnostic and leave the user where they are
        // rather than throwing them at an unrelated place.
        recordBreadcrumb('error_boundary_triggered', {
          route: 'notification',
          errorName: err instanceof Error ? err.name : typeof err,
          errorMessage: sanitizeErrorText(err),
        });
        void recordDiagnostic({
          errorCode: 'notification_route_failed',
          route: 'notification',
          error: err,
        });
        clearPendingNotificationNavigation();
      }
    }

    // Cold-start: app was launched by tapping a notification.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) routeFromResponse(response);
      })
      .catch(() => undefined);

    // Warm-start: app already open (foreground tap, or a background resume).
    logInfo('notification-dedupe', 'listener_registered name=notification_response');
    const sub = Notifications.addNotificationResponseReceivedListener(routeFromResponse);
    return () => {
      logInfo('notification-dedupe', 'listener_cleanup name=notification_response');
      sub.remove();
    };
    // Registered ONCE per mount on purpose: the handler reads the live pathname
    // and flush function through refs, so re-subscribing on every navigation
    // (which would also re-run `getLastNotificationResponseAsync`) is neither
    // needed nor wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppErrorBoundary onReturnToMap={() => router.replace('/(tabs)/map')}>
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
              <Stack.Screen name="reset-password" />
              <Stack.Screen name="activate" />
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
                options={{
                  headerShown: false,
                  title: 'Share queue',
                  presentation: 'transparentModal',
                  animation: 'slide_from_bottom',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              <Stack.Screen
                name="share-jobs/[jobId]"
                options={{
                  headerShown: false,
                  title: 'Finish saving',
                  presentation: 'transparentModal',
                  animation: 'slide_from_bottom',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
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
