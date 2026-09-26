import type { ImageSourcePropType } from 'react-native';

import type { OfflineOnboardingAssetKey } from '../fixtures/offlineOnboardingFixtures';

const OFFLINE_ONBOARDING_ASSETS: Record<OfflineOnboardingAssetKey, ImageSourcePropType> = {
  dorset_quarry: require('../../assets/onboarding/dorset-quarry-source-frame.jpg'),
  food_cafe: require('../../assets/onboarding/offline/food-cafe-poster.png'),
  travel_town: require('../../assets/onboarding/offline/travel-town-poster.png'),
};

export function offlineOnboardingAsset(key: OfflineOnboardingAssetKey): ImageSourcePropType {
  return OFFLINE_ONBOARDING_ASSETS[key];
}

export const OFFLINE_ONBOARDING_ASSET_KEYS = Object.freeze(
  Object.keys(OFFLINE_ONBOARDING_ASSETS) as OfflineOnboardingAssetKey[],
);
