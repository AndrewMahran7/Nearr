import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingColors, OnboardingRadius, OnboardingSizes } from './theme';

type FeatherIcon = keyof typeof Feather.glyphMap;

type Props = {
  icon: FeatherIcon;
  title: string;
  subtitle?: string;
  /** Show a right chevron (implies the row is tappable). */
  showChevron?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
};

/**
 * Feature row for screens like Nearby Reminders: icon in an orange-tinted
 * badge on the left, title + subtitle in the center, optional chevron.
 * Renders as a Pressable only when `onPress` is provided.
 */
export function OnboardingFeatureCard({
  icon,
  title,
  subtitle,
  showChevron,
  onPress,
  style,
}: Props) {
  const body = (
    <>
      <View style={styles.iconBadge}>
        <Feather name={icon} size={20} color={OnboardingColors.orange} />
      </View>

      <View style={styles.textCol}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {showChevron ? (
        <Feather name="chevron-right" size={20} color={OnboardingColors.textMuted} />
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {body}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{body}</View>;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OnboardingColors.card,
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    padding: Spacing.lg,
  },
  pressed: {
    opacity: 0.85,
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
  textCol: {
    flex: 1,
  },
  title: {
    color: OnboardingColors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
});
