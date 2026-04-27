/**
 * MapFallbackList — list view shown in place of the native map when the
 * Google Maps SDK keys are not configured (typical in Demo Mode running
 * with no `.env`). Each row shows the saved place name, address, lat/lng,
 * and a "View details" button.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { Colors, Radius, Spacing, Typography } from '@/constants';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  data: SavedPlaceWithPlace[];
  onPressItem: (item: SavedPlaceWithPlace) => void;
};

export function MapFallbackList({ data, onPressItem }: Props) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.headerCard}>
        <Text style={Typography.bodyStrong}>Map unavailable in demo mode</Text>
        <Text style={[Typography.caption, styles.muted, { marginTop: Spacing.xs }]}>
          Native map keys aren&apos;t configured, so we&apos;re showing a list of
          your saved places with their coordinates instead.
        </Text>
      </View>
      {data.length === 0 ? (
        <EmptyState
          title="No places yet"
          body="Save a place to see it here."
        />
      ) : (
        data.map((s) => (
          <Pressable key={s.id} onPress={() => onPressItem(s)}>
            <Card style={styles.row}>
              <Text style={Typography.heading} numberOfLines={1}>{s.place.name}</Text>
              {s.place.formatted_address ? (
                <Text style={[Typography.caption, styles.muted]} numberOfLines={2}>
                  {s.place.formatted_address}
                </Text>
              ) : null}
              <Text style={[Typography.caption, styles.coord]}>
                {s.place.latitude.toFixed(4)}, {s.place.longitude.toFixed(4)}
              </Text>
              <View style={styles.actionRow}>
                <Text style={styles.action}>View details ›</Text>
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  headerCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.md,
  },
  row: { marginBottom: Spacing.sm, gap: Spacing.xs },
  muted: { color: Colors.textMuted },
  coord: { color: Colors.textMuted, marginTop: Spacing.xs },
  actionRow: { marginTop: Spacing.sm },
  action: { color: Colors.primary, ...Typography.label },
});
