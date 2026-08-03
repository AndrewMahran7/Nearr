import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';

import { trackEvent } from '@/lib/analytics';
import { hapticImpact, hapticSelection, hapticSuccess } from '@/lib/haptics';
import { markDemoCompleted, setOnboardingPreview } from '@/lib/onboarding';
import {
  OnboardingPrimaryButton,
  OnboardingScreenShell,
} from '@/components/onboarding';
import {
  ChooseNearrScreen,
  FindingSavingScreen,
  MapResultScreen,
  TapShareScreen,
  ValuePropScreen,
} from '@/components/onboarding/screens';

// Five interactive demonstration screens. The first is a value-prop intro
// advanced by a CTA; screens 2–4 advance only when the user performs the
// taught action (tap Share, tap Nearr, tap Save); the last advances via the
// "Save your first place" CTA. Every screen carries the "N of 5" progress.
const TOTAL_STEPS = 5;
const LAST_STEP = TOTAL_STEPS - 1;

const SCREEN_NAMES = [
  'value_prop',
  'tap_share',
  'choose_nearr',
  'finding_saving',
  'map_result',
] as const;

// Small delay so the in-screen tap animation is visible before the transition.
const ADVANCE_DELAY_MS = 300;

function screenProps(index: number) {
  return {
    screen: SCREEN_NAMES[index] ?? 'unknown',
    screen_index: index,
    total_screens: TOTAL_STEPS,
  };
}

/**
 * Pre-auth interactive onboarding.
 *
 * A hands-on practice run of the Nearr loop (tap Share → tap Nearr → watch it
 * resolve → tap Save → see the pin) shown BEFORE the user creates an account.
 * Finishing routes to the single email auth screen; it does not sign the user
 * in and does not count as a first save. No location/notification permission
 * is requested here.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const isWelcome = step === 0;
  const isLast = step === LAST_STEP;

  // `onboarding_demo_started` once on mount.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void trackEvent('onboarding_demo_started', screenProps(0));
  }, []);

  // Clear any dev-only onboarding preview request when leaving the flow.
  useEffect(() => {
    return () => setOnboardingPreview(false);
  }, []);

  // `onboarding_screen_viewed` once per screen.
  const viewedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (viewedRef.current.has(step)) return;
    viewedRef.current.add(step);
    void trackEvent('onboarding_screen_viewed', screenProps(step));
  }, [step]);

  // Guard against accidental double navigation from rapid taps. Reset whenever
  // the step changes (so back navigation re-enables interaction), and cancel
  // any pending advance so a fast tap-then-back can't bounce the user forward.
  const busyRef = useRef(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    busyRef.current = false;
    return () => {
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    };
  }, [step]);

  const advance = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    advanceTimerRef.current = setTimeout(
      () => setStep((s) => Math.min(s + 1, LAST_STEP)),
      ADVANCE_DELAY_MS,
    );
  };

  const goBack = () => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    void trackEvent('onboarding_back_tapped', screenProps(step));
    setStep((s) => Math.max(s - 1, 0));
  };

  // Interactive advance handlers (screens 2–4).
  const handleShareTap = () => {
    if (busyRef.current) return;
    void trackEvent('onboarding_share_demo_tapped', screenProps(1));
    hapticSelection();
    advance();
  };

  const handleNearrTap = () => {
    if (busyRef.current) return;
    void trackEvent('onboarding_nearr_demo_tapped', screenProps(2));
    hapticSelection();
    advance();
  };

  const handleSaveTap = () => {
    if (busyRef.current) return;
    void trackEvent('onboarding_demo_save_tapped', screenProps(3));
    hapticImpact();
    advance();
  };

  // Screen 5 pin animation (once) — analytics only, no advance.
  const pinShownRef = useRef(false);
  const handlePinShown = () => {
    if (pinShownRef.current) return;
    pinShownRef.current = true;
    void trackEvent('onboarding_demo_pin_shown', screenProps(4));
    hapticSuccess();
  };

  // Value-prop CTA → next screen.
  const handleSeeHowItWorks = () => {
    void trackEvent('onboarding_continue_tapped', screenProps(step));
    advance();
  };

  // Final CTA → single email auth screen. Guarded against double navigation.
  const finishingRef = useRef(false);
  const handleSaveYourOwnPlace = () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    void markDemoCompleted();
    void trackEvent('onboarding_demo_completed', screenProps(LAST_STEP));
    router.push('/(onboarding)/account');
  };

  return (
    <OnboardingScreenShell
      onBack={isWelcome ? undefined : goBack}
      progress={{ total: TOTAL_STEPS, current: step }}
      footer={renderFooter()}
    >
      {renderBody()}
    </OnboardingScreenShell>
  );

  function renderFooter() {
    if (isWelcome) {
      return <OnboardingPrimaryButton title="See how it works" onPress={handleSeeHowItWorks} />;
    }
    if (isLast) {
      return (
        <OnboardingPrimaryButton title="Save your first place" onPress={handleSaveYourOwnPlace} />
      );
    }
    // Screens 2–4 advance through in-screen interaction; no footer button.
    return null;
  }

  function renderBody() {
    switch (step) {
      case 0:
        return <ValuePropScreen />;
      case 1:
        return <TapShareScreen onShareTap={handleShareTap} />;
      case 2:
        return <ChooseNearrScreen onNearrTap={handleNearrTap} />;
      case 3:
        return <FindingSavingScreen onSave={handleSaveTap} />;
      case 4:
      default:
        return <MapResultScreen onPinShown={handlePinShown} />;
    }
  }
}
