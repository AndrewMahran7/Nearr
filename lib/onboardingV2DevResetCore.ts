import { NEARR_DEV_SUPABASE_REF, type ResolvedEnvironment } from './appEnvironmentCore';
import type { OnboardingV2State } from './onboardingV2Core';

export const ONBOARDING_DEV_RESET_BLOCKED_NON_DEV = 'ONBOARDING_DEV_RESET_BLOCKED_NON_DEV';

type ResetEnvironment = Pick<
  ResolvedEnvironment,
  'appEnv' | 'backendEnv' | 'appEnvWasDefaulted' | 'backendEnvWasDefaulted' | 'supabaseProjectRef'
>;

/** Fail closed: only an explicitly declared development app on Nearr-Dev qualifies. */
export function canRunOnboardingV2DevelopmentReset(environment: ResetEnvironment): boolean {
  return (
    environment.appEnv === 'development' &&
    environment.backendEnv === 'development' &&
    !environment.appEnvWasDefaulted &&
    !environment.backendEnvWasDefaulted &&
    environment.supabaseProjectRef === NEARR_DEV_SUPABASE_REF
  );
}

export type TrustedTutorialSource = { id: string; sourceUrl: string };

/**
 * Return the one saved-place id that is provably owned by the guided tutorial.
 * Anything ambiguous is preserved; a dev reset must never broaden deletion.
 */
export function tutorialSavedPlaceIdForDevelopmentReset(
  state: OnboardingV2State,
  trustedTutorials: readonly TrustedTutorialSource[],
): string | null {
  const save = state.tutorialSave;
  if (!save || save.kind !== 'tutorial' || !save.savedPlaceId) return null;
  const trusted = trustedTutorials.find((item) => item.id === save.contentId);
  if (!trusted || trusted.sourceUrl !== save.sourceUrl) return null;
  return save.savedPlaceId;
}

/** Contract used by tests and diagnostics after the local state replacement. */
export function isFreshOnboardingV2State(state: OnboardingV2State): boolean {
  return (
    state.stage === 'not_started' &&
    state.cohort === null &&
    state.preferredPlatform === null &&
    state.interest === null &&
    state.tutorialContentId === null &&
    state.funnelSessionId === null &&
    state.identityLifecycle === 'none' &&
    state.anonymousUserId === null &&
    state.boundUserId === null &&
    state.tutorialSave === null &&
    state.independentSaves.length === 0 &&
    state.behavioralCompletedAt === null
  );
}
