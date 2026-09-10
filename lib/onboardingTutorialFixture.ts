import { getResolvedEnvironment } from '@/lib/appEnvironment';
import { supabase } from '@/lib/supabase';
import type { OnboardingTutorialFixture } from '@/lib/onboardingV2Core';
import { canLoadOnboardingTutorialFixture, parsePublicOnboardingTutorialFixture } from '@/lib/onboardingTutorialFixtureCore';

export { canLoadOnboardingTutorialFixture, isShareJobForTutorialFixture, parsePublicOnboardingTutorialFixture, tutorialResultFromShareJob } from '@/lib/onboardingTutorialFixtureCore';

export async function loadActiveOnboardingTutorialFixture(): Promise<OnboardingTutorialFixture> {
  if (!canLoadOnboardingTutorialFixture(getResolvedEnvironment())) {
    throw new Error('development_fixture_unavailable');
  }
  const { data, error } = await supabase.functions.invoke('get-onboarding-tutorial');
  if (error) throw new Error('fixture_request_failed');
  const fixture = parsePublicOnboardingTutorialFixture(data);
  if (!fixture) throw new Error('fixture_unavailable');
  return fixture;
}
