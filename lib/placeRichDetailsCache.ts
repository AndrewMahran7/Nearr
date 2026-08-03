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