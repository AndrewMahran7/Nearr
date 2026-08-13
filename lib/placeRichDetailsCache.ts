import {
  getPlaceRichDetails,
  type PlaceRichDetails,
} from '@/services/placesService';
import { createAsyncValueCache } from '@/lib/asyncValueCache';

export const getCachedPlaceRichDetails = createAsyncValueCache<PlaceRichDetails>(
  (googlePlaceId) =>
    getPlaceRichDetails(googlePlaceId, {
      maxPhotos: 5,
      maxPhotoWidth: 1000,
    }),
  (googlePlaceId, error) => {
      console.debug('[places] rich details unavailable', {
        googlePlaceId,
        message: error instanceof Error ? error.message : String(error),
      });
  },
);

/** Drop cached photos/phone/website for a place (e.g. after a correction). */
export function invalidatePlaceRichDetails(googlePlaceId: string | null | undefined): void {
  const key = (googlePlaceId ?? '').trim();
  if (key) getCachedPlaceRichDetails.invalidate(key);
}