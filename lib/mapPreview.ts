/**
 * Map Preview Mode — dev-only switch for polishing the real `react-native-maps`
 * UI without Supabase, Google Places, or real device location.
 *
 * Enabled by `EXPO_PUBLIC_MAP_PREVIEW_MODE=true` AND `__DEV__ === true`. When
 * enabled:
 *   - Auth is bypassed with a fake `map-preview-user` (see `hooks/useAuth.ts`).
 *   - `services/savedPlacesService` reads return the seeded demo dataset
 *     (read-only path; writes still try the real Supabase client).
 *   - `services/placesService` short-circuits to local catalog matches.
 *   - The map screen renders the real `MapView` with markers + preview cards
 *     centered on a fixed Santa Cruz region; no location permission is
 *     requested.
 *
 * This is intentionally a SEPARATE switch from Demo Mode. Demo Mode swaps the
 * map for a list fallback (so the app runs without native map keys); Map
 * Preview Mode keeps the real map but skips the network surface.
 *
 * Production safety: `__DEV__` is false in production EAS / `expo export`
 * builds, so the flag is a no-op there. If the env var leaks into a non-dev
 * build we log a one-shot warning and ignore it.
 */

import type { Region } from 'react-native-maps';

const RAW = process.env.EXPO_PUBLIC_MAP_PREVIEW_MODE;
const REQUESTED = RAW === 'true' || RAW === '1';

let warnedProdLeak = false;

export const MAP_PREVIEW_USER = {
  id: 'map-preview-user',
  email: 'map-preview@nearr.local',
} as const;

/** Fixed region for Map Preview Mode — downtown Santa Cruz. */
export const MAP_PREVIEW_REGION: Region = {
  latitude: 36.9741,
  longitude: -122.0308,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

export function isMapPreviewMode(): boolean {
  if (!REQUESTED) return false;
  if (!__DEV__) {
    if (!warnedProdLeak) {
      // eslint-disable-next-line no-console
      console.warn(
        '[mapPreview] EXPO_PUBLIC_MAP_PREVIEW_MODE=true was set in a non-dev build — ignoring.',
      );
      warnedProdLeak = true;
    }
    return false;
  }
  return true;
}

/** Returns true if the env var was set (regardless of whether it took effect). */
export function isMapPreviewModeRequested(): boolean {
  return REQUESTED;
}
