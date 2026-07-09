import { Component, useCallback, useEffect, useState } from 'react';
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
import { handleAuthDeepLink } from '@/lib/authDeepLink';
import { clearDevAuth } from '@/lib/devAuth';
import { trackEvent } from '@/lib/analytics';
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
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
    console.error('[APP_ERROR_BOUNDARY] caught render error:', message);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    console.error('[APP_ERROR_BOUNDARY] componentDidCatch', error, info?.componentStack);
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

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading, isDevSession } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inOnboarding = segments[0] === '(onboarding)';
  // Suppress the setup reminder while the (pre-auth) onboarding intro is shown
  // — e.g. a signed-in dev preview — so permission prompts don't collide.
  const suppressSetupReminder = inOnboarding;
  const [setupReminderVisible, setSetupReminderVisible] = useState(false);
  const [needsNotifications, setNeedsNotifications] = useState(false);
  const [needsLocation, setNeedsLocation] = useState(false);
  const [setupReminderDismissedThisSession, setSetupReminderDismissedThisSession] = useState(false);
  const [legalAgreementVisible, setLegalAgreementVisible] = useState(false);
  const [acceptingLegal, setAcceptingLegal] = useState(false);

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
      isDevSession,
      segments: segments.join('/'),
    });

    // Logged out: onboarding is the PUBLIC landing. Allow the auth and
    // onboarding groups; send everything else into the intro flow.
    if (!session) {
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
  }, [session, loading, segments, router, isDevSession, inOnboarding]);

  // Run a one-shot proximity check on sign-in and on app foreground. The
  // background task does the heavy lifting; this just makes sure we react
  // promptly when the user opens the app. Skipped in dev-session mode
  // because there's no real Supabase auth — the query would just return
  // empty and we'd needlessly trigger the location prompt.
  useEffect(() => {
    if (!session || isDevSession) return;
    void syncProximityWatch();
    void checkProximityOnce();
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
      const handled = await handleAuthDeepLink(url);
      // Fallback: if onAuthStateChange didn't trigger a navigation, push
      // the user to the map explicitly so the sign-in screen doesn't stay visible.
      if (handled) {
        router.replace('/(tabs)/map');
      }
    });
    // Warm-start: app already open (e.g. tapping link while app is in background).
    const sub = ExpoLinking.addEventListener('url', async ({ url }) => {
      logDebug('deeplink', 'received URL', url.replace(/[?#].*$/, ''));
      const handled = await handleAuthDeepLink(url);
      if (handled) {
        router.replace('/(tabs)/map');
      }
    });
    return () => sub.remove();
  }, [router]);

  // Register notification action categories once per launch, and handle
  // action taps (e.g. "Give me 3 more chances" resets notification_count).
  useEffect(() => {
    void registerNotificationCategories();

    function routeFromResponse(response: Notifications.NotificationResponse) {
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
          <AuthGate>
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
              <Stack.Screen name="legal/terms" options={{ headerShown: true, title: 'Terms of Service' }} />
              <Stack.Screen name="legal/privacy" options={{ headerShown: true, title: 'Privacy Policy' }} />
              <Stack.Screen name="place/[id]" options={{ headerShown: true, title: 'Place' }} />
            </Stack>
          </AuthGate>
          <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
