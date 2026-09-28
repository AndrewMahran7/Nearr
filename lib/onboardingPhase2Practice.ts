import type { OnboardingInterest, OnboardingTutorialFixture } from './onboardingV2Core';
import {
  onboardingCategoryForInterest,
  type OfflineOnboardingAssetKey,
  type OfflineOnboardingCategory,
} from '../onboarding/fixtures/offlineOnboardingFixtures';

export type OnboardingPhase2PracticeSource = {
  internalSourceId: string;
  contentId: string;
  expectedPlaceName: string;
  expectedPlaceAddress: string;
  canonicalUrl: string;
  category: OfflineOnboardingCategory;
  localPreviewAssetKey: OfflineOnboardingAssetKey;
  provenanceUrl: string;
  revision: number;
};

/**
 * Versioned, public Phase 2 exercises. The source URL is only an identity and
 * launch target: a fresh user-owned share job still performs ordinary cache /
 * recognition safety checks and the expected place is never auto-committed.
 */
export const ONBOARDING_PHASE2_PRACTICE_BY_CATEGORY: Record<
  OfflineOnboardingCategory,
  OnboardingPhase2PracticeSource
> = {
  food: {
    internalSourceId: 'instagram-2nd-floor-post',
    contentId: 'dypcd2zbtsz',
    expectedPlaceName: '2nd Floor',
    expectedPlaceAddress: '126 Main St, Huntington Beach',
    canonicalUrl: 'https://www.instagram.com/p/DYpcd2ZBTsZ/',
    category: 'food',
    localPreviewAssetKey: 'mad_yolks',
    provenanceUrl: 'repository recognition regression corpus',
    revision: 2,
  },
  outdoors: {
    internalSourceId: 'instagram-dorset-quarry-post',
    contentId: 'c9z963mulhi',
    expectedPlaceName: 'Dorset Marble Quarry',
    expectedPlaceAddress: '1848 VT-30, Dorset, VT',
    canonicalUrl: 'https://www.instagram.com/reel/C9Z963muLHI/',
    category: 'outdoors',
    localPreviewAssetKey: 'dorset_quarry',
    provenanceUrl: 'repository tutorial fixture manifest',
    revision: 2,
  },
  travel: {
    internalSourceId: 'instagram-dorset-quarry-destination-post',
    contentId: 'c9z963mulhi',
    expectedPlaceName: 'Dorset Marble Quarry',
    expectedPlaceAddress: '1848 VT-30, Dorset, VT',
    canonicalUrl: 'https://www.instagram.com/reel/C9Z963muLHI/',
    category: 'travel',
    localPreviewAssetKey: 'dorset_quarry',
    provenanceUrl: 'repository tutorial fixture manifest',
    revision: 2,
  },
  shopping: {
    internalSourceId: 'instagram-country-roads-antiques-post',
    contentId: 'cm2qchdn2nk',
    expectedPlaceName: 'Country Roads Antiques',
    expectedPlaceAddress: '204 W Chapman Ave, Orange, CA',
    canonicalUrl: 'https://www.instagram.com/p/CM2QChDn2Nk/',
    category: 'shopping',
    localPreviewAssetKey: 'old_towne_shops_v2',
    provenanceUrl: 'https://www.octa.net/getting-around/rail/metrolink/metrolink-weekends/overview/orange-daycation/old-towne-orange-antiquing/',
    revision: 2,
  },
};

/** Backward-compatible default for callers/tests that do not have state. */
export const ONBOARDING_PHASE2_PRACTICE = ONBOARDING_PHASE2_PRACTICE_BY_CATEGORY.food;

export function onboardingPhase2PracticeForInterest(
  interest: OnboardingInterest | null,
): OnboardingPhase2PracticeSource {
  return ONBOARDING_PHASE2_PRACTICE_BY_CATEGORY[onboardingCategoryForInterest(interest)];
}

export function onboardingPhase2PracticeFixture(
  selectedAt: string,
  source: OnboardingPhase2PracticeSource = ONBOARDING_PHASE2_PRACTICE,
): OnboardingTutorialFixture {
  return {
    id: source.internalSourceId,
    revision: source.revision,
    role: 'primary',
    platform: 'instagram',
    identityKey: `v1:instagram:${source.contentId}`,
    identityVersion: 1,
    contentId: source.contentId,
    canonicalUrl: source.canonicalUrl,
    launchUrl: source.canonicalUrl,
    thumbnailUrl: null,
    selectedAt,
  };
}

export function onboardingPhase2PracticeFromFixtureId(
  fixtureId: string | null | undefined,
): OnboardingPhase2PracticeSource | null {
  if (!fixtureId) return null;
  return Object.values(ONBOARDING_PHASE2_PRACTICE_BY_CATEGORY)
    .find((source) => source.internalSourceId === fixtureId) ?? null;
}
