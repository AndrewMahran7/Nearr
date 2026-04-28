import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { useAuth } from '@/hooks/useAuth';
import { handleAuthDeepLink } from '@/lib/authDeepLink';
import { clearDevAuth } from '@/lib/devAuth';
import { trackEvent } from '@/lib/analytics';
import { checkProximityOnce } from '@/services/notifications';
import '@/lib/notifications'; // registers background task

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
    console.log('[AuthGate] decide', {
      hasSession: !!session,
      inAuth,
      segments: segments.join('/'),
    });
    if (!session && !inAuth) {
      console.log('[AuthGate] -> /(auth)/sign-in');
      router.replace('/(auth)/sign-in');
    } else if (session && inAuth) {
      console.log('[AuthGate] -> /(tabs)/home');
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
      console.log('[deeplink]', url);
      handleAuthDeepLink(url);
    });
    return () => sub.remove();
  }, []);

  return (
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
  );
}
