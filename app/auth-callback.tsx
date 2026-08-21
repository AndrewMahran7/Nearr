import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ExpoLinking from 'expo-linking';

import { Screen } from '@/components';
import { Colors, Spacing, Typography } from '@/constants';
import { useAuth } from '@/hooks/useAuth';
import { trackEvent } from '@/lib/analytics';
import { parseAuthCallbackUrl } from '@/lib/authDeepLink';
import { resolvePostAuthRoute, type PostAuthRoute } from '@/lib/postAuthRouting';
import { decideAuthCallbackNavigation } from '@/lib/authDeepLinkCore';
import { useAuthLinkStatus } from '@/lib/authLinkStatus';

// Last-resort safety net ONLY. Primary resolution is the sticky terminal
// auth-link status (`succeeded`/`failed`) plus session presence, which is
// deterministic regardless of mount ordering. This timer exists solely so a
// pathological state — the exchange promise hanging on a dead network, or the
// screen somehow reached with no processing at all — can never strand the user
// on the button-less "Signing you in..." view. It is NOT what handles
// expired/invalid/warm links; those resolve immediately via `failed`.
const AUTH_CALLBACK_SAFETY_MS = 10000;

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const status = useAuthLinkStatus();
  const hasNavigated = useRef(false);
  const hasLoggedOpen = useRef(false);
  const hasLoggedOutcome = useRef(false);
  // Latest session, for the safety-net timer (which reads it at fire time).
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const decision = decideAuthCallbackNavigation({ status, hasSession: !!session });

  useEffect(() => {
    if (hasLoggedOpen.current) return;
    hasLoggedOpen.current = true;
    console.log('[auth-callback] opened');

    void ExpoLinking.getInitialURL().then((url) => {
      const parsed = url
        ? parseAuthCallbackUrl(url)
        : { matches: false, params: {} as Record<string, string> };
      console.log('[auth-callback] has_code=' + Boolean(parsed.params.code));
    });
  }, []);

  // Single navigation authority. Resolves the moment the pure decision leaves
  // `wait` — i.e. as soon as a session exists, or the status becomes a terminal
  // `succeeded`/`failed`. Because the status is sticky, this is correct no
  // matter when this screen mounted relative to the exchange.
  useEffect(() => {
    if (hasNavigated.current || decision === 'wait') return;
    hasNavigated.current = true;

    if (decision === 'navigate_reset_password') {
      // Password recovery: a session exists, but running the normal save-aware
      // routing here would silently skip the reset the user asked for.
      if (!hasLoggedOutcome.current) {
        hasLoggedOutcome.current = true;
        console.log('[auth-callback] exchange_success=true type=recovery');
      }
      router.replace('/reset-password');
      return;
    }

    if (decision === 'navigate_app') {
      void (async () => {
        const current = sessionRef.current;
        let route: PostAuthRoute = '/(tabs)/map';
        try {
          if (current) {
            route = await resolvePostAuthRoute(current.user.id);
            void trackEvent('onboarding_auth_completed', {
              destination: route === '/activate' ? 'activate' : 'map',
            });
          }
        } catch (error) {
          console.warn('[auth-callback] onboarding_transfer_failed', error);
          router.replace('/(onboarding)/account');
          return;
        }
        if (!hasLoggedOutcome.current) {
          hasLoggedOutcome.current = true;
          console.log('[auth-callback] exchange_success=true');
          console.log('[auth-callback] session_present=' + Boolean(current));
        }
        router.replace(route);
      })();
      return;
    }

    // decision === 'navigate_sign_in'
    if (!hasLoggedOutcome.current) {
      hasLoggedOutcome.current = true;
      console.log('[auth-callback] exchange_success=false');
      console.log('[auth-callback] session_present=false');
    }
    router.replace('/(onboarding)/account');
  }, [decision, router]);

  // Last-resort safety net (see AUTH_CALLBACK_SAFETY_MS). Cleared on unmount,
  // which happens as soon as the primary resolution navigates away.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (hasNavigated.current) return;
      hasNavigated.current = true;
      const current = sessionRef.current;
      console.warn(
        '[auth-callback] safety_fallback fired resolved_by=' +
          (current ? 'session' : 'no_session'),
      );
      router.replace(current ? '/(tabs)/map' : '/(onboarding)/account');
    }, AUTH_CALLBACK_SAFETY_MS);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <Screen>
      <View style={styles.container}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <Text style={[Typography.heading, styles.title]}>Signing you in...</Text>
        <Text style={[Typography.body, styles.subtitle]}>
          Please wait while Nearr finishes login.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  title: {
    marginTop: Spacing.lg,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: Spacing.sm,
    textAlign: 'center',
    color: Colors.textSecondary,
    maxWidth: 280,
    lineHeight: 22,
  },
});
