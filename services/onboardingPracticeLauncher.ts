import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import type { OnboardingTutorialFixture } from '@/lib/onboardingV2Core';

/** Open the exact curated source; never degrade to a platform home/feed URL. */
export async function openOnboardingPracticePost(
  fixture: Pick<OnboardingTutorialFixture, 'launchUrl' | 'canonicalUrl'>,
): Promise<void> {
  const target = fixture.launchUrl || fixture.canonicalUrl;
  try {
    await Linking.openURL(target);
  } catch {
    await WebBrowser.openBrowserAsync(target);
  }
}
