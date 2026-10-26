import { i18n, t } from '@/lib/i18n';
import { useLocale } from '@/hooks/useLocale';
import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PlaceImage, type PlaceImageResolutionKind } from './PlaceImage';
import { Radius, Spacing } from '@/constants';
import {
  formatBrowseDistance,
  hasOriginalPost,
  savedPlaceNotePreview,
} from '@/lib/savedPlacesBrowse';
import { CATEGORY_LABELS, savedPlaceCategory } from '@/lib/placeCategory';
import { splitPlaceAddress } from '@/lib/sharePhase1Ui';
import { useTheme } from '@/lib/theme';
import { hydrateSavedPlace } from '@/lib/savedPlaceHydration';
import { placeSourceCards } from '@/lib/placeSources';
import { savedPlacePhotoKind, type SavedPlacePhotoKind } from '@/lib/savedPlaceSnapshot';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  saved: SavedPlaceWithPlace & { distanceMeters?: number };
  onPress: (saved: SavedPlaceWithPlace) => void;
  featured?: boolean;
};

function savedDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SavedPlaceBrowseCardView({ saved, onPress, featured = false }: Props) {
  useLocale();
  const { colors, typography } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const styles = useMemo(() => createStyles(colors), [colors, i18n.language]);
  const category = CATEGORY_LABELS[savedPlaceCategory(saved)];
  const locality = splitPlaceAddress(saved.place.formatted_address).locality;
  const distance = formatBrowseDistance(saved.distanceMeters);
  const note = savedPlaceNotePreview(saved);
  const hasSource = hasOriginalPost(saved);
  const date = savedDate(saved.created_at);
  const sourceImageUri = useMemo(
    () => placeSourceCards(saved).find((source) => !!source.thumbnailUrl)?.thumbnailUrl ?? null,
    [saved, i18n.language],
  );
  const [savedImageUri, setSavedImageUri] = useState<string | null>(null);
  const [savedImageKind, setSavedImageKind] = useState<SavedPlacePhotoKind>('unknown');
  const [imageResolution, setImageResolution] = useState<PlaceImageResolutionKind | null>(null);
  // A feature earns its space with a known saved photo. Missing or failed
  // imagery keeps the same compact, useful destination row as the collection.
  const showFeature = featured && !!savedImageUri && savedImageKind !== 'source' && imageResolution !== 'neutral';
  const imageSize = showFeature ? Math.max(240, width - 48) : 72;

  useEffect(() => {
    let cancelled = false;
    setSavedImageUri(null);
    setSavedImageKind('unknown');
    setImageResolution(null);
    void hydrateSavedPlace({
      userId: saved.user_id,
      saved,
      trigger: 'saved_library',
      knownImageUri: sourceImageUri,
    }).then((hydrated) => {
      if (!cancelled) {
        const uri = hydrated.details.photoUrls[0] ?? null;
        setSavedImageUri(uri);
        setSavedImageKind(uri ? savedPlacePhotoKind(hydrated.snapshot, uri) : 'unknown');
      }
    });
    return () => { cancelled = true; };
  }, [saved.id, saved.place.google_place_id, saved.user_id, sourceImageUri]);
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
      onPress={() => onPress(saved)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t("Opens saved place details")}
      style={({ pressed }) => [styles.card, showFeature && styles.featured, largeText && styles.largeTextCard, pressed && styles.pressed]}
    >
      <View style={[styles.imageWrap, showFeature && styles.featuredImageWrap]}>
        <PlaceImage
          googlePlaceId={saved.place.google_place_id}
          hydrationPolicy="saved_snapshot"
          initialPhotoUrls={savedImageUri ? [savedImageUri] : undefined}
          sourceUri={sourceImageUri}
          preferPlacePhoto
          onResolvedKind={setImageResolution}
          size={imageSize}
          borderRadius={Radius.md}
          style={[styles.image, showFeature && styles.featuredImage]}
        />
        {imageResolution === 'source' || savedImageKind === 'source' ? (
          <View style={[styles.imageOrigin, { backgroundColor: colors.surface }]}><Text style={styles.imageOriginText}>{t("Post")}</Text></View>
        ) : hasSource ? (
          <View style={styles.sourceBadge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Feather name="play" size={12} color={colors.textInverse} />
          </View>
        ) : null}
      </View>

      <View style={styles.copy}>
        <Text style={[typography.bodyStrong, styles.name, showFeature && styles.featuredName]} numberOfLines={largeText ? undefined : 2}>
          {saved.place.name}
        </Text>
        {locality ? (
          <Text style={[typography.caption, styles.locality]} numberOfLines={largeText ? undefined : 1}>{locality}</Text>
        ) : null}
        {note ? (
          <View style={styles.noteRow}>
            <Text style={[typography.caption, styles.note]} numberOfLines={largeText || showFeature ? 2 : 1}>{note.text}</Text>
          </View>
        ) : null}
        <View style={styles.footer}>
          <View style={styles.categoryPill}>
            <Text style={styles.categoryText}>{category}</Text>
          </View>
          <View style={styles.footerMeta}>
            {distance ? <Text style={[typography.caption, styles.distance]}>{distance}</Text> : null}
            {showFeature && date ? <Text style={[typography.caption, styles.date]}>{date}</Text> : null}
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
      minHeight: 106,
      flexDirection: 'row',
      gap: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.bg,
    },
    featured: { flexDirection: 'column', gap: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, marginBottom: Spacing.sm },
    largeTextCard: { flexWrap: 'wrap' },
    featuredImageWrap: { width: '100%', height: undefined, aspectRatio: 2 },
    featuredImage: { width: '100%', height: '100%' },
    featuredName: { fontSize: 23, lineHeight: 28 },
    pressed: { backgroundColor: colors.surfaceElevated },
    imageWrap: { width: 72, height: 82 },
    image: { borderWidth: 0, width: '100%', height: '100%' },
    sourceBadge: {
      position: 'absolute',
      right: 7,
      bottom: 7,
      width: 24,
      height: 24,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    imageOrigin: { position: 'absolute', left: 4, bottom: 4, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
    imageOriginText: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
    copy: { flex: 1, minWidth: 140, paddingVertical: 2 },
    name: { color: colors.text, lineHeight: 21 },
    locality: { color: colors.textSecondary, marginTop: 3 },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: Spacing.sm },
    note: { color: colors.textSecondary, flex: 1, lineHeight: 18 },
    footer: {
      marginTop: Spacing.xs,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    categoryPill: {
      flexShrink: 1,
    },
    categoryText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    footerMeta: { alignItems: 'flex-end', gap: 2 },
    distance: { color: colors.textSecondary, fontWeight: '600' },
    date: { color: colors.textSecondary, fontSize: 12 },
  });
}
