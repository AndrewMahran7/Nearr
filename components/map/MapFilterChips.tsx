/**
 * MapFilterChips — the Nearby / Recent / Saved selector that sits under the
 * map-first search bar.
 *
 * Phase 1: this is purely a controlled UI selection. The parent owns the
 * `selectedMapFilter` state; tapping a chip updates it but does not yet change
 * which markers render. Phase 2's bottom sheet will consume the selection to
 * decide what list to show.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

export type MapFilter = 'nearby' | 'recent' | 'saved';

const CHIPS: ReadonlyArray<{ value: MapFilter; label: string }> = [
  { value: 'nearby', label: 'Nearby' },
  { value: 'recent', label: 'Recent' },
  { value: 'saved', label: 'Saved' },
];

type Props = {
  value: MapFilter;
  onChange: (next: MapFilter) => void;
};

export function MapFilterChips({ value, onChange }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  return (
    <View style={styles.row}>
      {CHIPS.map((chip) => {
        const active = chip.value === value;
        return (
          <Pressable
            key={chip.value}
            onPress={() => onChange(chip.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={chip.label}
            style={[
              styles.chip,
              active ? styles.chipActive : styles.chipInactive,
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                { color: active ? colors.textInverse : colors.text },
              ]}
            >
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    chip: {
      paddingVertical: Spacing.xs + 2,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.pill,
      borderWidth: 1,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipInactive: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
    },
    chipLabel: {
      ...typography.label,
      fontWeight: '600',
    },
  });
}
