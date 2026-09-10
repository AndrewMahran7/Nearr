import type { ImageSourcePropType } from 'react-native';

/** Curated, answer-free frames taken from the exact tutorial source media. */
const EXACT_SOURCE_FRAMES: Record<string, ImageSourcePropType> = {
  C9Z963muLHI: require('../assets/onboarding/dorset-quarry-source-frame.jpg'),
};

export function onboardingTutorialSourceAsset(contentId: string): ImageSourcePropType | null {
  return EXACT_SOURCE_FRAMES[contentId] ?? null;
}
