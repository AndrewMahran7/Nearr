import AsyncStorage from '@react-native-async-storage/async-storage';

import { ONBOARDING_STARTER_CONTENT } from '@/constants/onboardingStarterContent';
import { getResolvedEnvironment } from '@/lib/appEnvironment';
import { clearOfflineUserData } from '@/lib/offlineIdentity';
import { setOnboardingPreview } from '@/lib/onboarding';
import { rotateOnboardingFunnelId } from '@/lib/onboardingFunnelIdentity';
import {
  getOnboardingV2State,
  resetOnboardingV2LocalStateForDevelopment,
} from '@/lib/onboardingV2';
import {
  canRunOnboardingV2DevelopmentReset,
  ONBOARDING_DEV_RESET_BLOCKED_NON_DEV,
  tutorialSavedPlaceIdForDevelopmentReset,
} from '@/lib/onboardingV2DevResetCore';
import { supabase } from '@/lib/supabase';
import { deleteSavedPlace } from '@/services/savedPlacesService';

export const ONBOARDING_V2_ACCOUNT_TRANSFER_KEY = 'nearr:onboarding:v2:account-transfer';

export type OnboardingV2DevelopmentResetResult =
  | { ok: false; code: typeof ONBOARDING_DEV_RESET_BLOCKED_NON_DEV | 'ONBOARDING_DEV_RESET_FAILED' }
  | {
      ok: true;
      tutorialSaveCleanup: 'not_present' | 'removed' | 'preserved_unverified' | 'preserved_after_error';
    };

type TutorialSaveCleanup = Extract<
  OnboardingV2DevelopmentResetResult,
  { ok: true }
>['tutorialSaveCleanup'];

/** Used by Settings as a rendering guard; the operation repeats the same check. */
export function isOnboardingV2DevelopmentResetAvailable(): boolean {
  return canRunOnboardingV2DevelopmentReset(getResolvedEnvironment());
}

/**
 * Reset only the device and identity used for development Onboarding V2 QA.
 *
 * The prior server checkpoint is intentionally not broadly deleted. Signing
 * out locally and rotating the funnel causes the next Welcome bootstrap to
 * create a different anonymous user, so that identity-scoped checkpoint can
 * never win hydration for the fresh run. Existing anonymous-retention cleanup
 * remains responsible for the abandoned server identity.
 */
export async function resetOnboardingV2ForDevelopment(): Promise<OnboardingV2DevelopmentResetResult> {
  if (!isOnboardingV2DevelopmentResetAvailable()) {
    console.warn(ONBOARDING_DEV_RESET_BLOCKED_NON_DEV);
    return { ok: false, code: ONBOARDING_DEV_RESET_BLOCKED_NON_DEV };
  }

  try {
    const [state, sessionResult] = await Promise.all([
      getOnboardingV2State(),
      supabase.auth.getSession(),
    ]);
    const priorUserId = sessionResult.data.session?.user.id ?? state.boundUserId;
    const tutorialSavedPlaceId = tutorialSavedPlaceIdForDevelopmentReset(
      state,
      ONBOARDING_STARTER_CONTENT,
    );
    let tutorialSaveCleanup: TutorialSaveCleanup = state.tutorialSave
      ? 'preserved_unverified'
      : 'not_present';

    // The only server mutation is an exact-id delete proven by the V2 state
    // and checked-in tutorial registry. No query or broad user delete exists.
    if (tutorialSavedPlaceId) {
      try {
        await deleteSavedPlace(tutorialSavedPlaceId);
        tutorialSaveCleanup = 'removed';
      } catch (error) {
        tutorialSaveCleanup = 'preserved_after_error';
        console.warn('[onboarding-v2] dev_reset_tutorial_cleanup_failed', error);
      }
    }

    // Replace and publish local product state before sign-out. This prevents
    // the onboarding route from mounting against stale progress during the
    // auth-state transition.
    await resetOnboardingV2LocalStateForDevelopment();
    await AsyncStorage.removeItem(ONBOARDING_V2_ACCOUNT_TRANSFER_KEY);
    await rotateOnboardingFunnelId();
    setOnboardingPreview(false);

    // A reset is an explicit local-device QA action. Never revoke the real
    // permanent account's sessions on other devices.
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) throw signOutError;

    // Signing out must not leave a private offline cache unlocked on device.
    // This removes cache copies only; server saved places and preferences stay.
    await clearOfflineUserData(priorUserId);

    console.log(
      '[onboarding-v2] ONBOARDING_DEV_RESET_COMPLETE tutorial_cleanup=' + tutorialSaveCleanup,
    );
    return { ok: true, tutorialSaveCleanup };
  } catch (error) {
    console.warn('[onboarding-v2] ONBOARDING_DEV_RESET_FAILED', error);
    return { ok: false, code: 'ONBOARDING_DEV_RESET_FAILED' };
  }
}
