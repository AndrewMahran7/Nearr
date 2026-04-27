/**
 * SavedPlaceCard — one row in the saved-places list.
 *
 * Shows: name, address, radius (with profile-default fallback when overrides
 * are null), source badge (when not 'manual'), notifications on/off pill,
 * and a small delete affordance. Tapping the body opens the detail screen.
 */

import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { Colors, Radius, Spacing, Typography } from '@/constants';
import type { Profile, SavedPlaceWithPlace } from '@/types';

type Props = {
  saved: SavedPlaceWithPlace;
  profile: Profile | null;
  onPress: () => void;
  onDelete: () => void;
  /**
   * When provided, renders a small "Show on map" affordance in the meta
   * row that jumps the user to the Map tab focused on this place.
   * Optional so callers that don't want it (e.g. raw lists) opt out.
   */
  onShowOnMap?: () => void;
};

function formatRadius(saved: SavedPlaceWithPlace, profile: Profile | null): string {
  if (saved.radius_value != null && saved.radius_unit) {
    return `${saved.radius_value} ${saved.radius_unit}`;
  }
  if (profile) {
    return `${profile.default_radius_value} ${profile.default_radius_unit} (default)`;
  }
  return 'Default radius';
}

function sourceLabel(saved: SavedPlaceWithPlace): string | null {
  switch (saved.source_type) {
    case 'tiktok':
      return 'TikTok';
    case 'instagram':
      return 'Instagram';
    case 'link':
      return 'Link';
    default:
      return null; // 'manual' or null
  }
}

export function SavedPlaceCard({ saved, profile, onPress, onDelete, onShowOnMap }: Props) {
  const place = saved.place;
  const radius = formatRadius(saved, profile);
  const source = sourceLabel(saved);
  const notifyOn = saved.notifications_enabled;

  function confirmDelete() {
    Alert.alert(
      'Remove place?',
      `${place.name} will be removed from your saved places.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: onDelete },
      ],
    );
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={Typography.bodyStrong} numberOfLines={1}>
            {place.name}
          </Text>
          <Pressable onPress={confirmDelete} hitSlop={12} style={styles.deleteBtn}>
            <Text style={[Typography.label, { color: Colors.danger }]}>Remove</Text>
          </Pressable>
        </View>

        {place.formatted_address ? (
          <Text style={[Typography.caption, styles.muted]} numberOfLines={2}>
            {place.formatted_address}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{radius}</Text>
          </View>
          <View style={[styles.pill, notifyOn ? styles.pillOn : styles.pillOff]}>
            <Text style={[styles.pillText, notifyOn ? styles.pillTextOn : styles.pillTextOff]}>
              {notifyOn ? 'Notify on' : 'Notify off'}
            </Text>
          </View>
          {source ? (
            <View style={[styles.pill, styles.pillAccent]}>
              <Text style={[styles.pillText, { color: Colors.textInverse }]}>{source}</Text>
            </View>
          ) : null}
          {onShowOnMap ? (
            // Stop propagation so tapping this pill doesn't also fire the
            // outer card press (which would navigate to the detail screen).
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onShowOnMap();
              }}
              hitSlop={8}
              style={[styles.pill, styles.pillMap]}
              accessibilityRole="button"
              accessibilityLabel={`Show ${place.name} on map`}
            >
              <Text style={[styles.pillText, { color: Colors.textInverse }]}>Show on map</Text>
            </Pressable>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.md },
  pressed: { opacity: 0.7 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  deleteBtn: { paddingVertical: 2, paddingHorizontal: Spacing.xs },
  muted: { color: Colors.textMuted, marginTop: 4 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.md,
  },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillOn: { backgroundColor: Colors.success, borderColor: Colors.success },
  pillOff: { backgroundColor: Colors.bg, borderColor: Colors.border },
  pillAccent: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  pillMap: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontSize: 12, fontWeight: '600', color: Colors.text },
  pillTextOn: { color: Colors.textInverse },
  pillTextOff: { color: Colors.textMuted },
});
