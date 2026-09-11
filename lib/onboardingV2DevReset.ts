import AsyncStorage from '@react-native-async-storage/async-storage';

import { bootstrapAnonymousOnboarding } from '@/lib/anonymousOnboarding';
import { getResolvedEnvironment } from '@/lib/appEnvironment';
import { clearOfflineUserData } from '@/lib/offlineIdentity';
import { resetOnboarding, setOnboardingPreview } from '@/lib/onboarding';
import { rotateOnboardingFunnelId } from '@/lib/onboardingFunnelIdentity';
import { resetOnboardingV2LocalStateForDevelopment } from '@/lib/onboardingV2';
import {
  canRunOnboardingV2DevelopmentReset,
  ONBOARDING_DEV_RESET_BLOCKED_NON_DEV,
} from '@/lib/onboardingV2DevResetCore';
import { supabase } from '@/lib/supabase';

export const ONBOARDING_V2_ACCOUNT_TRANSFER_KEY = 'nearr:onboarding:v2:account-transfer';

export type OnboardingV2DevelopmentResetMode = 'onboarding_only' | 'fresh_anonymous';

export type OnboardingV2DevelopmentResetResult =
  | {
      ok: false;
      code:
        | typeof ONBOARDING_DEV_RESET_BLOCKED_NON_DEV
        | 'ONBOARDING_DEV_RESET_REQUIRES_ANONYMOUS'
        | 'ONBOARDING_DEV_RESET_FAILED';
    }
  | {
      ok: true;
      mode: OnboardingV2DevelopmentResetMode;
      anonymousUserId: string;
      identityChanged: boolean;
      serverData: 'onboarding_sessions_removed' | 'prior_identity_preserved';
    };

/** Used by Settings and the fallback route; each operation repeats the guard. */
export function isOnboardingV2DevelopmentResetAvailable(): boolean {
  return canRunOnboardingV2DevelopmentReset(getResolvedEnvironment());
}

async function clearLocalOnboardingState(userId: string | null): Promise<void> {
  await resetOnboardingV2LocalStateForDevelopment();
  if (userId) await resetOnboarding(userId);
  await AsyncStorage.removeItem(ONBOARDING_V2_ACCOUNT_TRANSFER_KEY);
  await rotateOnboardingFunnelId();
  setOnboardingPreview(false);
}

async function removeOwnedServerSessions(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('reset-onboarding-qa', {
    body: { mode: 'onboarding_only' },
  });
  if (error || data?.ok !== true) {
    throw new Error(error?.message ?? data?.error ?? 'onboarding_qa_server_reset_failed');
  }
}

async function bootstrapFreshAnonymous(priorUserId: string | null): Promise<string> {
  const bootstrap = await bootstrapAnonymousOnboarding();
  if (bootstrap.kind !== 'anonymous') {
    throw new Error(
      bootstrap.kind === 'failed' ? bootstrap.reason : 'fresh_anonymous_identity_not_created',
    );
  }
  if (priorUserId && bootstrap.user.id === priorUserId) {
    throw new Error('fresh_anonymous_identity_not_rotated');
  }
  return bootstrap.user.id;
}

/**
 * Clear onboarding progress while keeping the current anonymous identity and
 * all saved places/jobs. The server endpoint removes only this token owner's
 * onboarding session rows so stale hydration cannot restore the old journey.
 */
export async function resetOnboardingV2OnlyForDevelopment(): Promise<OnboardingV2DevelopmentResetResult> {
  if (!isOnboardingV2DevelopmentResetAvailable()) {
    console.warn(ONBOARDING_DEV_RESET_BLOCKED_NON_DEV);
    return { ok: false, code: ONBOARDING_DEV_RESET_BLOCKED_NON_DEV };
  }

  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (session && session.user.is_anonymous !== true) {
      return { ok: false, code: 'ONBOARDING_DEV_RESET_REQUIRES_ANONYMOUS' };
    }
    if (session) await removeOwnedServerSessions();
    await clearLocalOnboardingState(session?.user.id ?? null);
    const bootstrap = await bootstrapAnonymousOnboarding();
    if (bootstrap.kind !== 'anonymous') {
      throw new Error(
        bootstrap.kind === 'failed' ? bootstrap.reason : 'anonymous_identity_not_available',
      );
    }
    console.log('[onboarding-v2] ONBOARDING_DEV_RESET_COMPLETE mode=onboarding_only');
    return {
      ok: true,
      mode: 'onboarding_only',
      anonymousUserId: bootstrap.user.id,
      identityChanged: false,
      serverData: session ? 'onboarding_sessions_removed' : 'prior_identity_preserved',
    };
  } catch (error) {
    console.warn('[onboarding-v2] ONBOARDING_DEV_RESET_FAILED mode=onboarding_only', error);
    return { ok: false, code: 'ONBOARDING_DEV_RESET_FAILED' };
  }
}

/**
 * Start with a brand-new anonymous auth identity. An anonymous predecessor's
 * onboarding checkpoints are removed; its saves/jobs stay isolated under the
 * abandoned identity for normal retention cleanup. A permanent account is
 * only signed out locally and its server data is left completely untouched.
 */
export async function resetOnboardingV2WithFreshAnonymousUserForDevelopment(): Promise<OnboardingV2DevelopmentResetResult> {
  if (!isOnboardingV2DevelopmentResetAvailable()) {
    console.warn(ONBOARDING_DEV_RESET_BLOCKED_NON_DEV);
    return { ok: false, code: ONBOARDING_DEV_RESET_BLOCKED_NON_DEV };
  }

  try {
    const session = (await supabase.auth.getSession()).data.session;
    const priorUserId = session?.user.id ?? null;
    const priorWasAnonymous = session?.user.is_anonymous === true;
    if (priorWasAnonymous) await removeOwnedServerSessions();

    await clearLocalOnboardingState(priorUserId);
    if (session) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      await clearOfflineUserData(priorUserId);
    }

    const anonymousUserId = await bootstrapFreshAnonymous(priorUserId);
    console.log('[onboarding-v2] ONBOARDING_DEV_RESET_COMPLETE mode=fresh_anonymous');
    return {
      ok: true,
      mode: 'fresh_anonymous',
      anonymousUserId,
      identityChanged: !priorUserId || anonymousUserId !== priorUserId,
      serverData: priorWasAnonymous ? 'onboarding_sessions_removed' : 'prior_identity_preserved',
    };
  } catch (error) {
    console.warn('[onboarding-v2] ONBOARDING_DEV_RESET_FAILED mode=fresh_anonymous', error);
    return { ok: false, code: 'ONBOARDING_DEV_RESET_FAILED' };
  }
}

/** Backward-compatible alias for old dev tooling: the old action meant fresh identity. */
export const resetOnboardingV2ForDevelopment =
  resetOnboardingV2WithFreshAnonymousUserForDevelopment;
