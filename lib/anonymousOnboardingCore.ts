import type { User } from '@supabase/supabase-js';

export const ABANDONED_ANONYMOUS_TTL_DAYS = 30;
export const CONVERTED_ANONYMOUS_GRACE_HOURS = 24;
export const ACCOUNT_TRANSFER_TTL_MINUTES = 24 * 60;

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
