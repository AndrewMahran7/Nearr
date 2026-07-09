/**
 * Map view for saved places.
 *
 * - Renders the user's saved places as markers using `react-native-maps`.
 * - Shows the user's location when foreground permission is granted.
 * - Tapping a marker opens an in-app preview card (Name, address, source,
 *   plus "View details" and "Open in Maps") instead of the platform callout.
 * - FAB opens the Save Place screen.
 *
 * Permission states:
 *   - 'pending'    : asking the OS; map still renders, no spinner overlay.
 *   - 'granted'    : center on the user; render the user dot.
 *   - 'denied'     : map still works. We center on the first saved place
 *                    (or a sensible US-wide fallback) and surface a small
 *                    banner so the user knows location is off.
 *   - 'unavailable': permission ok but the OS can't give us a fix (common on
 *                    Android emulators without a mock location). Treated like
 *                    'denied' for rendering: small non-blocking pill, no user
 *                    dot, but we never hide the map behind a spinner.
 *
 * V1 deliberately omits filters, clustering, and tile/style customization.
 */

import { useCallback, useEffect, useMemo, useRef, useState, memo, type ComponentRef } from 'react';
import {
  Animated,
  Alert,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

// iOS uses the default provider (Apple Maps) — the Google Maps iOS SDK
// requires the `AirGoogleMaps` Xcode subproject, which we don't link in
// our managed/EAS build. Android keeps PROVIDER_GOOGLE since the Google
// Maps Android SDK is wired via app.json `android.config.googleMaps`.
const MAP_PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined;

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#141414' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#787878' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#141414' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#1e1e1e' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#b3b3b3' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#5f6368' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#11171a' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#556064' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#202020' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#343434' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#252525' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b5b5b5' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b0f14' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4d6470' }] },
];

import { Button, Card, DemoModeBanner, MapFallbackList } from '@/components';
import {
  FloatingMapActions,
  MapBottomSheet,
  MapFilterChips,
  MapPlaceSearchDropdown,
  MapSnackbar,
  MapTopSearchBar,
  SelectedPlaceDetails,
  getSheetPartialHeight,
  type MapFilter,
  type SheetSnap,
} from '@/components/map';
import { Colors, Radius, Spacing, Typography } from '@/constants';
import { useNearbyPlaces } from '@/hooks/useNearbyPlaces';
import { useRecentPlaces } from '@/hooks/useRecentPlaces';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
} from '@/hooks/useSavedPlaces';
import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import { openExternalMaps as openInExternalMaps } from '@/lib/externalMaps';
import { trackEvent } from '@/lib/analytics';
import { isLikelyUrl } from '@/lib/shareParser';
import { distanceMeters, milesToMeters, minutesToMeters } from '@/lib/geo';
import { useTheme } from '@/lib/theme';
import { getDemoSeededSavedPlacesSync } from '@/services/demo';
import { getProfile } from '@/services/profileService';
import {
  deleteSavedPlace,
  markArchived,
  markVisited,
  saveSavedPlace,
} from '@/services/savedPlacesService';
import type { PlaceCandidate } from '@/services/placesService';
import type { Profile, SavedPlaceWithPlace } from '@/types';

function formatDistanceAway(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return 'Nearby now';
  const rounded = miles >= 10 ? Math.round(miles) : Math.round(miles * 10) / 10;
  return `${rounded} mi away`;
}

function selectedMeta(saved: SavedPlaceWithPlace): string | null {
  switch (saved.source_type) {
    case 'instagram':
      return 'Saved from Instagram';
    case 'tiktok':
      return 'Saved from TikTok';
    case 'link':
      return 'Saved from a link';
    default:
      return saved.place.category ?? null;
  }
}

function selectedIconName(saved: SavedPlaceWithPlace): React.ComponentProps<typeof Feather>['name'] {
  switch (saved.source_type) {
    case 'instagram':
      return 'instagram';
    case 'tiktok':
      return 'video';
    default:
      return 'map-pin';
  }
}

// Default radius used when neither the saved place nor the profile specify one.
// Matches the V1 default surfaced in add-place.tsx.
const DEFAULT_RADIUS_MILES = 1;

// Vertical space reserved by the floating search bar (50) + filter chips (40)
// plus their gaps, measured from the top of the map area. Other top-anchored
// overlays (View All, empty/preview pills) sit below this, and the bottom
// sheet's expanded top is clamped under it so the two never collide.
const TOP_CHROME_CLEARANCE = Spacing.md + 50 + Spacing.sm + 40 + Spacing.sm;

/**
 * Effective radius (in meters) for a saved place, used to render a Life360-
 * style zone bubble. Honors:
 *   1. per-place radius_value/radius_unit if set
 *   2. else profile default_radius_value/default_radius_unit if available
 *   3. else 1 mile
 */
function effectiveRadiusMeters(
  s: SavedPlaceWithPlace,
  profile: Profile | null,
): number {
  const value =
    s.radius_value ?? profile?.default_radius_value ?? DEFAULT_RADIUS_MILES;
  const unit = s.radius_unit ?? profile?.default_radius_unit ?? 'miles';
  return unit === 'minutes' ? minutesToMeters(value) : milesToMeters(value);
}

// Approximate degrees-of-latitude per meter. Good enough for camera framing
// (we do NOT use this for distance math — that lives in lib/geo.ts).
const METERS_PER_DEGREE_LAT = 111_000;

/**
 * Build the two diagonal corners of a square that bounds a circle of
 * `radiusMeters` centered at `(lat, lng)`. We pad by 30% so the circle
 * never touches the screen edge — this is what makes the zone feel like
 * a real bubble instead of a clipped arc.
 */
function radiusBoundingCoords(
  lat: number,
  lng: number,
  radiusMeters: number,
): Array<{ latitude: number; longitude: number }> {
  const padded = radiusMeters * 1.3;
  const dLat = padded / METERS_PER_DEGREE_LAT;
  // Longitude degrees shrink with latitude; correct for it so circles near
  // the poles still frame correctly.
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLng = padded / (METERS_PER_DEGREE_LAT * cosLat);
  return [
    { latitude: lat + dLat, longitude: lng + dLng },
    { latitude: lat - dLat, longitude: lng - dLng },
  ];
}

/**
 * Build bounding coords that cover ALL saved-place zones (each marker plus
 * its radius bubble). Used so multi-place fitting frames the circles, not
 * just the pins.
 */
function allZoneBoundingCoords(
  places: SavedPlaceWithPlace[],
  profile: Profile | null,
): Array<{ latitude: number; longitude: number }> {
  const coords: Array<{ latitude: number; longitude: number }> = [];
  for (const p of places) {
    coords.push(
      ...radiusBoundingCoords(
        p.place.latitude,
        p.place.longitude,
        effectiveRadiusMeters(p, profile),
      ),
    );
  }
  return coords;
}

type PermissionState = 'pending' | 'granted' | 'denied' | 'unavailable';
type ReminderSource = 'nearby' | 'notification' | 'unknown';

const MAX_REMINDER_OPPORTUNITIES = 3;

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseBoolParam(value?: string | string[]): boolean {
  const raw = firstParam(value);
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function parsePositiveIntParam(value?: string | string[]): number | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// How long we wait for `getCurrentPositionAsync` before giving up. Android
// emulators without a mock location will otherwise hang this call forever,
// which used to leave the map stuck behind a spinner.
const LOCATION_TIMEOUT_MS = 6_000;

// Centered on the contiguous US — used only when location is denied AND
// the user has zero saved places to anchor on.
const FALLBACK_REGION: Region = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 30,
  longitudeDelta: 30,
};

// Hoisted to module scope so its identity is stable across renders. Used
// only when Map Preview Mode is active.
const PREVIEW_INITIAL_REGION: Region = {
  latitude: 36.9741,
  longitude: -122.0308,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

// ---------------------------------------------------------------------------
// PlaceMarker
//
// 2026-05-27 Android OOM fix.
//
// Symptom: java.lang.OutOfMemoryError in
//   com.google.android.gms.maps.model.Marker.setIcon
//   ← com.rnmaps.maps.MapMarker.updateMarkerIcon
//   ← com.rnmaps.maps.ViewChangesTracker.update
//
// Cause: react-native-maps' `ViewChangesTracker` polls every custom
// <Marker> view on Android (default `tracksViewChanges={true}`),
// re-rasterizing its React children into a Bitmap on each tick.
// With N saved-place markers this allocates N bitmaps per poll,
// quickly exhausting the GC heap.
//
// Fix: render the custom child views ONCE, then flip
// `tracksViewChanges` to `false` after a single frame. The marker
// bitmap is then frozen on the GPU and no further allocations occur.
// We never mutate the marker children after mount (opacity is a
// native-side prop, not part of the rasterized bitmap), so this is
// safe. iOS is unaffected by the OOM but the same pattern is harmless
// there and avoids unnecessary work.
//
// Memoized on the few inputs that can actually change so a selection /
// theme update doesn't churn all N markers.
type PlaceMarkerProps = {
  place: SavedPlaceWithPlace;
  markerRefs: React.MutableRefObject<Record<string, ComponentRef<typeof Marker> | null>>;
  onPress: (place: SavedPlaceWithPlace) => void;
};

const PlaceMarker = memo(function PlaceMarker({
  place: p,
  markerRefs,
  onPress,
}: PlaceMarkerProps) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    // Stop tracking on the next frame — gives the native side one
    // chance to rasterize the custom child View, then locks the
    // bitmap. See block comment above for the OOM context.
    const id = setTimeout(() => setTracksViewChanges(false), 0);
    return () => clearTimeout(id);
  }, []);
  const handlePress = useCallback(
    (e: { stopPropagation?: () => void }) => {
      e.stopPropagation?.();
      onPress(p);
    },
    [onPress, p],
  );
  return (
    <Marker
      identifier={p.id}
      opacity={p.archived_at || p.visited_at ? 0.45 : 1}
      ref={(ref) => {
        markerRefs.current[p.id] = ref;
      }}
      coordinate={{
        latitude: p.place.latitude,
        longitude: p.place.longitude,
      }}
      // Custom marker views default to bottom-center anchoring, which
      // would offset our pin upward from the geographic coordinate and
      // visually push it off-center inside the radius circle. Anchor
      // (and iOS centerOffset) at the marker's middle so the pin sits
      // exactly on the coordinate that the Circle is centered on.
      anchor={{ x: 0.5, y: 0.5 }}
      centerOffset={{ x: 0, y: 0 }}
      tracksViewChanges={tracksViewChanges}
      onPress={handlePress}
    >
      {/* "Home base" pin: a soft halo around a solid dot reinforces
          that this is the center of the zone, not just a pin drop.
          Static (no animation) to keep V1 light. */}
      <View style={MARKER_STYLES.wrap}>
        <View style={MARKER_STYLES.halo} />
        <View style={MARKER_STYLES.core} />
        <View style={MARKER_STYLES.dot} />
      </View>
    </Marker>
  );
}, (prev, next) =>
  prev.place.id === next.place.id &&
  prev.place.archived_at === next.place.archived_at &&
  prev.place.visited_at === next.place.visited_at &&
  prev.place.place.latitude === next.place.place.latitude &&
  prev.place.place.longitude === next.place.place.longitude &&
  prev.onPress === next.onPress,
);

// Static — does NOT change with theme. Using fixed colors here keeps
// the marker bitmap identity stable across light/dark switches so the
// memoized PlaceMarker doesn't have to re-rasterize on theme change
// (which would re-arm the OOM path).
const MARKER_STYLES = StyleSheet.create({
  wrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 106, 26, 0.18)',
  },
  core: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 106, 26, 0.35)',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FF6A1A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});

export default function MapScreen() {
  const router = useRouter();
  const { colors, typography, resolvedTheme } = useTheme();
  // Map header is hidden (map-first) so the screen owns the top safe area.
  // Floor the inset so devices that report ~0 (older Android without a
  // translucent status bar / notch) still keep the search bar clear of the
  // status bar instead of hugging the very top edge.
  const insets = useSafeAreaInsets();
  const safeTopInset = Math.max(insets.top, Spacing.xl);
  const styles = useMemo(
    () => createStyles(colors, typography, safeTopInset),
    [colors, typography, safeTopInset],
  );
  // Optional deep-link param: when present, the map should center on this
  // saved place and open its preview card. Set by "Show on map" actions on
  // the place detail screen and saved-place cards. We track the last id we
  // already handled in `handledTargetIdRef` so we don't re-animate every
  // render or fight the user's panning.
  const {
    savedPlaceId: rawSavedPlaceId,
    reminderOpen: rawReminderOpen,
    reminderSource: rawReminderSource,
    nearbyCount: rawNearbyCount,
  } = useLocalSearchParams<{
    savedPlaceId?: string | string[];
    reminderOpen?: string | string[];
    reminderSource?: string | string[];
    nearbyCount?: string | string[];
  }>();
  const savedPlaceId = firstParam(rawSavedPlaceId);
  const reminderOpen = parseBoolParam(rawReminderOpen);
  const reminderSourceRaw = firstParam(rawReminderSource);
  const reminderSource: ReminderSource =
    reminderSourceRaw === 'nearby'
      ? 'nearby'
      : reminderSourceRaw === 'notification'
        ? 'notification'
        : 'unknown';
  const nearbyCount = parsePositiveIntParam(rawNearbyCount);
  const { data: liveData, loading: liveLoading, refresh, revalidate } = useSavedPlaces();
  const mapRef = useRef<MapView | null>(null);
  const markerRefs = useRef<Record<string, ComponentRef<typeof Marker> | null>>({});
  const demo = isDemoMode();
  // Map Preview keeps the real MapView but skips Supabase / Google / location.
  // Demo Mode wins if both flags are set (it doesn't render MapView at all).
  const mapPreview = !demo && isMapPreviewMode();

  // In Map Preview Mode, render against the synchronous seeded dataset so the
  // first frame already has markers — no async race, no loading state.
  const previewData = useMemo<SavedPlaceWithPlace[]>(
    () => (mapPreview ? getDemoSeededSavedPlacesSync() : []),
    [mapPreview],
  );
  const data = mapPreview ? previewData : liveData;
  // In Map Preview Mode the saved-places list is the synchronous seed; alias
  // for clarity in the debug logs and marker map below.
  const places = data;

  // Skip any saved place whose coordinates are missing or non-finite. Maps
  // crashes hard on NaN, so we filter once at the top of render.
  const validPlaces = useMemo<SavedPlaceWithPlace[]>(
    () =>
      places.filter(
        (s) =>
          !!s.place &&
          Number.isFinite(s.place.latitude) &&
          Number.isFinite(s.place.longitude),
      ),
    [places],
  );

  // ---- DEBUG (Map Preview only) ----------------------------------------
  // Verify the seeded data shape and exact coordinates handed to <Marker>.
  // Logged once per data identity to avoid flooding the JS thread on
  // every render (which can starve native event dispatch).
  const previewLoggedRef = useRef<unknown>(null);
  if (mapPreview && __DEV__ && previewLoggedRef.current !== places) {
    previewLoggedRef.current = places;
    places.forEach((p) => {
      // eslint-disable-next-line no-console
      console.log('[map] preview coord', p?.place?.latitude, p?.place?.longitude);
    });
  }

  const [permission, setPermission] = useState<PermissionState>('pending');
  const [userRegion, setUserRegion] = useState<Region | null>(null);
  const [currentLocationLoading, setCurrentLocationLoading] = useState(false);
  const [selected, setSelected] = useState<SavedPlaceWithPlace | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Map-first chrome: which filter chip is active. Phase 1 keeps this as UI
  // state only — the Phase 2 bottom sheet will consume it to pick a list.
  const [selectedMapFilter, setSelectedMapFilter] = useState<MapFilter>('nearby');
  // Bumped on chip tap so a minimized sheet re-opens to its partial snap.
  const [sheetOpenSignal, setSheetOpenSignal] = useState(0);
  const handleSelectMapFilter = useCallback((next: MapFilter) => {
    setSelectedMapFilter(next);
    setSheetOpenSignal((n) => n + 1);
  }, []);
  // In-app search overlay (replaces the old native Alert on the search bar).
  const [searchVisible, setSearchVisible] = useState(false);
  // Post-save "Saved to your map" snackbar with optional Undo.
  const [snackbar, setSnackbar] = useState<{
    message: string;
    undoId: string | null;
  } | null>(null);
  const [savingPlace, setSavingPlace] = useState(false);
  // Bumped to ask the sheet to minimize (map-level "View All").
  const [sheetMinimizeSignal, setSheetMinimizeSignal] = useState(0);
  const [reminderContextSavedPlaceId, setReminderContextSavedPlaceId] = useState<string | null>(null);
  const [reminderActionBusy, setReminderActionBusy] = useState(false);
  // Current sheet snap + animated lift so the floating actions follow the
  // sheet's top edge instead of floating at a fixed height.
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('partial');
  // Initialized to 0; the sheet reports its real partial height on mount via
  // onSnapChange, which animates this to the correct lift immediately.
  const actionsLift = useRef(new Animated.Value(0)).current;
  const handleSheetSnapChange = useCallback(
    (snap: SheetSnap, visibleHeight: number) => {
      setSheetSnap(snap);
      Animated.timing(actionsLift, {
        toValue: visibleHeight,
        duration: 200,
        useNativeDriver: true,
      }).start();
    },
    [actionsLift],
  );

  // Bottom-sheet data. `useNearbyPlaces` is check-only here (never prompts) so
  // it doesn't fight the map's own permission flow. Recent/saved come from the
  // already-coordinate-valid list so every sheet row is focusable on the map.
  // We measure the real map-area height (excludes header + tab bar) via
  // onLayout so the sheet's expanded height never clips behind the top chrome;
  // windowHeight is only a first-paint fallback.
  const { height: windowHeight } = useWindowDimensions();
  const [mapAreaHeight, setMapAreaHeight] = useState(0);
  const availableHeight = mapAreaHeight || windowHeight;
  const sheetPartialHeight = useMemo(
    () => getSheetPartialHeight(availableHeight),
    [availableHeight],
  );
  const { nearbyPlaces } = useNearbyPlaces(data, { limit: 5 });
  const recentPlaces = useRecentPlaces(validPlaces, 5);
  const previewTranslateY = useRef(new Animated.Value(0)).current;
  // Selected-place sheet: collapsed (preview) vs expanded (inline details).
  // Reset to collapsed whenever a new place is selected or the sheet is
  // dismissed. The pan responder reads the current value via a ref so it
  // never has to be recreated when the sheet toggles.
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const previewExpandedRef = useRef(false);
  previewExpandedRef.current = previewExpanded;
  const hideTopSelectionControls = !!selected && previewExpanded;
  const didFitRef = useRef(false);
  // Set to true when the user pans or zooms the map so auto-centering
  // effects don't override the user's chosen viewport.
  const hasUserMovedRef = useRef(false);
  // Tracks which `savedPlaceId` deep-link we've already focused on. Reset
  // implicitly when the param changes to a new id so coming back to the
  // same place from a different card still triggers the focus animation.
  const handledTargetIdRef = useRef<string | null>(null);
  const handledReminderAnalyticsRef = useRef<string | null>(null);
  const shownMissingReminderRef = useRef<string | null>(null);
  const previousRegionRef = useRef<Region | null>(null);
  const lastRegionRef = useRef<Region | null>(null);

  // ---- permission + initial location ------------------------------------
  // IMPORTANT: this effect must NEVER block map rendering. The map should be
  // visible the moment we have at least one valid saved place, regardless of
  // whether the OS has given us a current location yet. Android emulators in
  // particular often can't produce a fix at all, and previously left the
  // permission state stuck on 'pending' (full-screen spinner forever).
  useEffect(() => {
    if (demo) {
      setPermission('denied');
      return;
    }
    if (mapPreview) {
      // Skip the OS prompt entirely; we render against MAP_PREVIEW_REGION.
      setPermission('denied');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          console.log('[map] location permission denied');
          setPermission('denied');
          return;
        }
        setPermission('granted');

        // Bail early if the OS-level location switch is off — the call below
        // would just hang on most Android devices/emulators.
        try {
          const enabled = await Location.hasServicesEnabledAsync();
          if (!enabled) {
            if (!cancelled) setPermission('unavailable');
            return;
          }
        } catch {
          if (!cancelled) setPermission('unavailable');
          return;
        }

        setCurrentLocationLoading(true);
        // Race the location call against a hard timeout so an unresponsive
        // location provider can never wedge the screen.
        const loc = await Promise.race<
          Location.LocationObject | { __timeout: true }
        >([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<{ __timeout: true }>((resolve) =>
            setTimeout(() => resolve({ __timeout: true }), LOCATION_TIMEOUT_MS),
          ),
        ]);
        if (cancelled) return;
        setCurrentLocationLoading(false);
        if ('__timeout' in loc) {
          console.log('[map] getCurrentPositionAsync timed out');
          setPermission('unavailable');
          return;
        }
        setUserRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        });
      } catch (e) {
        if (cancelled) return;
        // expo-location throws "Current location is unavailable..." on
        // emulators / when the OS has no fix. That's expected — degrade to
        // 'unavailable' so the map keeps rendering without a user dot.
        const msg = e instanceof Error ? e.message : String(e);
        if (/location is unavailable|location services|E_LOCATION_/i.test(msg)) {
          if (__DEV__) console.debug('[map] location unavailable:', msg);
          setPermission('unavailable');
        } else {
          console.warn('[map] location failed', e);
          setPermission('unavailable');
        }
        setCurrentLocationLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, mapPreview]);

  // ---- re-fetch on focus -------------------------------------------------
  // Stale-while-revalidate: hydrates instantly from the shared cache and only
  // hits the network if the data is stale — so the map never visibly resets
  // when returning to this tab.
  useFocusEffect(
    useCallback(() => {
      void revalidate();
      void trackEvent('map_opened', {});
    }, [revalidate]),
  );

  // ---- load profile (for default radius fallback) -----------------------
  // Best-effort. If this fails or returns null we just fall back to 1 mile
  // per place — never blocks the map.
  useEffect(() => {
    if (mapPreview) return;
    let cancelled = false;
    getProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e) => {
        if (__DEV__) console.debug('[map] getProfile failed', e);
      });
    return () => {
      cancelled = true;
    };
  }, [mapPreview]);

  // ---- pick an initial region -------------------------------------------
  // Map Preview Mode uses the hoisted PREVIEW_INITIAL_REGION so the map
  // always has a valid camera target on first paint, regardless of seed
  // loading. (See module-scope constant above.)
  // Computed exactly once for `initialRegion`. We deliberately do NOT
  // recompute this on every data/userRegion change — `react-native-maps`
  // ignores changes to `initialRegion` after mount, and we re-target the
  // camera imperatively below instead.
  const initialRegion = useMemo<Region>(() => {
    if (mapPreview) return PREVIEW_INITIAL_REGION;
    if (userRegion) return userRegion;
    if (validPlaces.length > 0) {
      const first = validPlaces[0].place;
      return {
        latitude: first.latitude,
        longitude: first.longitude,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };
    }
    return FALLBACK_REGION;
    // Intentionally only depends on mapPreview — initialRegion is captured
    // once at first mount and the camera is moved imperatively after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapPreview]);

  // ---- center on user location once on initial map load ----------------
  // Runs when we have both a ready map and a GPS fix. Skipped if:
  //   - the user has already panned (hasUserMovedRef)
  //   - a deep-link target already set the camera (didFitRef)
  //   - Map Preview Mode (static initialRegion handles it)
  // Does NOT auto-fit saved places — use the "View All" button for that.
  useEffect(() => {
    if (mapPreview) return;
    if (!mapReady) return;
    if (!userRegion) return;
    if (didFitRef.current) return;
    if (hasUserMovedRef.current) return;
    didFitRef.current = true;
    try {
      mapRef.current?.animateToRegion(userRegion, 400);
    } catch (e) {
      if (__DEV__) console.debug('[map] animateToRegion skipped', e);
    }
  }, [userRegion, mapReady, mapPreview]);

  // ---- deep-link target: focus a specific saved place -------------------
  // Triggered by the "Show on map" action elsewhere in the app. Runs once
  // per `savedPlaceId` change, after the map is ready and the saved-places
  // list has loaded. We:
  //   1. find the matching saved place
  //   2. mark it as `selected` (opens the preview card)
  //   3. frame its full radius zone via fitToCoordinates (not just a pin)
  //   4. mark `didFitRef` so the multi-zone auto-fit doesn't run after us
  // If the id doesn't match anything, we silently fall back to the normal
  // map behavior.
  useEffect(() => {
    if (!reminderOpen || !savedPlaceId) return;
    const signature = `${savedPlaceId}:${reminderSource}:${nearbyCount ?? 1}`;
    if (handledReminderAnalyticsRef.current === signature) return;
    handledReminderAnalyticsRef.current = signature;
    void trackEvent('nearby_reminder_opened_map', {
      saved_place_id: savedPlaceId,
      source: 'notification',
      nearby_count: nearbyCount ?? 1,
    });
  }, [nearbyCount, reminderOpen, reminderSource, savedPlaceId]);

  useEffect(() => {
    if (!mapReady) return;
    if (!savedPlaceId) return;
    if (handledTargetIdRef.current === savedPlaceId) return;
    if (validPlaces.length === 0) return; // wait for data to arrive
    const target = validPlaces.find((p) => p.id === savedPlaceId);
    if (!target) {
      // Not in the current list. If saved places are still loading, WAIT — a
      // freshly-saved place (or a cold-cache deep link) may not have hydrated
      // yet. Only give up (mark handled) once loading has settled, so we never
      // refocus-loop on a genuinely-absent id (e.g. deleted on another device).
      if (liveLoading) return;
      handledTargetIdRef.current = savedPlaceId;
      if (reminderOpen && shownMissingReminderRef.current !== savedPlaceId) {
        shownMissingReminderRef.current = savedPlaceId;
        setReminderContextSavedPlaceId(null);
        setSnackbar({
          message: 'Could not find that saved place. Showing your map.',
          undoId: null,
        });
      }
      if (__DEV__) console.log('[map] target id not found', savedPlaceId);
      return;
    }
    handledTargetIdRef.current = savedPlaceId;
    if (reminderOpen) {
      setReminderContextSavedPlaceId(target.id);
    }
    didFitRef.current = true;
    try {
      selectPlace(target);
    } catch (err) {
      console.warn('[map] focus failed', (err as Error)?.message ?? err);
    }
  }, [savedPlaceId, mapReady, validPlaces, profile, liveLoading, reminderOpen]);

  // ---- DEBUG ------------------------------------------------------------
  // Temporary verbose logs requested while diagnosing the "spinner forever"
  // bug. Throttled to fire only when one of the watched fields actually
  // changes — logging on every render starves the JS thread under idle
  // AppState / Supabase chatter and contributed to a native
  // EventDispatcher OOM observed on Android.
  const debugStateRef = useRef<string>('');
  if (__DEV__) {
    const sig = `${liveLoading}|${data.length}|${validPlaces.length}|${permission}|${currentLocationLoading}|${mapReady}|${mapPreview}`;
    if (debugStateRef.current !== sig) {
      debugStateRef.current = sig;
      // eslint-disable-next-line no-console
      console.log('[map] state', {
        platform: Platform.OS,
        providerIntended: MAP_PROVIDER ?? 'default',
        googleProviderIntended: MAP_PROVIDER === PROVIDER_GOOGLE,
        customMapStyleLength: DARK_MAP_STYLE.length,
        customMapStyleEnabled: Platform.OS === 'android',
        savedPlacesLoading: liveLoading,
        savedPlacesLength: data.length,
        validPlacesLength: validPlaces.length,
        locationPermissionState: permission,
        currentLocationLoading,
        mapReady,
        markersRendered: validPlaces.length,
        mapPreview,
      });
    }
  }

  // -----------------------------------------------------------------------
  function openExternalMaps(
    item: SavedPlaceWithPlace,
    surface: 'map_preview_card' | 'nearby_reminder' = 'map_preview_card',
  ) {
    void trackEvent('open_in_maps_tapped', {
      saved_place_id: item.id,
      google_place_id: item.place.google_place_id ?? null,
      surface,
    });
    void openInExternalMaps(item.place);
  }

  const selectedDistance = useMemo(() => {
    if (!selected || !userRegion) return null;
    return distanceMeters(
      { latitude: userRegion.latitude, longitude: userRegion.longitude },
      { latitude: selected.place.latitude, longitude: selected.place.longitude },
    );
  }, [selected, userRegion]);

  const dismissSelectedPlace = useCallback(
    (options?: { restoreRegion?: boolean }) => {
      if (!selected) return;

      markerRefs.current[selected.id]?.hideCallout?.();
      previewTranslateY.stopAnimation();
      previewTranslateY.setValue(0);
      setSelected(null);
      setPreviewExpanded(false);
      if (__DEV__) console.log('[map-sheet] dismissed');

      if (options?.restoreRegion === false) {
        previousRegionRef.current = null;
        return;
      }

      const previousRegion = previousRegionRef.current;
      previousRegionRef.current = null;
      if (!previousRegion) return;

      try {
        mapRef.current?.animateToRegion(previousRegion, 250);
      } catch (e) {
        if (__DEV__) console.debug('[map] dismiss restore skipped', e);
      }
    },
    [previewTranslateY, selected],
  );

  /**
   * Frame the map around a single saved place's zone (marker + radius
   * bubble). Called when the user taps a marker so the selection feels
   * like "zoom into this zone" instead of "jump to a pin".
   */
  function focusZone(item: SavedPlaceWithPlace) {
    if (!mapRef.current) return;
    const coords = radiusBoundingCoords(
      item.place.latitude,
      item.place.longitude,
      effectiveRadiusMeters(item, profile),
    );
    try {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 100, right: 100, bottom: 220, left: 100 },
        animated: true,
      });
    } catch (e) {
      if (__DEV__) console.debug('[map] focusZone skipped', e);
    }
  }

  function selectPlace(item: SavedPlaceWithPlace) {
    previousRegionRef.current = lastRegionRef.current;
    setSelected(item);
    // Always (re)open a newly selected marker in the collapsed preview state.
    setPreviewExpanded(false);
    previewTranslateY.setValue(0);
    try {
      focusZone(item);
    } catch (err) {
      console.warn('[map] focus failed', (err as Error)?.message ?? err);
    }
  }

  // Stable identity so PlaceMarker memoization survives parent re-renders
  // (selection, theme, etc.). Without this, every render would pass a
  // fresh inline closure and re-arm the Android view-tracking path that
  // produced the OutOfMemoryError on the GMS Marker.setIcon side.
  const handleMarkerPress = useCallback((p: SavedPlaceWithPlace) => {
    void trackEvent('place_marker_tapped', {
      saved_place_id: p.id,
      google_place_id: p.place.google_place_id ?? null,
    });
    selectPlace(p);
    // selectPlace and trackEvent are stable enough in practice (defined
    // in the component body); we intentionally exclude them from deps
    // to keep the callback identity stable for the whole session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNearbyReminderGetDirections = useCallback(() => {
    if (!selected) return;
    void trackEvent('nearby_reminder_get_directions_tapped', {
      saved_place_id: selected.id,
      source: 'notification',
    });
    openExternalMaps(selected, 'nearby_reminder');
  }, [selected]);

  const handleNearbyReminderVisited = useCallback(async () => {
    if (!selected || reminderActionBusy) return;
    setReminderActionBusy(true);
    const snapshot = getSavedPlacesCacheSnapshot();
    try {
      await markVisited(selected.id);
      removeSavedPlaceFromCache(selected.id);
      setReminderContextSavedPlaceId(null);
      dismissSelectedPlace({ restoreRegion: false });
      setSnackbar({ message: 'Marked as visited', undoId: null });
      void trackEvent('nearby_reminder_mark_visited_tapped', {
        saved_place_id: selected.id,
        source: 'notification',
      });
      void trackEvent('place_marked_visited', { saved_place_id: selected.id });
    } catch (e: any) {
      restoreSavedPlacesCache(snapshot);
      Alert.alert('Could not mark visited', e?.message ?? 'Unknown error.');
    } finally {
      setReminderActionBusy(false);
    }
  }, [dismissSelectedPlace, reminderActionBusy, selected]);

  const handleNearbyReminderDismiss = useCallback(async () => {
    if (!selected || reminderActionBusy) return;
    setReminderActionBusy(true);
    const shouldArchive = (selected.reminder_opportunity_count ?? 0) >= MAX_REMINDER_OPPORTUNITIES;
    const snapshot = getSavedPlacesCacheSnapshot();
    try {
      if (shouldArchive) {
        await markArchived(selected.id, { exhausted: true });
        removeSavedPlaceFromCache(selected.id);
        setSnackbar({ message: 'Reminder archived for this place', undoId: null });
      }
      setReminderContextSavedPlaceId(null);
      dismissSelectedPlace();
      void trackEvent('nearby_reminder_dismissed', {
        saved_place_id: selected.id,
        source: 'notification',
      });
      if (shouldArchive) {
        void trackEvent('opportunity_archived_after_3', {
          saved_place_id: selected.id,
        });
      }
    } catch (e: any) {
      restoreSavedPlacesCache(snapshot);
      Alert.alert('Could not update reminder', e?.message ?? 'Unknown error.');
    } finally {
      setReminderActionBusy(false);
    }
  }, [dismissSelectedPlace, reminderActionBusy, selected]);

  const isNearbyReminderSelection =
    !!selected && reminderContextSavedPlaceId === selected.id;

  useEffect(() => {
    if (!selected || !reminderContextSavedPlaceId) return;
    if (selected.id !== reminderContextSavedPlaceId) {
      setReminderContextSavedPlaceId(null);
    }
  }, [reminderContextSavedPlaceId, selected]);

  const previewPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          !!selected &&
          Math.abs(gestureState.dy) > 6 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          if (previewExpandedRef.current) {
            // Expanded: only downward drag matters (collapse); clamp upward.
            previewTranslateY.setValue(Math.max(0, gestureState.dy));
          } else {
            // Collapsed: downward drag tracks toward dismissal; give a small
            // upward peek to signal the sheet can expand.
            previewTranslateY.setValue(
              gestureState.dy > 0 ? gestureState.dy : Math.max(-48, gestureState.dy),
            );
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          const vertical =
            Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
          const springBack = () =>
            Animated.spring(previewTranslateY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 6,
            }).start();

          if (previewExpandedRef.current) {
            // From expanded, a small downward drag collapses back to preview;
            // it never dismisses in a single gesture.
            if (vertical && gestureState.dy > 60) {
              setPreviewExpanded(false);
              if (__DEV__) console.log('[map-sheet] collapsed');
            }
            springBack();
            return;
          }

          // Collapsed: upward drag expands, larger downward drag dismisses.
          if (vertical && gestureState.dy < -40) {
            setPreviewExpanded(true);
            if (__DEV__) console.log('[map-sheet] expanded');
            springBack();
            return;
          }
          if (vertical && gestureState.dy > 80) {
            dismissSelectedPlace();
            return;
          }
          springBack();
        },
        onPanResponderTerminate: () => {
          Animated.spring(previewTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
      }),
    [dismissSelectedPlace, previewTranslateY, selected],
  );

  // Stable handlers passed to MapView. onPanDrag fires on every gesture
  // sample (potentially dozens per second) so we early-out once the flag
  // is set instead of recreating closures or re-writing the ref.
  const handlePanDrag = useCallback(() => {
    if (!hasUserMovedRef.current) hasUserMovedRef.current = true;
  }, []);
  const handleRegionChangeComplete = useCallback((region: Region) => {
    lastRegionRef.current = region;
  }, []);
  const handleMapReady = useCallback(() => setMapReady(true), []);
  const handleMapPress = useCallback(() => {
    dismissSelectedPlace();
  }, [dismissSelectedPlace]);

  // Paste-link button: read the clipboard and, if it holds a URL, hand it to
  // the existing /share flow (which accepts an initial `url` param). Otherwise
  // nudge the user to copy a link first. No new save system is introduced.
  const handlePasteLink = useCallback(async () => {
    let text = '';
    try {
      text = (await Clipboard.getStringAsync())?.trim() ?? '';
    } catch (e) {
      if (__DEV__) console.debug('[map] clipboard read failed', e);
    }
    if (text && isLikelyUrl(text)) {
      router.push({ pathname: '/share', params: { url: text } });
      return;
    }
    Alert.alert(
      'No link copied',
      'Copy a TikTok, Instagram, or place link first, then tap to save it.',
    );
  }, [router]);

  // Direct-save a real-world place chosen from the map search dropdown. Saves
  // immediately using the profile DEFAULT radius (radiusValue/Unit = null), so
  // the user never sees the add-place radius picker. On success we revalidate
  // the cache, focus the new place, and show an Undo snackbar.
  const handleSavePlaceCandidate = useCallback(
    async (place: PlaceCandidate) => {
      if (savingPlace) return;
      setSearchVisible(false);
      setSavingPlace(true);
      try {
        const result = await saveSavedPlace({
          candidate: place,
          radiusValue: null,
          radiusUnit: null,
          sourceType: 'manual',
        });
        // Force a refetch so the newly saved place is in the shared cache and
        // its marker renders immediately (a stale-while-revalidate would skip
        // the network within the freshness window and the marker wouldn't
        // appear until later).
        await refresh();
        if (result.status === 'duplicate') {
          const existing =
            result.savedPlaceId != null
              ? validPlaces.find((p) => p.id === result.savedPlaceId)
              : undefined;
          if (existing) selectPlace(existing);
          setSnackbar({ message: 'Already on your map', undoId: null });
          return;
        }
        selectPlace(result.saved);
        setSnackbar({ message: 'Saved to your map', undoId: result.savedPlaceId });
        void trackEvent('save_success', {
          source_type: 'manual',
          flow: 'map_search',
          google_place_id: place.googlePlaceId ?? null,
          saved_place_id: result.savedPlaceId,
          duplicate: false,
        });
      } catch (e: any) {
        console.warn('[map] direct save failed', e?.message);
        Alert.alert('Could not save', e?.message ?? 'Please try again.');
      } finally {
        setSavingPlace(false);
      }
    },
    [refresh, savingPlace, validPlaces],
  );

  // Undo a just-saved place: optimistically remove it from the shared cache
  // (marker disappears on every screen at once), clear the selection if it is
  // the undone place, then delete server-side. Roll back on failure.
  const handleUndoSave = useCallback(
    async (savedPlaceId: string) => {
      setSnackbar(null);
      const snapshot = getSavedPlacesCacheSnapshot();
      try {
        if (selected?.id === savedPlaceId) {
          dismissSelectedPlace({ restoreRegion: false });
        }
        removeSavedPlaceFromCache(savedPlaceId);
        await deleteSavedPlace(savedPlaceId);
      } catch (e: any) {
        console.warn('[map] undo save failed', e?.message);
        restoreSavedPlacesCache(snapshot);
        Alert.alert('Could not undo', e?.message ?? 'Please try again.');
      }
    },
    [dismissSelectedPlace, selected],
  );

  // Custom recenter button. Prefers an existing GPS fix; otherwise does a
  // best-effort fetch that mirrors the initial-location effect (permission
  // check + timeout race) so it can never wedge the UI.
  const recenterOnUser = useCallback(async () => {
    if (userRegion) {
      try {
        mapRef.current?.animateToRegion(userRegion, 400);
      } catch (e) {
        if (__DEV__) console.debug('[map] recenter skipped', e);
      }
      return;
    }
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      let status = perm.status;
      if (status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status;
      }
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      const loc = await Promise.race<
        Location.LocationObject | { __timeout: true }
      >([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<{ __timeout: true }>((resolve) =>
          setTimeout(() => resolve({ __timeout: true }), LOCATION_TIMEOUT_MS),
        ),
      ]);
      if ('__timeout' in loc) {
        setPermission('unavailable');
        return;
      }
      const region: Region = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      };
      setUserRegion(region);
      setPermission('granted');
      try {
        mapRef.current?.animateToRegion(region, 400);
      } catch (e) {
        if (__DEV__) console.debug('[map] recenter animate skipped', e);
      }
    } catch (e) {
      if (__DEV__) console.debug('[map] recenter failed', e);
    }
  }, [userRegion]);

  // -----------------------------------------------------------------------
  if (demo) {
    return (
      <View style={styles.container}>
        <View style={{ padding: Spacing.lg, paddingTop: safeTopInset + Spacing.lg, paddingBottom: 0 }}>
          <DemoModeBanner />
        </View>
        <MapFallbackList
          data={data}
          onPressItem={(s) => router.push(`/place/${s.id}`)}
        />
        <Pressable
          style={styles.fab}
          onPress={() => router.push('/add-place')}
          accessibilityLabel="Save a place"
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      </View>
    );
  }

  // -----------------------------------------------------------------------
  return (
    <View
      style={styles.container}
      onLayout={(e) => setMapAreaHeight(e.nativeEvent.layout.height)}
    >
      {/* MapView ALWAYS mounts. Empty / loading / no-GPS states render as
          non-blocking overlays on top of the map — never as replacements
          for it. This is what makes the screen feel alive instead of a
          spinner-trapped shell. */}
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        customMapStyle={Platform.OS === 'android' && resolvedTheme === 'dark' ? DARK_MAP_STYLE : undefined}
        // Only show the user dot when we actually have a fix. Toggling
        // `showsUserLocation` on without a usable provider can leave the
        // Google Maps Android view in a "loading" state.
        showsUserLocation={!mapPreview && permission === 'granted' && !!userRegion}
        showsMyLocationButton={!mapPreview && permission === 'granted' && !!userRegion}
        initialRegion={initialRegion}
        onMapReady={handleMapReady}
        onPress={handleMapPress}
        onPanDrag={handlePanDrag}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {/* Life360-style zone bubbles. Rendered as a separate pass before
            markers so marker pins always sit on top of their own circle.
            Stroke is intentionally darker than the fill so the boundary
            reads clearly on satellite, dark, and light map tiles alike.
            Archived places are rendered without a radius circle to keep
            the active set visually quiet. */}
        {validPlaces.map((p) => (
          p.archived_at ? null : (
            <Circle
              key={`circle-${p.id}`}
              center={{
                latitude: p.place.latitude,
                longitude: p.place.longitude,
              }}
              radius={effectiveRadiusMeters(p, profile)}
              strokeColor={
                selected?.id === p.id
                  ? 'rgba(255,106,26,0.52)'
                  : 'rgba(255,106,26,0.14)'
              }
              strokeWidth={selected?.id === p.id ? 2 : 1}
              fillColor={
                selected?.id === p.id
                  ? 'rgba(255,106,26,0.12)'
                  : 'rgba(255,106,26,0.035)'
              }
            />
          )
        ))}
        {validPlaces.map((p) => (
          <PlaceMarker
            key={p.id}
            place={p}
            markerRefs={markerRefs}
            onPress={handleMarkerPress}
          />
        ))}
      </MapView>

      {/* Non-blocking empty/loading pill. The map keeps rendering underneath. */}
      {validPlaces.length === 0 ? (
        <View style={styles.emptyPill} pointerEvents="none">
          <Text style={styles.emptyPillText}>
            {liveLoading ? 'Loading places…' : 'No saved places yet'}
          </Text>
        </View>
      ) : null}

      {/* Small non-blocking pill when current location can't be obtained.
          Never blocks the map. */}
      {!mapPreview && permission === 'unavailable' ? (
        <View style={styles.locPill} pointerEvents="none">
          <Text style={styles.locPillText}>Location unavailable</Text>
        </View>
      ) : null}

      {/* No full-screen pending overlay anymore: the previous spinner could
          stick if the OS location call hung, leaving the map unusable. The
          small "Location unavailable" pill above is the only location-state
          UI now, and it never blocks the map. */}

      {/* Map Preview Mode banner (dev-only) */}
      {mapPreview ? (
        <View style={styles.previewBadge} pointerEvents="none">
          <View style={styles.previewBadgeDot} />
          <Text style={styles.previewBadgeText}>Map Preview Mode</Text>
        </View>
      ) : null}

      {/* Small non-blocking pill when the user explicitly denied location.
          Tappable: opens system settings so they can re-enable. Map keeps
          rendering underneath. */}
      {permission === 'denied' && !mapPreview ? (
        <Pressable
          style={styles.locPill}
          onPress={() => Linking.openSettings().catch(() => {})}
          accessibilityLabel="Open location settings"
        >
          <Text style={styles.locPillText}>Location off — tap to enable</Text>
        </Pressable>
      ) : null}

      {/* Preview card */}
      {selected ? (
        <Animated.View
          style={[styles.previewWrap, { transform: [{ translateY: previewTranslateY }] }]}
          pointerEvents="box-none"
        >
          <Card style={styles.previewCard}>
            {/* Drag region: handle + header. The pan responder lives here
                (not on the whole card) so the expanded body ScrollView can
                scroll without fighting the collapse/dismiss gesture. */}
            <View {...previewPanResponder.panHandlers}>
              <View style={styles.previewHandleWrap}>
                <View style={styles.previewHandle} />
              </View>
              <View style={styles.previewTopRow}>
                <View style={styles.previewThumb}>
                  <Feather
                    name={selectedIconName(selected)}
                    size={18}
                    color={colors.accent}
                  />
                </View>
                <View style={styles.previewCopy}>
                  <View style={styles.previewHeader}>
                    <Text style={typography.heading} numberOfLines={1}>
                      {selected.place.name}
                    </Text>
                    <Pressable
                      onPress={() => dismissSelectedPlace()}
                      hitSlop={12}
                      style={styles.closeBtn}
                    >
                      <Text style={styles.closeText}>×</Text>
                    </Pressable>
                  </View>
                  {selected.place.formatted_address ? (
                    <Text style={[typography.caption, styles.previewAddress]} numberOfLines={1}>
                      {selected.place.formatted_address}
                    </Text>
                  ) : null}
                  <View style={styles.previewMetaRow}>
                    {selectedDistance != null ? (
                      <Text style={[typography.caption, styles.previewMetaText]}>
                        {formatDistanceAway(selectedDistance)}
                      </Text>
                    ) : null}
                    {selectedMeta(selected) ? (
                      <View style={styles.metaPill}>
                        <Text style={styles.metaPillText} numberOfLines={1}>
                          {selectedMeta(selected)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>

            {previewExpanded ? (
              // Expanded: the full editable details (reminder / radius / note /
              // remove) moved off /place/[id]. Bounded + scrollable so a long
              // note never pushes the sheet past the top of the map.
              <ScrollView
                style={{ maxHeight: Math.min(windowHeight * 0.66, 580) }}
                contentContainerStyle={styles.previewScrollContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                <SelectedPlaceDetails
                  saved={selected}
                  profile={profile}
                  onGetDirections={() => openExternalMaps(selected)}
                  onRequestDismiss={() => dismissSelectedPlace({ restoreRegion: false })}
                  onSaved={(updated) => setSelected(updated)}
                />
              </ScrollView>
            ) : (
              // Collapsed: quick directions + an explicit expander (in addition
              // to the slide-up gesture) so there's always a tap affordance.
              <>
                {isNearbyReminderSelection ? (
                  <View style={styles.reminderContextWrap}>
                    <View style={styles.reminderBadge}>
                      <Text style={styles.reminderBadgeText}>Nearby reminder</Text>
                    </View>
                    <Text style={[typography.caption, styles.reminderCopy]}>
                      You saved this place and you&apos;re nearby.
                    </Text>
                    {nearbyCount && nearbyCount > 1 ? (
                      <Text style={[typography.caption, styles.reminderNearbyCount]}>
                        {nearbyCount} saved places nearby
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.previewActions}>
                  <Button
                    title="Get directions"
                    onPress={() => {
                      if (isNearbyReminderSelection) {
                        handleNearbyReminderGetDirections();
                        return;
                      }
                      openExternalMaps(selected);
                    }}
                    loading={reminderActionBusy}
                    style={styles.previewPrimaryAction}
                  />
                </View>
                {isNearbyReminderSelection ? (
                  <View style={styles.reminderSecondaryActions}>
                    <Button
                      title="I went here"
                      variant="secondary"
                      onPress={() => void handleNearbyReminderVisited()}
                      loading={reminderActionBusy}
                    />
                    <Button
                      title="Maybe next time"
                      variant="ghost"
                      onPress={() => void handleNearbyReminderDismiss()}
                      loading={reminderActionBusy}
                    />
                    <Pressable
                      onPress={() => {
                        setPreviewExpanded(true);
                        if (__DEV__) console.log('[map-sheet] expanded for reminder settings');
                      }}
                      hitSlop={10}
                      style={styles.reminderAdjustRow}
                    >
                      <Text style={styles.reminderAdjustText}>Adjust reminder radius</Text>
                    </Pressable>
                  </View>
                ) : null}
                <Pressable
                  onPress={() => {
                    setPreviewExpanded(true);
                    if (__DEV__) console.log('[map-sheet] expanded');
                  }}
                  hitSlop={10}
                  style={styles.previewSecondaryRow}
                >
                  <Text style={styles.previewSecondaryText}>
                    {isNearbyReminderSelection ? 'Swipe up for details and reminder settings' : 'Swipe up for details'}
                  </Text>
                  <Feather name="chevron-up" size={16} color={colors.textSecondary} />
                </Pressable>
              </>
            )}
          </Card>
        </Animated.View>
      ) : null}

      {/* Map-first top chrome: floating search bar + filter chips. Rendered
          as a box-none overlay so only the bar/chips capture touches and the
          rest of the map stays pannable underneath. Hidden while the search
          dropdown is open so there is only ever ONE visible search input. */}
      {searchVisible ? null : (
        <View style={styles.topChrome} pointerEvents="box-none">
          <MapTopSearchBar onPress={() => setSearchVisible(true)} />
          {!hideTopSelectionControls ? (
            <MapFilterChips value={selectedMapFilter} onChange={handleSelectMapFilter} />
          ) : null}
        </View>
      )}

      {/* "View All" pill — fits all saved-place zones on demand. Only shown
          when there are places to frame and we're not in preview mode. */}
      {validPlaces.length > 0 && !mapPreview && !hideTopSelectionControls ? (
        <Pressable
          style={styles.viewAllBtn}
          onPress={() => {
            if (!mapRef.current) return;
            if (validPlaces.length === 0) return;
            // Map-level "View All" = see every saved place on the map, so
            // minimize the sheet out of the way.
            setSheetMinimizeSignal((n) => n + 1);
            const coords = allZoneBoundingCoords(validPlaces, profile);
            if (coords.length === 0) return;
            try {
              // Camera center uses the average of saved-place coordinates
              // (center of mass) so a single distant outlier doesn't drag
              // the camera into empty space between clusters. The zoom
              // (latitude/longitudeDelta) is still derived from the full
              // bounding box of every zone so all places remain visible.
              let sumLat = 0;
              let sumLng = 0;
              for (const p of validPlaces) {
                sumLat += p.place.latitude;
                sumLng += p.place.longitude;
              }
              const centerLat = sumLat / validPlaces.length;
              const centerLng = sumLng / validPlaces.length;

              let minLat = coords[0].latitude;
              let maxLat = coords[0].latitude;
              let minLng = coords[0].longitude;
              let maxLng = coords[0].longitude;
              for (const c of coords) {
                if (c.latitude < minLat) minLat = c.latitude;
                if (c.latitude > maxLat) maxLat = c.latitude;
                if (c.longitude < minLng) minLng = c.longitude;
                if (c.longitude > maxLng) maxLng = c.longitude;
              }

              // Extreme-spread guard: for globally distant points,
              // center-of-mass framing can hide places off-screen or
              // misframe across the antimeridian. Fall back to
              // react-native-maps' built-in fitToCoordinates which is
              // safer for very large spans.
              const latSpan = maxLat - minLat;
              const lngSpan = maxLng - minLng;
              // Date-line heuristic: sort place longitudes and look for a
              // gap > 180° between consecutive values (including wrap).
              // Such a gap means the shorter arc between points crosses
              // the antimeridian (e.g. one place at -179, another at +179).
              const lngsSorted = validPlaces
                .map((p) => p.place.longitude)
                .sort((a, b) => a - b);
              let maxLngGap = 0;
              for (let i = 1; i < lngsSorted.length; i++) {
                const gap = lngsSorted[i] - lngsSorted[i - 1];
                if (gap > maxLngGap) maxLngGap = gap;
              }
              if (lngsSorted.length > 1) {
                const wrapGap =
                  360 - (lngsSorted[lngsSorted.length - 1] - lngsSorted[0]);
                if (wrapGap > maxLngGap) maxLngGap = wrapGap;
              }
              const crossesDateLine = maxLngGap > 180;

              if (latSpan > 45 || lngSpan > 90 || crossesDateLine) {
                mapRef.current.fitToCoordinates(coords, {
                  edgePadding: {
                    top: 100,
                    right: 100,
                    bottom: 180,
                    left: 100,
                  },
                  animated: true,
                });
                return;
              }

              // Cluster-focused zoom: size the viewport from the SPREAD of
              // saved-place coordinates around the centroid (standard
              // deviation) instead of the single farthest point. A lone
              // distant outlier therefore can't force an extreme zoom-out —
              // the main cluster stays usable and the outlier may sit just
              // off-screen (the intended "center of balance" behavior). The
              // extreme-spread guard above still handles globe-scale spans.
              let varLat = 0;
              let varLng = 0;
              for (const p of validPlaces) {
                varLat += (p.place.latitude - centerLat) ** 2;
                varLng += (p.place.longitude - centerLng) ** 2;
              }
              const stdLat = Math.sqrt(varLat / validPlaces.length);
              const stdLng = Math.sqrt(varLng / validPlaces.length);
              // Half-span in std-devs; ~2σ frames the bulk of a cluster.
              const SPREAD_SIGMAS = 2;
              const PAD = 1.3;
              const MIN_DELTA = 0.02; // single-place / tight-cluster floor
              const latitudeDelta = Math.max(
                stdLat * SPREAD_SIGMAS * 2 * PAD,
                MIN_DELTA,
              );
              const longitudeDelta = Math.max(
                stdLng * SPREAD_SIGMAS * 2 * PAD,
                MIN_DELTA,
              );

              mapRef.current.animateToRegion(
                {
                  latitude: centerLat,
                  longitude: centerLng,
                  latitudeDelta,
                  longitudeDelta,
                },
                400,
              );
            } catch (e) {
              if (__DEV__) console.debug('[map] viewAll skipped', e);
            }
          }}
          accessibilityLabel="View all saved places"
        >
          <Text style={styles.viewAllText}>View All</Text>
        </Pressable>
      ) : null}

      {/* Floating right-side actions: recenter + orange paste-link. Hidden
          while a preview card is showing or the sheet is full so they never
          overlap. They follow the sheet's top edge via `actionsLift`. */}
      {selected || sheetSnap === 'full' ? null : (
        <FloatingMapActions
          onRecenter={recenterOnUser}
          onPasteLink={handlePasteLink}
          liftY={actionsLift}
        />
      )}

      {/* Map-first bottom sheet. Hidden while a place is selected so the
          existing selected-place preview card (rendered above) is the single
          bottom surface — the smallest safe way to avoid overlap this phase. */}
      {selected ? null : (
        <MapBottomSheet
          mode={selectedMapFilter}
          loading={liveLoading}
          nearbyPlaces={nearbyPlaces}
          recentPlaces={recentPlaces}
          savedPlaces={validPlaces}
          partialHeight={sheetPartialHeight}
          availableHeight={availableHeight}
          topInset={safeTopInset + TOP_CHROME_CLEARANCE + Spacing.md}
          openSignal={sheetOpenSignal}
          minimizeSignal={sheetMinimizeSignal}
          onSnapChange={handleSheetSnapChange}
          onRequestSavedMode={() => setSelectedMapFilter('saved')}
          onSelectPlace={selectPlace}
          onGetDirections={openExternalMaps}
          onSaveFromLink={() => router.push('/share')}
          onSearchManually={() => router.push('/add-place')}
        />
      )}

      {/* Compact place-search dropdown — searches REAL places (Google Places
          via usePlacesSearch), not saved places. Tapping a result direct-saves
          it to the map with the default radius (no add-place screens). */}
      <MapPlaceSearchDropdown
        visible={searchVisible}
        topInset={safeTopInset + Spacing.md}
        onClose={() => setSearchVisible(false)}
        onPickPlace={handleSavePlaceCandidate}
      />

      {/* Post-save snackbar with Undo. After a direct save the selected-place
          preview card is showing, so lift the snackbar above it. */}
      <MapSnackbar
        visible={!!snackbar}
        message={snackbar?.message ?? ''}
        bottomOffset={(selected ? 264 : Spacing.lg + 4) + insets.bottom}
        actionLabel={snackbar?.undoId ? 'Undo' : undefined}
        onAction={
          snackbar?.undoId ? () => void handleUndoSave(snackbar.undoId as string) : undefined
        }
        onDismiss={() => setSnackbar(null)}
      />
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
  insetTop: number,
) {
  // Top-anchored overlays clear the floating chrome (search bar + chips) AND
  // the top safe area now that the Map header is hidden.
  const pillTop = insetTop + TOP_CHROME_CLEARANCE;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  topChrome: {
    position: 'absolute',
    top: insetTop + Spacing.md,
    left: Spacing.lg,
    right: Spacing.lg,
  },

  markerWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerHalo: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,106,26,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,106,26,0.22)',
  },
  markerCore: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,106,26,0.28)',
  },
  markerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.text,
  },

  locPill: {
    position: 'absolute',
    bottom: Spacing.lg + 4,
    left: Spacing.lg,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  locPillText: {
    ...typography.caption,
    color: colors.text,
  },

  banner: {
    position: 'absolute',
    top: Spacing.lg,
    left: Spacing.lg,
    right: Spacing.lg,
  },
  bannerCard: {},
  muted: { color: colors.textMuted, marginTop: 2 },

  previewBadge: {
    position: 'absolute',
    top: pillTop,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  previewBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  previewBadgeText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
  },

  emptyPill: {
    position: 'absolute',
    top: pillTop,
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyPillText: {
    ...typography.caption,
    color: colors.text,
  },

  previewWrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.lg,
  },
  previewCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: resolvedShadowOpacity(colors),
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    padding: 14,
  },
  previewHandleWrap: {
    alignItems: 'center',
    marginTop: -2,
    marginBottom: Spacing.sm,
  },
  previewHandle: {
    width: 42,
    height: 5,
    borderRadius: Radius.pill,
    backgroundColor: colors.border,
  },
  previewTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  previewThumb: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  previewCopy: {
    flex: 1,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  previewAddress: {
    color: colors.textSecondary,
    marginTop: 2,
  },
  previewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  previewMetaText: {
    color: colors.textSecondary,
  },
  metaPill: {
    paddingVertical: 5,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaPillText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeText: {
    fontSize: 22,
    lineHeight: 22,
    color: colors.textMuted,
    fontWeight: '600',
  },
  previewActions: {
    marginTop: Spacing.md,
  },
  reminderContextWrap: {
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  reminderBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,106,26,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,106,26,0.3)',
  },
  reminderBadgeText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },
  reminderCopy: {
    color: colors.text,
  },
  reminderNearbyCount: {
    color: colors.textSecondary,
  },
  previewScrollContent: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  previewPrimaryAction: {
    width: '100%',
  },
  reminderSecondaryActions: {
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  reminderAdjustRow: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.xs,
  },
  reminderAdjustText: {
    ...typography.caption,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  previewSecondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  previewSecondaryText: {
    ...typography.label,
    color: colors.textSecondary,
  },

  viewAllBtn: {
    position: 'absolute',
    top: pillTop,
    right: Spacing.lg,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  viewAllText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
  },

  fab: {
    position: 'absolute',
    bottom: Spacing.lg + 4,
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  fabText: { color: colors.textInverse, fontSize: 28, lineHeight: 30 },
  });
}

function resolvedShadowOpacity(colors: ReturnType<typeof useTheme>['colors']) {
  return colors.bg === '#FFF8F1' ? 0.12 : 0.34;
}
