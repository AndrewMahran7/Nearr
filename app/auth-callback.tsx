import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ExpoLinking from 'expo-linking';

import { Screen } from '@/components';
import { Colors, Spacing, Typography } from '@/constants';
import { useAuth } from '@/hooks/useAuth';
import { parseAuthCallbackUrl } from '@/lib/authDeepLink';

const AUTH_CALLBACK_TIMEOUT_MS = 5000;

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const hasLoggedOpen = useRef(false);
  const hasLoggedOutcome = useRef(false);
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (hasLoggedOpen.current) return;
    hasLoggedOpen.current = true;
    console.log('[auth-callback] opened');

    void ExpoLinking.getInitialURL().then((url) => {
      const parsed = url ? parseAuthCallbackUrl(url) : { matches: false, params: {} as Record<string, string> };
      console.log('[auth-callback] has_code=' + Boolean(parsed.params.code));
    });
  }, []);

  useEffect(() => {
    if (!session || hasNavigated.current) return;
    hasNavigated.current = true;
    if (!hasLoggedOutcome.current) {
      hasLoggedOutcome.current = true;
      console.log('[auth-callback] exchange_success=true');
      console.log('[auth-callback] session_present=true');
    }
    router.replace('/(tabs)/home');
  }, [router, session]);

  useEffect(() => {
    if (session) return;

    const timeout = setTimeout(() => {
      if (hasNavigated.current || session) return;
      hasNavigated.current = true;
      if (!hasLoggedOutcome.current) {
        hasLoggedOutcome.current = true;
        console.log('[auth-callback] exchange_success=false');
        console.log('[auth-callback] session_present=false');
      }
      router.replace('/sign-in');
    }, AUTH_CALLBACK_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [router, session]);

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