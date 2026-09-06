import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PlaceBrowseCarousel } from '@/components/PlaceBrowseCarousel';
import { Spacing } from '@/constants';
import { sourceGroupPosition } from '@/lib/sourcePlaceGroup';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  places: SavedPlaceWithPlace[];
  selectedId: string;
  expanded: boolean;
  onSelect: (place: SavedPlaceWithPlace, interaction: 'tap' | 'swipe') => void;
  onViewAll: () => void;
  onCollapse: () => void;
};

export function SourceGroupSwitcher({
  places,
  selectedId,
  expanded,
  onSelect,
  onViewAll,
  onCollapse,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = createStyles(colors, typography);
  const position = sourceGroupPosition(places, selectedId);
  if (!position) return null;
  const carouselItems = places.map((place) => ({
    id: place.id,
    name: place.place.name,
    subtitle: place.place.formatted_address || 'Saved to your map',
    googlePlaceId: place.place.google_place_id,
  }));

  return (
    <View
      style={styles.wrap}
      testID="source-group-switcher"
      accessibilityLabel={`${expanded ? 'All places' : 'Places'} from this video. ${position.label}.`}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>
            {expanded ? 'All places from this video' : `${position.count} places from this video`}
          </Text>
          <Text style={styles.position} accessibilityLiveRegion="polite">{position.label}</Text>
        </View>
        <Pressable
          onPress={expanded ? onCollapse : onViewAll}
          accessibilityRole="button"
          accessibilityLabel={expanded
            ? 'Collapse all places from this video'
            : `See all ${position.count} places from this video`}
          hitSlop={6}
          style={styles.viewAll}
        >
          <Text style={styles.viewAllText}>{expanded ? 'Done' : 'See all'}</Text>
          {!expanded ? <Feather name="arrow-right" size={14} color={colors.accent} /> : null}
        </Pressable>
      </View>
      <PlaceBrowseCarousel
        items={carouselItems}
        selectedId={selectedId}
        presentation={expanded ? 'expanded' : 'compact'}
        onSelect={(item, interaction) => {
          const place = places.find((candidate) => candidate.id === item.id);
          if (place) onSelect(place, interaction);
        }}
        testID={expanded ? 'source-group-full-view' : 'source-group-selected-carousel'}
      />
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    wrap: { marginBottom: Spacing.sm, paddingBottom: Spacing.xs },
    header: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
    },
    headerCopy: { flex: 1 },
    title: { ...typography.label, color: colors.text },
    position: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    viewAll: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: Spacing.xs,
    },
    viewAllText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  });
}
