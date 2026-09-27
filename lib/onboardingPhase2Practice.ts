import type { OnboardingTutorialFixture } from './onboardingV2Core';

/**
 * One public, curated Phase 2 exercise. The source also lives in the share
 * regression corpus as `instagram-2nd-floor-post`, where its expected result
 * is 2nd Floor in Huntington Beach.
 */
export const ONBOARDING_PHASE2_PRACTICE = {
  internalSourceId: 'instagram-2nd-floor-post',
  contentId: 'dypcd2zbtsz',
  expectedPlaceName: '2nd Floor',
  expectedPlaceAddress: '126 Main St, Huntington Beach',
  canonicalUrl: 'https://www.instagram.com/p/DYpcd2ZBTsZ/',
} as const;

export function onboardingPhase2PracticeFixture(selectedAt: string): OnboardingTutorialFixture {
  return {
    id: ONBOARDING_PHASE2_PRACTICE.internalSourceId,
    revision: 1,
    role: 'primary',
    platform: 'instagram',
    identityKey: `v1:instagram:${ONBOARDING_PHASE2_PRACTICE.contentId}`,
    identityVersion: 1,
    contentId: ONBOARDING_PHASE2_PRACTICE.contentId,
    canonicalUrl: ONBOARDING_PHASE2_PRACTICE.canonicalUrl,
    launchUrl: ONBOARDING_PHASE2_PRACTICE.canonicalUrl,
    thumbnailUrl: null,
    selectedAt,
  };
}
