import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingColors, OnboardingRadius, OnboardingSizes } from './theme';

type FeatherIcon = keyof typeof Feather.glyphMap;

type Props = {
  icon: FeatherIcon;
  title: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  onPress?: () => void;
  /** Override the icon tint (defaults to orange). */
  iconColor?: string;
  /**
   * Emphasized (filled orange) variant for the single primary action in a
   * group — e.g. "Open Instagram" on the first-save screen.
   */
  emphasized?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

/**
 * Tappable action row for the final screen: "Open Instagram", "Open TikTok",
 * "Paste a link". Icon on the left, title, chevron on the right. Pass
 * `emphasized` to render the orange filled variant for the primary option.
 */
export function OnboardingActionCard({
  icon,
  title,
  subtitle,
  onPress,
  iconColor,
  emphasized,
  disabled,
  style,
}: Props) {
  const resolvedIconColor =
    iconColor ?? (emphasized ? OnboardingColors.onOrange : OnboardingColors.orange);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.card,
        emphasized && styles.cardEmphasized,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={[styles.iconBadge, emphasized && styles.iconBadgeEmphasized]}>
        <Feather name={icon} size={20} color={resolvedIconColor} />
      </View>

      <View style={styles.textWrap}>
        <Text style={[styles.title, emphasized && styles.titleEmphasized]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.subtitle, emphasized && styles.subtitleEmphasized]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      <Feather
        name="chevron-right"
        size={20}
        color={emphasized ? OnboardingColors.onOrange : OnboardingColors.textMuted}
      />
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
    minHeight: 64,
  },
  cardEmphasized: {
    backgroundColor: OnboardingColors.orange,
    borderColor: OnboardingColors.orange,
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
  iconBadgeEmphasized: {
    backgroundColor: 'rgba(8, 8, 8, 0.14)',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    color: OnboardingColors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  titleEmphasized: {
    color: OnboardingColors.onOrange,
    fontWeight: '700',
  },
  subtitle: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  subtitleEmphasized: {
    color: 'rgba(8, 8, 8, 0.7)',
  },
});
