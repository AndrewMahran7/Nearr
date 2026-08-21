/**
 * Memoized saved-place marker with a default-off legacy path.
 *
 * Android custom markers are rasterized into native bitmaps. View tracking is
 * enabled only long enough to capture the current visual (including a selected
 * photo), then disabled to avoid react-native-maps' ViewChangesTracker OOM
 * path. Only the selected marker may request rich details; normal markers are
 * category-only and never fan out network calls.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
} from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Marker } from 'react-native-maps';

import { getCachedPlaceRichDetails } from '@/lib/placeRichDetailsCache';
import {
  savedMarkerPresentation,
  type MapMarkerDetailLevel,
} from '@/lib/mapMarkerPresentation';
import { savedPlacePinOpacity } from '@/lib/savedPlacePinState';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  place: SavedPlaceWithPlace;
  markerRefs: React.MutableRefObject<Record<string, ComponentRef<typeof Marker> | null>>;
  onPress: (place: SavedPlaceWithPlace) => void;
  dimmed: boolean;
  selected: boolean;
  detailLevel: MapMarkerDetailLevel;
  redesignEnabled: boolean;
};

const PHOTO_TRACKING_SAFETY_MS = 2500;
const MAP_PIN_DIAGNOSTIC_LIMIT = 30;
let mapPinDiagnosticsEmitted = 0;

function recordMapPinDiagnostic(
  event: string,
  details: Record<string, unknown>,
): void {
  if (!__DEV__ || mapPinDiagnosticsEmitted >= MAP_PIN_DIAGNOSTIC_LIMIT) return;
  mapPinDiagnosticsEmitted += 1;
  console.debug('[map-pins]', event, details);
}

function NearrMapMarkerView({
  place,
  markerRefs,
  onPress,
  dimmed,
  selected,
  detailLevel,
  redesignEnabled,
}: Props) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  if ([1, 5, 10].includes(renderCountRef.current)) {
    recordMapPinDiagnostic('marker-render', {
      savedPlaceId: place.id,
      renderCount: renderCountRef.current,
      selected,
      detailLevel,
    });
  }

  useEffect(() => {
    let cancelled = false;
    const googlePlaceId = place.place.google_place_id?.trim() || null;

    setPhotoUri(null);
    setPhotoFailed(false);
    if (!redesignEnabled || !selected || !googlePlaceId) return () => { cancelled = true; };

    // The selected Place Detail uses this same in-memory cache. Concurrent
    // reads dedupe to one request, so this never adds a per-marker fan-out.
    recordMapPinDiagnostic('selected-photo-request', { savedPlaceId: place.id });
    void getCachedPlaceRichDetails(googlePlaceId).then((details) => {
      if (cancelled) return;
      const nextPhotoUri = details?.photoUrls.find((uri) => !!uri?.trim()) ?? null;
      recordMapPinDiagnostic('selected-photo-result', {
        savedPlaceId: place.id,
        hasPhoto: !!nextPhotoUri,
      });
      setPhotoUri(nextPhotoUri);
    });

    return () => {
      cancelled = true;
    };
  }, [place.id, place.place.google_place_id, redesignEnabled, selected]);

  const presentation = useMemo(
    () => savedMarkerPresentation(place, {
      detailLevel,
      selected,
      photoUri,
      photoFailed,
    }),
    [detailLevel, photoFailed, photoUri, place, selected],
  );

  // Re-arm native snapshotting only when the visual itself changes. Category
  // markers freeze on the next turn; a selected photo gets a bounded window to
  // decode and also freezes immediately from its onLoad callback.
  useEffect(() => {
    setTracksViewChanges(true);
    const delay = presentation.visual === 'photo' ? PHOTO_TRACKING_SAFETY_MS : 0;
    const id = setTimeout(() => setTracksViewChanges(false), delay);
    return () => clearTimeout(id);
  }, [presentation.detailLevel, presentation.selected, presentation.visual, presentation.photoUri]);

  const handlePress = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      onPress(place);
    },
    [onPress, place],
  );

  const handlePhotoLoad = useCallback(() => {
    recordMapPinDiagnostic('selected-photo-loaded', { savedPlaceId: place.id });
    setTracksViewChanges(false);
  }, [place.id]);
  const handlePhotoError = useCallback(() => {
    // The next render is the complete category fallback; its visual-key effect
    // briefly re-arms tracking so native never keeps a blank image snapshot.
    recordMapPinDiagnostic('selected-photo-failed', { savedPlaceId: place.id });
    setPhotoFailed(true);
  }, [place.id]);

  const markerSize = selected
    ? 52
    : detailLevel === 'dense'
      ? 20
      : detailLevel === 'compact'
        ? 26
        : 32;
  const iconSize = selected
    ? 23
    : detailLevel === 'dense'
      ? 11
      : detailLevel === 'compact'
        ? 14
        : 18;
  const selectedWidth = 148;
  const selectedHeight = 78;

  return (
    <Marker
      identifier={place.id}
      opacity={savedPlacePinOpacity(place, dimmed)}
      zIndex={selected ? 30 : dimmed ? 1 : 20}
      ref={(ref) => {
        markerRefs.current[place.id] = ref;
      }}
      coordinate={{
        latitude: place.place.latitude,
        longitude: place.place.longitude,
      }}
      anchor={selected && redesignEnabled ? { x: 0.5, y: 0.335 } : { x: 0.5, y: 0.5 }}
      centerOffset={{ x: 0, y: 0 }}
      tracksViewChanges={tracksViewChanges}
      onPress={handlePress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={presentation.accessibilityLabel}
      accessibilityHint="Opens saved place details"
      accessibilityState={{ selected }}
    >
      {!redesignEnabled ? (
        <View style={styles.legacyWrap}>
          <View style={styles.legacyHalo} />
          <View style={styles.legacyCore} />
          <View style={styles.legacyDot} />
        </View>
      ) : (
        <View
          style={[
            styles.redesignWrap,
            selected
              ? { width: selectedWidth, height: selectedHeight }
              : { width: markerSize, height: markerSize },
          ]}
          pointerEvents="none"
        >
          <View
            style={[
              styles.categoryDisc,
              { width: markerSize, height: markerSize, borderRadius: markerSize / 2 },
              selected && styles.selectedDisc,
              detailLevel === 'dense' && !selected && styles.denseDisc,
            ]}
          >
            {presentation.visual === 'photo' && presentation.photoUri ? (
              <Image
                source={{ uri: presentation.photoUri }}
                style={styles.photo}
                resizeMode="cover"
                onLoad={handlePhotoLoad}
                onError={handlePhotoError}
                accessible={false}
              />
            ) : (
              <MaterialCommunityIcons
                name={presentation.glyph as ComponentProps<typeof MaterialCommunityIcons>['name']}
                size={iconSize}
                color={selected ? '#FFF7ED' : '#282421'}
              />
            )}
            {!selected && detailLevel !== 'dense' ? <View style={styles.savedDot} /> : null}
          </View>
          {presentation.showLabel ? (
            <View style={styles.labelCapsule}>
              <Text style={styles.labelText} numberOfLines={1}>
                {place.place.name}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </Marker>
  );
}

export const NearrMapMarker = memo(NearrMapMarkerView, (prev, next) =>
  prev.place.id === next.place.id &&
  prev.place.archived_at === next.place.archived_at &&
  prev.place.visited_at === next.place.visited_at &&
  prev.place.notifications_enabled === next.place.notifications_enabled &&
  prev.place.category === next.place.category &&
  prev.place.place.name === next.place.place.name &&
  prev.place.place.category === next.place.place.category &&
  prev.place.place.google_primary_type === next.place.place.google_primary_type &&
  prev.place.place.google_types?.join('|') === next.place.place.google_types?.join('|') &&
  prev.place.place.google_place_id === next.place.place.google_place_id &&
  prev.place.place.latitude === next.place.place.latitude &&
  prev.place.place.longitude === next.place.place.longitude &&
  prev.dimmed === next.dimmed &&
  prev.selected === next.selected &&
  prev.detailLevel === next.detailLevel &&
  prev.redesignEnabled === next.redesignEnabled &&
  prev.onPress === next.onPress,
);

const styles = StyleSheet.create({
  legacyWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legacyHalo: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 106, 26, 0.18)',
  },
  legacyCore: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 106, 26, 0.35)',
  },
  legacyDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FF6A1A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  redesignWrap: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  categoryDisc: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF4E8',
    borderWidth: 1.5,
    borderColor: '#282421',
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  denseDisc: {
    borderWidth: 1,
    shadowOpacity: 0.16,
    shadowRadius: 2,
    elevation: 2,
  },
  selectedDisc: {
    backgroundColor: '#FF6A1A',
    borderWidth: 4,
    borderColor: '#FFF4E8',
    shadowOpacity: 0.34,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  savedDot: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF6A1A',
    borderWidth: 1,
    borderColor: '#FFF4E8',
  },
  photo: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  labelCapsule: {
    maxWidth: 148,
    marginTop: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#282421',
    borderWidth: 1,
    borderColor: '#FFF4E8',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  labelText: {
    color: '#FFF7ED',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
});
