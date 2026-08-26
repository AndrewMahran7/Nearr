/**
 * ShareJobsHeader — compact navigation header for the share-job queue and the
 * per-job confirmation screen.
 *
 * Both routes render with `headerShown: false` (app/_layout.tsx) so they own a
 * consistent, on-brand header instead of relying on the native stack bar (which
 * shows NO back control on a cold deep-link entry, trapping the user). This
 * provides a 44px circular back/close control that always has a safe action.
 *
 * Sits inside a `<Screen>` (which already applies the top safe-area inset), so
 * it needs no inset math of its own.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

type Props = {
  title: string;
  onBack: () => void;
  /** Keeps the 44pt control while reducing non-interactive header padding. */
  compact?: boolean;
  /** Accessibility label for the back control (e.g. "Back to map"). */
  backLabel?: string;
  icon?: 'back' | 'close';
  /** Optional small actionable-count badge shown on the right. */
  count?: number;
  /** Optional overflow action used for infrequent queue-wide operations. */
  rightAction?: {
    accessibilityLabel: string;
    onPress: () => void;
    disabled?: boolean;
  };
};

export function ShareJobsHeader({
  title,
  onBack,
  compact = false,
  backLabel = 'Back',
  icon = 'back',
  count,
  rightAction,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const showBadge = typeof count === 'number' && count > 0;

  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        hitSlop={8}
      >
        <Feather name={icon === 'close' ? 'x' : 'chevron-left'} size={24} color={colors.text} />
      </Pressable>
      <Text style={[typography.title, styles.title]} numberOfLines={1}>
        {title}
      </Text>
      {rightAction ? (
        <Pressable
          onPress={rightAction.onPress}
          disabled={rightAction.disabled}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed && styles.backBtnPressed,
            rightAction.disabled && styles.actionBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={rightAction.accessibilityLabel}
          hitSlop={8}
        >
          <Feather name="more-horizontal" size={22} color={colors.text} />
        </Pressable>
      ) : showBadge ? (
        <View
          style={styles.badge}
          accessibilityLabel={`${count} ${count === 1 ? 'item needs' : 'items need'} your help`}
        >
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      ) : (
        <View style={styles.spacer} />
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
      gap: Spacing.md,
    },
    headerCompact: { paddingTop: Spacing.xs, paddingBottom: Spacing.sm },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    backBtnPressed: { backgroundColor: colors.surfaceElevated },
    actionBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionBtnDisabled: { opacity: 0.45 },
    title: { flex: 1, color: colors.text },
    spacer: { width: 44, height: 44 },
    badge: {
      minWidth: 28,
      height: 28,
      borderRadius: 14,
      paddingHorizontal: 8,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
  });
}
