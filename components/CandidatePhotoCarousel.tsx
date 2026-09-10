import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { PhotoRolodexModal } from '@/components/PhotoRolodex';
import { pageIndexFromOffset } from '@/lib/photoCarousel';
import {
  candidateHydrationDecision,
  normalizedPhotoUrls,
  visitCandidatePhoto,
  type CandidatePresentationContext,
} from '@/lib/candidatePresentation';
import { getCachedCandidatePhotoUrlsWithOutcome } from '@/lib/candidatePhotoDetailsCache';
import { trackCandidatePresentation } from '@/lib/candidatePresentationTelemetry';
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
  variant?: 'carousel' | 'thumbnail';
  thumbnailWidth?: number;
  onResolvedKind?: (kind: PlaceImageResolutionKind) => void;
  /** Optional Google presentation hydration is allowed only while active. */
  active?: boolean;
  presentationContext?: CandidatePresentationContext;
};

/** Shared bounded Places-photo carousel used by Quick Check and multi-place review. */
export function CandidatePhotoCarousel({
  googlePlaceId,
  sourceUri,
  initialPhotoUrls,
  fallbackSourceUri,
  accessibilityLabel,
  height = 220,
  variant = 'carousel',
  thumbnailWidth = 118,
  onResolvedKind,
  active = true,
  presentationContext = { trigger: 'other' },
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const width = measuredWidth || Math.max(280, windowWidth - Spacing.lg * 2);
  const initialPhotoSignature = (initialPhotoUrls ?? []).join('\n');
  const normalizedInitialPhotos = useMemo(
    () => normalizedPhotoUrls(initialPhotoUrls, MAX_CANDIDATE_PHOTOS),
    // The signature avoids resetting on callers that reconstruct an equal array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialPhotoSignature],
  );
  const [placePhotoUrls, setPlacePhotoUrls] = useState<string[]>(normalizedInitialPhotos);
  const [failedUris, setFailedUris] = useState<ReadonlySet<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [visitedPhotoIndexes, setVisitedPhotoIndexes] = useState<ReadonlySet<number>>(
    () => new Set([0]),
  );
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const photoLoadsRef = useRef(new Set<string>());
  const lastAvoidanceRef = useRef<string | null>(null);
  const lastActivePlaceIdRef = useRef<string | null>(null);
  const contextRef = useRef(presentationContext);
  contextRef.current = presentationContext;

  const hydrationDecision = useMemo(() => candidateHydrationDecision({
    active,
    googlePlaceId,
    photoUrls: normalizedInitialPhotos,
    sourceUri,
    fallbackSourceUri,
  }), [active, fallbackSourceUri, googlePlaceId, normalizedInitialPhotos, sourceUri]);

  useEffect(() => {
    setPlacePhotoUrls(normalizedInitialPhotos);
    setFailedUris(new Set());
    setActiveIndex(0);
    setViewerIndex(null);
    setVisitedPhotoIndexes(new Set([0]));
    setLoading(false);
    setTimedOut(false);
    photoLoadsRef.current.clear();
    return undefined;
  // Active transitions are handled below without discarding hydrated session data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googlePlaceId, initialPhotoSignature, normalizedInitialPhotos]);

  useEffect(() => {
    trackCandidatePresentation('candidate_presented', {
      ...presentationContext,
      googlePlaceId,
      active,
    });
  // Presentation identity, not object identity, controls this event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googlePlaceId, presentationContext.trigger, presentationContext.jobId, presentationContext.candidateIndex]);

  useEffect(() => {
    if (active && lastActivePlaceIdRef.current !== (googlePlaceId ?? 'no_google_place_id')) {
      trackCandidatePresentation('candidate_became_active', {
        ...presentationContext,
        googlePlaceId,
        active: true,
      });
      setVisitedPhotoIndexes((current) => visitCandidatePhoto(current, 0, Math.max(1, placePhotoUrls.length)));
    }
    lastActivePlaceIdRef.current = active ? googlePlaceId ?? 'no_google_place_id' : null;
  }, [active, googlePlaceId, placePhotoUrls.length, presentationContext]);

  useEffect(() => {
    if (hydrationDecision.shouldRequest) return;
    const key = `${googlePlaceId ?? ''}:${active}:${hydrationDecision.reason}`;
    if (lastAvoidanceRef.current === key) return;
    lastAvoidanceRef.current = key;
    trackCandidatePresentation('candidate_google_details_avoided', {
      ...presentationContext,
      googlePlaceId,
      active,
      reason: hydrationDecision.reason,
    });
  }, [active, googlePlaceId, hydrationDecision, presentationContext]);

  useEffect(() => {
    let cancelled = false;
    if (!hydrationDecision.shouldRequest || !googlePlaceId) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setTimedOut(false);
    const timeout = setTimeout(() => { if (!cancelled) setTimedOut(true); }, PHOTO_RESOLUTION_TIMEOUT_MS);
    void getCachedCandidatePhotoUrlsWithOutcome(googlePlaceId, (outcome) => {
      if (outcome === 'requested') {
        trackCandidatePresentation('candidate_google_details_requested', {
          ...contextRef.current,
          googlePlaceId,
          active: true,
          reason: 'required',
        });
      } else if (outcome === 'deduped') {
        trackCandidatePresentation('candidate_google_request_deduped', {
          ...contextRef.current,
          googlePlaceId,
          active: true,
          reason: 'required',
        });
      } else {
        trackCandidatePresentation('candidate_google_details_avoided', {
          ...contextRef.current,
          googlePlaceId,
          active: true,
          reason: 'cache_hit',
        });
      }
    }).then(({ urls }) => {
      if (cancelled) return;
      setPlacePhotoUrls(urls);
      setLoading(false);
      clearTimeout(timeout);
    });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [googlePlaceId, hydrationDecision.shouldRequest]);

  const items = useMemo<PhotoItem[]>(() => {
    const places = active
      ? placePhotoUrls.filter((uri) => !failedUris.has(uri)).map((uri) => ({ uri, kind: 'places' as const }))
      : [];
    if (places.length > 0) return places;
    if (loading && !timedOut) return [];
    if (active && sourceUri && !failedUris.has(sourceUri)) return [{ uri: sourceUri, kind: 'source' }];
    if (fallbackSourceUri && !failedUris.has(fallbackSourceUri)) return [{ uri: fallbackSourceUri, kind: 'frame' }];
    return [];
  }, [active, failedUris, fallbackSourceUri, loading, placePhotoUrls, sourceUri, timedOut]);

  useEffect(() => {
    if (loading && !timedOut && items.length === 0) return;
    onResolvedKind?.(items[0]?.kind ?? 'neutral');
  }, [items, loading, onResolvedKind, timedOut]);

  const markFailed = (uri: string) => setFailedUris((current) => new Set([...current, uri]));
  const trackPhotoLoad = useCallback((index: number, uri: string) => {
    const key = `${googlePlaceId ?? ''}:${uri}`;
    if (photoLoadsRef.current.has(key)) return;
    photoLoadsRef.current.add(key);
    const item = items[index];
    if (item?.kind === 'places') {
      trackCandidatePresentation('candidate_google_photo_requested', {
        ...contextRef.current,
        googlePlaceId,
        active,
        reason: 'image_load',
        photoIndex: index,
        imageSource: 'google',
      });
      trackCandidatePresentation('candidate_photo_google_used', {
        ...contextRef.current,
        googlePlaceId,
        active,
        photoIndex: index,
        imageSource: 'google',
      });
    } else if (item?.kind === 'source' || item?.kind === 'frame') {
      trackCandidatePresentation('candidate_photo_source_media_used', {
        ...contextRef.current,
        googlePlaceId,
        active,
        photoIndex: index,
        imageSource: 'source_media',
      });
    }
    if (normalizedInitialPhotos.includes(uri)) {
      trackCandidatePresentation('candidate_photo_existing_data_used', {
        ...contextRef.current,
        googlePlaceId,
        active,
        photoIndex: index,
        imageSource: 'existing_data',
      });
    }
  }, [active, googlePlaceId, items, normalizedInitialPhotos]);
  const updatePageFromOffset = useCallback((offset: number) => {
    const index = pageIndexFromOffset(offset, width, items.length);
    setActiveIndex(index);
    setVisitedPhotoIndexes((current) => visitCandidatePhoto(current, index, items.length));
  }, [items.length, width]);
  const rolodexItems = useMemo(() => items.map((item, index) => ({
    key: item.uri,
    uri: item.uri,
    accessibilityLabel: `${accessibilityLabel}, photo ${index + 1} of ${items.length}`,
  })), [accessibilityLabel, items]);

  if (variant === 'thumbnail') {
    const first = items[0] ?? null;
    return (
      <View
        style={[styles.thumbnailRoot, { width: thumbnailWidth, height }]}
        testID="candidate-photo-thumbnail"
      >
        {first ? (
          <Pressable
            style={styles.thumbnailButton}
            onPress={() => setViewerIndex(0)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${accessibilityLabel}. Open gallery with ${items.length} ${items.length === 1 ? 'photo' : 'photos'}.`}
            accessibilityHint="Opens the shared photo gallery"
            testID="candidate-photo-thumbnail-open"
          >
            <Image
              source={{ uri: first.uri }}
              style={styles.image}
              resizeMode="cover"
              onLoadStart={() => trackPhotoLoad(0, first.uri)}
              onError={() => markFailed(first.uri)}
              accessible={false}
            />
            <View style={styles.expandBadge} pointerEvents="none">
              <Feather name="maximize-2" size={15} color={COLORS.cream} />
            </View>
            <View style={styles.countBadge} pointerEvents="none">
              <Feather name="image" size={14} color={COLORS.cream} />
              <Text style={styles.countText}>1 / {items.length}</Text>
            </View>
          </Pressable>
        ) : loading && !timedOut ? (
          <View style={styles.thumbnailState} accessibilityLabel="Loading place photos">
            <ActivityIndicator color={COLORS.orange} />
          </View>
        ) : (
          <View style={styles.thumbnailState} accessibilityLabel="No place photos available">
            <Feather name="map-pin" size={23} color={COLORS.orange} />
            <Text style={styles.thumbnailFallback}>No photo</Text>
          </View>
        )}
        <PhotoRolodexModal
          visible={viewerIndex != null}
          items={rolodexItems}
          initialIndex={viewerIndex ?? 0}
          onClose={() => setViewerIndex(null)}
          loadOnlyVisited
          prefetchAdjacent={false}
          onPhotoLoadStart={trackPhotoLoad}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { minHeight: height }]} onLayout={(event) => setMeasuredWidth(Math.round(event.nativeEvent.layout.width))} testID="candidate-photo-carousel">
      {items.length > 0 ? (
        <>
          <FlatList
            horizontal
            pagingEnabled
            nestedScrollEnabled
            directionalLockEnabled
            scrollEnabled={items.length > 1}
            data={items}
            keyExtractor={(item) => item.uri}
            showsHorizontalScrollIndicator={false}
            bounces={items.length > 1}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={2}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onScroll={(event) => updatePageFromOffset(event.nativeEvent.contentOffset.x)}
            onMomentumScrollEnd={(event) => updatePageFromOffset(event.nativeEvent.contentOffset.x)}
            scrollEventThrottle={16}
            renderItem={({ item, index }) => (
              <Pressable
                style={[styles.photo, { width, height }]}
                onPress={() => setViewerIndex(index)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`${accessibilityLabel}, photo ${index + 1} of ${items.length}`}
                accessibilityHint="Opens the shared photo gallery"
                testID={`candidate-photo-${index + 1}`}
              >
                {visitedPhotoIndexes.has(index) ? (
                  <Image source={{ uri: item.uri }} style={styles.image} resizeMode="cover" onLoadStart={() => trackPhotoLoad(index, item.uri)} onError={() => markFailed(item.uri)} accessible={false} />
                ) : (
                  <View style={styles.lazyPlaceholder} accessibilityLabel="Photo loads when viewed"><Feather name="image" size={23} color={COLORS.muted} /></View>
                )}
              </Pressable>
            )}
          />
          {items.length > 1 ? (
            <View
              style={styles.dots}
              accessible
              accessibilityLabel={`Photo ${activeIndex + 1} of ${items.length}`}
              accessibilityValue={{ text: `${activeIndex + 1} of ${items.length}` }}
              testID="candidate-photo-pagination"
            >
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
      <PhotoRolodexModal
        visible={viewerIndex != null}
        items={rolodexItems}
        initialIndex={viewerIndex ?? activeIndex}
        onClose={() => setViewerIndex(null)}
        loadOnlyVisited
        prefetchAdjacent={false}
        onPhotoLoadStart={trackPhotoLoad}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', backgroundColor: COLORS.surface, overflow: 'hidden' },
  thumbnailRoot: { overflow: 'hidden', borderRadius: 15, backgroundColor: COLORS.surface },
  thumbnailButton: { flex: 1 },
  photo: { backgroundColor: COLORS.surface },
  image: { width: '100%', height: '100%' },
  lazyPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  state: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  fallbackText: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  thumbnailState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  thumbnailFallback: { color: COLORS.muted, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  expandBadge: {
    position: 'absolute', right: 7, top: 7, width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,6,8,0.76)',
  },
  countBadge: {
    position: 'absolute', left: 7, bottom: 7, minHeight: 28, flexDirection: 'row',
    alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRadius: 10,
    backgroundColor: 'rgba(5,6,8,0.82)',
  },
  countText: { color: COLORS.cream, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  dots: { position: 'absolute', bottom: 9, alignSelf: 'center', minHeight: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 9, borderRadius: 10, backgroundColor: 'rgba(15,16,20,0.68)' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { width: 17, backgroundColor: COLORS.cream },
});
