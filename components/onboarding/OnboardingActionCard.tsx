import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingColors, OnboardingRadius, OnboardingSizes } from './theme';

type FeatherIcon = keyof typeof Feather.glyphMap;

type Props = {
  icon: FeatherIcon;
  title: string;
  onPress?: () => void;
  /** Override the icon tint (defaults to orange). */
  iconColor?: string;
  disabled?: boolean;
  style?: ViewStyle;
};

/**
 * Tappable action row for the final screen: "Open Instagram", "Open TikTok",
 * "Paste a link". Icon on the left, title, chevron on the right.
 */
export function OnboardingActionCard({
  icon,
  title,
  onPress,
  iconColor,
  disabled,
  style,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.card,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.iconBadge}>
        <Feather name={icon} size={20} color={iconColor ?? OnboardingColors.orange} />
      </View>

      <Text style={styles.title}>{title}</Text>

      <Feather name="chevron-right" size={20} color={OnboardingColors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OnboardingColors.cardElevated,
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
  iconBadge: {
    width: OnboardingSizes.iconBadge,
    height: OnboardingSizes.iconBadge,
    borderRadius: OnboardingRadius.pill,
    backgroundColor: 'rgba(255, 107, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  title: {
    flex: 1,
    color: OnboardingColors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
