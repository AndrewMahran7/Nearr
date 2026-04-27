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
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';

import { Button, Card, DemoModeBanner, MapFallbackList } from '@/components';
import { Colors, Radius, Spacing, Typography } from '@/constants';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import { getDemoSeededSavedPlacesSync } from '@/services/demo';
import type { SavedPlaceWithPlace } from '@/types';

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
  const didFitRef = useRef(false);
  // Controlled region — required so we can imperatively re-target the camera
  // once places load. `react-native-maps` will not always re-render markers
  // after initial mount unless the region prop is driven from state.
  const [region, setRegion] = useState<Region>(FALLBACK_REGION);

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
    }, [refresh]),
  );

  // ---- pick an initial region -------------------------------------------
  // Map Preview Mode uses a hard-coded Santa Cruz region so the map always
  // has a valid camera target on first paint, regardless of seed loading.
  const PREVIEW_INITIAL_REGION: Region = {
    latitude: 36.9741,
    longitude: -122.0308,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  };
  const initialRegion = useMemo<Region>(() => {
    if (mapPreview) return PREVIEW_INITIAL_REGION;
    if (userRegion) return userRegion;
    if (data.length > 0) {
      const first = data[0].place;
      return {
        latitude: first.latitude,
        longitude: first.longitude,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };
    }
    return FALLBACK_REGION;
  }, [mapPreview, userRegion, data]);

  // Keep the controlled `region` in sync with whatever the rest of this
  // component decides is the right initial target. In Map Preview Mode this
  // also force-pushes the Santa Cruz region the moment seeded places appear,
  // which is what unsticks the marker layer on first paint.
  useEffect(() => {
    if (mapPreview && places.length > 0) {
      setRegion(PREVIEW_INITIAL_REGION);
      return;
    }
    setRegion(initialRegion);
    // PREVIEW_INITIAL_REGION is a stable literal declared above; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapPreview, places.length, initialRegion]);

  // ---- once we have data + a map, fit the camera to all markers --------
  // NOTE: completely skipped in Map Preview Mode — the controlled `region`
  // above is the single source of truth there, and didFitRef would otherwise
  // block the seeded markers from showing.
  useEffect(() => {
    if (mapPreview) return;
    if (didFitRef.current) return;
    if (!mapRef.current) return;
    if (validPlaces.length === 0) return;

    const coords = validPlaces.map((s) => ({
      latitude: s.place.latitude,
      longitude: s.place.longitude,
    }));
    // Guard: fitToCoordinates throws on an empty array; we already checked
    // length above, but double-check after the map() in case of any future
    // refactor.
    if (coords.length === 0) return;
    didFitRef.current = true;
    // Defer to next tick so markers are mounted and the map ref is fully
    // wired up natively.
    setTimeout(() => {
      if (!mapRef.current) return;
      try {
        mapRef.current.fitToCoordinates(coords, {
          edgePadding: { top: 100, right: 80, bottom: 180, left: 80 },
          animated: true,
        });
      } catch (e) {
        if (__DEV__) console.debug('[map] fitToCoordinates skipped', e);
      }
    }, 250);
  }, [validPlaces, mapPreview]);

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
      mapRegion: region,
      markersRendered: validPlaces.length,
      mapPreview,
    });
  }

  // -----------------------------------------------------------------------
  function openExternalMaps(item: SavedPlaceWithPlace) {
    const url =
      item.place.google_maps_url ??
      `https://www.google.com/maps/search/?api=1&query=${item.place.latitude},${item.place.longitude}`;
    Linking.openURL(url).catch((e) => console.warn('[map] openURL failed', e));
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
      {/* Defer mounting MapView until we actually have valid places to draw.
          This avoids the react-native-maps quirk where markers added after
          the first frame are silently dropped. The `key` ties the MapView's
          identity to the dataset size, so any change forces a clean remount
          and a guaranteed marker pass. */}
      {validPlaces.length > 0 ? (
        <MapView
          key={`map-${validPlaces.length}`}
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          // Only show the user dot when we actually have a fix. Toggling
          // `showsUserLocation` on without a usable provider can leave the
          // Google Maps Android view in a "loading" state.
          showsUserLocation={!mapPreview && permission === 'granted' && !!userRegion}
          showsMyLocationButton={!mapPreview && permission === 'granted' && !!userRegion}
          region={region}
          onRegionChangeComplete={setRegion}
          onPress={() => setSelected(null)}
        >
          {validPlaces.map((p) => (
            <Marker
              key={p.id}
              identifier={p.id}
              coordinate={{
                latitude: p.place.latitude,
                longitude: p.place.longitude,
              }}
              title={p.place.name}
              description={p.place.formatted_address ?? undefined}
              onPress={(e) => {
                e.stopPropagation?.();
                setSelected(p);
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: '#111',
                  borderWidth: 2,
                  borderColor: '#fff',
                }}
              />
            </Marker>
          ))}
        </MapView>
      ) : null}

      {/* Fallback when no valid places are available. Distinguishes between
          "still loading" and "loaded zero places" so the user isn't stuck
          looking at a blank screen. */}
      {validPlaces.length === 0 ? (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <Text style={styles.emptyText}>
            {liveLoading ? 'Loading places…' : 'No places loaded'}
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

  emptyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...Typography.body,
    color: Colors.text,
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    overflow: 'hidden',
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
