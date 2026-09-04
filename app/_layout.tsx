import { Component, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as ExpoLinking from 'expo-linking';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
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
import { isOnboardingV2Enabled } from '@/lib/featureFlags';
import { isOnboardingV2InProgressState } from '@/lib/onboardingV2Core';
import {
  expectedOnboardingV2Route,
  onboardingRouteKey,
  shouldNavigateOnboarding,
  type OnboardingV2Route,
  type PendingOnboardingNavigation,
} from '@/lib/onboardingV2RoutingCore';
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
} from '@/lib/diagnosticContext';
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
  syncProximityWatch,
} from '@/services/notifications';
import { acceptLegalTerms, getLegalAcceptanceStatus } from '@/services/profileService';
import '@/lib/notifications'; // registers background location task
import '@/lib/geofencing'; // registers geofence task
import { syncGeofencesForSavedPlaces } from '@/lib/geofencing';
import { Colors } from '@/constants';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { AutoSaveUndoToast } from '@/components/AutoSaveUndoToast';
import { NotificationTapController } from '@/components/NotificationTapController';
import { StartupSurface } from '@/components/StartupSurface';
import { useStartupWatchdog } from '@/hooks/useStartupWatchdog';
import { ownerForStartupRoute, resolveStartupPresentation } from '@/lib/startupWatchdogCore';

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
  const isAnonymousSession = session?.user.is_anonymous === true;
  const { state: onboardingV2, loading: onboardingV2Loading } = useOnboardingV2();
  const segments = useSegments();
  const router = useRouter();
  const currentRoute = onboardingRouteKey(segments);
  const inOnboarding = currentRoute === '/(onboarding)' || currentRoute === '/(onboarding)/account';
  const inAuth = currentRoute.startsWith('/(auth)');
  const inAuthCallback = currentRoute === '/auth-callback';
  const inResetPassword = currentRoute === '/reset-password';
  const inTabs = currentRoute.startsWith('/(tabs)');
  const pendingOnboardingNavigationRef = useRef<PendingOnboardingNavigation>(null);
  if (pendingOnboardingNavigationRef.current?.to === currentRoute) {
    pendingOnboardingNavigationRef.current = null;
  }
  // Only surface the setup reminder once the user has fully landed in the app
  // (on the tabs route) AND no magic-link exchange is still in flight. This
  // keeps the transparent modal from ever being presented over the
  // auth-callback / auth / onboarding routes or during the post-login
  // navigation transition — on iOS, presenting a modal mid-transition can
  // leave an invisible modal that swallows every touch. Reaching the tabs
  // route with a real session already implies auth + the pre-auth onboarding
  // intro are complete.
  const behavioralOnboardingActive =
    isOnboardingV2Enabled() &&
    !!onboardingV2 &&
    isOnboardingV2InProgressState(onboardingV2);
  const suppressSetupReminder = !inTabs || authLinkPending || behavioralOnboardingActive;
  const [setupReminderVisible, setSetupReminderVisible] = useState(false);
  const [needsNotifications, setNeedsNotifications] = useState(false);
  const [needsLocation, setNeedsLocation] = useState(false);
  const [setupReminderDismissedThisSession, setSetupReminderDismissedThisSession] = useState(false);
  const [legalAgreementVisible, setLegalAgreementVisible] = useState(false);
  const [acceptingLegal, setAcceptingLegal] = useState(false);
  const previousUserIdRef = useRef<string | null>(null);
  const startupPending = loading || (isOnboardingV2Enabled() && onboardingV2Loading);
  const startupWatchdog = useStartupWatchdog(startupPending);
  const startupPresentation = resolveStartupPresentation({
    pending: startupPending,
    timedOut: startupWatchdog.timedOut,
    pendingOwner: 'AUTH',
    readyOwner: ownerForStartupRoute(currentRoute),
  });

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

    if (!session || isDevSession || isAnonymousSession || !LEGAL_ACCEPTANCE_REQUIRED) {
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
  }, [session, session?.user.id, isAnonymousSession, isDevSession]);

  const refreshSetupReminder = useCallback(async (force = false) => {
    if (!session || isDevSession || isAnonymousSession) {
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
  }, [suppressSetupReminder, isAnonymousSession, isDevSession, legalAgreementVisible, session, setupReminderDismissedThisSession]);

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
    logDebug('AuthGate', 'decide', {
      hasSession: !!session,
      inAuth,
      inOnboarding,
      inAuthCallback,
      authLinkPending,
      isDevSession,
      route: currentRoute,
      onboardingStage: onboardingV2?.stage ?? null,
    });

    const replaceOnce = (expectedRoute: OnboardingV2Route) => {
      if (!shouldNavigateOnboarding({
        currentRoute,
        expectedRoute,
        pendingNavigation: pendingOnboardingNavigationRef.current,
      })) return;
      pendingOnboardingNavigationRef.current = { from: currentRoute, to: expectedRoute };
      logDebug('AuthGate', `-> ${expectedRoute}`);
      router.replace(expectedRoute);
    };

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
        replaceOnce('/(onboarding)');
      }
      return;
    }

    // A Supabase anonymous user is authenticated for RLS/share-extension
    // purposes but is still inside Onboarding V2. AuthGate is the sole owner
    // of automatic V2 routing: screens mutate durable stage only, then this
    // guarded edge moves at most once to the route that owns that stage.
    if (isAnonymousSession) {
      if (!isOnboardingV2Enabled() || onboardingV2?.cohort !== 'new_user_v2') {
        replaceOnce('/(onboarding)');
        return;
      }
      if (onboardingV2.boundUserId && onboardingV2.boundUserId !== session.user.id) {
        // A checkpoint owned by a deleted/stale identity must return to the
        // visible repair owner. Never wait forever on the route it used to own.
        replaceOnce('/(onboarding)');
        return;
      }
      const expectedRoute = expectedOnboardingV2Route(onboardingV2.stage);
      if (expectedRoute) replaceOnce(expectedRoute);
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
      replaceOnce('/(tabs)/map');
    }
  }, [
    session?.user.id,
    loading,
    currentRoute,
    router,
    isDevSession,
    inOnboarding,
    inAuthCallback,
    inResetPassword,
    authLinkPending,
    isAnonymousSession,
    onboardingV2?.boundUserId,
    onboardingV2?.cohort,
    onboardingV2?.phase1CompletedAt,
    onboardingV2?.stage,
  ]);

  // Run a one-shot proximity check on sign-in and on app foreground. The
  // background task does the heavy lifting; this just makes sure we react
  // promptly when the user opens the app. Skipped in dev-session mode
  // because there's no real Supabase auth — the query would just return
  // empty and we'd needlessly trigger the location prompt.
  useEffect(() => {
    if (!session || isDevSession || isAnonymousSession) return;
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
  }, [session, isAnonymousSession, isDevSession, refreshSetupReminder]);

  useEffect(() => {
    if (!session || isDevSession || isAnonymousSession) {
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
  }, [session, isAnonymousSession, isDevSession, suppressSetupReminder, refreshSetupReminder]);

  if (startupPresentation.mode !== 'ready') {
    return (
      <StartupSurface
        owner={startupPresentation.owner}
        recovery={startupPresentation.mode === 'recovery'}
        onRetry={startupPresentation.mode === 'recovery' ? startupWatchdog.retry : undefined}
      />
    );
  }

  return (
    <>
      {children}
      <NotificationTapController authReady={!loading && !!session && !authLinkPending} />
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
              <Stack.Screen
                name="monetization"
                options={{
                  headerShown: false,
                  title: 'Nearr Tokens',
                  presentation: 'modal',
                  gestureEnabled: true,
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
