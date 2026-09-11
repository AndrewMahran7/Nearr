import { createCandidatePhotoCache } from '@/lib/candidatePresentation';
import { getCandidatePhotoUrls } from '@/services/placesService';

const cache = createCandidatePhotoCache(
  (googlePlaceId) => getCandidatePhotoUrls(googlePlaceId, { maxPhotos: 5, maxPhotoWidth: 1000 }),
);

export const getCachedCandidatePhotoUrls = cache.get;
export const getCachedCandidatePhotoUrlsWithOutcome = cache.getWithOutcome;
export const invalidateCandidatePhotoUrls = cache.invalidate;
