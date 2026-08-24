import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
  type DimensionValue,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { getCachedPlaceRichDetails } from '@/lib/placeRichDetailsCache';
import { selectPlaceImageUri } from '@/lib/placeImageSource';
import { useTheme } from '@/lib/theme';

type Props = {
  googlePlaceId?: string | null;
  sourceUri?: string | null;
  /** Candidate-specific source-video frame, used only after place imagery. */
  fallbackSourceUri?: string | null;
  /** Candidate confirmation prefers an exact Places photo over source media. */
  preferPlacePhoto?: boolean;
  size?: number;
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  onResolvedKind?: (kind: PlaceImageResolutionKind) => void;
};

export type PlaceImageResolutionKind = 'places' | 'source' | 'frame' | 'neutral';

const PHOTO_RESOLUTION_TIMEOUT_MS = 2200;

export function PlaceImage({
  googlePlaceId,
  sourceUri,
  fallbackSourceUri,
  preferPlacePhoto = false,
  size = 64,
  width,
  height,
  borderRadius = 12,
  style,
  imageStyle,
  accessibilityLabel,
  onResolvedKind,
}: Props) {
  const { colors } = useTheme();
  const [placePhotoUrls, setPlacePhotoUrls] = useState<string[]>([]);
  const [failedUris, setFailedUris] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(Boolean(googlePlaceId) && (preferPlacePhoto || !sourceUri));
  const [resolutionTimedOut, setResolutionTimedOut] = useState(false);
  const lastResolutionRef = useRef<PlaceImageResolutionKind | null>(null);
  const frameStyle = useMemo(
    () => ({ width: width ?? size, height: height ?? size, borderRadius }),
    [borderRadius, height, size, width],
  );

  useEffect(() => {
    setPlacePhotoUrls([]);
    setFailedUris({});
    setResolutionTimedOut(false);
    lastResolutionRef.current = null;
  }, [fallbackSourceUri, googlePlaceId, sourceUri]);

  const holdFallbackForPlacePhoto = preferPlacePhoto && loading && !resolutionTimedOut;
  const resolvedUri = selectPlaceImageUri(
    holdFallbackForPlacePhoto ? null : sourceUri,
    placePhotoUrls,
    failedUris,
    {
      preferPlacePhoto,
      fallbackSourceUri: holdFallbackForPlacePhoto ? null : fallbackSourceUri,
    },
  );

  useEffect(() => {
    let cancelled = false;

    if (!preferPlacePhoto && sourceUri && !failedUris[sourceUri]) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (!googlePlaceId) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setResolutionTimedOut(false);
    const timeout = setTimeout(() => {
      if (!cancelled) setResolutionTimedOut(true);
    }, PHOTO_RESOLUTION_TIMEOUT_MS);
    void getCachedPlaceRichDetails(googlePlaceId).then((details) => {
      if (cancelled) return;
      setPlacePhotoUrls(details?.photoUrls ?? []);
      setLoading(false);
      clearTimeout(timeout);
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [failedUris, googlePlaceId, preferPlacePhoto, sourceUri]);

  const resolutionKind: PlaceImageResolutionKind = resolvedUri
    ? placePhotoUrls.includes(resolvedUri)
      ? 'places'
      : resolvedUri === sourceUri
        ? 'source'
        : 'frame'
    : loading && !resolutionTimedOut
      ? 'neutral'
      : 'neutral';

  useEffect(() => {
    if (!onResolvedKind || (loading && !resolvedUri && !resolutionTimedOut)) return;
    if (lastResolutionRef.current === resolutionKind) return;
    lastResolutionRef.current = resolutionKind;
    onResolvedKind(resolutionKind);
  }, [loading, onResolvedKind, resolutionKind, resolutionTimedOut, resolvedUri]);

  return (
    <View
      style={[
        styles.frame,
        frameStyle,
        { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
        style,
      ]}
    >
      {resolvedUri ? (
        <Image
          source={{ uri: resolvedUri }}
          style={[styles.image, frameStyle, imageStyle]}
          resizeMode="cover"
          onError={() => setFailedUris((current) => ({ ...current, [resolvedUri]: true }))}
          accessibilityLabel={accessibilityLabel}
          accessible={Boolean(accessibilityLabel)}
        />
      ) : loading && !resolutionTimedOut ? (
        <View style={[styles.skeleton, { backgroundColor: colors.border }]} accessibilityLabel="Loading place photo">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <View style={styles.neutral} accessibilityLabel="No place photo available">
          <Feather name="map-pin" size={Math.max(22, Math.round(Math.min(size, height ?? size) * 0.28))} color={colors.accent} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  skeleton: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', opacity: 0.55 },
  neutral: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
