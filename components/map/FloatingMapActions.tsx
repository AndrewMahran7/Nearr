/** Quiet recenter control; social-link import lives in Search and Saved. */

import { useMemo } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

type Props = {
  onRecenter: () => void;
  bottomInset?: number;
  /**
   * Animated lift (px) so the stack stays attached to the bottom sheet's top
   * edge — i.e. the sheet's current visible height. The buttons are nudged
   * UP by this amount from their base bottom position.
   */
  liftY: Animated.Value | Animated.AnimatedInterpolation<number>;
};

export function FloatingMapActions({ onRecenter, liftY, bottomInset = 0 }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Animated.View
      style={[styles.wrap, { bottom: bottomInset + 16, transform: [{ translateY: Animated.multiply(liftY, -1) }] }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onRecenter}
        accessibilityRole="button"
        accessibilityLabel="Recenter on my location"
        style={({ pressed }) => [styles.locBtn, pressed && styles.pressed]}
      >
        <Feather name="crosshair" size={20} color={colors.text} />
      </Pressable>
    </Animated.View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      right: Spacing.lg,
      bottom: Spacing.lg + 4,
      alignItems: 'center',
      gap: Spacing.md,
    },
    pressed: {
      opacity: 0.85,
    },
    locBtn: {
      width: 48,
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.24,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
  });
}
