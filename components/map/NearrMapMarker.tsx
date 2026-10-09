/**
 * Memoized saved-place marker with a default-off legacy path.
 *
 * Android custom markers are rasterized into native bitmaps. View tracking is
 * enabled only long enough to capture the current visual (including a selected
 * photo), then disabled to avoid react-native-maps' ViewChangesTracker OOM
 * path. Saved markers never request rich details; recommendation markers can
 * display a photo already returned by the bounded Nearby Search response.
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
import { useTheme } from '@/lib/theme';
import { readSavedPlaceSnapshot } from '@/lib/savedPlaceSnapshot';

import {
  savedMarkerPresentation,
  type MapMarkerDetailLevel,
} from '@/lib/mapMarkerPresentation';
import { savedPlacePinOpacity } from '@/lib/savedPlacePinState';
import { hydrateSavedPlace } from '@/lib/savedPlaceHydration';
import { placeSourceCards } from '@/lib/placeSources';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  place: SavedPlaceWithPlace;
  markerRefs: React.MutableRefObject<Record<string, ComponentRef<typeof Marker> | null>>;
  onPress: (place: SavedPlaceWithPlace) => void;
  dimmed: boolean;
  selected: boolean;
  /** Another durable member of the selected source-video group. */
  groupMember?: boolean;
  /**
   * True while the selected place's Place Detail card is on screen. Only the
   * marker's visual name capsule reacts to this; the accessible name is
   * unconditional.
   */
  detailVisible: boolean;
  detailLevel: MapMarkerDetailLevel;
  redesignEnabled: boolean;
  /** Explorer recommendations use the current marker without implying a save. */
  savedState?: boolean;
  /** Bounded thumbnail already returned by the nearby recommendation request. */
  photoUri?: string | null;
  photoEligible?: boolean;
  accessibilityHint?: string;
};

const PHOTO_TRACKING_SAFETY_MS = 2500;
// A zero-delay timer can run before Android has rasterized the first native
// frame, freezing a blank custom-marker bitmap. Keep the bounded tracker alive
// long enough for layout + one rendered frame, then disable it as before.
const STATIC_MARKER_SNAPSHOT_MS = 120;
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
  groupMember = false,
  detailVisible,
  detailLevel,
  redesignEnabled,
  savedState = true,
  photoUri: suppliedPhotoUri,
  photoEligible = false,
  accessibilityHint,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
    setPhotoUri(suppliedPhotoUri?.trim() || null);
    setPhotoFailed(false);
    if (suppliedPhotoUri?.trim()) return () => { cancelled = true; };
    if (!redesignEnabled || !savedState) return () => { cancelled = true; };
    if (!selected) {
      if (photoEligible) void readSavedPlaceSnapshot({ userId: place.user_id, savedPlaceId: place.id, googlePlaceId: place.place.google_place_id }).then(result => {
        if (!cancelled && result.status === 'hit') setPhotoUri(result.snapshot.localImageUri);
      });
      return () => { cancelled = true; };
    }
    // Share the canonical local-first request with Place Detail. Hydration is
    // coalesced by saved id, so marker + card never produce duplicate recovery.
    recordMapPinDiagnostic('selected-photo-request', { savedPlaceId: place.id });
    void hydrateSavedPlace({
      userId: place.user_id,
      saved: place,
      trigger: 'map_detail',
      knownImageUri: placeSourceCards(place).find((source) => !!source.thumbnailUrl)?.thumbnailUrl ?? null,
    }).then((hydrated) => {
      if (cancelled) return;
      const nextPhotoUri = hydrated.details.photoUrls[0] ?? null;
      recordMapPinDiagnostic('selected-photo-result', {
        savedPlaceId: place.id,
        hasPhoto: !!nextPhotoUri,
        source: hydrated.source,
      });
      setPhotoUri(nextPhotoUri);
    });
    return () => {
      cancelled = true;
    };
  }, [place.id, place.place.google_place_id, place.user_id, redesignEnabled, savedState, selected, suppliedPhotoUri, photoEligible]);

  const presentation = useMemo(
    () => savedMarkerPresentation(place, {
      detailLevel,
      selected,
      photoUri,
      photoFailed,
      detailVisible,
      savedState,
      photoEligible,
    }),
    [detailLevel, detailVisible, photoFailed, photoUri, place, savedState, selected, photoEligible],
  );

  // The label capsule is part of the rasterized visual, so its presence also
  // decides how much canvas the selected marker needs and where the pin's
  // anchor sits inside that canvas.
  const showsLabel = presentation.showLabel;

  // Re-arm native snapshotting only when the visual itself changes. Category
  // markers freeze on the next turn; a selected photo gets a bounded window to
  // decode and also freezes immediately from its onLoad callback.
  useEffect(() => {
    setTracksViewChanges(true);
    const delay = presentation.visual === 'photo'
      ? PHOTO_TRACKING_SAFETY_MS
      : STATIC_MARKER_SNAPSHOT_MS;
    const id = setTimeout(() => setTracksViewChanges(false), delay);
    return () => clearTimeout(id);
  }, [
    presentation.detailLevel,
    presentation.selected,
    presentation.showLabel,
    presentation.visual,
    presentation.photoUri,
    colors.surface,
  ]);

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
    ? 60
    : presentation.visual === 'photo' ? 46
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
  const selectedHeight = 90;

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
      // The label capsule extends the canvas BELOW the disc, so the selected
      // pin anchors on the disc's centre (26 of 78) instead of the box centre.
      // Without a label the canvas is the disc itself and the anchor is 0.5 —
      // both resolve to the same geographic point, so hiding the label never
      // nudges the pin.
      anchor={selected && redesignEnabled && showsLabel ? { x: 0.5, y: 0.335 } : { x: 0.5, y: 0.5 }}
      centerOffset={{ x: 0, y: 0 }}
      tracksViewChanges={tracksViewChanges}
      onPress={handlePress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={presentation.accessibilityLabel}
      accessibilityHint={accessibilityHint ?? 'Opens saved place details'}
      accessibilityState={{ selected }}
    >
      {!redesignEnabled ? (
        <View style={styles.legacyWrap}>
          <View style={[styles.legacyHalo, groupMember && styles.legacyGroupHalo]} />
          <View style={styles.legacyCore} />
          <View style={styles.legacyDot} />
        </View>
      ) : (
        <View
          style={[
            styles.redesignWrap,
            selected && showsLabel
              ? { width: selectedWidth, height: selectedHeight }
              : { width: markerSize, height: markerSize },
          ]}
          pointerEvents="none"
        >
          <View
            style={[
              styles.categoryDisc,
              { width: markerSize, height: markerSize, borderRadius: presentation.visual === 'photo' ? 14 : markerSize / 2 },
              selected && styles.selectedDisc,
              groupMember && !selected && styles.groupMemberDisc,
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
                name={(savedState ? 'star-four-points' : presentation.glyph) as ComponentProps<typeof MaterialCommunityIcons>['name']}
                size={iconSize}
                color={selected ? colors.onGradient : colors.text}
              />
            )}
            {savedState && !selected && detailLevel !== 'dense' ? <View style={styles.savedDot} /> : null}
          </View>
          {showsLabel ? (
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
  prev.groupMember === next.groupMember &&
  prev.detailVisible === next.detailVisible &&
  prev.detailLevel === next.detailLevel &&
  prev.redesignEnabled === next.redesignEnabled &&
  prev.savedState === next.savedState &&
  prev.photoUri === next.photoUri &&
  prev.photoEligible === next.photoEligible &&
  prev.accessibilityHint === next.accessibilityHint &&
  prev.onPress === next.onPress,
);

function createStyles(colors: ReturnType<typeof useTheme>['colors']) { return StyleSheet.create({
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
    backgroundColor: colors.brand,
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
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.text,
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
    backgroundColor: colors.brand,
    borderWidth: 4,
    borderColor: colors.surface,
    shadowOpacity: 0.34,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  legacyGroupHalo: {
    backgroundColor: 'rgba(255, 106, 26, 0.42)',
    borderWidth: 2,
    borderColor: colors.brand,
  },
  groupMemberDisc: {
    borderWidth: 3,
    borderColor: colors.brand,
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 6,
  },
  savedDot: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand,
    borderWidth: 1,
    borderColor: colors.surface,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  labelText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
});
}
