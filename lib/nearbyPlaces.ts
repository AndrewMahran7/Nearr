import { distanceMeters } from './geo';
import { getEffectiveNearbyNotificationRadiusMeters } from './nearbyEligibility';
import type { SavedPlaceWithPlace } from '../types';

export type NearbyPlace = SavedPlaceWithPlace & { distanceMeters: number };
export type NearbyCoordinates = { latitude: number; longitude: number };

/** The saved-place Nearby contract: inside its effective radius, then nearest first. */
export function nearbyPlacesForLocation(
  places: SavedPlaceWithPlace[],
  location: NearbyCoordinates | null,
  limit?: number,
): NearbyPlace[] {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return [];
  const nearby = places
    .filter((saved) =>
      !!saved.place
      && Number.isFinite(saved.place.latitude)
      && Number.isFinite(saved.place.longitude),
    )
    .map((saved) => ({
      ...saved,
      distanceMeters: distanceMeters(
        location,
        { latitude: saved.place.latitude, longitude: saved.place.longitude },
      ),
    }))
    .filter((saved) =>
      Number.isFinite(saved.distanceMeters)
      && saved.distanceMeters <= getEffectiveNearbyNotificationRadiusMeters(saved),
    )
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  return typeof limit === 'number' ? nearby.slice(0, limit) : nearby;
}
