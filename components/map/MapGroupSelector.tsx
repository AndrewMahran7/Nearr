import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PlaceBrowseCarousel } from '@/components/PlaceBrowseCarousel';
import { Radius, Spacing } from '@/constants';
import {
  MAP_GROUP_TRAY_CLOSE_HIT_SLOP,
  MAP_GROUP_TRAY_CLOSE_TARGET_SIZE,
} from '@/lib/mapGroupTray';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  places: SavedPlaceWithPlace[];
  missingCoordinateIds: ReadonlySet<string>;
  failedCount: number;
  onSelect: (place: SavedPlaceWithPlace, interaction: 'tap' | 'swipe') => void;
  onViewAll: () => void;
  onClose: () => void;
};

export function MapGroupSelector({
  places,
  missingCoordinateIds,
  failedCount,
  onSelect,
  onViewAll,
  onClose,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const carouselItems = useMemo(() => places.map((place) => ({
    id: place.id,
    name: place.place.name,
    subtitle: missingCoordinateIds.has(place.id)
      ? 'Location unavailable'
      : place.place.formatted_address || 'Saved to your map',
    googlePlaceId: place.place.google_place_id,
    disabled: missingCoordinateIds.has(place.id),
  })), [missingCoordinateIds, places]);
  return (
    <View style={styles.container} pointerEvents="auto" testID="source-group-tray">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{places.length} places from this video</Text>
          {failedCount > 0 ? (
            <Text style={styles.subtitle}>{failedCount} still need attention in your queue</Text>
          ) : null}
        </View>
        <Pressable
          onPress={onViewAll}
          accessibilityRole="button"
          accessibilityLabel={`View all ${places.length} places from this video`}
          style={styles.headerAction}
        >
          <Feather name="maximize-2" size={15} color={colors.accent} />
          <Text style={styles.headerActionText}>View all</Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss places from this video"
          hitSlop={MAP_GROUP_TRAY_CLOSE_HIT_SLOP}
          pressRetentionOffset={12}
          testID="source-group-tray-close"
          style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
        >
          <Feather name="x" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      <PlaceBrowseCarousel
        items={carouselItems}
        onSelect={(item, interaction) => {
          const place = places.find((candidate) => candidate.id === item.id);
          if (place) onSelect(place, interaction);
        }}
        testID="source-group-tray-carousel"
      />
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.lg,
      paddingVertical: Spacing.md,
      shadowColor: '#000',
      shadowOpacity: 0.24,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
      overflow: 'visible',
      zIndex: 1,
    },
    header: {
      minHeight: MAP_GROUP_TRAY_CLOSE_TARGET_SIZE,
      paddingHorizontal: Spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    headerCopy: { flex: 1 },
    title: { ...typography.label, color: colors.text },
    subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    headerAction: {
      minHeight: MAP_GROUP_TRAY_CLOSE_TARGET_SIZE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: Spacing.sm,
    },
    headerActionText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
    closeButton: {
      width: MAP_GROUP_TRAY_CLOSE_TARGET_SIZE,
      height: MAP_GROUP_TRAY_CLOSE_TARGET_SIZE,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: MAP_GROUP_TRAY_CLOSE_TARGET_SIZE / 2,
      zIndex: 2,
    },
    closeButtonPressed: { opacity: 0.65 },
  });
}
