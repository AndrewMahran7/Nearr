/**
 * SavedPlaceCard — one row in the saved-places list.
 *
 * Shows: name, address, radius (with profile-default fallback when overrides
 * are null), source badge (when not 'manual'), notifications on/off pill,
 * and a small delete affordance. Tapping the body opens the detail screen.
 */

import { useMemo } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from './Button';
import { Card } from './Card';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import type { Profile, SavedPlaceWithPlace } from '@/types';

type Props = {
  saved: SavedPlaceWithPlace;
  profile: Profile | null;
  onPress: () => void;
  onDelete: () => void;
  metaPrefix?: string | null;
  /**
   * When provided, renders a small "Show on map" affordance in the meta
   * row that jumps the user to the Map tab focused on this place.
   * Optional so callers that don't want it (e.g. raw lists) opt out.
   */
  onShowOnMap?: () => void;
  /**
   * When provided (typically only for cards rendered inside the Archived
   * filter), shows a Restore button that clears `archived_at`.
   */
  onRestore?: () => void;
};

function sourceLabel(saved: SavedPlaceWithPlace): string | null {
  switch (saved.source_type) {
    case 'tiktok':
      return 'Saved from TikTok';
    case 'instagram':
      return 'Saved from Instagram';
    case 'link':
      return 'Saved from a link';
    default:
      return null; // 'manual' or null
  }
}

function sourceActionLabel(saved: SavedPlaceWithPlace): string {
  return saved.source_type === 'link' ? 'Open original link' : 'View original post';
}

export function SavedPlaceCard({
  saved,
  profile: _profile,
  onPress,
  onDelete,
  onShowOnMap,
  onRestore,
  metaPrefix,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const place = saved.place;
  const source = sourceLabel(saved);
  const isVisited = !!saved.visited_at;
  const isArchived = !!saved.archived_at && !isVisited;
  const remindersLabel =
    !isVisited && !isArchived && saved.notifications_enabled ? 'Reminder on' : null;
  const meta = [metaPrefix, source, remindersLabel].filter(Boolean).join(' · ');

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
    <Card style={styles.card}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.cardPressable, pressed && styles.pressed]}>
        <View style={styles.thumb}>
          <Feather
            name={source === 'Instagram' ? 'instagram' : source === 'TikTok' ? 'video' : 'map-pin'}
            size={18}
            color={colors.textSecondary}
          />
        </View>

        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text style={[typography.bodyStrong, styles.titleText]} numberOfLines={1}>
              {place.name}
            </Text>
            {isVisited ? (
              <View style={[styles.badge, styles.badgeVisited]}>
                <Text style={styles.badgeText}>Visited</Text>
              </View>
            ) : isArchived ? (
              <View style={[styles.badge, styles.badgeArchived]}>
                <Text style={styles.badgeText}>Archived</Text>
              </View>
            ) : null}
          </View>

          {place.formatted_address ? (
            <Text style={[typography.caption, styles.muted]} numberOfLines={2}>
              {place.formatted_address}
            </Text>
          ) : null}

          {meta ? (
            <Text style={[typography.caption, styles.metaText]} numberOfLines={2}>
              {meta}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.actionRow}>
        {onRestore ? (
          <Button title="Restore" onPress={onRestore} style={styles.primaryAction} />
        ) : (
          <Button title="Show on map" onPress={onShowOnMap ?? onPress} style={styles.primaryAction} />
        )}
        {onShowOnMap ? (
          <Button
            title="Details"
            variant="secondary"
            onPress={onPress}
            style={styles.secondaryAction}
          />
        ) : null}
      </View>

      <View style={styles.footerRow}>
        {saved.source_url ? (
          <Pressable
            onPress={() => Linking.openURL(saved.source_url!).catch(() => undefined)}
            hitSlop={8}
          >
            <Text style={styles.footerAction}>{sourceActionLabel(saved)}</Text>
          </Pressable>
        ) : <View />}

        <Pressable onPress={confirmDelete} hitSlop={12} style={styles.deleteBtn}>
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      </View>
    </Card>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    card: {
      marginBottom: Spacing.md,
      backgroundColor: colors.surfaceElevated,
      padding: 14,
    },
    cardPressable: {
      flexDirection: 'row',
      gap: Spacing.md,
      alignItems: 'flex-start',
    },
    pressed: { opacity: 0.7 },
    thumb: {
      width: 52,
      height: 52,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    copy: {
      flex: 1,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    titleText: { flexShrink: 1 },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      borderWidth: 1,
    },
    badgeVisited: {
      backgroundColor: colors.surface,
      borderColor: colors.accent,
    },
    badgeArchived: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    badgeText: {
      ...typography.caption,
      fontSize: 11,
      color: colors.textSecondary,
    },
    muted: { color: colors.textSecondary, marginTop: 2 },
    metaText: {
      color: colors.textMuted,
      marginTop: Spacing.xs,
      lineHeight: 18,
    },
    actionRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    primaryAction: {
      flex: 1,
      paddingVertical: 10,
    },
    secondaryAction: {
      flex: 1,
      paddingVertical: 10,
    },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Spacing.sm,
    },
    deleteBtn: {
      paddingVertical: 4,
      paddingHorizontal: Spacing.xs,
    },
    footerAction: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    removeText: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textMuted,
    },
  });
}
