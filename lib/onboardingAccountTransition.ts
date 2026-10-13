export type OnboardingAccountTransitionPhase =
  | 'ACCOUNT_TRANSITION_PENDING'
  | 'ACCOUNT_TRANSITION_IN_PROGRESS'
  | 'ACCOUNT_TRANSITION_COMPLETE'
  | 'ACCOUNT_TRANSITION_ERROR';

export type OnboardingAccountTransitionSnapshot<T> = {
  userId: string;
  generation: number;
  phase: OnboardingAccountTransitionPhase;
  value?: T;
  error?: unknown;
};

export type OnboardingAccountTransitionClaim<T> = {
  generation: number;
  owner: boolean;
  navigationOwner: boolean;
  replay: 'none' | 'in_flight' | 'complete' | 'error';
  promise: Promise<T>;
};

type TransitionRecord<T> = OnboardingAccountTransitionSnapshot<T> & {
  promise?: Promise<T>;
  recoveryNavigationClaimed?: boolean;
};

let generation = 0;
let current: TransitionRecord<unknown> | null = null;

/**
 * Claims the single post-auth account transition for a user.
 *
 * Callback replay, a component remount, and an auth-listener replay all share
 * the same promise while work is running. A completed transition is a no-op
 * for passive replays; one explicit signed-in Continue may recover its cached
 * route without rerunning backend work. A failed transition only starts again
 * after an explicit retry action. Only the work owner may publish errors.
 */
export function claimOnboardingAccountTransition<T>(options: {
  userId: string;
  run: () => Promise<T>;
  retry?: boolean;
  recoverCompletedNavigation?: boolean;
}): OnboardingAccountTransitionClaim<T> {
  const existing = current as TransitionRecord<T> | null;
  if (existing?.userId === options.userId) {
    if (
      (existing.phase === 'ACCOUNT_TRANSITION_PENDING' || existing.phase === 'ACCOUNT_TRANSITION_IN_PROGRESS')
      && existing.promise
    ) {
      return {
        generation: existing.generation,
        owner: false,
        navigationOwner: false,
        replay: 'in_flight',
        promise: existing.promise,
      };
    }
    if (existing.phase === 'ACCOUNT_TRANSITION_COMPLETE') {
      const navigationOwner = options.recoverCompletedNavigation === true &&
        existing.recoveryNavigationClaimed !== true;
      if (navigationOwner) {
        current = { ...existing, recoveryNavigationClaimed: true };
      }
      return {
        generation: existing.generation,
        owner: false,
        navigationOwner,
        replay: 'complete',
        promise: Promise.resolve(existing.value as T),
      };
    }
    if (existing.phase === 'ACCOUNT_TRANSITION_ERROR' && !options.retry) {
      return {
        generation: existing.generation,
        owner: false,
        navigationOwner: false,
        replay: 'error',
        promise: Promise.reject(existing.error),
      };
    }
  }

  generation += 1;
  const claimedGeneration = generation;
  current = {
    userId: options.userId,
    generation: claimedGeneration,
    phase: 'ACCOUNT_TRANSITION_PENDING',
  };

  const promise = Promise.resolve()
    .then(() => {
      if (current?.generation === claimedGeneration) {
        current = { ...current, phase: 'ACCOUNT_TRANSITION_IN_PROGRESS' };
      }
      return options.run();
    })
    .then((value) => {
      if (current?.generation === claimedGeneration) {
        current = {
          userId: options.userId,
          generation: claimedGeneration,
          phase: 'ACCOUNT_TRANSITION_COMPLETE',
          value,
          recoveryNavigationClaimed: false,
        };
      }
      return value;
    })
    .catch((error: unknown) => {
      if (current?.generation === claimedGeneration) {
        current = {
          userId: options.userId,
          generation: claimedGeneration,
          phase: 'ACCOUNT_TRANSITION_ERROR',
          error,
        };
      }
      throw error;
    });

  current = { ...current, promise };
  return {
    generation: claimedGeneration,
    owner: true,
    navigationOwner: true,
    replay: 'none',
    promise,
  };
}

export function getOnboardingAccountTransitionSnapshot(): OnboardingAccountTransitionSnapshot<unknown> | null {
  if (!current) return null;
  const { promise: _promise, recoveryNavigationClaimed: _recoveryNavigationClaimed, ...snapshot } = current;
  return snapshot;
}

export function resetOnboardingAccountTransitionForTests(): void {
  generation = 0;
  current = null;
}
