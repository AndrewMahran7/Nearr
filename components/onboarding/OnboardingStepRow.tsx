import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingColors, OnboardingRadius, OnboardingSizes } from './theme';

type FeatherIcon = keyof typeof Feather.glyphMap;

type Props = {
  /** 1-based step number shown in the left badge. */
  number: number;
  title: string;
  subtitle?: string;
  /** Optional Feather icon on the right (e.g. "share", "check"). */
  icon?: FeatherIcon;
  style?: ViewStyle;
};

/**
 * Numbered tutorial row: "1  Tap the share button". Number badge on the
 * left, text in the center, optional icon on the right. Meant to be stacked
 * inside an `OnboardingCard`.
 */
export function OnboardingStepRow({ number, title, subtitle, icon, style }: Props) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{number}</Text>
      </View>

      <View style={styles.textCol}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {icon ? (
        <Feather name={icon} size={20} color={OnboardingColors.textMuted} style={styles.icon} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  badge: {
    width: OnboardingSizes.numberBadge,
    height: OnboardingSizes.numberBadge,
    borderRadius: OnboardingRadius.pill,
    backgroundColor: OnboardingColors.cardElevated,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  badgeText: {
    color: OnboardingColors.orange,
    fontSize: 15,
    fontWeight: '700',
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
  },
  icon: {
    marginLeft: Spacing.md,
  },
});
