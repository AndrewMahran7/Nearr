import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PlaceImage } from './PlaceImage';
import { Radius, Spacing } from '@/constants';
import {
  formatBrowseDistance,
  hasOriginalVideo,
  savedPlaceNotePreview,
} from '@/lib/savedPlacesBrowse';
import { CATEGORY_LABELS, savedPlaceCategory } from '@/lib/placeCategory';
import { splitPlaceAddress } from '@/lib/sharePhase1Ui';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  saved: SavedPlaceWithPlace & { distanceMeters?: number };
  onPress: (savedPlaceId: string) => void;
};

function savedDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function SavedPlaceBrowseCardView({ saved, onPress }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const category = CATEGORY_LABELS[savedPlaceCategory(saved)];
  const locality = splitPlaceAddress(saved.place.formatted_address).locality;
  const distance = formatBrowseDistance(saved.distanceMeters);
  const note = savedPlaceNotePreview(saved);
  const hasSource = hasOriginalVideo(saved);
  const date = savedDate(saved.created_at);
  const label = [
    saved.place.name,
    locality,
    category,
    distance,
    note?.text,
    hasSource ? 'Original post attached' : null,
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={() => onPress(saved.id)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens saved place details"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.imageWrap}>
        <PlaceImage
          googlePlaceId={saved.place.google_place_id}
          size={116}
          borderRadius={Radius.md}
          style={styles.image}
        />
        {hasSource ? (
          <View style={styles.sourceBadge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Feather name="play" size={12} color={colors.textInverse} />
          </View>
        ) : null}
      </View>

      <View style={styles.copy}>
        <Text style={[typography.bodyStrong, styles.name]} numberOfLines={2}>
          {saved.place.name}
        </Text>
        {locality ? (
          <Text style={[typography.caption, styles.locality]} numberOfLines={1}>{locality}</Text>
        ) : null}
        {note ? (
          <View style={styles.noteRow}>
            <Feather
              name={note.kind === 'user' ? 'message-circle' : 'zap'}
              size={13}
              color={note.kind === 'user' ? colors.textSecondary : colors.accent}
            />
            <Text style={[typography.caption, styles.note]} numberOfLines={2}>{note.text}</Text>
          </View>
        ) : null}
        <View style={styles.footer}>
          <View style={styles.categoryPill}>
            <Text style={styles.categoryText} numberOfLines={1}>{category}</Text>
          </View>
          <View style={styles.footerMeta}>
            {distance ? <Text style={[typography.caption, styles.distance]}>{distance}</Text> : null}
            {date ? <Text style={[typography.caption, styles.date]}>{date}</Text> : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export const SavedPlaceBrowseCard = memo(SavedPlaceBrowseCardView);

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    card: {
      minHeight: 140,
      flexDirection: 'row',
      gap: Spacing.md,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
    imageWrap: { width: 116, height: 116 },
    image: { borderWidth: 0 },
    sourceBadge: {
      position: 'absolute',
      right: 7,
      bottom: 7,
      width: 28,
      height: 28,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    copy: { flex: 1, minWidth: 0, paddingVertical: 2 },
    name: { color: colors.text, lineHeight: 21 },
    locality: { color: colors.textSecondary, marginTop: 3 },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: Spacing.sm },
    note: { color: colors.textSecondary, flex: 1, lineHeight: 18 },
    footer: {
      flex: 1,
      minHeight: 28,
      marginTop: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    categoryPill: {
      maxWidth: '58%',
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(255,106,26,0.13)',
    },
    categoryText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
    footerMeta: { alignItems: 'flex-end', gap: 2 },
    distance: { color: colors.textSecondary, fontWeight: '600' },
    date: { color: colors.textMuted, fontSize: 11 },
  });
}
