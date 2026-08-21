import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { User } from '@supabase/supabase-js';

import { isAnonymousSupabaseUser, parseAccountTransitionResult } from '@/lib/anonymousOnboardingCore';
import { ensureOnboardingFunnelId, rotateOnboardingFunnelId } from '@/lib/onboardingFunnelIdentity';
import {
  beginOnboardingV2,
  beginOnboardingV2PermanentAccountLink,
  bindOnboardingV2AnonymousUser,
  cancelOnboardingV2PermanentAccountLink,
  completeOnboardingV2PermanentAccountLink,
  discardOnboardingV2CheckpointForMissingIdentity,
  getOnboardingV2State,
  flushOnboardingV2StateToServer,
  hydrateOnboardingV2FromServer,
} from '@/lib/onboardingV2';
import { onboardingV2ResumeEligibility } from '@/lib/onboardingV2Core';
import { supabase } from '@/lib/supabase';
import { markOnboardingComplete } from '@/lib/onboarding';

const TRANSFER_KEY = 'nearr:onboarding:v2:account-transfer';

type PendingTransfer = {
  onboardingSessionId: string;
  anonymousUserId: string;
  secret: string;
  expiresAt: string;
};

function randomSecret(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function readTransfer(): Promise<PendingTransfer | null> {
  try {
    const raw = await AsyncStorage.getItem(TRANSFER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingTransfer;
    if (!parsed.secret || !parsed.onboardingSessionId || Date.parse(parsed.expiresAt) <= Date.now()) {
      await AsyncStorage.removeItem(TRANSFER_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type AnonymousBootstrapResult =
  | { kind: 'anonymous'; user: User; resumed: boolean }
  | { kind: 'permanent'; user: User }
  | { kind: 'failed'; reason: string };

/** Establish exactly one persisted Supabase anonymous session for this install. */
export async function bootstrapAnonymousOnboarding(): Promise<AnonymousBootstrapResult> {
  const current = await supabase.auth.getSession();
  let session = current.data.session;
  const resumed = !!session;
  if (session && !isAnonymousSupabaseUser(session.user)) {
    return { kind: 'permanent', user: session.user };
  }
  if (!session) {
    const prior = await getOnboardingV2State();
    if (
      prior.identityLifecycle === 'anonymous_active' &&
      prior.anonymousUserId &&
      prior.cohort === 'new_user_v2'
    ) {
      // A normal restart restores the persisted Supabase session. If it is
      // missing while local product state still belongs to that user, creating
      // another anonymous identity would orphan/duplicate the tutorial save.
      return { kind: 'failed', reason: 'anonymous_session_recovery_required' };
    }
    const needsFreshJourney =
      prior.identityLifecycle === 'permanent_account' ||
      prior.cohort === 'existing_user_bypassed' ||
      !!prior.phase1CompletedAt ||
      !!prior.behavioralCompletedAt;
    if (needsFreshJourney) {
      await discardOnboardingV2CheckpointForMissingIdentity();
      await AsyncStorage.removeItem(TRANSFER_KEY);
    }
    const funnelId = needsFreshJourney
      ? await rotateOnboardingFunnelId()
      : await ensureOnboardingFunnelId();
    const created = await supabase.auth.signInAnonymously({
      options: { data: { onboarding_version: 2, onboarding_session_id: funnelId } },
    });
    if (created.error || !created.data.session) {
      return { kind: 'failed', reason: created.error?.message ?? 'anonymous_session_missing' };
    }
    session = created.data.session;
  }

  let checkpoint = await hydrateOnboardingV2FromServer(session.user.id);
  if (
    checkpoint.identityLifecycle !== 'none' &&
    !onboardingV2ResumeEligibility(checkpoint, {
      userId: session.user.id,
      identityExists: true,
      isAnonymous: true,
    }).eligible
  ) {
    checkpoint = await discardOnboardingV2CheckpointForMissingIdentity();
    await AsyncStorage.removeItem(TRANSFER_KEY);
    await rotateOnboardingFunnelId();
  }
  const funnelId = await ensureOnboardingFunnelId();
  await beginOnboardingV2();
  await bindOnboardingV2AnonymousUser(session.user.id, funnelId);
  return { kind: 'anonymous', user: session.user, resumed };
}

/**
 * Create a short-lived, one-time server grant while the anonymous JWT is still
 * active. The raw secret stays on-device; Postgres stores only SHA-256.
 */
export async function prepareOnboardingAccountTransfer(): Promise<PendingTransfer> {
  const existing = await readTransfer();
  if (existing) {
    await beginOnboardingV2PermanentAccountLink();
    return existing;
  }
  const state = await getOnboardingV2State();
  const session = (await supabase.auth.getSession()).data.session;
  if (
    !session || !isAnonymousSupabaseUser(session.user) ||
    !state.funnelSessionId || state.anonymousUserId !== session.user.id || !state.tutorialSave
  ) {
    throw new Error('anonymous_onboarding_transfer_not_ready');
  }
  const secret = randomSecret(await Crypto.getRandomBytesAsync(32));
  // The tutorial-save transition normally mirrors in the background. Flush it
  // here so a fast account tap cannot race grant creation on the server.
  await flushOnboardingV2StateToServer();
  const { data, error } = await supabase.rpc('begin_onboarding_account_transfer', {
    p_onboarding_session_id: state.funnelSessionId,
    p_transfer_secret: secret,
  });
  if (error || !data) throw new Error(error?.message ?? 'transfer_grant_failed');
  const transfer: PendingTransfer = {
    onboardingSessionId: state.funnelSessionId,
    anonymousUserId: session.user.id,
    secret,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
  };
  await AsyncStorage.setItem(TRANSFER_KEY, JSON.stringify(transfer));
  await beginOnboardingV2PermanentAccountLink();
  return transfer;
}

export async function cancelOnboardingAccountTransfer(): Promise<void> {
  await cancelOnboardingV2PermanentAccountLink();
}

/** Remove a pending grant only after the account deletion is confirmed. */
export async function clearOnboardingAccountTransferAfterDeletion(): Promise<void> {
  await AsyncStorage.removeItem(TRANSFER_KEY);
}

/** Finalize either an in-place identity link or an allowlisted cross-user transfer. */
export async function finishOnboardingAccountTransition(user: User): Promise<{
  route: '/(tabs)/map';
  destinationWasEstablished: boolean;
  tutorialSavedPlaceId: string;
}> {
  if (isAnonymousSupabaseUser(user)) throw new Error('permanent_identity_not_established');
  const refreshed = await supabase.auth.refreshSession();
  const permanentUser = refreshed.data.session?.user ?? user;
  if (isAnonymousSupabaseUser(permanentUser)) throw new Error('permanent_token_not_refreshed');
  const state = await getOnboardingV2State();
  const transfer = await readTransfer();
  let result;
  if (state.anonymousUserId === permanentUser.id) {
    const { data, error } = await supabase.rpc('finalize_onboarding_identity_link', {
      p_onboarding_session_id: state.funnelSessionId,
    });
    if (error) throw new Error(error.message);
    result = parseAccountTransitionResult(data);
  } else {
    const operation = transfer
      ? supabase.rpc('complete_onboarding_account_transfer', { p_transfer_secret: transfer.secret })
      : supabase.rpc('resume_completed_onboarding_account_transfer', {
          p_onboarding_session_id: state.funnelSessionId,
        });
    const { data, error } = await operation;
    if (error) throw new Error(error.message);
    result = parseAccountTransitionResult(data);
  }
  if (!result) throw new Error('invalid_onboarding_transfer_result');
  if (!result.tutorialSavedPlaceId) throw new Error('tutorial_saved_place_identity_missing');
  await completeOnboardingV2PermanentAccountLink({
    permanentUserId: result.permanentUserId,
    destinationWasEstablished: result.destinationWasEstablished,
    tutorialSavedPlaceId: result.tutorialSavedPlaceId,
  });
  if (result.destinationWasEstablished) {
    await markOnboardingComplete(result.permanentUserId);
  }
  await AsyncStorage.removeItem(TRANSFER_KEY);
  return {
    route: '/(tabs)/map',
    destinationWasEstablished: result.destinationWasEstablished,
    tutorialSavedPlaceId: result.tutorialSavedPlaceId,
  };
}

export async function hasPendingOnboardingAccountTransfer(): Promise<boolean> {
  return !!(await readTransfer());
}
