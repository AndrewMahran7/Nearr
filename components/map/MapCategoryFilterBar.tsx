/**
 * MapCategoryFilterBar — the map's single control row.
 *
 * Replaces the old Nearby / Recent / Saved chips, which never filtered the map
 * (they only picked which list the bottom sheet showed) and each duplicated
 * something the sheet already offered.
 *
 * This row answers the one question the map actually needs: "of the things I
 * saved, what do I want to see right now?" Chips are single-select and apply
 * immediately — glance, tap, map changes. The fit-all control lives at the end
 * of the SAME row so it no longer floats on its own misaligned line.
 *
 * Options come from lib/mapVisibility (which reuses the existing browse
 * sections), and only groups the user actually has places in are shown, so the
 * row stays short for a small collection.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import {
  MAP_FILTER_ALL,
  type MapFilterOption,
  type MapVisibilityFilter,
} from '@/lib/mapVisibility';

type Props = {
  options: MapFilterOption[];
  value: MapVisibilityFilter;
  onChange: (next: MapVisibilityFilter) => void;
  /** Frame every currently visible place. Hidden when there is nothing to fit. */
  onFitAll?: () => void;
};

export function MapCategoryFilterBar({ options, value, onChange, onFitAll }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  if (options.length === 0 && !onFitAll) return null;

  return (
    <View style={styles.row}>
      {options.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          style={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {options.map((option) => {
            const active = option.id === value;
            // The count rides on the active chip only: enough to make a hidden
            // half of the map obvious, without numbers scattered everywhere.
            const showCount = active && option.id !== MAP_FILTER_ALL;
            return (
              <Pressable
                key={option.id}
                onPress={() => onChange(option.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  active
                    ? `${option.label}, showing ${option.count} ${option.count === 1 ? 'place' : 'places'}`
                    : `Show ${option.label}, ${option.count} ${option.count === 1 ? 'place' : 'places'}`
                }
                style={({ pressed }) => [
                  styles.chip,
                  active ? styles.chipActive : styles.chipInactive,
                  pressed && styles.chipPressed,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.chipLabel, { color: active ? colors.textInverse : colors.text }]}
                >
                  {option.label}
                </Text>
                {showCount ? (
                  <View style={styles.countPill}>
                    <Text style={styles.countText}>{option.count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.scroll} />
      )}

      {onFitAll ? (
        <Pressable
          onPress={onFitAll}
          accessibilityRole="button"
          accessibilityLabel="Fit all visible places on the map"
          style={({ pressed }) => [styles.fitButton, pressed && styles.chipPressed]}
        >
          <Feather name="maximize" size={16} color={colors.text} />
        </Pressable>
      ) : null}
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
      alignItems: 'center',
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    scroll: { flex: 1 },
    scrollContent: { gap: Spacing.sm, paddingRight: Spacing.xs, alignItems: 'center' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 34,
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
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipInactive: { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
    chipPressed: { opacity: 0.75 },
    chipLabel: { ...typography.label, fontWeight: '600' },
    countPill: {
      minWidth: 20,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(0,0,0,0.22)',
      alignItems: 'center',
    },
    countText: { ...typography.caption, color: colors.textInverse, fontWeight: '700' },
    fitButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
  });
}
