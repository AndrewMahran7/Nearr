import { Component, useEffect } from 'react';
import { AppState, Text, View, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { useAuth } from '@/hooks/useAuth';
import { handleAuthDeepLink } from '@/lib/authDeepLink';
import { clearDevAuth } from '@/lib/devAuth';
import { trackEvent } from '@/lib/analytics';
import { checkProximityOnce, registerNotificationCategories, handleNotificationAction } from '@/services/notifications';
import * as Notifications from 'expo-notifications';
import '@/lib/notifications'; // registers background task

console.log('[APP_START] _layout module loaded');

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
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12 },
  body: { fontSize: 15, textAlign: 'center', color: '#555', marginBottom: 16 },
  detail: { fontSize: 12, color: '#999', textAlign: 'center' },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading, isDevSession } = useAuth();
  const segments = useSegments();
  const router = useRouter();

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
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    if (__DEV__) {
      console.log('[AuthGate] decide', {
        hasSession: !!session,
        inAuth,
        segments: segments.join('/'),
      });
    }
    if (!session && !inAuth) {
      if (__DEV__) console.log('[AuthGate] -> /(auth)/sign-in');
      router.replace('/(auth)/sign-in');
    } else if (session && inAuth) {
      if (__DEV__) console.log('[AuthGate] -> /(tabs)/home');
      router.replace('/(tabs)/home');
    }
  }, [session, loading, segments, router]);

  // Run a one-shot proximity check on sign-in and on app foreground. The
  // background task does the heavy lifting; this just makes sure we react
  // promptly when the user opens the app. Skipped in dev-session mode
  // because there's no real Supabase auth — the query would just return
  // empty and we'd needlessly trigger the location prompt.
  useEffect(() => {
    if (!session || isDevSession) return;
    void checkProximityOnce();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkProximityOnce();
    });
    return () => sub.remove();
  }, [session, isDevSession]);

  return <>{children}</>;
}

export default function RootLayout() {
  // One-shot wipe of any leftover Local UI Mode flag. Old installs may have
  // ``nearr.devAuthEnabled=1`` persisted from before the UI entry point was
  // removed; without this, sign-out would silently re-enter Local UI Mode.
  useEffect(() => {
    void clearDevAuth();
  }, []);

  // Handle deep links (magic-link callback + share-incoming).
  useEffect(() => {
    // Cold-start: app launched by tapping the link.
    Linking.getInitialURL().then((url) => {
      if (url) handleAuthDeepLink(url);
    });
    // Warm-start: app already open.
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (__DEV__) console.log('[deeplink]', url);
      handleAuthDeepLink(url);
    });
    return () => sub.remove();
  }, []);

  // Register notification action categories once per launch, and handle
  // action taps (e.g. "Give me 3 more chances" resets notification_count).
  useEffect(() => {
    void registerNotificationCategories();
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const { actionIdentifier, notification } = response;
      const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
      void handleNotificationAction(
        actionIdentifier,
        data.savedPlaceId as string | undefined,
        data.placeId as string | undefined,
      );
    });
    return () => sub.remove();
  }, []);

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthGate>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="add-place" options={{ presentation: 'modal', headerShown: true, title: 'Save place' }} />
              <Stack.Screen name="share" options={{ presentation: 'modal', headerShown: true, title: 'Save from link' }} />
              <Stack.Screen name="place/[id]" options={{ headerShown: true, title: 'Place' }} />
            </Stack>
          </AuthGate>
          <StatusBar style="auto" />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
