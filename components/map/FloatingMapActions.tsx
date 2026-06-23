/**
 * FloatingMapActions — the right-side stack of floating map controls.
 *
 *   - recenter button (dark, circular): re-centers the map on the user.
 *   - paste-link button (orange, circular, prominent): reads the clipboard and
 *     opens the existing save-from-link flow.
 *
 * Self-positioned at the bottom-right so the parent only has to wire the two
 * callbacks. The parent hides this whole stack while the selected-place card
 * is open so the buttons never collide with it.
 */

import { useMemo } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

type Props = {
  onRecenter: () => void;
  onPasteLink: () => void;
  /**
   * Animated lift (px) so the stack stays attached to the bottom sheet's top
   * edge — i.e. the sheet's current visible height. The buttons are nudged
   * UP by this amount from their base bottom position.
   */
  liftY: Animated.Value | Animated.AnimatedInterpolation<number>;
};

export function FloatingMapActions({ onRecenter, onPasteLink, liftY }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Animated.View
      style={[styles.wrap, { transform: [{ translateY: Animated.multiply(liftY, -1) }] }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onRecenter}
        accessibilityRole="button"
        accessibilityLabel="Recenter on my location"
        style={({ pressed }) => [styles.locBtn, pressed && styles.pressed]}
      >
        <Feather name="navigation" size={20} color={colors.text} />
      </Pressable>
      <Pressable
        onPress={onPasteLink}
        accessibilityRole="button"
        accessibilityLabel="Paste a link to save a place"
        style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
      >
        <Feather name="link" size={24} color={colors.textInverse} />
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
    addBtn: {
      width: 56,
      height: 56,
      borderRadius: Radius.pill,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.primary,
      shadowOpacity: 0.45,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
  });
}
