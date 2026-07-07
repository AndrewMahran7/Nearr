import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants';
import { OnboardingColors } from '../theme';

type Props = {
  headline: string;
  subtext: string;
};

/**
 * Shared headline + subtext block used at the top of every onboarding
 * screen. White bold headline, muted gray body. All copy is passed in so
 * it stays editable at the call site.
 */
export function ScreenHeading({ headline, subtext }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.subtext}>{subtext}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.xl,
  },
  headline: {
    color: OnboardingColors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  subtext: {
    color: OnboardingColors.textMuted,
    fontSize: 16,
    lineHeight: 22,
    marginTop: Spacing.md,
  },
});
