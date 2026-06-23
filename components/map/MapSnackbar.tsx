/**
 * MapSnackbar — a small, non-blocking toast shown above the bottom sheet after
 * a direct save (or similar map action). Optional action (e.g. "Undo").
 *
 * Deliberately tiny: no dependency, auto-dismisses, slides up/in. Used instead
 * of a native Alert so the user stays on the map.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

type Props = {
  visible: boolean;
  message: string;
  /** Distance from the bottom edge (px) — set so it clears the sheet. */
  bottomOffset: number;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Default 4000. */
  durationMs?: number;
};

export function MapSnackbar({
  visible,
  message,
  bottomOffset,
  actionLabel,
  onAction,
  onDismiss,
  durationMs = 4000,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      bounciness: 6,
    }).start();
    const id = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(id);
  }, [visible, anim, onDismiss, durationMs]);

  useEffect(() => {
    if (visible) return;
    anim.setValue(0);
  }, [visible, anim]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          bottom: bottomOffset,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
          ],
        },
      ]}
      pointerEvents="box-none"
    >
      <Text style={styles.message} numberOfLines={1}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: Spacing.lg,
      right: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.34,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 12,
      zIndex: 30,
    },
    message: {
      ...typography.bodyStrong,
      flex: 1,
      color: colors.text,
    },
    action: {
      ...typography.label,
      color: colors.primary,
      fontWeight: '700',
    },
  });
}
