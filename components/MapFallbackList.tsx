/**
 * MapFallbackList — list view shown in place of the native map when the
 * Google Maps SDK keys are not configured (typical in Demo Mode running
 * with no `.env`). Each row shows the saved place name, address, lat/lng,
 * and a "View details" button.
 */

import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PlaceImage } from './PlaceImage';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  data: SavedPlaceWithPlace[];
  onPressItem: (item: SavedPlaceWithPlace) => void;
};

export function MapFallbackList({ data, onPressItem }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  return (
    <FlatList data={data} keyExtractor={item => item.id} initialNumToRender={8} windowSize={5} contentContainerStyle={styles.scroll} ListHeaderComponent={
      <View style={styles.headerCard}>
        <Text style={typography.title}>Your places</Text>
        <Text style={[typography.caption, styles.muted, { marginTop: Spacing.xs }]}>
          A little inspiration, everywhere. Explore your saved places below.
        </Text>
      </View>
      } ListEmptyComponent={
        <EmptyState
          title="No places yet"
          body="Save a place to see it here."
        />
      } renderItem={({ item: s }) => (
          <Pressable onPress={() => onPressItem(s)} accessibilityRole="button" accessibilityLabel={`Open ${s.place.name}`}>
            <Card style={styles.row}>
              <PlaceImage googlePlaceId={s.place.google_place_id} hydrationPolicy="compact_known_only" size={64} borderRadius={12} />
              <View style={{ flex: 1 }}>
              <Text style={typography.bodyStrong} numberOfLines={3}>{s.place.name}</Text>
              {s.place.formatted_address ? (
                <Text style={[typography.caption, styles.muted]} numberOfLines={2}>
                  {s.place.formatted_address}
                </Text>
              ) : null}
              <View style={styles.actionRow}>
                <Text style={styles.action}>View place</Text>
              </View>
              </View>
              <Feather name="chevron-right" size={20} color={colors.textSecondary} />
            </Card>
          </Pressable>
      )} />
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
    headerCard: {
      padding: Spacing.md,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.surface,
      marginBottom: Spacing.md,
    },
    row: { marginBottom: Spacing.sm, gap: Spacing.md, flexDirection: 'row', alignItems: 'center' },
    muted: { color: colors.textMuted },
    coord: { color: colors.textMuted, marginTop: Spacing.xs },
    actionRow: { marginTop: Spacing.sm },
    action: { ...typography.label, color: colors.primary },
  });
}
