import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { getCachedPlaceRichDetails } from '@/lib/placeRichDetailsCache';
import type { PlaceImageResolutionKind } from '@/components/PlaceImage';

export const MAX_CANDIDATE_PHOTOS = 5;
export const PHOTO_RESOLUTION_TIMEOUT_MS = 5_000;

const COLORS = {
  orange: '#FF6A1A', cream: '#F4F2EF', muted: '#A7A39D', surface: '#202228', border: '#34363D',
};

type PhotoItem = { uri: string; kind: PlaceImageResolutionKind };

type Props = {
  googlePlaceId?: string | null;
  sourceUri?: string | null;
  initialPhotoUrls?: readonly string[] | null;
  fallbackSourceUri?: string | null;
  accessibilityLabel: string;
  height?: number;
  onResolvedKind?: (kind: PlaceImageResolutionKind) => void;
};

/** Shared bounded Places-photo carousel used by Quick Check and multi-place review. */
export function CandidatePhotoCarousel({
  googlePlaceId,
  sourceUri,
  initialPhotoUrls,
  fallbackSourceUri,
  accessibilityLabel,
  height = 220,
  onResolvedKind,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const width = measuredWidth || Math.max(280, windowWidth - Spacing.lg * 2);
  const [placePhotoUrls, setPlacePhotoUrls] = useState<string[]>(() => [...(initialPhotoUrls ?? [])].slice(0, MAX_CANDIDATE_PHOTOS));
  const [failedUris, setFailedUris] = useState<ReadonlySet<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [hydratedThrough, setHydratedThrough] = useState(1);
  const [loading, setLoading] = useState(!!googlePlaceId);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlacePhotoUrls([...(initialPhotoUrls ?? [])].slice(0, MAX_CANDIDATE_PHOTOS));
    setFailedUris(new Set());
    setActiveIndex(0);
    setHydratedThrough(1);
    setLoading(!!googlePlaceId && !(initialPhotoUrls?.length));
    setTimedOut(false);
    if (!googlePlaceId || initialPhotoUrls?.length) return () => { cancelled = true; };
    const timeout = setTimeout(() => { if (!cancelled) setTimedOut(true); }, PHOTO_RESOLUTION_TIMEOUT_MS);
    void getCachedPlaceRichDetails(googlePlaceId).then((details) => {
      if (cancelled) return;
      setPlacePhotoUrls((details?.photoUrls ?? []).filter(Boolean).slice(0, MAX_CANDIDATE_PHOTOS));
      setLoading(false);
      clearTimeout(timeout);
    });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [googlePlaceId, initialPhotoUrls]);

  const items = useMemo<PhotoItem[]>(() => {
    const places = placePhotoUrls.filter((uri) => !failedUris.has(uri)).map((uri) => ({ uri, kind: 'places' as const }));
    if (places.length > 0) return places;
    if (loading && !timedOut) return [];
    if (sourceUri && !failedUris.has(sourceUri)) return [{ uri: sourceUri, kind: 'source' }];
    if (fallbackSourceUri && !failedUris.has(fallbackSourceUri)) return [{ uri: fallbackSourceUri, kind: 'frame' }];
    return [];
  }, [failedUris, fallbackSourceUri, loading, placePhotoUrls, sourceUri, timedOut]);

  useEffect(() => {
    if (loading && !timedOut && items.length === 0) return;
    onResolvedKind?.(items[0]?.kind ?? 'neutral');
  }, [items, loading, onResolvedKind, timedOut]);

  const markFailed = (uri: string) => setFailedUris((current) => new Set([...current, uri]));

  return (
    <View style={[styles.root, { minHeight: height }]} onLayout={(event) => setMeasuredWidth(Math.round(event.nativeEvent.layout.width))} testID="candidate-photo-carousel">
      {items.length > 0 ? (
        <>
          <FlatList
            horizontal
            pagingEnabled
            data={items}
            keyExtractor={(item) => item.uri}
            showsHorizontalScrollIndicator={false}
            bounces={items.length > 1}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={2}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={(event) => {
              const index = Math.max(0, Math.min(Math.round(event.nativeEvent.contentOffset.x / width), items.length - 1));
              setActiveIndex(index);
              setHydratedThrough((current) => Math.max(current, index + 1));
            }}
            renderItem={({ item, index }) => (
              <View style={[styles.photo, { width, height }]}>
                {index <= hydratedThrough ? (
                  <Image source={{ uri: item.uri }} style={styles.image} resizeMode="cover" onError={() => markFailed(item.uri)} accessibilityLabel={`${accessibilityLabel}, photo ${index + 1} of ${items.length}`} accessible />
                ) : (
                  <View style={styles.lazyPlaceholder} accessibilityLabel="Photo loads when viewed"><Feather name="image" size={23} color={COLORS.muted} /></View>
                )}
              </View>
            )}
          />
          {items.length > 1 ? (
            <View style={styles.dots} accessibilityLabel={`Photo ${activeIndex + 1} of ${items.length}`}>
              {items.map((item, index) => <View key={item.uri} style={[styles.dot, index === activeIndex && styles.dotActive]} />)}
            </View>
          ) : null}
        </>
      ) : loading && !timedOut ? (
        <View style={[styles.state, { height }]} accessibilityLabel="Loading place photos"><ActivityIndicator color={COLORS.orange} /></View>
      ) : (
        <View style={[styles.state, { height }]} accessibilityLabel="No place photos available">
          <Feather name="map-pin" size={28} color={COLORS.orange} />
          <Text style={styles.fallbackText}>Place photos unavailable</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', backgroundColor: COLORS.surface, overflow: 'hidden' },
  photo: { backgroundColor: COLORS.surface },
  image: { width: '100%', height: '100%' },
  lazyPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  state: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  fallbackText: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  dots: { position: 'absolute', bottom: 9, alignSelf: 'center', minHeight: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 9, borderRadius: 10, backgroundColor: 'rgba(15,16,20,0.68)' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { width: 17, backgroundColor: COLORS.cream },
});
