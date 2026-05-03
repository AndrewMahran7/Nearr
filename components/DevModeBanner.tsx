/**
 * DevModeBanner — shown ONLY when the legacy fake-local Dev Mode
 * (a.k.a. "Local UI Mode") is active. This mode does NOT have a real
 * Supabase session, so all reads return empty and all writes fail RLS.
 *
 * For real development testing, sign in with a magic link using a test
 * email — do not use this mode. It exists only to validate UI flows
 * without network access.
 *
 * Renders nothing in production builds and when not in a local-UI session.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

type Props = {
  visible: boolean;
};

export function DevModeBanner({ visible }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!__DEV__ || !visible) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.dot} />
        <Text style={typography.bodyStrong}>Local UI Mode</Text>
      </View>
      <Text style={[typography.caption, styles.body]}>
        Local UI Mode cannot test Supabase reads/writes. You’re signed in
        with a fake local user, so RLS will reject every query. Sign out and
        use a real magic-link test email to exercise database flows.
      </Text>
    </Card>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    card: {
      marginBottom: Spacing.lg,
      backgroundColor: colors.surface,
      borderColor: colors.accent,
      borderWidth: 1,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    body: { color: colors.textMuted, lineHeight: 18 },
  });
}
