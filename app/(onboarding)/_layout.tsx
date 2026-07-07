import { Stack } from 'expo-router';

import { OnboardingColors } from '@/components/onboarding';

/**
 * Onboarding route group layout.
 *
 * Headerless, dark background, and swipe-back disabled so the linear flow is
 * driven only by the in-screen CTA / back button. NOTE: this group is not yet
 * wired into `AuthGate` — it exists for manual preview at `/(onboarding)`.
 */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        contentStyle: { backgroundColor: OnboardingColors.background },
      }}
    />
  );
}
