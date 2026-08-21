import { Redirect } from 'expo-router';

import { useAuth } from '@/hooks/useAuth';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { isOnboardingV2Enabled } from '@/lib/featureFlags';

export default function Index() {
  // Initial-entry decision. Onboarding is now the PUBLIC pre-auth landing:
  // logged-out users see the intro first; signed-in users go to the map.
  // AuthGate remains the ongoing guard. (Rollback: point the signed-in
  // destination back to '/(tabs)/home'.)
  const { session, loading } = useAuth();
  const { state: onboardingV2, loading: onboardingV2Loading } = useOnboardingV2();

  if (loading || (isOnboardingV2Enabled() && onboardingV2Loading)) return null;
  if (!session) return <Redirect href="/(onboarding)" />;
  if (isOnboardingV2Enabled() && session.user.is_anonymous === true) {
    if (onboardingV2?.stage === 'account_required') {
      return <Redirect href="/(onboarding)/account" />;
    }
    if (onboardingV2?.stage?.startsWith('tutorial_')) {
      return <Redirect href="/activate" />;
    }
    return <Redirect href="/(onboarding)" />;
  }
  const tutorialNeedsResume =
    isOnboardingV2Enabled() &&
    onboardingV2?.cohort === 'new_user_v2' &&
    onboardingV2.boundUserId === session.user.id &&
    !onboardingV2.tutorialSave &&
    !onboardingV2.behavioralCompletedAt;
  if (tutorialNeedsResume) return <Redirect href="/activate" />;
  return <Redirect href="/(tabs)/map" />;
}
