/**
 * useNearbyPlaces — shared "places near you" data layer.
 *
 * Encapsulates the location-permission + current-position + distance-sort
 * logic that Home and Places previously each implemented inline (and that the
 * upcoming map-first bottom sheet would otherwise copy a fourth time).
 *
 * Behavior notes (kept identical to the previous inline implementations):
 *   - Home only *checks* existing foreground permission (never prompts), so it
 *     passes `requestPermission: false` (the default).
 *   - Places *requests* permission when the user opens the Nearby filter, so it
 *     passes `requestPermission: true`.
 *   - Distance uses the existing great-circle helper in `lib/geo`.
 *   - Places with missing / non-finite coordinates are skipped.
 *   - The list is sorted nearest-first and optionally truncated to `limit`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';

import {
  nearbyPlacesForLocation,
  type NearbyCoordinates,
  type NearbyPlace,
} from '@/lib/nearbyPlaces';
import type { SavedPlaceWithPlace } from '@/types';

export { nearbyPlacesForLocation } from '@/lib/nearbyPlaces';
export type { NearbyPlace } from '@/lib/nearbyPlaces';

export type NearbyLocationState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'permission_denied'
  | 'unavailable'
  | 'error';

export type UseNearbyPlacesOptions = {
  /** Maximum number of nearby places to return. Unlimited when omitted. */
  limit?: number;
  /**
   * When false, the hook will not auto-load location. Defaults to true.
   * (`refreshLocation()` always loads regardless of this flag.)
   */
  enabled?: boolean;
  /**
   * When true, prompt for foreground permission if it isn't already granted.
   * When false (default), only read the existing permission — never prompt.
   */
  requestPermission?: boolean;
};

export type UseNearbyPlacesResult = {
  location: NearbyCoordinates | null;
  nearbyPlaces: NearbyPlace[];
  locationState: NearbyLocationState;
  error: string | null;
  refreshLocation: () => Promise<void>;
  requestLocationPermission: () => Promise<boolean>;
};

export function useNearbyPlaces(
  places: SavedPlaceWithPlace[],
  options?: UseNearbyPlacesOptions,
): UseNearbyPlacesResult {
  const limit = options?.limit;
  const enabled = options?.enabled ?? true;
  const requestPermission = options?.requestPermission ?? false;

  const [location, setLocation] = useState<NearbyCoordinates | null>(null);
  const [locationState, setLocationState] = useState<NearbyLocationState>('idle');
  const [error, setError] = useState<string | null>(null);

  // Avoid setting state after unmount (location calls are async).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadLocation = useCallback(async (forcePermissionRequest = false): Promise<boolean> => {
    if (!mountedRef.current) return false;
    setLocationState('loading');
    setError(null);
    try {
      const existing = await Location.getForegroundPermissionsAsync();
      let status = existing.status;
      if (status !== 'granted' && (requestPermission || forcePermissionRequest)) {
        const requested = await Location.requestForegroundPermissionsAsync();
        status = requested.status;
      }

      if (status !== 'granted') {
        if (!mountedRef.current) return false;
        setLocation(null);
        setLocationState('permission_denied');
        return false;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!mountedRef.current) return false;
      setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setLocationState('ready');
      return true;
    } catch (e) {
      if (!mountedRef.current) return false;
      setLocation(null);
      setLocationState('unavailable');
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [requestPermission]);

  const refreshLocation = useCallback(async () => {
    await loadLocation();
  }, [loadLocation]);

  const requestLocationPermission = useCallback(async () => {
    return await loadLocation(true);
  }, [loadLocation]);

  // Auto-load once when enabled and we haven't resolved location yet. Re-entry
  // (e.g. switching back to the Nearby filter) is driven by `refreshLocation`.
  useEffect(() => {
    if (!enabled) return;
    if (locationState !== 'idle') return;
    void loadLocation();
  }, [enabled, locationState, loadLocation]);

  const nearbyPlaces = useMemo<NearbyPlace[]>(() => {
    return nearbyPlacesForLocation(places, location, limit);
  }, [location, places, limit]);

  return { location, nearbyPlaces, locationState, error, refreshLocation, requestLocationPermission };
}
