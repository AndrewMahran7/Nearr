import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants';
import { sourceGroupPosition } from '@/lib/sourcePlaceGroup';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  places: SavedPlaceWithPlace[];
  selectedId: string;
  onSelect: (place: SavedPlaceWithPlace) => void;
  onViewAll: () => void;
};

const MAX_NUMBERED_CHIPS = 5;

export function SourceGroupSwitcher({ places, selectedId, onSelect, onViewAll }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const position = sourceGroupPosition(places, selectedId);
  if (!position) return null;

  const previous = places[(position.index - 1 + places.length) % places.length]!;
  const next = places[(position.index + 1) % places.length]!;

  return (
    <View
      style={styles.wrap}
      testID="source-group-switcher"
      accessibilityLabel={`Place ${position.index + 1} of ${position.count} from this video`}
    >
      {places.length <= MAX_NUMBERED_CHIPS ? (
        <View style={styles.chips}>
          {places.map((place, index) => {
            const selected = place.id === selectedId;
            return (
              <Pressable
                key={place.id}
                onPress={() => onSelect(place)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${place.place.name}, ${index + 1} of ${places.length}`}
                hitSlop={5}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{index + 1}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.pager}>
          <Pressable
            onPress={() => onSelect(previous)}
            accessibilityRole="button"
            accessibilityLabel={`Previous place, ${previous.place.name}`}
            hitSlop={8}
            style={styles.arrow}
          >
            <Feather name="chevron-left" size={18} color={colors.textSecondary} />
          </Pressable>
          <Text style={styles.count}>{position.index + 1} / {position.count}</Text>
          <Pressable
            onPress={() => onSelect(next)}
            accessibilityRole="button"
            accessibilityLabel={`Next place, ${next.place.name}`}
            hitSlop={8}
            style={styles.arrow}
          >
            <Feather name="chevron-right" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}
      {places.length <= MAX_NUMBERED_CHIPS ? (
        <Text style={styles.position}>{position.index + 1} / {position.count}</Text>
      ) : null}
      <Pressable
        onPress={onViewAll}
        accessibilityRole="button"
        accessibilityLabel={`View all ${position.count} places from this video`}
        hitSlop={6}
        style={styles.viewAll}
      >
        <Text style={styles.viewAllText}>View all</Text>
      </Pressable>
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    wrap: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.xs,
    },
    chips: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
    chip: {
      width: 30,
      height: 30,
      borderRadius: Radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
    chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
    chipTextSelected: { color: colors.textInverse },
    pager: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    arrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    count: { ...typography.label, color: colors.text },
    position: { ...typography.caption, color: colors.textSecondary },
    viewAll: { minHeight: 36, justifyContent: 'center', paddingHorizontal: Spacing.xs },
    viewAllText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  });
}
