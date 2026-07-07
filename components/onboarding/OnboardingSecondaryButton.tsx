import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { Spacing } from '@/constants';
import { OnboardingColors } from './theme';

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

const styles = StyleSheet.create({
  button: {
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
    fontSize: 15,
    fontWeight: '600',
  },
  muted: {
    color: OnboardingColors.textMuted,
  },
  emphasis: {
    color: OnboardingColors.orange,
  },
});
