import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { Spacing } from '@/constants';
import { OnboardingColors, useOnboardingColors } from './theme';

type Props = {
  title: string;
  onPress?: () => void;
  /** Render the label in the orange accent (for link-style emphasis). */
  emphasis?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

/**
 * Text-only button for secondary actions like "Skip for now" or
 * "Already have an account? Sign in". Muted by default; `emphasis` switches
 * the label to the orange accent.
 */
export function OnboardingSecondaryButton({
  title,
  onPress,
  emphasis,
  disabled,
  style,
}: Props) {
  const OnboardingColors = useOnboardingColors();
  const styles = useMemo(() => createStyles(OnboardingColors), [OnboardingColors]);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, emphasis ? styles.emphasis : styles.muted]}>
        {title}
      </Text>
    </Pressable>
  );
}

function createStyles(OnboardingColors: ReturnType<typeof useOnboardingColors>) { return StyleSheet.create({
  button: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
  },
  muted: {
    color: OnboardingColors.textMuted,
  },
  emphasis: {
    color: OnboardingColors.orange,
  },
}); }
