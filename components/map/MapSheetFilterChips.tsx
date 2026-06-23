/**
 * MapSheetFilterChips — the lightweight filter row shown INSIDE the expanded
 * map bottom sheet (the "lightweight Places surface"). Distinct from the
 * top-of-map `MapFilterChips` (which choose the sheet's overall mode): these
 * only refine the expanded saved-places list.
 *
 * Presentational + controlled. Optional `counts` render a small trailing
 * number on each chip when > 0.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

export type SheetListFilter =
  | 'all'
  | 'nearby'
  | 'recent'
  | 'reminders'
  | 'visited';

const FILTERS: ReadonlyArray<{ value: SheetListFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'nearby', label: 'Nearby' },
  { value: 'recent', label: 'Recent' },
  { value: 'reminders', label: 'Reminders' },
  { value: 'visited', label: 'Visited' },
];

type Props = {
  value: SheetListFilter;
  onChange: (next: SheetListFilter) => void;
  counts?: Partial<Record<SheetListFilter, number>>;
};

export function MapSheetFilterChips({ value, onChange, counts }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {FILTERS.map((f) => {
        const active = f.value === value;
        const count = counts?.[f.value] ?? 0;
        return (
          <Pressable
            key={f.value}
            onPress={() => onChange(f.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={f.label}
            style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
          >
            <Text
              style={[
                styles.chipLabel,
                { color: active ? colors.textInverse : colors.text },
              ]}
            >
              {count > 0 ? `${f.label} ${count}` : f.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    row: {
      gap: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    chip: {
      paddingVertical: Spacing.xs + 1,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.pill,
      borderWidth: 1,
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
