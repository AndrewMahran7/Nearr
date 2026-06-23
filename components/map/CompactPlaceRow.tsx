/**
 * CompactPlaceRow — a dense, single-line-ish saved-place row used for the
 * secondary lists inside the map bottom sheet (rest of nearby, recently
 * saved, saved-places preview).
 *
 * Presentational only. Tapping the row focuses the place on the map via the
 * parent-supplied callback.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  place: SavedPlaceWithPlace;
  /** Short status line, e.g. "Nearby now", "Saved recently", "Reminder on". */
  status?: string;
  onPress: () => void;
};

function iconName(
  place: SavedPlaceWithPlace,
): React.ComponentProps<typeof Feather>['name'] {
  switch (place.source_type) {
    case 'instagram':
      return 'instagram';
    case 'tiktok':
      return 'video';
    default:
      return 'map-pin';
  }
}

export function CompactPlaceRow({ place, status, onPress }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Focus ${place.place.name} on map`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.iconTile}>
        <Feather name={iconName(place)} size={16} color={colors.accent} />
      </View>
      <View style={styles.copy}>
        <Text style={typography.bodyStrong} numberOfLines={1}>
          {place.place.name}
        </Text>
        {place.place.formatted_address ? (
          <Text style={[typography.caption, styles.address]} numberOfLines={1}>
            {place.place.formatted_address}
          </Text>
        ) : null}
        {status ? (
          <Text style={[typography.caption, styles.status]} numberOfLines={1}>
            {status}
          </Text>
        ) : null}
      </View>
      {place.place.category ? (
        <View style={styles.categoryChip}>
          <Text style={styles.categoryChipText} numberOfLines={1}>
            {place.place.category}
          </Text>
        </View>
      ) : null}
      <Feather name="chevron-right" size={18} color={colors.textMuted} />
    </Pressable>
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
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.md,
    },
    pressed: {
      backgroundColor: colors.surfaceElevated,
    },
    iconTile: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    copy: {
      flex: 1,
    },
    address: {
      color: colors.textSecondary,
      marginTop: 1,
    },
    status: {
      color: colors.textMuted,
      marginTop: 1,
    },
    categoryChip: {
      paddingVertical: 3,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      maxWidth: 110,
    },
    categoryChipText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  });
}
