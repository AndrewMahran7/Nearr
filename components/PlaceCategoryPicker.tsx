import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants';
import { CATEGORY_LABELS, NEARR_CATEGORIES, type NearrCategory } from '@/lib/placeCategory';
import { useTheme } from '@/lib/theme';

type Props = {
  value: NearrCategory;
  onChange: (category: NearrCategory) => void;
  disabled?: boolean;
};

export function PlaceCategoryPicker({ value, onChange, disabled = false }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View>
      <Text style={[typography.bodyStrong, styles.heading]}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {NEARR_CATEGORIES.map((category) => {
          const selected = category === value;
          return (
            <Pressable
              key={category}
              onPress={() => onChange(category)}
              disabled={disabled || selected}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              style={[styles.chip, selected ? styles.selected : styles.unselected]}
            >
              <Text style={[styles.label, { color: selected ? colors.textInverse : colors.text }]}>
                {CATEGORY_LABELS[category]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    heading: { color: colors.text, marginBottom: Spacing.sm },
    row: { gap: Spacing.sm, paddingRight: Spacing.md },
    chip: {
      minHeight: 36,
      justifyContent: 'center',
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.pill,
      borderWidth: 1,
    },
    selected: { backgroundColor: colors.primary, borderColor: colors.primary },
    unselected: { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
    label: { fontSize: 13, fontWeight: '600' },
  });
}