import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
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
  size?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
};

export function PlaceImage({
  googlePlaceId,
  sourceUri,
  size = 64,
  borderRadius = 12,
  style,
  imageStyle,
  accessibilityLabel,
}: Props) {
  const { colors } = useTheme();
  const [placePhotoUrls, setPlacePhotoUrls] = useState<string[]>([]);
  const [failedUris, setFailedUris] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(!sourceUri && !!googlePlaceId);
  const frameStyle = useMemo(
    () => ({ width: size, height: size, borderRadius }),
    [borderRadius, size],
  );

  useEffect(() => {
    setPlacePhotoUrls([]);
    setFailedUris({});
  }, [googlePlaceId, sourceUri]);

  const resolvedUri = selectPlaceImageUri(sourceUri, placePhotoUrls, failedUris);

  useEffect(() => {
    let cancelled = false;

    if (sourceUri && !failedUris[sourceUri]) {
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
    void getCachedPlaceRichDetails(googlePlaceId).then((details) => {
      if (cancelled) return;
      setPlacePhotoUrls(details?.photoUrls ?? []);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [failedUris, googlePlaceId, sourceUri]);

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
        />
      ) : loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Feather name="map-pin" size={Math.max(18, Math.round(size * 0.3))} color={colors.accent} />
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
});