import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components';
import { Radius, Spacing } from '@/constants';
import { CATEGORY_LABELS } from '@/lib/placeCategory';
import { formatNearbyDistance } from '@/lib/alsoNearby';
import { openExternalMaps } from '@/lib/externalMaps';
import { pageIndexFromOffset } from '@/lib/photoCarousel';
import { useTheme } from '@/lib/theme';
import {
  type PlaceRecommendation,
} from '@/lib/placeRecommendations';
import {
  recommendationHeroHeight,
  visibleRecommendationPhotoUrls,
} from '@/lib/recommendationDetailUi';

type Props = {
  recommendation: PlaceRecommendation | null;
  onClose: () => void;
  onSave?: (recommendation: PlaceRecommendation) => Promise<boolean>;
};

/**
 * Read-only detail for an unsaved recommendation. Opening this view never
 * saves; the only mutation is the explicit "Save place" button.
 */
export function RecommendedPlaceDetails({ recommendation, onClose, onSave }: Props) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const [saving, setSaving] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Record<string, true>>({});
  const [carouselWidth, setCarouselWidth] = useState(() =>
    Math.max(1, viewportWidth - Spacing.lg * 2),
  );
  const galleryRef = useRef<FlatList<string> | null>(null);

  const photoUrls = useMemo(
    () => visibleRecommendationPhotoUrls(recommendation, failedPhotoUrls),
    [recommendation, failedPhotoUrls],
  );

  useEffect(() => {
    setSaving(false);
    setPhotoIndex(0);
    setFailedPhotoUrls({});
  }, [recommendation?.googlePlaceId]);

  useEffect(() => {
    setPhotoIndex((current) => {
      if (photoUrls.length === 0) return 0;
      return Math.min(current, photoUrls.length - 1);
    });
  }, [photoUrls.length]);

  if (!recommendation) return null;

  const safePhotoIndex = photoUrls.length === 0
    ? 0
    : Math.max(0, Math.min(photoIndex, photoUrls.length - 1));
  const heroHeight = recommendationHeroHeight(carouselWidth);
  const categoryLabel = CATEGORY_LABELS[recommendation.nearrCategory] ?? null;
  const distanceLabel = Number.isFinite(recommendation.distanceMeters)
    ? `${formatNearbyDistance(recommendation.distanceMeters)} away`
    : null;
  const metaLabel = [categoryLabel, distanceLabel].filter(Boolean).join(' · ');
  const address = recommendation.formattedAddress?.trim() || null;

  const handleSave = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      const saved = await onSave(recommendation);
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDirections = () => {
    void openExternalMaps({
      google_maps_url: recommendation.googleMapsUrl,
      google_place_id: recommendation.googlePlaceId,
      latitude: recommendation.latitude,
      longitude: recommendation.longitude,
      name: recommendation.name,
      formatted_address: recommendation.formattedAddress,
    });
  };

  const handlePhotoSettled = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPhotoIndex(
      pageIndexFromOffset(
        event.nativeEvent.contentOffset.x,
        carouselWidth,
        photoUrls.length,
      ),
    );
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: Math.max(insets.top, Spacing.md) }]}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close nearby place"
            hitSlop={10}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Feather name="x" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Nearby place</Text>
          <View style={styles.iconButton} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View
            style={[styles.hero, { height: heroHeight }]}
            onLayout={(event) => {
              const nextWidth = Math.round(event.nativeEvent.layout.width);
              if (nextWidth > 0 && nextWidth !== carouselWidth) setCarouselWidth(nextWidth);
            }}
          >
            {photoUrls.length > 0 ? (
              <FlatList
                ref={galleryRef}
                key={`recommendation-gallery-${recommendation.googlePlaceId}-${carouselWidth}`}
                data={photoUrls}
                horizontal
                pagingEnabled
                bounces={photoUrls.length > 1}
                scrollEnabled={photoUrls.length > 1}
                decelerationRate="fast"
                showsHorizontalScrollIndicator={false}
                initialNumToRender={1}
                maxToRenderPerBatch={2}
                windowSize={3}
                initialScrollIndex={safePhotoIndex}
                getItemLayout={(_data, index) => ({
                  length: carouselWidth,
                  offset: carouselWidth * index,
                  index,
                })}
                keyExtractor={(url) => url}
                onMomentumScrollEnd={handlePhotoSettled}
                onScrollToIndexFailed={({ index }) => {
                  requestAnimationFrame(() => {
                    galleryRef.current?.scrollToOffset({
                      offset: Math.min(index, photoUrls.length - 1) * carouselWidth,
                      animated: false,
                    });
                  });
                }}
                renderItem={({ item, index }) => (
                  <Image
                    source={{ uri: item }}
                    style={[styles.heroImage, { width: carouselWidth, height: heroHeight }]}
                    resizeMode="cover"
                    accessibilityRole="image"
                    accessibilityLabel={`${recommendation.name}, photo ${index + 1} of ${photoUrls.length}`}
                    onError={() =>
                      setFailedPhotoUrls((current) => ({ ...current, [item]: true }))
                    }
                  />
                )}
              />
            ) : (
              <View style={styles.heroFallback}>
                <View style={styles.fallbackIcon}>
                  <Feather name="map-pin" size={34} color={colors.accent} />
                </View>
                <Text style={styles.fallbackText}>No place photos yet</Text>
              </View>
            )}

            {photoUrls.length > 1 ? (
              <>
                <View pointerEvents="none" style={styles.counterPill}>
                  <Feather name="image" size={13} color="#FFFFFF" />
                  <Text style={styles.counterText}>
                    {safePhotoIndex + 1} / {photoUrls.length}
                  </Text>
                </View>
                <View pointerEvents="none" style={styles.paginationDots}>
                  {photoUrls.map((url, index) => (
                    <View
                      key={`dot-${url}`}
                      style={[styles.paginationDot, index === safePhotoIndex && styles.paginationDotActive]}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </View>

          <View style={styles.placeDetails}>
            <Text accessibilityRole="header" style={styles.name} numberOfLines={3}>
              {recommendation.name}
            </Text>
            {metaLabel ? <Text style={styles.meta}>{metaLabel}</Text> : null}
            {address ? (
              <View style={styles.addressRow}>
                <Feather name="map-pin" size={15} color={colors.textMuted} />
                <Text style={styles.address}>{address}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.actions}>
            <Button title="Directions" variant="secondary" onPress={handleDirections} style={styles.action} />
            {onSave ? (
              <Button
                title="Save place"
                onPress={() => void handleSave()}
                loading={saving}
                disabled={saving}
                style={styles.action}
              />
            ) : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 16 },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: Radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    pressed: { opacity: 0.65 },
    content: { padding: Spacing.lg, gap: Spacing.xl, paddingBottom: Spacing.xl * 2 },
    hero: {
      overflow: 'hidden',
      borderRadius: Radius.lg,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    heroImage: { backgroundColor: colors.surfaceElevated },
    heroFallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surfaceElevated,
    },
    fallbackIcon: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    fallbackText: { ...typography.bodyStrong, color: colors.textSecondary },
    counterPill: {
      position: 'absolute',
      right: Spacing.md,
      top: Spacing.md,
      minHeight: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(0,0,0,0.62)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.24)',
    },
    counterText: { ...typography.caption, color: '#FFFFFF', fontWeight: '700' },
    paginationDots: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: Spacing.md,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
    },
    paginationDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.45)',
    },
    paginationDotActive: {
      width: 18,
      backgroundColor: '#FFFFFF',
    },
    placeDetails: { gap: Spacing.sm },
    name: {
      ...typography.title,
      color: colors.text,
      fontSize: 28,
      lineHeight: 33,
    },
    meta: { ...typography.bodyStrong, color: colors.accent, fontSize: 15 },
    addressRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
      paddingTop: 2,
    },
    address: {
      ...typography.body,
      flex: 1,
      color: colors.textSecondary,
      lineHeight: 21,
    },
    actions: { flexDirection: 'row', gap: Spacing.md, paddingTop: Spacing.xs },
    action: { flex: 1, minHeight: 52 },
  });
}
