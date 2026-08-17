/**
 * components/map/ShareQueueButton.tsx
 *
 * Compact entry point to the share-job queue, shown on the map's top chrome.
 * Shows an active-queue badge count when > 0.
 *
 * Visibility follows `canReachShareQueue` — whether this user has a queue to
 * open — and NOT `isAsyncShareJobsEnabled()`, which it used to. That flag is
 * resolved from an env var at bundle time, so an OTA update published from a
 * checkout without `EXPO_PUBLIC_ASYNC_SHARE_JOBS_ENABLED` set silently
 * returned `null` here and took the user's inbox off the map entirely. The
 * rollout flag still decides whether new shares BECOME jobs (app/share.tsx,
 * ShareExtension.tsx); it has no business deciding whether the user can look
 * at the ones they already have.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/hooks/useAuth';
import { isDemoMode } from '@/lib/demoMode';
import { canReachShareQueue } from '@/lib/shareQueueAccess';
import { useActiveQueueCount } from '@/hooks/useShareJobs';

export function ShareQueueButton() {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session, isDevSession } = useAuth();
  const queueCount = useActiveQueueCount();

  const reachable = canReachShareQueue({
    signedIn: !!session?.user?.id,
    isDevSession,
    isDemoMode: isDemoMode(),
  });
  if (!reachable) return null;

  return (
    <Pressable
      onPress={() => router.push('/share-jobs')}
      style={({ pressed }) => [styles.pill, pressed ? styles.pressed : null]}
      accessibilityRole="button"
      accessibilityLabel={
        queueCount > 0 ? `Share queue, ${queueCount} current items` : 'Share queue'
      }
      hitSlop={6}
    >
      <Feather name="inbox" size={17} color={colors.text} />
      <Text style={[typography.caption, styles.label]}>Queue</Text>
      {queueCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{queueCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      marginTop: Spacing.sm,
      minHeight: 44,
      paddingHorizontal: Spacing.md + 2,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
    label: { color: colors.text, fontWeight: '600' },
    badge: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      marginLeft: 2,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: colors.textInverse, fontSize: 11, fontWeight: '700' },
  });
}
