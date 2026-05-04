/**
 * Demo services barrel. Imports here always work — the gate that decides
 * whether to *call* them lives in `lib/demoMode.ts` (`isDemoMode()`).
 */

import { resetDemoProfile } from './profileService';
import { resetDemoSavedPlaces } from './savedPlacesService';

export {
  getDemoProfile,
  updateDemoProfile,
  resetDemoProfile,
} from './profileService';

export {
  searchDemoPlaces,
  getDemoPlaceDetails,
} from './placesService';

export {
  listDemoSavedPlaces,
  getDemoSavedPlace,
  saveDemoSavedPlace,
  updateDemoSavedPlace,
  deleteDemoSavedPlace,
  resetDemoSavedPlaces,
  getDemoSeededSavedPlacesSync,
  markDemoVisited,
  markDemoArchived,
  unarchiveDemo,
} from './savedPlacesService';

export { simulateDemoNearbyNotification } from './notifications';

export async function resetAllDemoData(): Promise<void> {
  await Promise.all([resetDemoProfile(), resetDemoSavedPlaces()]);
  console.log('[demo] full reset complete');
}
