import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PlaceImage } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  places: SavedPlaceWithPlace[];
  selectedId: string | null;
  missingCoordinateIds: ReadonlySet<string>;
  failedCount: number;
  onSelect: (place: SavedPlaceWithPlace) => void;
  onViewAll: () => void;
  onClose: () => void;
};

const CARD_WIDTH = 224;
const CARD_GAP = 10;

export function MapGroupSelector({
  places,
  selectedId,
  missingCoordinateIds,
  failedCount,
  onSelect,
  onViewAll,
  onClose,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const index = places.findIndex((place) => place.id === selectedId);
    if (index < 0) return;
    scrollRef.current?.scrollTo({ x: index * (CARD_WIDTH + CARD_GAP), animated: true });
  }, [places, selectedId]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{places.length} newly saved</Text>
          {failedCount > 0 ? (
            <Text style={styles.subtitle}>{failedCount} still need attention in your queue</Text>
          ) : null}
        </View>
        <Pressable
          onPress={onViewAll}
          accessibilityRole="button"
          accessibilityLabel="View all newly saved places"
          style={styles.headerAction}
        >
          <Feather name="maximize-2" size={15} color={colors.accent} />
          <Text style={styles.headerActionText}>View all</Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close newly saved places"
          hitSlop={10}
          style={styles.closeButton}
        >
          <Feather name="x" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        snapToInterval={CARD_WIDTH + CARD_GAP}
        decelerationRate="fast"
      >
        {places.map((place) => {
          const selected = selectedId === place.id;
          const missingLocation = missingCoordinateIds.has(place.id);
          return (
            <Pressable
              key={place.id}
              onPress={() => onSelect(place)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${place.place.name}${missingLocation ? ', location unavailable' : ''}`}
              style={[styles.card, selected ? styles.cardSelected : null]}
            >
              <PlaceImage
                googlePlaceId={place.place.google_place_id}
                size={48}
                borderRadius={8}
                accessibilityLabel={`Photo of ${place.place.name}`}
              />
              <View style={styles.cardCopy}>
                <Text style={styles.name} numberOfLines={1}>{place.place.name}</Text>
                <Text style={missingLocation ? styles.missing : styles.address} numberOfLines={1}>
                  {missingLocation
                    ? 'Location unavailable'
                    : place.place.formatted_address || 'Saved to your map'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
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
    },
    header: {
      minHeight: 32,
      paddingHorizontal: Spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    headerCopy: { flex: 1 },
    title: { ...typography.label, color: colors.text },
    subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    headerAction: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: Spacing.sm,
    },
    headerActionText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
    closeButton: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    list: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      gap: CARD_GAP,
    },
    card: {
      width: CARD_WIDTH,
      height: 66,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      padding: Spacing.sm,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    cardSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.bg,
    },
    cardCopy: { flex: 1, minWidth: 0 },
    name: { ...typography.label, color: colors.text },
    address: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
    missing: { ...typography.caption, color: colors.danger, marginTop: 3 },
  });
}