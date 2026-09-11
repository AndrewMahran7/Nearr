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
import { getCachedCandidatePhotoUrlsWithOutcome } from '@/lib/candidatePhotoDetailsCache';
import {
  candidateHydrationDecision,
  normalizedPhotoUrls,
  type CandidatePresentationContext,
} from '@/lib/candidatePresentation';
import { trackCandidatePresentation } from '@/lib/candidatePresentationTelemetry';
import { selectPlaceImageUri } from '@/lib/placeImageSource';
import { acquirePlacePresentationImage } from '@/lib/savedPlaceImageStore';
import {
  allowsPlaceImageLookup,
  type PlaceImageHydrationPolicy,
} from '@/lib/placeImagePolicy';
import { useTheme } from '@/lib/theme';

type Props = {
  googlePlaceId?: string | null;
  sourceUri?: string | null;
  /** Candidate-specific source-video frame, used only after place imagery. */
  fallbackSourceUri?: string | null;
  /** Candidate confirmation prefers an exact Places photo over source media. */
  preferPlacePhoto?: boolean;
  /** Saved-place surfaces set false so list/card mounts never hydrate Google. */
  allowGoogleLookup?: boolean;
  /** Explicit context policy; preferred over the legacy boolean veto. */
  hydrationPolicy?: PlaceImageHydrationPolicy;
  size?: number;
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  onResolvedKind?: (kind: PlaceImageResolutionKind) => void;
  initialPhotoUrls?: readonly string[] | null;
  /** Keeps saved-place rich details intact while candidate surfaces use photos-only fallback. */
  presentationMode?: 'rich' | 'candidate';
  presentationActive?: boolean;
  presentationContext?: CandidatePresentationContext;
};

export type PlaceImageResolutionKind = 'places' | 'source' | 'frame' | 'neutral';

const PHOTO_RESOLUTION_TIMEOUT_MS = 2200;

export function PlaceImage({
  googlePlaceId,
  sourceUri,
  fallbackSourceUri,
  preferPlacePhoto = false,
  allowGoogleLookup = true,
  hydrationPolicy,
  size = 64,
  width,
  height,
  borderRadius = 12,
  style,
  imageStyle,
  accessibilityLabel,
  onResolvedKind,
  initialPhotoUrls,
  presentationMode = 'rich',
  presentationActive = true,
  presentationContext = { trigger: 'other' },
}: Props) {
  const { colors } = useTheme();
  const googleLookupAllowed = hydrationPolicy
    ? allowsPlaceImageLookup(hydrationPolicy, Boolean(googlePlaceId))
    : allowGoogleLookup;
  const knownImageryVisible = hydrationPolicy
    ? hydrationPolicy !== 'inactive_candidate' && hydrationPolicy !== 'offscreen_manual_search'
    : presentationMode !== 'candidate' || presentationActive;
  const initialPhotoSignature = (initialPhotoUrls ?? []).join('\n');
  const normalizedInitialPhotos = useMemo(
    () => normalizedPhotoUrls(initialPhotoUrls),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialPhotoSignature],
  );
  const [placePhotoUrls, setPlacePhotoUrls] = useState<string[]>(normalizedInitialPhotos);
  const [failedUris, setFailedUris] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(() => presentationMode === 'candidate'
    ? candidateHydrationDecision({
        active: presentationActive,
        allowGoogleLookup: googleLookupAllowed,
        googlePlaceId,
        photoUrls: normalizedInitialPhotos,
        sourceUri,
        fallbackSourceUri,
      }).shouldRequest
    : googleLookupAllowed && Boolean(googlePlaceId) && (preferPlacePhoto || !sourceUri));
  const [resolutionTimedOut, setResolutionTimedOut] = useState(false);
  const [materializedImage, setMaterializedImage] = useState<{ source: string; uri: string } | null>(null);
  const lastResolutionRef = useRef<PlaceImageResolutionKind | null>(null);
  const photoLoadRef = useRef<string | null>(null);
  const lastAvoidanceRef = useRef<string | null>(null);
  const lastActivePlaceIdRef = useRef<string | null>(null);
  const contextRef = useRef(presentationContext);
  contextRef.current = presentationContext;
  const frameStyle = useMemo(
    () => ({ width: width ?? size, height: height ?? size, borderRadius }),
    [borderRadius, height, size, width],
  );

  useEffect(() => {
    setPlacePhotoUrls(normalizedInitialPhotos);
    setFailedUris({});
    setResolutionTimedOut(false);
    setMaterializedImage(null);
    setLoading(presentationMode === 'candidate'
      ? candidateHydrationDecision({
          active: presentationActive,
          allowGoogleLookup: googleLookupAllowed,
          googlePlaceId,
          photoUrls: normalizedInitialPhotos,
          sourceUri,
          fallbackSourceUri,
        }).shouldRequest
      : googleLookupAllowed && Boolean(googlePlaceId) && (preferPlacePhoto || !sourceUri));
    lastResolutionRef.current = null;
    photoLoadRef.current = null;
  }, [
    googleLookupAllowed,
    fallbackSourceUri,
    googlePlaceId,
    initialPhotoSignature,
    normalizedInitialPhotos,
    preferPlacePhoto,
    presentationActive,
    presentationMode,
    sourceUri,
  ]);

  const candidateDecision = useMemo(() => candidateHydrationDecision({
    active: presentationActive,
    allowGoogleLookup: googleLookupAllowed,
    googlePlaceId,
    photoUrls: normalizedInitialPhotos,
    sourceUri,
    fallbackSourceUri,
  }), [fallbackSourceUri, googleLookupAllowed, googlePlaceId, normalizedInitialPhotos, presentationActive, sourceUri]);

  useEffect(() => {
    if (presentationMode !== 'candidate') return;
    trackCandidatePresentation('candidate_presented', {
      ...presentationContext,
      googlePlaceId,
      active: presentationActive,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googlePlaceId, presentationContext.trigger, presentationContext.jobId, presentationContext.candidateIndex]);

  useEffect(() => {
    if (
      presentationMode === 'candidate'
      && presentationActive
      && lastActivePlaceIdRef.current !== (googlePlaceId ?? 'no_google_place_id')
    ) {
      trackCandidatePresentation('candidate_became_active', {
        ...presentationContext,
        googlePlaceId,
        active: true,
      });
    }
    lastActivePlaceIdRef.current = presentationMode === 'candidate' && presentationActive
      ? googlePlaceId ?? 'no_google_place_id'
      : null;
  }, [googlePlaceId, presentationActive, presentationContext, presentationMode]);

  // Provider hydration and known-image visibility are distinct policy choices:
  // visible manual rows may render returned metadata while hidden candidates do not.
  const candidatePhotoUrls = knownImageryVisible ? placePhotoUrls : [];
  const candidateSourceUri = knownImageryVisible ? sourceUri : null;
  const holdFallbackForPlacePhoto = preferPlacePhoto && loading && !resolutionTimedOut;
  const resolvedUri = selectPlaceImageUri(
    holdFallbackForPlacePhoto ? null : candidateSourceUri,
    candidatePhotoUrls,
    failedUris,
    {
      preferPlacePhoto,
      fallbackSourceUri: holdFallbackForPlacePhoto ? null : fallbackSourceUri,
    },
  );
  const remoteResolvedUri = resolvedUri && /^https?:\/\//i.test(resolvedUri) ? resolvedUri : null;

  useEffect(() => {
    let cancelled = false;
    if (!remoteResolvedUri) {
      setMaterializedImage(null);
      return () => { cancelled = true; };
    }
    void acquirePlacePresentationImage(remoteResolvedUri).then((localUri) => {
      if (cancelled) return;
      if (localUri) setMaterializedImage({ source: remoteResolvedUri, uri: localUri });
      else setFailedUris((current) => ({ ...current, [remoteResolvedUri]: true }));
    });
    return () => { cancelled = true; };
  }, [remoteResolvedUri]);

  const displayUri = remoteResolvedUri
    ? materializedImage?.source === remoteResolvedUri ? materializedImage.uri : null
    : resolvedUri;
  const imageAcquisitionPending = Boolean(remoteResolvedUri && !displayUri);

  useEffect(() => {
    let cancelled = false;

    if (presentationMode === 'candidate') {
      if (!candidateDecision.shouldRequest) {
        setLoading(false);
        const key = `${googlePlaceId ?? ''}:${presentationActive}:${candidateDecision.reason}`;
        if (lastAvoidanceRef.current !== key) {
          lastAvoidanceRef.current = key;
          trackCandidatePresentation('candidate_google_details_avoided', {
            ...contextRef.current,
            googlePlaceId,
            active: presentationActive,
            reason: candidateDecision.reason,
          });
        }
        return () => { cancelled = true; };
      }
      if (!googlePlaceId) return () => { cancelled = true; };
      setLoading(true);
      setResolutionTimedOut(false);
      const timeout = setTimeout(() => {
        if (!cancelled) setResolutionTimedOut(true);
      }, PHOTO_RESOLUTION_TIMEOUT_MS);
      void getCachedCandidatePhotoUrlsWithOutcome(googlePlaceId, (outcome) => {
        trackCandidatePresentation(
          outcome === 'requested'
            ? 'candidate_google_details_requested'
            : outcome === 'deduped'
              ? 'candidate_google_request_deduped'
              : 'candidate_google_details_avoided',
          {
            ...contextRef.current,
            googlePlaceId,
            active: true,
            reason: outcome === 'cache_hit' ? 'cache_hit' : 'required',
          },
        );
      }).then(({ urls }) => {
        if (cancelled) return;
        setPlacePhotoUrls(urls);
        setLoading(false);
        clearTimeout(timeout);
      });
      return () => { cancelled = true; clearTimeout(timeout); };
    }

    if (!preferPlacePhoto && sourceUri && !failedUris[sourceUri]) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (!googleLookupAllowed || !googlePlaceId) {
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
  }, [
    googleLookupAllowed,
    candidateDecision,
    failedUris,
    googlePlaceId,
    preferPlacePhoto,
    presentationActive,
    presentationMode,
    sourceUri,
  ]);

  const resolutionKind: PlaceImageResolutionKind = resolvedUri
    ? candidatePhotoUrls.includes(resolvedUri)
      ? 'places'
      : resolvedUri === sourceUri
        ? 'source'
        : 'frame'
    : loading && !resolutionTimedOut
      ? 'neutral'
      : 'neutral';

  useEffect(() => {
    if (!onResolvedKind || imageAcquisitionPending || (loading && !resolvedUri && !resolutionTimedOut)) return;
    if (lastResolutionRef.current === resolutionKind) return;
    lastResolutionRef.current = resolutionKind;
    onResolvedKind(resolutionKind);
  }, [imageAcquisitionPending, loading, onResolvedKind, resolutionKind, resolutionTimedOut, resolvedUri]);

  return (
    <View
      style={[
        styles.frame,
        frameStyle,
        { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
        style,
      ]}
    >
      {displayUri && resolvedUri ? (
        <Image
          source={{ uri: displayUri }}
          style={[styles.image, frameStyle, imageStyle]}
          resizeMode="cover"
          onLoadStart={() => {
            if (presentationMode !== 'candidate' || photoLoadRef.current === resolvedUri) return;
            photoLoadRef.current = resolvedUri;
            const googlePhoto = candidatePhotoUrls.includes(resolvedUri);
            trackCandidatePresentation(
              googlePhoto ? 'candidate_google_photo_requested' : 'candidate_photo_source_media_used',
              {
                ...contextRef.current,
                googlePlaceId,
                active: presentationActive,
                reason: googlePhoto ? 'image_load' : undefined,
                photoIndex: 0,
                imageSource: googlePhoto ? 'google' : 'source_media',
              },
            );
            if (googlePhoto) {
              trackCandidatePresentation('candidate_photo_google_used', {
                ...contextRef.current,
                googlePlaceId,
                active: presentationActive,
                photoIndex: 0,
                imageSource: 'google',
              });
            }
            if (googlePhoto && normalizedInitialPhotos.includes(resolvedUri)) {
              trackCandidatePresentation('candidate_photo_existing_data_used', {
                ...contextRef.current,
                googlePlaceId,
                active: presentationActive,
                photoIndex: 0,
                imageSource: 'existing_data',
              });
            }
          }}
          onError={() => setFailedUris((current) => ({ ...current, [resolvedUri]: true }))}
          accessibilityLabel={accessibilityLabel}
          accessible={Boolean(accessibilityLabel)}
        />
      ) : imageAcquisitionPending || (loading && !resolutionTimedOut) ? (
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
