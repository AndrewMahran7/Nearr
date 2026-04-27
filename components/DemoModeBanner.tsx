/**
 * DemoModeBanner — small persistent reminder shown on main screens when
 * the app is running in `EXPO_PUBLIC_DEMO_MODE`. Distinct from
 * `DevModeBanner` (which warns about RLS-blocked writes) — this banner
 * tells the user they're seeing seeded fake data and no external APIs are
 * being called.
 *
 * Renders nothing if `isDemoMode()` is false.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { Colors, Spacing, Typography } from '@/constants';
import { isDemoMode } from '@/lib/demoMode';

export function DemoModeBanner() {
  if (!isDemoMode()) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.dot} />
        <Text style={Typography.bodyStrong}>Demo Mode</Text>
      </View>
      <Text style={[Typography.caption, styles.body]}>
        Showing seeded demo data. Supabase, Google Places, real location, and
        notifications are all mocked. Disable with EXPO_PUBLIC_DEMO_MODE.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: Spacing.lg,
    backgroundColor: Colors.surface,
    borderColor: Colors.accent,
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
    backgroundColor: Colors.accent,
  },
  body: { color: Colors.textMuted, lineHeight: 18 },
});
