import { getResolvedEnvironment } from '@/lib/appEnvironment';
import { supabase } from '@/lib/supabase';
import type { OnboardingPlatform, OnboardingTutorialFixture } from '@/lib/onboardingV2Core';
import { canLoadOnboardingTutorialFixture, parsePublicOnboardingTutorialFixture } from '@/lib/onboardingTutorialFixtureCore';

export { canLoadOnboardingTutorialFixture, isShareJobForTutorialFixture, parsePublicOnboardingTutorialFixture, tutorialResultFromShareJob } from '@/lib/onboardingTutorialFixtureCore';

export async function loadActiveOnboardingTutorialFixture(
  preferredPlatform?: OnboardingPlatform | null,
): Promise<OnboardingTutorialFixture> {
  if (!canLoadOnboardingTutorialFixture(getResolvedEnvironment())) {
    throw new Error('development_fixture_unavailable');
  }
  const { data, error } = await supabase.functions.invoke('get-onboarding-tutorial', {
    body: { preferredPlatform: preferredPlatform === 'other' ? null : preferredPlatform ?? null },
  });
  if (error) throw new Error('fixture_request_failed');
  const fixture = parsePublicOnboardingTutorialFixture(data);
  if (!fixture) throw new Error('fixture_unavailable');
  return fixture;
}

export async function loadOnboardingPracticeFixture(input: {
  preferredPlatform?: OnboardingPlatform | null;
  onboardingSessionId: string;
}): Promise<OnboardingTutorialFixture> {
  if (!canLoadOnboardingTutorialFixture(getResolvedEnvironment())) throw new Error('development_fixture_unavailable');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase.functions.invoke('get-onboarding-tutorial', {
      body: {
        mode: 'practice',
        preferredPlatform: input.preferredPlatform === 'other' ? null : input.preferredPlatform ?? null,
        onboardingSessionId: input.onboardingSessionId,
      },
    });
    const fixture = !error ? parsePublicOnboardingTutorialFixture(data) : null;
    if (fixture) return fixture;
    // The local checkpoint is published before its best-effort server sync.
    // Give that bounded handoff time to settle without inventing a fixture.
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error('practice_fixture_unavailable');
}
