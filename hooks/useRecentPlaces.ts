/**
 * useRecentPlaces — shared "recently saved" helper.
 *
 * `useSavedPlaces()` (via `listSavedPlaces()`) already returns saved places
 * newest-first, so "recently saved" is just the head of that list. This hook
 * centralizes the slice so Home and the upcoming map-first bottom sheet share
 * one definition instead of each calling `data.slice(0, n)`.
 *
 * Intentionally does NOT re-sort: changing the ordering here would diverge from
 * the server-defined order the rest of the app relies on.
 */

import { useMemo } from 'react';

import type { SavedPlaceWithPlace } from '@/types';

export function useRecentPlaces(
  places: SavedPlaceWithPlace[],
  limit?: number,
): SavedPlaceWithPlace[] {
  return useMemo(
    () => (typeof limit === 'number' ? places.slice(0, limit) : places),
    [places, limit],
  );
}
