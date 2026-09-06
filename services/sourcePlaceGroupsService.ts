import {
  sourcePlaceGroupForAnchor,
  sourcePlaceGroupFromSeeds,
  type SourcePlaceGroup,
} from '@/lib/sourcePlaceGroup';
import { listSavedPlaces } from '@/services/savedPlacesService';
import type { SavedPlaceWithPlace } from '@/types';

/**
 * Cold-start query for one saved place's current source-video group.
 * `listSavedPlaces` hydrates both saved rows and `saved_place_sources`, so this
 * has the exact same membership semantics as the already-mounted map.
 */
export async function getSourcePlaceGroupForSavedPlace(
  savedPlaceId: string,
): Promise<SourcePlaceGroup<SavedPlaceWithPlace> | null> {
  const places = await listSavedPlaces();
  const anchor = places.find((place) => place.id === savedPlaceId);
  return sourcePlaceGroupForAnchor(anchor, places);
}

/** Resolve an incoming notification/share batch to live durable membership. */
export async function getSourcePlaceGroupFromSeeds(
  savedPlaceIds: readonly string[],
): Promise<SourcePlaceGroup<SavedPlaceWithPlace> | null> {
  const places = await listSavedPlaces();
  return sourcePlaceGroupFromSeeds(places, savedPlaceIds);
}
