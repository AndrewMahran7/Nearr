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
 * Marker filtering and visual density are presentation-only; clustering and
 * tile/style customization remain intentionally out of scope.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Animated,
  Alert,
  AppState,
  type AppStateStatus,
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
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
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
  MapCategoryFilterBar,
  MapGroupSelector,
  MapPlaceSearchDropdown,
  MapSnackbar,
  MapTopSearchBar,
  NearrMapMarker,
  SelectedPlaceDetails,
  ShareQueueButton,
  getSheetPartialHeight,
  type MapSheetMode,
  type SheetSnap,
} from '@/components/map';
import { Colors, Radius, Spacing, Typography } from '@/constants';
import {
  isMeaningfulInteraction,
  nextTransientMessage,
  type InteractionSource,
  type TransientMessage,
} from '@/lib/transientMessage';
import {
  MAP_FILTER_ALL,
  filterPlacesForMap,
  isMapFilterActive,
  mapFilterEmptyMessage,
  mapFilterOptions,
  shouldRenderZoneCircle,
  type MapVisibilityFilter,
} from '@/lib/mapVisibility';
import { useNearbyPlaces } from '@/hooks/useNearbyPlaces';
import { useRecentPlaces } from '@/hooks/useRecentPlaces';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
  updateSavedPlacesCache,
} from '@/hooks/useSavedPlaces';
import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import {
  clearMapGroupFocusRequest,
  decideMapGroupFit,
  getMapGroupFocusRequest,
  mapGroupEdgePadding,
  resolveMapGroupPlaces,
} from '@/lib/mapGroupFocus';
import { openExternalMaps as openInExternalMaps } from '@/lib/externalMaps';
import {
  shouldAcceptSample,
  shouldWatchLocation,
  canStartWatch,
  nextFollowMode,
  shouldFollowCamera,
  LIVE_LOCATION_TIME_INTERVAL_MS,
  LIVE_LOCATION_DISTANCE_INTERVAL_M,
  LIVE_LOCATION_FOLLOW_ANIMATION_MS,
  type LocationSample,
} from '@/lib/liveLocation';
import { trackEvent } from '@/lib/analytics';
import { recordBreadcrumb } from '@/lib/breadcrumbs';
import { setLocationWatcherState } from '@/lib/diagnosticContext';
import { isMapPinRedesignEnabled } from '@/lib/featureFlags';
import { mapMarkerDetailLevel } from '@/lib/mapMarkerPresentation';
import {
  decideSavedPlaceFocus,
  findSavedPlaceForOpen,
  isOpenExistingPlaceSource,
  isOpenSavedPlaceRequestHandled,
  markOpenSavedPlaceRequestHandled,
  openSavedPlaceMessage,
  savedPlaceFocusKey,
  shouldExpandSavedPlaceDetails,
} from '@/lib/openSavedPlace';
import { isLikelyUrl } from '@/lib/shareParser';
import { distanceMeters } from '@/lib/geo';
import { getEffectiveNearbyNotificationRadiusMeters } from '@/lib/nearbyEligibility';
import { savedPlacePinOpacity } from '@/lib/savedPlacePinState';
import { useTheme } from '@/lib/theme';
import { getDemoSeededSavedPlacesSync } from '@/services/demo';
import {
  deleteSavedPlace,
  markArchived,
  markVisited,
  saveSavedPlace,
} from '@/services/savedPlacesService';
import type { PlaceCandidate } from '@/services/placesService';
import type { SavedPlaceWithPlace } from '@/types';

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

// Vertical space reserved by the floating search bar + filter chips from the
// top of the map area. When async share-jobs are enabled we add one more row
// for the Queue pill so View All / preview pills never overlap it.
const TOP_CHROME_BASE_CLEARANCE = Spacing.md + 50 + Spacing.sm + 40 + Spacing.sm;
const QUEUE_PILL_CLEARANCE = 18 + Spacing.sm + 8;

// The Queue pill as it sits while Place Detail is expanded: its own top margin
// plus its minimum height.
const RAISED_QUEUE_PILL_HEIGHT = Spacing.sm + 44;

/**
 * Map left visible above the expanded Place Detail sheet.
 *
 * Just the raised Queue pill's row plus a small gap — the detail owns the rest
 * of the screen. Deriving it from the pill (rather than picking a percentage)
 * is what keeps "the sheet is nearly full-screen" and "the Queue is always
 * tappable" from being in tension: the peek cannot shrink below the one piece
 * of chrome that has to survive it.
 */
function expandedSheetMapPeek(safeTopInset: number): number {
  return safeTopInset + RAISED_QUEUE_PILL_HEIGHT + Spacing.md;
}

/**
 * Effective radius (in meters) for a saved place, used to render a Life360-
 * style zone bubble. Mirrors `effectiveRadiusMeters` in `lib/notifications.ts`
 * exactly — the map circle must show the SAME radius the reminder engine
 * actually uses, never a locally-recomputed guess. Honors:
 *   1. per-place radius_value/radius_unit if set
 *   2. else the category-aware default (see `lib/nearbyEligibility.ts`)
 */
function effectiveRadiusMeters(s: SavedPlaceWithPlace): number {
  return getEffectiveNearbyNotificationRadiusMeters(s);
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
): Array<{ latitude: number; longitude: number }> {
  const coords: Array<{ latitude: number; longitude: number }> = [];
  for (const p of places) {
    coords.push(
      ...radiusBoundingCoords(
        p.place.latitude,
        p.place.longitude,
        effectiveRadiusMeters(p),
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

export default function MapScreen() {
  const router = useRouter();
  const { colors, typography, resolvedTheme } = useTheme();
  const mapRenderCountRef = useRef(0);
  mapRenderCountRef.current += 1;
  // Reserve the Queue pill's row unconditionally. It used to follow
  // `isAsyncShareJobsEnabled()`, but the pill itself no longer does (see
  // lib/shareQueueAccess.ts), and two different predicates deciding whether the
  // same 34pt exists is precisely how the row ends up with something else
  // sitting in it. The cost of always reserving it is 34pt of top clearance.
  const topChromeClearance = TOP_CHROME_BASE_CLEARANCE + QUEUE_PILL_CLEARANCE;
  // Map header is hidden (map-first) so the screen owns the top safe area.
  // Floor the inset so devices that report ~0 (older Android without a
  // translucent status bar / notch) still keep the search bar clear of the
  // status bar instead of hugging the very top edge.
  const insets = useSafeAreaInsets();
  const safeTopInset = Math.max(insets.top, Spacing.xl);
  const styles = useMemo(
    () => createStyles(colors, typography, safeTopInset, topChromeClearance),
    [colors, typography, safeTopInset, topChromeClearance],
  );
  // Optional deep-link params: when present, the map should center on this
  // saved place and open its preview card. Set by "Show on map" actions, the
  // completed queue row, share-job completion, and notifications.
  // `openRequestId` identifies ONE navigation intent — it is what gets
  // consumed, so the same place can be opened again later, while a stale
  // param cannot re-open a place the user has already closed.
  const {
    savedPlaceId: rawSavedPlaceId,
    savedPlaceGoogleId: rawSavedPlaceGoogleId,
    placeSource: rawPlaceSource,
    openRequestId: rawOpenRequestId,
    reminderOpen: rawReminderOpen,
    reminderSource: rawReminderSource,
    nearbyCount: rawNearbyCount,
    mapGroupId: rawMapGroupId,
  } = useLocalSearchParams<{
    savedPlaceId?: string | string[];
    savedPlaceGoogleId?: string | string[];
    placeSource?: string | string[];
    openRequestId?: string | string[];
    reminderOpen?: string | string[];
    reminderSource?: string | string[];
    nearbyCount?: string | string[];
    mapGroupId?: string | string[];
  }>();
  const savedPlaceId = firstParam(rawSavedPlaceId);
  const savedPlaceGoogleId = firstParam(rawSavedPlaceGoogleId);
  const placeSource = firstParam(rawPlaceSource);
  const openRequestId = firstParam(rawOpenRequestId);
  const reminderOpen = parseBoolParam(rawReminderOpen);
  const reminderSourceRaw = firstParam(rawReminderSource);
  const reminderSource: ReminderSource =
    reminderSourceRaw === 'nearby'
      ? 'nearby'
      : reminderSourceRaw === 'notification'
        ? 'notification'
        : 'unknown';
  const nearbyCount = parsePositiveIntParam(rawNearbyCount);
  const mapGroupId = firstParam(rawMapGroupId);
  const {
    data: liveData,
    loading: liveLoading,
    refreshing: liveRefreshing,
    offline: liveOffline,
    refresh,
    revalidate,
  } = useSavedPlaces();
  const mapRef = useRef<MapView | null>(null);
  const markerRefs = useRef<Record<string, ComponentRef<typeof Marker> | null>>({});
  const demo = isDemoMode();
  // Map Preview keeps the real MapView but skips Supabase / Google / location.
  // Demo Mode wins if both flags are set (it doesn't render MapView at all).
  const mapPreview = !demo && isMapPreviewMode();
  const mapPinRedesignEnabled = isMapPinRedesignEnabled();
  const [mapPinGlyphsReady, setMapPinGlyphsReady] = useState(!mapPinRedesignEnabled);
  useEffect(() => {
    if (!mapPinRedesignEnabled) {
      setMapPinGlyphsReady(true);
      return;
    }
    let cancelled = false;
    void MaterialCommunityIcons.loadFont()
      .then(() => {
        if (!cancelled) setMapPinGlyphsReady(true);
      })
      .catch((error) => {
        // Keep the complete legacy marker instead of snapshotting blank glyphs.
        if (__DEV__) console.debug('[map] marker icon font unavailable', error);
      });
    return () => {
      cancelled = true;
    };
  }, [mapPinRedesignEnabled]);
  const mapPinRedesignActive = mapPinRedesignEnabled && mapPinGlyphsReady;

  // In Map Preview Mode, render against the synchronous seeded dataset so the
  // first frame already has markers — no async race, no loading state.
  const previewData = useMemo<SavedPlaceWithPlace[]>(
    () => (mapPreview ? getDemoSeededSavedPlacesSync() : []),
    [mapPreview],
  );
  const data = mapPreview ? previewData : liveData;
  // Demo and Map Preview render fixture data and are never 'offline'.
  const offline = !mapPreview && !demo && liveOffline;
  // In Map Preview Mode the saved-places list is the synchronous seed; alias
  // for clarity in the debug logs and marker map below.
  const places = data;
  const mapGroupRequest = useMemo(
    () => getMapGroupFocusRequest(mapGroupId),
    [mapGroupId],
  );
  const resolvedMapGroup = useMemo(
    () => resolveMapGroupPlaces(places, mapGroupRequest?.savedPlaceIds ?? []),
    [mapGroupRequest, places],
  );
  const mapGroupCoordinateIds = useMemo(
    () => new Set(resolvedMapGroup.coordinatePlaces.map((place) => place.id)),
    [resolvedMapGroup.coordinatePlaces],
  );

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
  // Follow mode: when ON, the camera glides to keep the live user location
  // centered. Enabled by tapping the recenter button; disabled the moment the
  // user manually pans/zooms the map (they've taken over navigation). The
  // user dot keeps updating regardless of this flag. Starts ON so the map
  // opens in a "here I am" state, then yields to the user on first gesture.
  const [followMode, setFollowMode] = useState(true);
  const followModeRef = useRef(true);
  followModeRef.current = followMode;
  const [selected, setSelected] = useState<SavedPlaceWithPlace | null>(null);
  // Updated only after a camera gesture completes. Presentation tiers are
  // discrete, so memoized markers never rerender on every pan frame.
  const [markerLatitudeDelta, setMarkerLatitudeDelta] = useState(
    PREVIEW_INITIAL_REGION.latitudeDelta,
  );

  // Keep an already-open detail sheet attached to the live cached row. Media
  // enrichment updates ai_note asynchronously after the initial save.
  useEffect(() => {
    if (!selected) return;
    const live = validPlaces.find((place) => place.id === selected.id);
    if (live && live !== selected) setSelected(live);
  }, [selected, validPlaces]);
  const [mapReady, setMapReady] = useState(false);
  // Which list the bottom sheet shows. The old Nearby/Recent/Saved chips drove
  // this from the map chrome; they never filtered the map and each duplicated
  // something the sheet already offers (its default list already carries a
  // "Recently saved" section, and its header already has "Open list"). The
  // sheet now owns its own mode and the map chrome filters the map instead.
  const [sheetMode, setSheetMode] = useState<MapSheetMode>('nearby');
  // Bumped when something asks a minimized sheet to re-open to its partial snap.
  const [sheetOpenSignal, setSheetOpenSignal] = useState(0);
  // Category visibility for MARKERS. Presentation only: it never mutates a
  // saved place, re-queries, or touches reminder/geofence state. Defaults to
  // All on every fresh session — the map is the user's whole collection unless
  // they just chose otherwise.
  const [mapCategoryFilter, setMapCategoryFilter] = useState<MapVisibilityFilter>(MAP_FILTER_ALL);

  // Chips to offer, derived from what the user actually saved. Only groups
  // with places appear, so a small collection shows two or three chips.
  const mapFilterChoices = useMemo(() => mapFilterOptions(validPlaces), [validPlaces]);

  // The markers that actually render. One memoized pass over an array the map
  // already holds — no query, no refetch, no mutation. The selected place is
  // pinned visible so a focused place is never hidden by an active filter.
  const visiblePlaces = useMemo(
    () => filterPlacesForMap(validPlaces, mapCategoryFilter, selected?.id ?? null),
    [mapCategoryFilter, selected?.id, validPlaces],
  );
  const markerDetailLevel = useMemo(
    () => mapMarkerDetailLevel({
      latitudeDelta: markerLatitudeDelta,
      visibleCount: visiblePlaces.length,
    }),
    [markerLatitudeDelta, visiblePlaces.length],
  );

  // A filter whose group no longer has any places (last one deleted, or the
  // collection changed underneath) silently returns to All rather than leaving
  // the user on an empty map with no matching chip to un-press.
  useEffect(() => {
    if (mapCategoryFilter === MAP_FILTER_ALL) return;
    if (mapFilterChoices.some((option) => option.id === mapCategoryFilter)) return;
    setMapCategoryFilter(MAP_FILTER_ALL);
  }, [mapCategoryFilter, mapFilterChoices]);

  const handleSelectMapCategory = useCallback((next: MapVisibilityFilter) => {
    setMapCategoryFilter(next);
    // Deliberately does NOT move the camera: the user may be inspecting an
    // area, and yanking the viewport on every chip tap is disorienting. The
    // fit control on the same row is the explicit "reframe" action.
    void trackEvent('map_filter_changed', { filter: next });
  }, []);

  /**
   * Frame every CURRENTLY VISIBLE place. This is the former "View All" pill,
   * unchanged in behavior (fit the zones + get the sheet out of the way) —
   * only its input narrowed from every saved place to the filtered set, so
   * "fit" and "what's on screen" agree.
   */
  const fitVisiblePlaces = useCallback(() => {
    if (!mapRef.current) return;
    if (visiblePlaces.length === 0) return;
    setSheetMinimizeSignal((n) => n + 1);
    const coords = allZoneBoundingCoords(visiblePlaces);
    if (coords.length === 0) return;
    try {
      // Camera center uses the average of coordinates (center of mass) so a
      // single distant outlier doesn't drag the camera into empty space
      // between clusters. Zoom is still derived from the full bounding box.
      let sumLat = 0;
      let sumLng = 0;
      for (const p of visiblePlaces) {
        sumLat += p.place.latitude;
        sumLng += p.place.longitude;
      }
      const centerLat = sumLat / visiblePlaces.length;
      const centerLng = sumLng / visiblePlaces.length;

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

      // Extreme-spread guard: for globally distant points, center-of-mass
      // framing can hide places off-screen or misframe across the
      // antimeridian. Fall back to fitToCoordinates for very large spans.
      const latSpan = maxLat - minLat;
      const lngSpan = maxLng - minLng;
      const lngsSorted = visiblePlaces
        .map((p) => p.place.longitude)
        .sort((a, b) => a - b);
      let maxLngGap = 0;
      for (let i = 1; i < lngsSorted.length; i++) {
        const gap = lngsSorted[i] - lngsSorted[i - 1];
        if (gap > maxLngGap) maxLngGap = gap;
      }
      if (lngsSorted.length > 1) {
        const wrapGap = 360 - (lngsSorted[lngsSorted.length - 1] - lngsSorted[0]);
        if (wrapGap > maxLngGap) maxLngGap = wrapGap;
      }
      const crossesDateLine = maxLngGap > 180;

      if (latSpan > 45 || lngSpan > 90 || crossesDateLine) {
        mapRef.current.fitToCoordinates(coords, {
          edgePadding: { top: 100, right: 100, bottom: 180, left: 100 },
          animated: true,
        });
        return;
      }

      // Cluster-focused zoom: size the viewport from the SPREAD around the
      // centroid (standard deviation) instead of the single farthest point,
      // so one distant outlier can't force an extreme zoom-out.
      let varLat = 0;
      let varLng = 0;
      for (const p of visiblePlaces) {
        varLat += (p.place.latitude - centerLat) ** 2;
        varLng += (p.place.longitude - centerLng) ** 2;
      }
      const stdLat = Math.sqrt(varLat / visiblePlaces.length);
      const stdLng = Math.sqrt(varLng / visiblePlaces.length);
      const SPREAD_SIGMAS = 2;
      const PAD = 1.3;
      const MIN_DELTA = 0.02; // single-place / tight-cluster floor
      const latitudeDelta = Math.max(stdLat * SPREAD_SIGMAS * 2 * PAD, MIN_DELTA);
      const longitudeDelta = Math.max(stdLng * SPREAD_SIGMAS * 2 * PAD, MIN_DELTA);

      mapRef.current.animateToRegion(
        { latitude: centerLat, longitude: centerLng, latitudeDelta, longitudeDelta },
        400,
      );
    } catch (e) {
      if (__DEV__) console.debug('[map] fit skipped', e);
    }
  }, [visiblePlaces]);
  // In-app search overlay (replaces the old native Alert on the search bar).
  const [searchVisible, setSearchVisible] = useState(false);
  // Post-save "Saved to your map" snackbar with optional Undo.
  const [snackbar, setSnackbar] = useState<TransientMessage | null>(null);
  // One place that raises a transient confirmation. Each message gets its own
  // identity so its timer belongs to it alone.
  const showSnackbar = useCallback((message: string, undoId: string | null = null) => {
    setSnackbar((current) => nextTransientMessage(current, message, undoId));
  }, []);
  // Any real user action retires the confirmation — it has already done its
  // job. System activity (image loads, Realtime rows, layout, camera) is
  // filtered out by isMeaningfulInteraction so the message is never eaten
  // before it is seen. This NEVER touches `selected`: the place stays open.
  const handleUserInteraction = useCallback((source: InteractionSource) => {
    if (!isMeaningfulInteraction(source)) return;
    setSnackbar((current) => (current ? null : current));
  }, []);
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
  const [mapGroupSelectorHeight, setMapGroupSelectorHeight] = useState(0);
  const availableHeight = mapAreaHeight || windowHeight;
  const sheetPartialHeight = useMemo(
    () => getSheetPartialHeight(availableHeight),
    [availableHeight],
  );
  /**
   * Expanded Place Detail height.
   *
   * The detail is the screen once it is open. It keeps a strip of map at the
   * top — enough to place the rounded edge against something, and enough for
   * the Queue pill to sit in — but no more than that. An earlier pass reserved
   * 72% for the sheet specifically to preserve a large map header; on device
   * that read as a cramped card under a mostly-empty map, so the reservation
   * is gone.
   *
   * The peek is measured from the top of the map AREA (tab bar already
   * excluded), and it is what guarantees the raised Queue pill and the sheet
   * never occupy the same points — see scripts/testMapQueueEntryPoint.ts.
   */
  const expandedSheetHeight = useMemo(
    () => Math.max(380, Math.round(availableHeight - expandedSheetMapPeek(safeTopInset))),
    [availableHeight, safeTopInset],
  );
  const { nearbyPlaces, locationState, requestLocationPermission } = useNearbyPlaces(data);
  const recentPlaces = useRecentPlaces(validPlaces, 5);
  const previewTranslateY = useRef(new Animated.Value(0)).current;
  // Selected-place sheet: collapsed (preview) vs expanded (inline details).
  // Reset to collapsed whenever a new place is selected or the sheet is
  // dismissed. The pan responder reads the current value via a ref so it
  // never has to be recreated when the sheet toggles.
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const previewExpandedRef = useRef(false);
  previewExpandedRef.current = previewExpanded;
  const shouldShowMapControls = !selected || !previewExpanded;
  const didFitRef = useRef(false);
  // Set to true when the user pans or zooms the map so auto-centering
  // effects don't override the user's chosen viewport.
  const hasUserMovedRef = useRef(false);
  // Legacy latch for navigations that carry a bare `savedPlaceId` and no
  // single-use `openRequestId` (Home's "Show on map", /place/[id], add-place,
  // cold deep links). Behaviour for those is unchanged: one focus per id per
  // map mount. Navigations built by `resolveOpenSavedPlaceRoute` consume the
  // module-level request ledger instead, which is what lets the SAME place be
  // opened again from the queue later.
  const handledTargetIdRef = useRef<string | null>(null);
  // The at-most-one forced refetch we're allowed per open request (see
  // `decideSavedPlaceFocus`). `settled` flips when the fetch finishes so the
  // "place is genuinely gone" verdict is never reached while it's in flight.
  const focusRefreshRef = useRef<{ key: string; settled: boolean } | null>(null);
  // Bumped when that refetch settles, purely to re-run the focus effect.
  const [focusRefreshTick, setFocusRefreshTick] = useState(0);
  const handledMapGroupIdRef = useRef<string | null>(null);
  const handledReminderAnalyticsRef = useRef<string | null>(null);
  const shownMissingReminderRef = useRef<string | null>(null);
  // The CURRENT VISIBLE REGION, kept deliberately separate from `userRegion`
  // (the GPS fix) — the two are not interchangeable. This is a record of where
  // the camera is, NOT a camera command: nothing may read it to move the map.
  // It used to feed a "restore the pre-open viewport" animation on dismiss,
  // which is exactly what yanked the camera back toward the user's location
  // when a place was closed. Closing UI does not move the camera.
  const lastRegionRef = useRef<Region | null>(null);

  // ---- live foreground location tracking --------------------------------
  // A single `watchPositionAsync` subscription, its last-accepted reading (for
  // stale/out-of-order rejection), and the lifecycle inputs (app foreground +
  // screen focus) that gate whether it should be running. See lib/liveLocation.ts
  // for the pure decision logic.
  const watchSubRef = useRef<Location.LocationSubscription | null>(null);
  const lastSampleRef = useRef<LocationSample | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [screenFocused, setScreenFocused] = useState(false);

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

  // ---- live foreground location subscription ----------------------------
  // Keeps the user dot (and follow-mode camera) tracking the real device
  // location while the map is visible and the app is foregrounded. Exactly one
  // subscription is ever active; it is torn down on blur, background, or
  // permission loss and a fresh one is started when we return to the
  // foreground. Stale / out-of-order / invalid readings are dropped via
  // lib/liveLocation.ts. We deliberately do NOT request background location and
  // never track while the app is closed.
  useEffect(() => {
    if (demo || mapPreview) return;

    const shouldWatch = shouldWatchLocation({
      isFocused: screenFocused,
      appActive,
      permissionGranted: permission === 'granted',
    });

    if (!shouldWatch) {
      // Not eligible to track right now — make sure any existing subscription
      // is removed (covers blur, background, and permission loss).
      if (watchSubRef.current) {
        watchSubRef.current.remove();
        watchSubRef.current = null;
        setLocationWatcherState('stopped');
        recordBreadcrumb('location_watcher_stopped', { result: 'gate_closed' });
      }
      return;
    }

    // Already have a live subscription — never create a duplicate.
    if (!canStartWatch(!!watchSubRef.current)) return;

    let cancelled = false;
    (async () => {
      try {
        const subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: LIVE_LOCATION_TIME_INTERVAL_MS,
            distanceInterval: LIVE_LOCATION_DISTANCE_INTERVAL_M,
          },
          (loc) => {
            const sample: LocationSample = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              timestamp: loc.timestamp,
            };
            // Reject stale / out-of-order / invalid readings.
            if (!shouldAcceptSample(lastSampleRef.current, sample)) {
              recordBreadcrumb('location_reading_rejected', { result: 'stale_or_invalid' });
              return;
            }
            lastSampleRef.current = sample;
            recordBreadcrumb('location_reading_accepted');
            // The marker/dot always reflects the latest accepted reading.
            setUserRegion((prev) => ({
              latitude: sample.latitude,
              longitude: sample.longitude,
              latitudeDelta: prev?.latitudeDelta ?? 0.03,
              longitudeDelta: prev?.longitudeDelta ?? 0.03,
            }));
            // Only the camera is gated on follow mode. Use animateCamera so we
            // preserve the user's current zoom instead of snapping to a fixed
            // delta.
            if (shouldFollowCamera(followModeRef.current, true)) {
              try {
                mapRef.current?.animateCamera(
                  { center: { latitude: sample.latitude, longitude: sample.longitude } },
                  { duration: LIVE_LOCATION_FOLLOW_ANIMATION_MS },
                );
              } catch (err) {
                if (__DEV__) console.debug('[map] follow animate skipped', err);
              }
            }
          },
        );
        if (cancelled) {
          // Unmounted / gate flipped while we awaited — drop it immediately.
          subscription.remove();
          return;
        }
        watchSubRef.current = subscription;
        setLocationWatcherState('watching');
        recordBreadcrumb('location_watcher_started');
      } catch (err) {
        // watchPositionAsync can throw on emulators / when the provider is
        // unavailable. Degrade gracefully — never crash the map.
        if (__DEV__) console.debug('[map] watchPositionAsync failed', err);
      }
    })();

    return () => {
      cancelled = true;
      if (watchSubRef.current) {
        watchSubRef.current.remove();
        watchSubRef.current = null;
        setLocationWatcherState('stopped');
        recordBreadcrumb('location_watcher_stopped', { result: 'cleanup' });
      }
    };
  }, [demo, mapPreview, screenFocused, appActive, permission]);

  // ---- mount / unmount breadcrumbs --------------------------------------
  useEffect(() => {
    recordBreadcrumb('map_mounted');
    return () => recordBreadcrumb('map_unmounted');
  }, []);

  // ---- re-fetch on focus -------------------------------------------------
  // Stale-while-revalidate: hydrates instantly from the shared cache and only
  // hits the network if the data is stale — so the map never visibly resets
  // when returning to this tab.
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      void revalidate();
      void trackEvent('map_opened', {});
      return () => {
        // Blur (tab switch / navigate away): the watch effect below reads
        // this and tears down the subscription so we never track a screen the
        // user isn't looking at.
        setScreenFocused(false);
      };
    }, [revalidate]),
  );

  // ---- app foreground/background listener --------------------------------
  // Drives the live-location watch lifecycle together with screen focus. When
  // the app goes to the background we stop tracking; when it returns to the
  // foreground the watch effect restarts a fresh subscription.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

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
    // A "View place" / completed-queue-row / already-saved / notification open
    // provides a saved_places id and, when available, the canonical
    // google_place_id as a fallback. `openRequestId` (minted per navigation)
    // is what we actually consume, so the SAME place can be opened again later.
    const requestKey = savedPlaceFocusKey({
      openRequestId,
      savedPlaceId,
      googlePlaceId: savedPlaceGoogleId,
    });
    // Resolve by saved_places.id FIRST, then by the stable google_place_id.
    // This is what makes "View place" reliably open the existing place even
    // when the exact saved_places id can't be matched (deleted-then-re-saved,
    // or a stale id) — one tested resolver (lib/openSavedPlace).
    const target = requestKey
      ? findSavedPlaceForOpen(validPlaces, {
          savedPlaceId,
          googlePlaceId: savedPlaceGoogleId,
        })
      : null;
    const refreshState =
      focusRefreshRef.current?.key === requestKey ? focusRefreshRef.current : null;
    const decision = decideSavedPlaceFocus({
      requestKey,
      handled: openRequestId
        ? isOpenSavedPlaceRequestHandled(openRequestId)
        : handledTargetIdRef.current === requestKey,
      mapReady,
      found: !!target,
      // A forced refetch reports through `refreshing`, not `loading`; both mean
      // "the answer isn't in yet".
      loading: liveLoading || liveRefreshing,
      refreshRequested: !!refreshState,
      refreshSettled: !!refreshState?.settled,
    });

    if (decision === 'idle' || decision === 'wait') return;

    // Explicit consumption: a request is answered exactly once, whether the
    // answer was "here it is" or "it is gone". The module ledger outlives a map
    // remount, so a stale param left in the route can never re-open the place.
    const consumeRequest = () => {
      handledTargetIdRef.current = requestKey;
      markOpenSavedPlaceRequestHandled(openRequestId);
    };

    // The list we have does not contain the target. Ask for exactly ONE
    // authoritative refetch before concluding anything: the map tab is
    // long-lived and its cached list can predate a place the worker saved
    // seconds ago. Bounded by `focusRefreshRef` — never a retry loop.
    if (decision === 'refresh') {
      if (!requestKey) return;
      focusRefreshRef.current = { key: requestKey, settled: false };
      void refresh().finally(() => {
        if (focusRefreshRef.current?.key === requestKey) {
          focusRefreshRef.current = { key: requestKey, settled: true };
        }
        setFocusRefreshTick((tick) => tick + 1);
      });
      return;
    }

    if (decision === 'missing') {
      // Consumed: the request is answered ("it isn't there"), so it can never
      // be retried on a later render or after a remount.
      consumeRequest();
      if (reminderOpen && shownMissingReminderRef.current !== requestKey) {
        shownMissingReminderRef.current = requestKey;
        setReminderContextSavedPlaceId(null);
        showSnackbar('Could not find that saved place. Showing your map.', null);
      } else if (
        isOpenExistingPlaceSource(placeSource) &&
        shownMissingReminderRef.current !== requestKey
      ) {
        // An already-saved / queue / notification open whose place no longer
        // exists. Recover locally with a friendly message and NO selection —
        // never a wrong place, never the error boundary.
        shownMissingReminderRef.current = requestKey;
        showSnackbar('This place is no longer available.', null);
      }
      recordBreadcrumb('saved_places_fetch_completed', {
        savedPlaceId: savedPlaceId ?? null,
        result: 'open_target_not_found',
      });
      if (__DEV__) console.log('[map] target id not found', requestKey);
      return;
    }

    if (!target) return; // unreachable for 'focus'; keeps the deref honest
    consumeRequest();
    // A deep link is an explicit "show me THIS place" instruction, so an
    // unrelated category filter left over from earlier is cleared rather than
    // silently hiding everything around the target. (The selected place is
    // pinned visible regardless; this also restores its surroundings.)
    setMapCategoryFilter(MAP_FILTER_ALL);
    if (reminderOpen) {
      setReminderContextSavedPlaceId(target.id);
    }
    didFitRef.current = true;
    try {
      // The SAME path a manual marker tap takes: camera to the place, card open.
      selectPlace(target);
      // A single nearby notification converges on the canonical Place Detail
      // V2 rather than a notification-specific single-place UI: same screen the
      // Map, Queue and Home all reach. Directions and "Did you go yet?" live
      // there, so no capability is lost by dropping the bespoke reminder block.
      if (shouldExpandSavedPlaceDetails(placeSource) || reminderOpen) {
        setPreviewExpanded(true);
      }
      const successMessage = openSavedPlaceMessage(placeSource);
      if (successMessage) {
        showSnackbar(successMessage, null);
      }
    } catch (err) {
      console.warn('[map] focus failed', (err as Error)?.message ?? err);
    }
  }, [
    savedPlaceId,
    savedPlaceGoogleId,
    openRequestId,
    placeSource,
    mapReady,
    validPlaces,
    liveLoading,
    liveRefreshing,
    focusRefreshTick,
    reminderOpen,
  ]);

  useEffect(() => {
    if (!mapGroupId) return;
    setPreviewExpanded(false);
    previewTranslateY.setValue(0);
  }, [mapGroupId, previewTranslateY]);

  useEffect(() => {
    const decision = decideMapGroupFit({
      requestId: mapGroupId,
      handledRequestId: handledMapGroupIdRef.current,
      mapReady,
      layoutHeight: mapAreaHeight,
      waitingForPlaces:
        (!!mapGroupRequest && liveLoading && resolvedMapGroup.missingIds.length > 0) ||
        (!!mapGroupRequest && resolvedMapGroup.places.length > 0 && mapGroupSelectorHeight <= 0),
    });
    if (decision !== 'fit' || !mapGroupId) return;
    if (!mapGroupRequest) {
      handledMapGroupIdRef.current = mapGroupId;
      showSnackbar('Showing your saved places.', null);
      return;
    }
    handledMapGroupIdRef.current = mapGroupId;
    fitCurrentMapGroup();
    if (mapGroupRequest.failedCount > 0) {
      showSnackbar(`${mapGroupRequest.failedCount} place${mapGroupRequest.failedCount === 1 ? '' : 's'} still need attention.`, null);
    } else if (resolvedMapGroup.missingCoordinateIds.length > 0) {
      showSnackbar(`${resolvedMapGroup.missingCoordinateIds.length} saved place${resolvedMapGroup.missingCoordinateIds.length === 1 ? '' : 's'} has no map location.`, null);
    }
    // Camera fitting is intentionally once per request id. Subsequent data,
    // selection, and pan updates must not take control away from the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLoading, mapAreaHeight, mapGroupId, mapGroupRequest, mapGroupSelectorHeight, mapReady, resolvedMapGroup]);

  // ---- DEBUG ------------------------------------------------------------
  // Temporary verbose logs requested while diagnosing the "spinner forever"
  // bug. Throttled to fire only when one of the watched fields actually
  // changes — logging on every render starves the JS thread under idle
  // AppState / Supabase chatter and contributed to a native
  // EventDispatcher OOM observed on Android.
  const debugStateRef = useRef<string>('');
  const debugLogCountRef = useRef(0);
  if (__DEV__) {
    const sig = `${liveLoading}|${data.length}|${validPlaces.length}|${visiblePlaces.length}|${markerDetailLevel}|${mapPinRedesignActive}|${permission}|${currentLocationLoading}|${mapReady}|${mapPreview}`;
    if (debugStateRef.current !== sig && debugLogCountRef.current < 30) {
      debugStateRef.current = sig;
      debugLogCountRef.current += 1;
      // eslint-disable-next-line no-console
      console.log('[map] state', {
        renderCount: mapRenderCountRef.current,
        diagnosticUpdateCount: debugLogCountRef.current,
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
        markersRendered: visiblePlaces.length,
        markerDetailLevel,
        mapPinRedesignActive,
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

  /**
   * Close the selected place. This NEVER moves the camera.
   *
   * It used to animate back to the viewport captured when the place was opened.
   * That restore was the "map jumps back to my current location" bug: for every
   * deep-link entry (queue row, notification, "Show on map") the captured
   * viewport was wherever the camera happened to be BEFORE the focus — normally
   * the user's own location — so closing the card threw the user across the
   * state. It also silently discarded any panning done while the card was open.
   *
   * Camera ownership rule: closing UI is not a reason to move the map. The
   * camera stays exactly where the user last left it, and only an explicit
   * request (recenter, or a deliberate navigation to a place) moves it.
   */
  const dismissSelectedPlace = useCallback(() => {
    if (!selected) return;
    // Collapsing the place is itself a user action; the confirmation must
    // not be left floating over the bare map.
    handleUserInteraction('sheet_dismiss');

    markerRefs.current[selected.id]?.hideCallout?.();
    previewTranslateY.stopAnimation();
    previewTranslateY.setValue(0);
    setSelected(null);
    setPreviewExpanded(false);
    if (__DEV__) console.log('[map-sheet] dismissed');
  }, [previewTranslateY, selected]);

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
      effectiveRadiusMeters(item),
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

  function fitCurrentMapGroup() {
    const coordinatePlaces = resolvedMapGroup.coordinatePlaces;
    if (!mapRef.current || coordinatePlaces.length === 0) {
      showSnackbar('These places do not have map locations yet.', null);
      return;
    }
    didFitRef.current = true;
    followModeRef.current = false;
    setFollowMode(false);
    if (coordinatePlaces.length === 1) {
      selectPlace(coordinatePlaces[0]!);
      return;
    }
    if (selected) {
      previewTranslateY.setValue(0);
      setSelected(null);
      setPreviewExpanded(false);
    }
    try {
      mapRef.current.fitToCoordinates(
        coordinatePlaces.map((place) => ({
          latitude: place.place.latitude,
          longitude: place.place.longitude,
        })),
        {
          edgePadding: mapGroupEdgePadding({
            topChromeHeight: safeTopInset + topChromeClearance,
            bottomOverlayHeight: mapGroupSelectorHeight + insets.bottom,
          }),
          animated: true,
        },
      );
    } catch (e) {
      if (__DEV__) console.debug('[map] group fit skipped', e);
    }
  }

  function selectMapGroupPlace(item: SavedPlaceWithPlace) {
    if (!mapGroupCoordinateIds.has(item.id)) {
      showSnackbar(`${item.place.name} does not have a map location yet.`, null);
      return;
    }
    selectPlace(item);
  }

  function closeMapGroup() {
    if (mapGroupId) clearMapGroupFocusRequest(mapGroupId);
    if (selected) dismissSelectedPlace();
    router.replace('/(tabs)/map');
  }

  function selectPlace(item: SavedPlaceWithPlace) {
    // Selecting a place is manual navigation to a specific spot — stop the
    // follow camera so it doesn't yank back to the user's live location while
    // they're examining this place. The user dot keeps updating; tapping the
    // recenter button re-enables follow. Set the ref directly for immediate
    // effect in any in-flight watch callback.
    followModeRef.current = false;
    setFollowMode(false);
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

  function focusCorrectedPlace(item: SavedPlaceWithPlace) {
    followModeRef.current = false;
    setFollowMode(false);
    setSelected(item);
    setPreviewExpanded(true);
    previewTranslateY.setValue(0);
    try {
      focusZone(item);
    } catch (err) {
      console.warn('[map] corrected-place focus failed', (err as Error)?.message ?? err);
    }
  }

  // Stable identity so NearrMapMarker memoization survives parent re-renders
  // (selection, theme, etc.). Without this, every render would pass a
  // fresh inline closure and re-arm the Android view-tracking path that
  // produced the OutOfMemoryError on the GMS Marker.setIcon side.
  const handleMarkerPress = useCallback((p: SavedPlaceWithPlace) => {
    handleUserInteraction('marker_press');
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
      // Visiting is NOT deleting. `markVisited` stamps `visited_at` and turns
      // reminders off (which is what stops future "go here" nudges), but the
      // save stays in the collection and on the map — so the cached row is
      // UPDATED, never removed. Removing it here made a visited place vanish
      // from the map until the next refetch, even though the server had
      // deleted nothing.
      updateSavedPlacesCache((current) =>
        current.map((row) =>
          row.id === selected.id
            ? { ...row, visited_at: new Date().toISOString(), notifications_enabled: false }
            : row,
        ),
      );
      setReminderContextSavedPlaceId(null);
      showSnackbar('Marked as visited', null);
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
        showSnackbar('Reminder archived for this place', null);
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
    // Manual pan/zoom hands navigation back to the user — stop the camera from
    // chasing new location readings. The user dot keeps updating regardless.
    if (followModeRef.current) {
      setFollowMode((cur) => nextFollowMode(cur, 'user-gesture'));
    }
  }, []);
  const handleRegionChangeComplete = useCallback((region: Region) => {
    lastRegionRef.current = region;
    if (mapPinRedesignEnabled) setMarkerLatitudeDelta(region.latitudeDelta);
  }, [mapPinRedesignEnabled]);
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
  // immediately using the category-aware automatic radius (null override), so
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
          showSnackbar('Already on your map', null);
          return;
        }
        selectPlace(result.saved);
        showSnackbar('Saved to your map', result.savedPlaceId);
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
          dismissSelectedPlace();
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
  // check + timeout race) so it can never wedge the UI. Always (re)enables
  // follow mode so the camera tracks the live location again.
  const recenterOnUser = useCallback(async () => {
    setFollowMode((cur) => nextFollowMode(cur, 'recenter'));
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
        {visiblePlaces.map((p) => (
          !shouldRenderZoneCircle({
            isSelected: selected?.id === p.id,
            hasSelection: !!selected,
            isArchived: !!p.archived_at,
            visibleCount: visiblePlaces.length,
          }) ? null : (
            <Circle
              key={`circle-${p.id}`}
              center={{
                latitude: p.place.latitude,
                longitude: p.place.longitude,
              }}
              radius={effectiveRadiusMeters(p)}
              strokeColor={
                selected?.id === p.id
                  ? 'rgba(255,106,26,0.52)'
                  : mapGroupRequest && !mapGroupCoordinateIds.has(p.id)
                    ? 'rgba(255,106,26,0.035)'
                  : 'rgba(255,106,26,0.14)'
              }
              strokeWidth={selected?.id === p.id ? 2 : 1}
              fillColor={
                selected?.id === p.id
                  ? 'rgba(255,106,26,0.12)'
                  : mapGroupRequest && !mapGroupCoordinateIds.has(p.id)
                    ? 'rgba(255,106,26,0.012)'
                  : 'rgba(255,106,26,0.035)'
              }
            />
          )
        ))}
        {visiblePlaces.map((p) => (
          <NearrMapMarker
            key={p.id}
            place={p}
            markerRefs={markerRefs}
            onPress={handleMarkerPress}
            dimmed={!!mapGroupRequest && !mapGroupCoordinateIds.has(p.id)}
            selected={selected?.id === p.id}
            detailLevel={markerDetailLevel}
            redesignEnabled={mapPinRedesignActive}
          />
        ))}
      </MapView>

      {/* Non-blocking empty/loading pill. The map keeps rendering underneath.
          A filter that matches nothing gets its own message plus a one-tap
          way back to All, so an empty map never reads as a broken app. */}
      {visiblePlaces.length === 0 ? (
        <View style={styles.emptyPill} pointerEvents="box-none">
          <Text style={styles.emptyPillText}>
            {liveLoading && validPlaces.length === 0
              ? 'Loading places…'
              : mapFilterEmptyMessage(mapCategoryFilter)}
          </Text>
          {isMapFilterActive(mapCategoryFilter) ? (
            <Pressable
              onPress={() => handleSelectMapCategory(MAP_FILTER_ALL)}
              accessibilityRole="button"
              accessibilityLabel="Show all saved places"
              style={styles.emptyPillAction}
            >
              <Text style={styles.emptyPillActionText}>Show all places</Text>
            </Pressable>
          ) : null}
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
          onStartShouldSetResponderCapture={() => {
            handleUserInteraction('press');
            return false;
          }}
          onMoveShouldSetResponderCapture={() => {
            handleUserInteraction('gesture');
            return false;
          }}
          style={[
            styles.previewWrap,
            // Expanded, the detail is the page: it spans the full width and
            // meets the bottom edge so it reads as a sheet growing out of the
            // map rather than a floating card. Collapsed, it stays the inset
            // preview card. Camera behaviour is untouched by either.
            previewExpanded && styles.previewWrapExpanded,
            { transform: [{ translateY: previewTranslateY }] },
          ]}
          pointerEvents="box-none"
        >
          <Card
            style={[
              styles.previewCard,
              previewExpanded && styles.previewCardExpanded,
              previewExpanded && { height: expandedSheetHeight },
            ]}
          >
            {/* Drag region: handle + header. The pan responder lives here
                (not on the whole card) so the expanded body ScrollView can
                scroll without fighting the collapse/dismiss gesture. */}
            <View {...previewPanResponder.panHandlers}>
              <View style={styles.previewHandleWrap}>
                <View style={styles.previewHandle} />
                {/* Dragging down is the primary dismissal. This is the
                    keyboard/VoiceOver equivalent, so it is small and sits ON
                    the handle line instead of owning a 44pt band of its own —
                    a 30pt mark plus hitSlop, not a button that outweighs the
                    place. */}
                {previewExpanded ? (
                  <Pressable
                    onPress={() => dismissSelectedPlace()}
                    accessibilityRole="button"
                    accessibilityLabel="Close place details"
                    hitSlop={12}
                    style={({ pressed }) => [
                      styles.closeBtnFloating,
                      pressed && styles.controlPressed,
                    ]}
                  >
                    <Feather name="x" size={17} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
              </View>
              {previewExpanded ? null : (
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
                    <Text style={[typography.heading, styles.previewTitle]} numberOfLines={1}>
                      {selected.place.name}
                    </Text>
                    <Pressable
                      onPress={() => dismissSelectedPlace()}
                      accessibilityRole="button"
                      accessibilityLabel="Close place preview"
                      style={({ pressed }) => [styles.closeBtn, pressed && styles.controlPressed]}
                    >
                      <Feather name="x" size={22} color={colors.textSecondary} />
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
              )}
            </View>

            {previewExpanded ? (
              // Expanded: the full editable details (reminder / radius / note /
              // remove) moved off /place/[id]. Bounded + scrollable so a long
              // note never pushes the sheet past the top of the map.
              <ScrollView
                // The card owns the height (see `expandedSheetHeight`); the
                // body just fills what is left of it. Driving the height from
                // content instead is what let the sheet grow until only a
                // sliver of map survived.
                style={styles.previewScroll}
                contentContainerStyle={styles.previewScrollContent}
                onScrollBeginDrag={() => handleUserInteraction('scroll')}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                <SelectedPlaceDetails
                  saved={selected}
                  allSavedPlaces={validPlaces}
                  // "Also nearby" routes through the SAME selection path a
                  // marker tap uses, by exact saved_places.id — so tapping a
                  // nearby save lands on the identical Place Detail V2.
                  onSelectNearby={(next) => {
                    handleUserInteraction('marker_press');
                    selectPlace(next);
                    setPreviewExpanded(true);
                  }}
                  onGetDirections={() => openExternalMaps(selected)}
                  // "See map" collapses back to the preview card so the pins
                  // are visible again. It is deliberately NOT a dismiss: the
                  // place stays selected and its marker stays focused, and the
                  // camera is not touched (79e5fba).
                  onSeeMap={() => setPreviewExpanded(false)}
                  onRequestDismiss={() => dismissSelectedPlace()}
                  onSaved={(updated) => setSelected(updated)}
                  onCorrected={focusCorrectedPlace}
                />
              </ScrollView>
            ) : (
              // Collapsed: quick directions + an explicit expander (in addition
              // to the slide-up gesture) so there's always a tap affordance.
              <>
                {/* A nearby-notification arrival is labelled, but it is NOT a
                    separate single-place experience: the notification opens
                    Place Detail V2 expanded, and "I went" / "Directions" live
                    there. This badge is only reachable if the user collapses
                    the sheet themselves. */}
                {isNearbyReminderSelection ? (
                  <View style={styles.reminderContextWrap}>
                    <View style={styles.reminderBadge}>
                      <Text style={styles.reminderBadgeText}>Nearby reminder</Text>
                    </View>
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
                    style={styles.previewPrimaryAction}
                  />
                </View>
                {/* Reminder LIFECYCLE, not place detail: declining the third
                    opportunity archives the reminder (MAX_REMINDER_OPPORTUNITIES).
                    "I went" moved into Place Detail V2, but this has no home
                    there — V2's "Not yet" is deliberately inert — so it stays
                    reachable here rather than being silently destroyed. */}
                {isNearbyReminderSelection ? (
                  <Pressable
                    onPress={() => void handleNearbyReminderDismiss()}
                    disabled={reminderActionBusy}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Not this time — stop reminding me about ${selected.place.name} for now`}
                    style={styles.reminderAdjustRow}
                  >
                    <Text style={styles.reminderAdjustText}>Maybe next time</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => {
                    setPreviewExpanded(true);
                    if (__DEV__) console.log('[map-sheet] expanded');
                  }}
                  hitSlop={10}
                  style={styles.previewSecondaryRow}
                >
                  <Text style={styles.previewSecondaryText}>Swipe up for details</Text>
                  <Feather name="chevron-up" size={16} color={colors.textSecondary} />
                </Pressable>
              </>
            )}
          </Card>
        </Animated.View>
      ) : null}

      {mapGroupRequest && resolvedMapGroup.places.length > 0 && !previewExpanded ? (
        <View
          style={[
            styles.mapGroupWrap,
            { bottom: (selected ? 248 : Spacing.lg) + insets.bottom },
          ]}
          onLayout={(event) => setMapGroupSelectorHeight(event.nativeEvent.layout.height)}
        >
          <MapGroupSelector
            places={resolvedMapGroup.places}
            selectedId={selected?.id ?? null}
            missingCoordinateIds={new Set(resolvedMapGroup.missingCoordinateIds)}
            failedCount={mapGroupRequest.failedCount}
            onSelect={selectMapGroupPlace}
            onViewAll={fitCurrentMapGroup}
            onClose={closeMapGroup}
          />
        </View>
      ) : null}

      {/* Map-first top chrome: floating search bar + filter chips. Rendered
          as a box-none overlay so only the bar/chips capture touches and the
          rest of the map stays pannable underneath. Hidden while the search
          dropdown is open so there is only ever ONE visible search input. */}
      {!searchVisible && shouldShowMapControls ? (
        <View style={styles.topChrome} pointerEvents="box-none">
          <MapTopSearchBar
            onPress={() => setSearchVisible(true)}
            offline={offline}
          />
          <MapCategoryFilterBar
            options={mapFilterChoices}
            value={mapCategoryFilter}
            onChange={handleSelectMapCategory}
            onFitAll={visiblePlaces.length > 0 && !mapPreview ? fitVisiblePlaces : undefined}
          />
        </View>
      ) : null}

      {/* The Queue is the user's INBOX, not map-selection chrome, so it is
          deliberately NOT gated on `shouldShowMapControls`. It used to live
          inside the block above and vanished with the search bar and filter
          chips whenever the detail sheet was expanded — tolerable when that
          sheet was a small floating card, but the expanded detail is now a
          real surface people sit in, and pending shares became unreachable
          without first closing the place. It keeps its exact previous position
          (below the filter row, left-aligned) so nothing else moves, and it
          still hides behind the search dropdown, which owns the whole screen.
          Regression covered by scripts/testMapQueueEntryPoint.ts. */}
      {!searchVisible ? (
        <View
          style={[
            styles.queueChrome,
            // Its usual slot sits under the filter row, which on a short phone
            // (375×667) is below the expanded sheet's top edge. When the sheet
            // is up, the search bar and chips are hidden anyway, so the pill
            // takes that now-empty top row instead of floating over the sheet.
            !shouldShowMapControls && styles.queueChromeRaised,
          ]}
          pointerEvents="box-none"
        >
          <ShareQueueButton />
        </View>
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
      {selected || mapGroupRequest ? null : (
        <MapBottomSheet
          mode={sheetMode}
          loading={liveLoading}
          offline={offline}
          nearbyPlaces={nearbyPlaces}
          locationState={locationState}
          recentPlaces={recentPlaces}
          savedPlaces={validPlaces}
          partialHeight={sheetPartialHeight}
          availableHeight={availableHeight}
          topInset={safeTopInset + topChromeClearance + Spacing.md}
          openSignal={sheetOpenSignal}
          minimizeSignal={sheetMinimizeSignal}
          onSnapChange={handleSheetSnapChange}
          onRequestSavedMode={() => setSheetMode('saved')}
          onSelectPlace={selectPlace}
          onGetDirections={openExternalMaps}
          onSaveFromLink={() => router.push('/share')}
          onSearchManually={() => router.push('/add-place')}
          requestLocationPermission={requestLocationPermission}
        />
      )}

      {/* Compact place-search dropdown — searches REAL places (Google Places
          via usePlacesSearch), not saved places. Tapping a result direct-saves
          it to the map with the automatic category radius (no add-place screens). */}
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
        bottomOffset={
          (selected
            ? 264
            : mapGroupRequest
              ? mapGroupSelectorHeight + Spacing.xl
              : Spacing.lg + 4) + insets.bottom
        }
        actionLabel={snackbar?.undoId ? 'Undo' : undefined}
        onAction={
          snackbar?.undoId ? () => void handleUndoSave(snackbar.undoId as string) : undefined
        }
        token={snackbar?.id}
        onDismiss={() => setSnackbar(null)}
      />
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
  insetTop: number,
  topChromeClearance: number,
) {
  // Top-anchored overlays clear the floating chrome (search bar + chips) AND
  // the top safe area now that the Map header is hidden.
  const pillTop = insetTop + topChromeClearance;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  topChrome: {
    position: 'absolute',
    top: insetTop + Spacing.md,
    left: Spacing.lg,
    right: Spacing.lg,
  },

  // Exactly where the Queue pill sat when it was the third child of
  // `topChrome`: search bar (50) + gap + filter row (38). The pill supplies
  // its own top margin, so this lands it pixel-identically to before while
  // letting it outlive the selection-gated chrome above.
  queueChrome: {
    position: 'absolute',
    top: insetTop + Spacing.md + 50 + Spacing.sm + 38,
    left: Spacing.lg,
  },
  // Sheet-up placement: the top row, right-aligned so it reads as a floating
  // map action rather than a headless search bar. `left: 'auto'` undoes the
  // base rule's left anchor.
  queueChromeRaised: {
    top: insetTop,
    left: 'auto',
    right: Spacing.lg,
  },

  mapGroupWrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
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
    textAlign: 'center',
  },
  emptyPillAction: {
    marginTop: Spacing.xs,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPillActionText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },

  previewWrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.lg,
  },
  previewWrapExpanded: {
    left: 0,
    right: 0,
    bottom: 0,
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
  // Rounded top only, hairline top border, no side/bottom edges — the sheet
  // is continuous with the bottom of the screen.
  previewCardExpanded: {
    borderRadius: 0,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    // Top padding is carried by the handle row; the body's own scroll padding
    // clears the tab bar at the bottom.
    paddingTop: 0,
    paddingBottom: 0,
  },
  previewHandleWrap: {
    alignItems: 'center',
    justifyContent: 'center',
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
  previewTitle: {
    flex: 1,
    minWidth: 0,
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
  // Collapsed preview: a normal 44pt control in the header row.
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Expanded: overlaid on the handle line at 30pt so it never claims a band of
  // its own. `hitSlop={12}` keeps the real target at 54pt.
  closeBtnFloating: {
    position: 'absolute',
    right: 0,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  controlPressed: { opacity: 0.7 },
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
  previewScroll: { flex: 1 },
  previewScrollContent: {
    paddingTop: Spacing.xs,
    // The expanded sheet has no bottom padding of its own, so the last section
    // clears the tab bar from here rather than sliding under it.
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
