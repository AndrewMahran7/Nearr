import type { ImageSourcePropType } from 'react-native';

import type { OfflineOnboardingAssetKey } from '../fixtures/offlineOnboardingFixtures';

export type OfflineOnboardingMediaPackage = {
  sourceVideoAsset: number;
  sourcePosterAsset: ImageSourcePropType;
  placePhotoAssets: readonly ImageSourcePropType[];
};

const OFFLINE_ONBOARDING_ASSETS: Record<OfflineOnboardingAssetKey, OfflineOnboardingMediaPackage> = {
  dorset_quarry: {
    sourceVideoAsset: require('../../assets/onboarding/authentic/dorset-quarry-loop.mp4'),
    sourcePosterAsset: require('../../assets/onboarding/authentic/dorset-quarry-poster.jpg'),
    placePhotoAssets: [
      require('../../assets/onboarding/authentic/dorset-quarry-poster.jpg'),
      require('../../assets/onboarding/authentic/dorset-quarry-place-2.jpg'),
    ],
  },
  mad_yolks: {
    sourceVideoAsset: require('../../assets/onboarding/authentic/mad-yolks-loop.mp4'),
    sourcePosterAsset: require('../../assets/onboarding/authentic/mad-yolks-poster.jpg'),
    placePhotoAssets: [
      require('../../assets/onboarding/authentic/mad-yolks-poster.jpg'),
      require('../../assets/onboarding/authentic/mad-yolks-place-2.jpg'),
    ],
  },
  hydra_old_town: {
    sourceVideoAsset: require('../../assets/onboarding/authentic/hydra-old-town-loop.mp4'),
    sourcePosterAsset: require('../../assets/onboarding/authentic/hydra-old-town-poster.jpg'),
    placePhotoAssets: [
      require('../../assets/onboarding/authentic/hydra-old-town-poster.jpg'),
      require('../../assets/onboarding/authentic/hydra-old-town-place-2.jpg'),
    ],
  },
  old_towne_shops_v2: {
    sourceVideoAsset: require('../../assets/onboarding/authentic/old-towne-shops-loop-v2.mp4'),
    sourcePosterAsset: require('../../assets/onboarding/authentic/old-towne-shops-poster-v2.png'),
    placePhotoAssets: [
      require('../../assets/onboarding/authentic/old-towne-shops-poster-v2.png'),
      require('../../assets/onboarding/authentic/old-towne-shops-place-v2.png'),
    ],
  },
};

export function offlineOnboardingMedia(key: OfflineOnboardingAssetKey): OfflineOnboardingMediaPackage {
  return OFFLINE_ONBOARDING_ASSETS[key];
}

/** Compatibility accessor for existing still-image surfaces. */
export function offlineOnboardingAsset(key: OfflineOnboardingAssetKey): ImageSourcePropType {
  return offlineOnboardingMedia(key).sourcePosterAsset;
}

export const OFFLINE_ONBOARDING_ASSET_KEYS = Object.freeze(
  Object.keys(OFFLINE_ONBOARDING_ASSETS) as OfflineOnboardingAssetKey[],
);
