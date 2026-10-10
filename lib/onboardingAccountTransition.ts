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
  promise: Promise<T>;
};

type TransitionRecord<T> = OnboardingAccountTransitionSnapshot<T> & {
  promise?: Promise<T>;
};

let generation = 0;
let current: TransitionRecord<unknown> | null = null;

/**
 * Claims the single post-auth account transition for a user.
 *
 * Callback replay, a component remount, and an auth-listener replay all share
 * the same promise while work is running. A completed transition is a no-op,
 * and a failed transition only starts again after an explicit retry action.
 * Only the owner may publish errors or navigate.
 */
export function claimOnboardingAccountTransition<T>(options: {
  userId: string;
  run: () => Promise<T>;
  retry?: boolean;
}): OnboardingAccountTransitionClaim<T> {
  const existing = current as TransitionRecord<T> | null;
  if (existing?.userId === options.userId) {
    if (
      (existing.phase === 'ACCOUNT_TRANSITION_PENDING' || existing.phase === 'ACCOUNT_TRANSITION_IN_PROGRESS')
      && existing.promise
    ) {
      return { generation: existing.generation, owner: false, promise: existing.promise };
    }
    if (existing.phase === 'ACCOUNT_TRANSITION_COMPLETE') {
      return {
        generation: existing.generation,
        owner: false,
        promise: Promise.resolve(existing.value as T),
      };
    }
    if (existing.phase === 'ACCOUNT_TRANSITION_ERROR' && !options.retry) {
      return {
        generation: existing.generation,
        owner: false,
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
  return { generation: claimedGeneration, owner: true, promise };
}

export function getOnboardingAccountTransitionSnapshot(): OnboardingAccountTransitionSnapshot<unknown> | null {
  if (!current) return null;
  const { promise: _promise, ...snapshot } = current;
  return snapshot;
}

export function resetOnboardingAccountTransitionForTests(): void {
  generation = 0;
  current = null;
}
