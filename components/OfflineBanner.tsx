/**
 * OfflineBanner — slim "you're offline" pill rendered above lists when
 * the saved-places hook is serving from the local cache.
 *
 * Stage 0 read-only offline support. The banner is intentionally
 * non-blocking: the user can still scroll, open detail screens, and
 * see map markers (anything that doesn't require a write). Mutations
 * are guarded inside the service layer and surface a friendly message.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

type Props = {
  visible: boolean;
  /** ISO timestamp of the cached payload, surfaced as a short "Last synced" line. */
  lastSyncedAt?: string | null;
};

function formatLastSynced(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return 'Last synced just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `Last synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last synced ${days}d ago`;
}

export function OfflineBanner({ visible, lastSyncedAt }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!visible) return null;
  const subline = formatLastSynced(lastSyncedAt);
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={[typography.bodyStrong, styles.title]}>
        You&apos;re offline
      </Text>
      <Text style={[typography.caption, styles.body]}>
        Showing your saved places from this device.
        {subline ? ` ${subline}.` : ''}
      </Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      marginBottom: Spacing.md,
    },
    title: { color: colors.text },
    body: { color: colors.textSecondary, marginTop: 2 },
  });
}
