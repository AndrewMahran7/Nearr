import { Image } from 'react-native';
import { offlineFixtureByPlaceId } from '../onboarding/fixtures/offlineOnboardingFixtures';
import { offlineOnboardingMedia } from '../onboarding/assets/offlineOnboardingAssets';

/** Only exact local tutorial identities can use bundled destination imagery. */
export function offlineSavedPlacePhoto(placeId: string): string | null {
  const fixture = offlineFixtureByPlaceId(placeId);
  if (!fixture) return null;
  const asset = offlineOnboardingMedia(fixture.assetKey).placePhotoAssets[0];
  return asset ? Image.resolveAssetSource(asset)?.uri ?? null : null;
}
