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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

// iOS uses the default provider (Apple Maps) — the Google Maps iOS SDK
// requires the `AirGoogleMaps` Xcode subproject, which we don't link in
// our managed/EAS build. Android keeps PROVIDER_GOOGLE since the Google
// Maps Android SDK is wired via app.json `android.config.googleMaps`.
const MAP_PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined;

import { Button, Card, DemoModeBanner, MapFallbackList } from '@/components';
import { Colors, Radius, Spacing, Typography } from '@/constants';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import { openExternalMaps as openInExternalMaps } from '@/lib/externalMaps';
import { trackEvent } from '@/lib/analytics';
import { milesToMeters, minutesToMeters } from '@/lib/geo';
import { getDemoSeededSavedPlacesSync } from '@/services/demo';
import { getProfile } from '@/services/profileService';
import type { Profile, SavedPlaceWithPlace } from '@/types';

// Default radius used when neither the saved place nor the profile specify one.
// Matches the V1 default surfaced in add-place.tsx.
const DEFAULT_RADIUS_MILES = 1;

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

export default function MapScreen() {
  const router = useRouter();
  // Optional deep-link param: when present, the map should center on this
  // saved place and open its preview card. Set by "Show on map" actions on
  // the place detail screen and saved-place cards. We track the last id we
  // already handled in `handledTargetIdRef` so we don't re-animate every
  // render or fight the user's panning.
  const { savedPlaceId: rawSavedPlaceId } = useLocalSearchParams<{
    savedPlaceId?: string | string[];
  }>();
  const savedPlaceId = Array.isArray(rawSavedPlaceId)
    ? rawSavedPlaceId[0]
    : rawSavedPlaceId;
  const { data: liveData, loading: liveLoading, refresh } = useSavedPlaces();
  const mapRef = useRef<MapView | null>(null);
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
  // The richer per-render state log lives further below.
  if (mapPreview && __DEV__) {
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
  const didFitRef = useRef(false);
  // Tracks which `savedPlaceId` deep-link we've already focused on. Reset
  // implicitly when the param changes to a new id so coming back to the
  // same place from a different card still triggers the focus animation.
  const handledTargetIdRef = useRef<string | null>(null);

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
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
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
  useFocusEffect(
    useCallback(() => {
      void refresh();
      void trackEvent('map_opened', {});
    }, [refresh]),
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
  // Map Preview Mode uses a hard-coded Santa Cruz region so the map always
  // has a valid camera target on first paint, regardless of seed loading.
  const PREVIEW_INITIAL_REGION: Region = {
    latitude: 36.9741,
    longitude: -122.0308,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  };
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

  // ---- once we have data + a ready map, fit the camera to all zones ----
  // Guarded by `mapReady` so we never call into the native map before the
  // view is fully wired up. Skipped in Map Preview Mode — the static
  // `initialRegion` is the single source of truth there.
  //
  // We frame the *zones* (marker + radius bubble), not just the pins. This
  // is what makes the screen read as Life360-style coverage instead of a
  // tightly-zoomed pin. For a single place this means the whole circle is
  // visible on first paint; for many it means none of the bubbles get
  // clipped at the screen edge.
  useEffect(() => {
    if (mapPreview) return;
    if (!mapReady) return;
    if (didFitRef.current) return;
    if (!mapRef.current) return;
    if (validPlaces.length === 0) return;

    const coords = allZoneBoundingCoords(validPlaces, profile);
    if (coords.length === 0) return;
    didFitRef.current = true;
    try {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 100, right: 100, bottom: 180, left: 100 },
        animated: true,
      });
    } catch (e) {
      if (__DEV__) console.debug('[map] fitToCoordinates skipped', e);
    }
  }, [validPlaces, mapPreview, mapReady, profile]);

  // When we acquire a GPS fix *after* the map has mounted (and we haven't
  // already fit to the saved-places set), gently animate the camera there.
  useEffect(() => {
    if (mapPreview) return;
    if (!mapReady) return;
    if (!userRegion) return;
    if (didFitRef.current) return;
    if (validPlaces.length > 0) return; // fit-to-coords path will handle it
    try {
      mapRef.current?.animateToRegion(userRegion, 400);
    } catch (e) {
      if (__DEV__) console.debug('[map] animateToRegion skipped', e);
    }
  }, [userRegion, mapReady, mapPreview, validPlaces.length]);

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
    if (!mapReady) return;
    if (!savedPlaceId) return;
    if (handledTargetIdRef.current === savedPlaceId) return;
    if (validPlaces.length === 0) return; // wait for data to arrive
    const target = validPlaces.find((p) => p.id === savedPlaceId);
    if (!target) {
      // Unknown id (e.g. deleted on another device). Mark as handled so we
      // don't keep scanning, but don't move the camera.
      handledTargetIdRef.current = savedPlaceId;
      if (__DEV__) console.log('[map] target id not found', savedPlaceId);
      return;
    }
    handledTargetIdRef.current = savedPlaceId;
    didFitRef.current = true;
    setSelected(target);
    try {
      const coords = radiusBoundingCoords(
        target.place.latitude,
        target.place.longitude,
        effectiveRadiusMeters(target, profile),
      );
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 100, right: 100, bottom: 220, left: 100 },
        animated: true,
      });
    } catch (e) {
      if (__DEV__) console.debug('[map] focus target skipped', e);
    }
  }, [savedPlaceId, mapReady, validPlaces, profile]);

  // ---- DEBUG ------------------------------------------------------------
  // Temporary verbose logs requested while diagnosing the "spinner forever"
  // bug. Cheap and dev-only; remove once the map is reliable.
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[map] state', {
      savedPlacesLoading: liveLoading,
      savedPlacesLength: data.length,
      validPlacesLength: validPlaces.length,
      locationPermissionState: permission,
      currentLocationLoading,
      mapReady,
      initialRegion,
      markersRendered: validPlaces.length,
      mapPreview,
    });
  }

  // -----------------------------------------------------------------------
  function openExternalMaps(item: SavedPlaceWithPlace) {
    void trackEvent('open_in_maps_tapped', {
      saved_place_id: item.id,
      google_place_id: item.place.google_place_id ?? null,
      surface: 'map_preview_card',
    });
    void openInExternalMaps(item.place);
  }

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

  // -----------------------------------------------------------------------
  if (demo) {
    return (
      <View style={styles.container}>
        <View style={{ padding: Spacing.lg, paddingBottom: 0 }}>
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
    <View style={styles.container}>
      {/* MapView ALWAYS mounts. Empty / loading / no-GPS states render as
          non-blocking overlays on top of the map — never as replacements
          for it. This is what makes the screen feel alive instead of a
          spinner-trapped shell. */}
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        // Only show the user dot when we actually have a fix. Toggling
        // `showsUserLocation` on without a usable provider can leave the
        // Google Maps Android view in a "loading" state.
        showsUserLocation={!mapPreview && permission === 'granted' && !!userRegion}
        showsMyLocationButton={!mapPreview && permission === 'granted' && !!userRegion}
        initialRegion={initialRegion}
        onMapReady={() => setMapReady(true)}
        onPress={() => setSelected(null)}
      >
        {/* Life360-style zone bubbles. Rendered as a separate pass before
            markers so marker pins always sit on top of their own circle.
            Stroke is intentionally darker than the fill so the boundary
            reads clearly on satellite, dark, and light map tiles alike. */}
        {validPlaces.map((p) => (
          <Circle
            key={`circle-${p.id}`}
            center={{
              latitude: p.place.latitude,
              longitude: p.place.longitude,
            }}
            radius={effectiveRadiusMeters(p, profile)}
            strokeColor="rgba(0,0,0,0.35)"
            strokeWidth={2}
            fillColor="rgba(0,0,0,0.10)"
          />
        ))}
        {validPlaces.map((p) => (
          <Marker
            key={p.id}
            identifier={p.id}
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
            title={p.place.name}
            description={p.place.formatted_address ?? undefined}
            onPress={(e) => {
              e.stopPropagation?.();
              void trackEvent('place_marker_tapped', {
                saved_place_id: p.id,
                google_place_id: p.place.google_place_id ?? null,
              });
              setSelected(p);
              focusZone(p);
            }}
          >
            {/* "Home base" pin: a soft halo around a solid dot reinforces
                that this is the center of the zone, not just a pin drop.
                Static (no animation) to keep V1 light. */}
            <View style={styles.markerWrap}>
              <View style={styles.markerHalo} />
              <View style={styles.markerDot} />
            </View>
          </Marker>
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
        <View style={styles.previewWrap} pointerEvents="box-none">
          <Card style={styles.previewCard}>
            <View style={styles.previewHeader}>
              <Text style={Typography.heading} numberOfLines={1}>
                {selected.place.name}
              </Text>
              <Pressable
                onPress={() => setSelected(null)}
                hitSlop={12}
                style={styles.closeBtn}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {selected.place.formatted_address ? (
              <Text style={[Typography.caption, styles.muted]} numberOfLines={2}>
                {selected.place.formatted_address}
              </Text>
            ) : null}
            {selected.place.category ? (
              <Text style={[Typography.caption, styles.muted, { marginTop: 2 }]}>
                {selected.place.category}
              </Text>
            ) : null}
            <View style={styles.previewActions}>
              <Button
                title="Open in Maps"
                variant="secondary"
                onPress={() => openExternalMaps(selected)}
                style={{ flex: 1 }}
              />
              <View style={{ width: Spacing.sm }} />
              <Button
                title="View details"
                onPress={() => {
                  const id = selected.id;
                  setSelected(null);
                  router.push(`/place/${id}`);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        </View>
      ) : null}

      {/* FAB → Save Place. Hidden while a preview card is showing so the
          two don't overlap on small screens. */}
      {selected ? null : (
        <Pressable
          style={styles.fab}
          onPress={() => router.push('/add-place')}
          accessibilityLabel="Save a place"
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  markerWrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerHalo: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  markerDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#fff',
  },

  locPill: {
    position: 'absolute',
    bottom: Spacing.lg + 4,
    left: Spacing.lg,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.textMuted,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  locPillText: {
    ...Typography.caption,
    color: Colors.text,
  },

  banner: {
    position: 'absolute',
    top: Spacing.lg,
    left: Spacing.lg,
    right: Spacing.lg,
  },
  bannerCard: {},
  muted: { color: Colors.textMuted, marginTop: 2 },

  previewBadge: {
    position: 'absolute',
    top: Spacing.lg,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  previewBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },
  previewBadgeText: {
    ...Typography.caption,
    color: Colors.text,
    fontWeight: '600',
  },

  emptyPill: {
    position: 'absolute',
    top: Spacing.lg,
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.textMuted,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyPillText: {
    ...Typography.caption,
    color: Colors.text,
  },

  previewWrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.lg,
  },
  previewCard: {
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  closeText: {
    fontSize: 22,
    lineHeight: 22,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  previewActions: {
    flexDirection: 'row',
    marginTop: Spacing.md,
  },

  fab: {
    position: 'absolute',
    bottom: Spacing.lg + 4,
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabText: { color: Colors.textInverse, fontSize: 28, lineHeight: 30 },
});
