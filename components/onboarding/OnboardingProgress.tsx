import { StyleSheet, View, ViewStyle } from 'react-native';

import { OnboardingColors, OnboardingRadius } from './theme';

type Props = {
  /** Total number of steps in the flow. */
  total: number;
  /** Zero-based index of the current step. Segments at or before it fill orange. */
  current: number;
  style?: ViewStyle;
};

/**
 * Segmented progress bar. Fills every segment up to and including `current`
 * with the orange accent; remaining segments render muted.
 */
export function OnboardingProgress({ total, current, style }: Props) {
  const count = Math.max(0, total);
  return (
    <View style={[styles.row, style]} accessibilityLabel={`Step ${current + 1} of ${count}`}>
      {Array.from({ length: count }).map((_, index) => {
        const active = index <= current;
        return (
          <View
            key={index}
            style={[styles.segment, active ? styles.segmentActive : styles.segmentInactive]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: OnboardingRadius.pill,
    maxWidth: 40,
  },
  segmentActive: {
    backgroundColor: OnboardingColors.orange,
  },
  segmentInactive: {
    backgroundColor: OnboardingColors.progressInactive,
  },
});
