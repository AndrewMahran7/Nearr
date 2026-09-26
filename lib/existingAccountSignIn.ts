import AsyncStorage from '@react-native-async-storage/async-storage';

import { bypassOnboardingV2ForExistingUserFromWelcome } from '@/lib/onboardingV2';
import { supabase } from '@/lib/supabase';
import {
  isQualifyingExistingAccount,
  type ExistingAccountEvidence,
  type ExistingAccountSignInIntent,
} from '@/lib/existingAccountSignInCore';

const STORAGE_KEY = 'nearr:onboarding:existing-account-intent:v1';
export const QUALIFIED_EXISTING_ACCOUNT_ROUTE = '/(tabs)/map' as const;

export { isQualifyingExistingAccount } from '@/lib/existingAccountSignInCore';
export type { ExistingAccountEvidence, ExistingAccountSignInIntent } from '@/lib/existingAccountSignInCore';

export async function beginExistingAccountSignIn(): Promise<ExistingAccountSignInIntent> {
  const intent = { startedAt: new Date().toISOString() };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  return intent;
}

export async function readExistingAccountSignIn(): Promise<ExistingAccountSignInIntent | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ExistingAccountSignInIntent>;
    return typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt))
      ? { startedAt: value.startedAt }
      : null;
  } catch {
    return null;
  }
}

export async function clearExistingAccountSignIn(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function getExistingAccountEvidence(userId: string): Promise<ExistingAccountEvidence> {
  const [profile, savedPlace, sessions] = await Promise.all([
    supabase.from('profiles').select('created_at').eq('id', userId).maybeSingle(),
    supabase.from('saved_places').select('id').eq('user_id', userId).limit(1),
    supabase.from('onboarding_v2_sessions').select('state').eq('user_id', userId).order('last_activity_at', { ascending: false }).limit(5),
  ]);
  if (profile.error) throw profile.error;
  if (savedPlace.error) throw savedPlace.error;
  if (sessions.error) throw sessions.error;
  const hasCompletedOnboardingSession = (sessions.data ?? []).some((row) => {
    const state = row.state as Record<string, unknown> | null;
    return !!state && (
      typeof state.behavioralCompletedAt === 'string' ||
      typeof state.onboardingV2CompletedAt === 'string' ||
      state.stage === 'graduated'
    );
  });
  return {
    profileCreatedAt: profile.data?.created_at ?? null,
    hasSavedPlace: (savedPlace.data?.length ?? 0) > 0,
    hasCompletedOnboardingSession,
  };
}

export type ExistingAccountResolution =
  | { kind: 'not_requested' }
  | { kind: 'qualified' }
  | { kind: 'new_account' };

export async function resolveExistingAccountSignIn(userId: string): Promise<ExistingAccountResolution> {
  const intent = await readExistingAccountSignIn();
  if (!intent) return { kind: 'not_requested' };
  const evidence = await getExistingAccountEvidence(userId);
  const qualified = isQualifyingExistingAccount(intent, evidence);
  await clearExistingAccountSignIn();
  if (qualified) {
    await bypassOnboardingV2ForExistingUserFromWelcome(userId);
    return { kind: 'qualified' };
  }
  await supabase.auth.signOut();
  return { kind: 'new_account' };
}
