import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';

import { useAuth } from '@/hooks/useAuth';
import { trackEvent } from '@/lib/analytics';
import { setOnboardingPreview } from '@/lib/onboarding';
import {
  OnboardingPrimaryButton,
  OnboardingScreenShell,
  OnboardingSecondaryButton,
} from '@/components/onboarding';
import {
  FirstSaveScreen,
  HowToSaveScreen,
  NearbyRemindersScreen,
  ShareFavoritesScreen,
  WelcomeScreen,
} from '@/components/onboarding/screens';

// Linear 5-step flow. Welcome (step 0) has no progress bar and no back
// button; the remaining four screens share a 4-segment progress indicator.
const TOTAL_STEPS = 5;
const STEPS_AFTER_WELCOME = TOTAL_STEPS - 1;
const LAST_STEP = TOTAL_STEPS - 1;

// Stable, PII-free step names for analytics. Index-aligned with the flow.
const STEP_NAMES = [
  'welcome',
  'share_favorites',
  'how_to_save',
  'nearby_reminders',
  'first_save',
] as const;

function onboardingStepProps(index: number) {
  return {
    step_index: index,
    step_name: STEP_NAMES[index] ?? 'unknown',
    total_steps: TOTAL_STEPS,
  };
}

/**
 * Pre-auth onboarding / intro flow.
 *
 * This is the PUBLIC first-run experience shown BEFORE sign-in. It does not
 * require a session and does NOT gate the app:
 *   - A logged-out user walks the intro and leaves via sign-in.
 *   - A signed-in user previewing from Settings (dev only) leaves to the map.
 *
 * Notification permission is intentionally NOT requested here — it happens
 * after sign-up / later in setup.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const signedIn = !!session;
  const [step, setStep] = useState(0);

  const isWelcome = step === 0;
  const isLast = step === LAST_STEP;

  // Fire `onboarding_started` exactly once when the flow mounts.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void trackEvent('onboarding_started', onboardingStepProps(0));
  }, []);

  // Clear any dev-only onboarding preview request when leaving the flow, so a
  // dev/demo session isn't kept on onboarding after the preview ends.
  useEffect(() => {
    return () => setOnboardingPreview(false);
  }, []);

  // Fire `onboarding_screen_viewed` once per step. The seen-set dedupes
  // re-renders and back-and-forth navigation so each screen counts once.
  const viewedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (viewedRef.current.has(step)) return;
    viewedRef.current.add(step);
    void trackEvent('onboarding_screen_viewed', onboardingStepProps(step));
    if (step === 1) {
      void trackEvent('onboarding_share_favorites_viewed', onboardingStepProps(step));
    }
    if (step === 2) {
      void trackEvent('onboarding_share_tutorial_viewed', onboardingStepProps(step));
    }
  }, [step]);

  const goNext = () => setStep((s) => Math.min(s + 1, LAST_STEP));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  // Where the intro ends: sign-in for logged-out users, or back to the map for
  // a signed-in dev preview. Guarded against double navigation.
  const leavingRef = useRef(false);
  const leaveOnboarding = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    if (signedIn) router.replace('/(tabs)/map');
    else router.replace('/(auth)/sign-in');
  };

  // Final-screen actions. Pre-auth they all funnel to sign-in (you need an
  // account to save); a signed-in preview funnels back to the map. Each fires
  // the target + completion analytics first. Opening Instagram/TikTok does not
  // save anything — the user finds a place and shares it to Nearr.
  const runFirstSaveAction = (
    target: 'instagram' | 'tiktok' | 'paste_link' | 'start_saving',
  ) => {
    void trackEvent('onboarding_first_save_cta_tapped', {
      ...onboardingStepProps(LAST_STEP),
      target,
    });
    void trackEvent('onboarding_completed', {
      ...onboardingStepProps(LAST_STEP),
      completed_via: target,
    });
    leaveOnboarding();
  };

  const handlePrimary = () => {
    if (isLast) {
      runFirstSaveAction('start_saving');
      return;
    }
    // Nearby Reminders (step 3) no longer requests notification permission
    // pre-auth — it just advances. Permission is requested after sign-up.
    void trackEvent('onboarding_continue_tapped', onboardingStepProps(step));
    goNext();
  };

  const handleSkip = () => {
    void trackEvent('onboarding_skip_tapped', onboardingStepProps(step));
    if (step === 3) {
      void trackEvent('onboarding_reminders_skipped', {
        ...onboardingStepProps(step),
        reason: 'skipped',
      });
    }
    goNext();
  };

  // Welcome secondary: existing account → sign-in.
  const goSignIn = () => router.push('/(auth)/sign-in');

  return (
    <OnboardingScreenShell
      onBack={isWelcome ? undefined : goBack}
      progress={isWelcome ? undefined : { total: STEPS_AFTER_WELCOME, current: step - 1 }}
      footer={renderFooter()}
    >
      {renderBody()}
    </OnboardingScreenShell>
  );

  function renderBody() {
    switch (step) {
      case 0:
        return <WelcomeScreen />;
      case 1:
        return <ShareFavoritesScreen />;
      case 2:
        return <HowToSaveScreen />;
      case 3:
        return <NearbyRemindersScreen />;
      case 4:
      default:
        return (
          <FirstSaveScreen
            onOpenInstagram={() => runFirstSaveAction('instagram')}
            onOpenTikTok={() => runFirstSaveAction('tiktok')}
            onPasteLink={() => runFirstSaveAction('paste_link')}
          />
        );
    }
  }

  function renderFooter() {
    const primaryLabel = PRIMARY_LABELS[step];
    return (
      <>
        <OnboardingPrimaryButton title={primaryLabel} onPress={handlePrimary} />
        {step === 0 ? (
          <OnboardingSecondaryButton
            title="Already have an account? Sign in"
            emphasis
            onPress={goSignIn}
          />
        ) : null}
        {step === 1 || step === 3 ? (
          <OnboardingSecondaryButton title="Skip for now" onPress={handleSkip} />
        ) : null}
      </>
    );
  }
}

const PRIMARY_LABELS = [
  'Get Started',
  'Continue',
  'Got it',
  'Continue',
  'Start saving',
] as const;
