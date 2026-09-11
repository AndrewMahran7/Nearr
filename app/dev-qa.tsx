import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';

import { Button, Card, Screen } from '@/components';
import { Spacing } from '@/constants';
import { useAuth } from '@/hooks/useAuth';
import {
  isOnboardingV2DevelopmentResetAvailable,
  resetOnboardingV2OnlyForDevelopment,
  resetOnboardingV2WithFreshAnonymousUserForDevelopment,
} from '@/lib/onboardingV2DevReset';
import { useTheme } from '@/lib/theme';

export default function DevelopmentQaScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, typography } = useTheme();
  const [busy, setBusy] = useState<'onboarding_only' | 'fresh_anonymous' | null>(null);

  if (!isOnboardingV2DevelopmentResetAvailable()) return <Redirect href="/" />;

  async function run(mode: 'onboarding_only' | 'fresh_anonymous') {
    if (busy) return;
    setBusy(mode);
    const result = mode === 'onboarding_only'
      ? await resetOnboardingV2OnlyForDevelopment()
      : await resetOnboardingV2WithFreshAnonymousUserForDevelopment();
    setBusy(null);
    if (!result.ok) {
      Alert.alert(
        'Reset blocked',
        result.code === 'ONBOARDING_DEV_RESET_REQUIRES_ANONYMOUS'
          ? 'Reset onboarding only keeps the current identity, so it requires an anonymous QA user. Use Fresh anonymous QA user to leave this account without deleting it.'
          : 'The Development QA reset did not complete. No Production data was touched.',
      );
      return;
    }
    router.replace('/(onboarding)');
    Alert.alert(
      mode === 'onboarding_only' ? 'Onboarding reset' : 'Fresh anonymous QA user ready',
      mode === 'onboarding_only'
        ? 'Progress and server checkpoints were cleared. Existing saves and jobs were preserved.'
        : `New anonymous identity ${result.anonymousUserId.slice(0, 8)}… is ready. The prior account and its data were preserved.`,
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={[typography.caption, { color: colors.primary }]}>DEVELOPMENT ONLY</Text>
        <Text style={[typography.title, { color: colors.text }]}>Onboarding QA reset</Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>This screen is available directly at nearr://dev-qa and does not depend on Settings.</Text>
      </View>

      <Card style={styles.card}>
        <Text style={[typography.bodyStrong, { color: colors.text }]}>Reset onboarding only</Text>
        <Text style={[typography.caption, styles.copy, { color: colors.textSecondary }]}>Keeps the current anonymous identity, saves, and jobs. Clears local V2 state, completion, transfer state, pending navigation, fixture attempts, and this user&apos;s server onboarding sessions.</Text>
        <Button title="Reset onboarding only" variant="secondary" loading={busy === 'onboarding_only'} disabled={!!busy} onPress={() => void run('onboarding_only')} />
      </Card>

      <Card style={styles.card}>
        <Text style={[typography.bodyStrong, { color: colors.text }]}>Fresh anonymous QA user</Text>
        <Text style={[typography.caption, styles.copy, { color: colors.textSecondary }]}>Signs out only this device, clears local onboarding/cache state, and immediately creates a different anonymous identity. A permanent account and all prior saves/jobs remain untouched.</Text>
        <Button title="Create fresh anonymous QA user" loading={busy === 'fresh_anonymous'} disabled={!!busy} onPress={() => void run('fresh_anonymous')} />
      </Card>

      <Text style={[typography.caption, styles.identity, { color: colors.textMuted }]}>Current identity: {user ? `${user.is_anonymous === true ? 'anonymous' : 'permanent'} ${user.id.slice(0, 8)}…` : 'signed out'}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.sm, marginBottom: Spacing.xl },
  card: { gap: Spacing.md, marginBottom: Spacing.lg },
  copy: { lineHeight: 19 },
  identity: { marginTop: Spacing.sm, textAlign: 'center' },
});
