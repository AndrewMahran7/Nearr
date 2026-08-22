import type { User } from '@supabase/supabase-js';
import type { OnboardingV2State } from './onboardingV2Core';

export const ABANDONED_ANONYMOUS_TTL_DAYS = 30;
export const CONVERTED_ANONYMOUS_GRACE_HOURS = 24;
export const ACCOUNT_TRANSFER_TTL_MINUTES = 24 * 60;
export const ANONYMOUS_BOOTSTRAP_TIMEOUT_MS = 12_000;

export type AnonymousBootstrapDecision =
  | 'use_anonymous_session'
  | 'use_permanent_session'
  | 'create_anonymous_session'
  | 'restart_with_new_anonymous_session'
  | 'recover_saved_identity';

/**
 * Auth is the identity authority. A local `anonymous_active` label without a
 * live Supabase session cannot authorize RPCs and must never suppress repair.
 */
export function decideAnonymousBootstrap(input: {
  sessionUserId: string | null;
  sessionIsAnonymous: boolean;
  state: Pick<
    OnboardingV2State,
    'cohort' | 'identityLifecycle' | 'anonymousUserId' | 'tutorialSave' |
    'behavioralCompletedAt'
  >;
}): AnonymousBootstrapDecision {
  if (input.sessionUserId) {
    return input.sessionIsAnonymous ? 'use_anonymous_session' : 'use_permanent_session';
  }
  const locallyAnonymous =
    input.state.cohort === 'new_user_v2' &&
    input.state.identityLifecycle === 'anonymous_active' &&
    !!input.state.anonymousUserId;
  if (locallyAnonymous) {
    return input.state.tutorialSave
      ? 'recover_saved_identity'
      : 'restart_with_new_anonymous_session';
  }
  if (
    input.state.identityLifecycle === 'permanent_account' ||
    input.state.cohort === 'existing_user_bypassed' ||
    !!input.state.behavioralCompletedAt
  ) {
    return 'restart_with_new_anonymous_session';
  }
  return 'create_anonymous_session';
}

export function isAnonymousSupabaseUser(
  user: Pick<User, 'is_anonymous'> | null | undefined,
): boolean {
  return user?.is_anonymous === true;
}

export type AccountTransitionResult = {
  permanentUserId: string;
  destinationWasEstablished: boolean;
  tutorialSavedPlaceId: string | null;
  replayed: boolean;
};

export function parseAccountTransitionResult(value: unknown): AccountTransitionResult | null {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row.permanent_user_id !== 'string') return null;
  return {
    permanentUserId: row.permanent_user_id,
    destinationWasEstablished: row.destination_was_established === true,
    tutorialSavedPlaceId:
      typeof row.tutorial_saved_place_id === 'string' ? row.tutorial_saved_place_id : null,
    replayed: row.replayed === true,
  };
}

export function isAnonymousCleanupEligible(input: {
  isAnonymous: boolean;
  lifecycle: 'anonymous_active' | 'permanent_account_linking' | 'permanent_account';
  lastActivityAt: string;
  upgradedAt?: string | null;
  now: string;
  abandonedTtlDays?: number;
  convertedGraceHours?: number;
}): boolean {
  if (!input.isAnonymous) return false;
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) return false;
  if (input.lifecycle === 'permanent_account' && input.upgradedAt) {
    return nowMs - Date.parse(input.upgradedAt) >=
      (input.convertedGraceHours ?? CONVERTED_ANONYMOUS_GRACE_HOURS) * 3_600_000;
  }
  return nowMs - Date.parse(input.lastActivityAt) >=
    (input.abandonedTtlDays ?? ABANDONED_ANONYMOUS_TTL_DAYS) * 86_400_000;
}
