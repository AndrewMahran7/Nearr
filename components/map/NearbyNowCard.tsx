/**
 * NearbyNowCard — the prominent "first recommended place" card shown at the
 * top of the map bottom sheet.
 *
 * Purely presentational: the parent decides which place is featured and wires
 * the two callbacks. Tapping the card focuses the place on the map; the orange
 * button triggers the existing directions handler.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Button } from '@/components';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  place: SavedPlaceWithPlace;
  /** Optional distance/eta label, e.g. "0.4 mi away". */
  metaLabel?: string | null;
  onPress: () => void;
  onGetDirections: () => void;
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

export function NearbyNowCard({ place, metaLabel, onPress, onGetDirections }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Focus ${place.place.name} on map`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={styles.iconTile}>
          <Feather name={iconName(place)} size={20} color={colors.accent} />
        </View>
        <View style={styles.copy}>
          <Text style={typography.heading} numberOfLines={1}>
            {place.place.name}
          </Text>
          {place.place.formatted_address ? (
            <Text style={[typography.caption, styles.address]} numberOfLines={1}>
              {place.place.formatted_address}
            </Text>
          ) : null}
          <View style={styles.statusRow}>
            <View style={styles.greenDot} />
            <Text style={[typography.caption, styles.statusText]}>
              {metaLabel ?? 'Nearby now'}
            </Text>
            {place.place.category ? (
              <View style={styles.categoryChip}>
                <Text style={styles.categoryChipText} numberOfLines={1}>
                  {place.place.category}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <Button
        title="Get directions"
        onPress={onGetDirections}
        style={styles.action}
      />
    </Pressable>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.md,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    pressed: {
      opacity: 0.92,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.md,
    },
    iconTile: {
      width: 48,
      height: 48,
      borderRadius: 14,
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
      marginTop: 2,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: Spacing.xs,
      marginTop: Spacing.sm,
    },
    greenDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.success,
    },
    statusText: {
      color: colors.text,
      fontWeight: '600',
    },
    categoryChip: {
      paddingVertical: 3,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    categoryChipText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    action: {
      marginTop: Spacing.md,
      width: '100%',
    },
  });
}
