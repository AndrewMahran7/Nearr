import { createPlaceRecommendationsLoader } from '../lib/placeRecommendationsLoader';
import { searchNearbyPlaces } from './placesService';

export type { PlaceRecommendationsInput } from '../lib/placeRecommendationsLoader';
export { createPlaceRecommendationsLoader } from '../lib/placeRecommendationsLoader';

/** Runtime recommendations loader backed by the existing Google provider. */
export const loadPlaceRecommendations = createPlaceRecommendationsLoader(searchNearbyPlaces);
