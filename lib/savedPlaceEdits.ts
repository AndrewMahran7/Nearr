import type { RadiusUnit, SavedPlaceWithPlace } from '@/types';

export type SavedPlaceEditablePatch = {
  radius_value?: number | null;
  radius_unit?: RadiusUnit | null;
  notifications_enabled?: boolean;
  notes?: string | null;
};

export function applySavedPlaceEdit(
  saved: SavedPlaceWithPlace,
  patch: SavedPlaceEditablePatch,
): SavedPlaceWithPlace {
  return { ...saved, ...patch };
}