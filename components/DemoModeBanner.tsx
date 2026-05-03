/**
 * DemoModeBanner — small persistent reminder shown on main screens when
 * the app is running in `EXPO_PUBLIC_DEMO_MODE`. Distinct from
 * `DevModeBanner` (which warns about RLS-blocked writes) — this banner
 * tells the user they're seeing seeded fake data and no external APIs are
 * being called.
 *
 * Renders nothing if `isDemoMode()` is false.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { Spacing } from '@/constants';
import { isDemoMode } from '@/lib/demoMode';
import { useTheme } from '@/lib/theme';

export function DemoModeBanner() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!isDemoMode()) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.dot} />
        <Text style={typography.bodyStrong}>Demo Mode</Text>
      </View>
      <Text style={[typography.caption, styles.body]}>
        Showing seeded demo data. Supabase, Google Places, real location, and
        notifications are all mocked. Disable with EXPO_PUBLIC_DEMO_MODE.
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
