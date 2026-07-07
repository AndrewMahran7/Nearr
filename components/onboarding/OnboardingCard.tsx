import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { Spacing } from '@/constants';
import { OnboardingColors, OnboardingRadius } from './theme';

type Props = {
  children: ReactNode;
  /** Use the lighter elevated surface (#1E1E1E) instead of the base card. */
  elevated?: boolean;
  style?: ViewStyle;
};

/**
 * Reusable charcoal container. Base surface by default, elevated surface
 * when `elevated` is set. Hairline border, ~20px corners.
 */
export function OnboardingCard({ children, elevated, style }: Props) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: elevated ? OnboardingColors.cardElevated : OnboardingColors.card },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    padding: Spacing.lg,
  },
});
