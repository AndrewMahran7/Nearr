import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';

import { OnboardingColors, OnboardingRadius, OnboardingSizes } from './theme';

type Props = {
  title: string;
  onPress?: () => void;
  /** Shows a spinner and blocks presses. */
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

/**
 * Large orange bottom CTA. Fixed 60px height, ~18px corners, dark text.
 */
export function OnboardingPrimaryButton({
  title,
  onPress,
  loading,
  disabled,
  style,
}: Props) {
  const blocked = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!blocked, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        pressed && !blocked && styles.pressed,
        blocked && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={OnboardingColors.onOrange} />
      ) : (
        <Text style={styles.label}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: OnboardingSizes.primaryButtonHeight,
    borderRadius: OnboardingRadius.button,
    backgroundColor: OnboardingColors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  pressed: {
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    color: OnboardingColors.onOrange,
    fontSize: 17,
    fontWeight: '700',
  },
});
