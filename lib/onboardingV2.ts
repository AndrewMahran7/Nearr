/** Persisted adapter and observable integration surface for Onboarding V2. */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { trackEvent } from '@/lib/analytics';
import { getResolvedEnvironment } from '@/lib/appEnvironment';
import { markOnboardingComplete } from '@/lib/onboarding';
import { isOnboardingV2Phase1Only } from '@/lib/featureFlags';
import { restoreOnboardingFunnelId } from '@/lib/onboardingFunnelIdentity';
import {
  canRunOnboardingV2DevelopmentReset,
  ONBOARDING_DEV_RESET_BLOCKED_NON_DEV,
} from '@/lib/onboardingV2DevResetCore';
import { supabase } from '@/lib/supabase';
import type { SavedPlaceWithPlace } from '@/types';
import {
  acknowledgeGraduation,
  advanceSimulatedTutorial,
  advancePlaceTour,
  backOnboardingV2,
  beginPermanentAccountLink,
  bindAnonymousUser,
  bypassExistingUser,
  cancelPermanentAccountLink,
  closePlaceTour,
  completePermanentAccountLink,
  completePendingSave,
  continueToTutorial,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  dismissPracticeRecovery,
  encodeOnboardingV2State,
  failPendingSave,
  freshOnboardingV2StateAfterAccountDeletion,
  isExpectedOnboardingSource,
  isOnboardingV2InProgressState,
  observeOnboardingResult,
  onboardingV2SyncCredentialDecision,
  onboardingV2ResumeEligibility,
  openExternalStarter,
  openPlaceTour,
  openStarterShelf,
  recordPracticeHelpOpened,
  recordPracticeReturnedWithoutShare,
  receiveSharedSource,
  resumePhase2AfterCompletedPhase1,
  replaceTutorialContent,
  recordStarterImpressions,
  selectInterest,
  selectPracticeSource,
  selectPlatform,
  showStarterPrompt,
  startOnboardingV2,
  tapGetStarted,
  type OnboardingInterest,
  type OnboardingPlatform,
  type OnboardingResultClass,
  type OnboardingTransition,
  type OnboardingV2State,
  type SimulatedTutorialAction,
} from '@/lib/onboardingV2Core';
import type { OnboardingStarterContent } from '@/constants/onboardingStarterContent';
import { saveSavedPlace } from '@/services/savedPlacesService';

export const ONBOARDING_V2_STORAGE_KEY = 'nearr:onboarding:v2:state';

export type OnboardingV2EventName =
  | 'onboarding_overview_viewed'
  | 'onboarding_get_started_tapped'
  | 'onboarding_platform_selected'
  | 'onboarding_interest_selected'
  | 'onboarding_anonymous_session_established'
  | 'onboarding_tutorial_opened'
  | 'onboarding_back_tapped'
  | 'tutorial_share_tapped'
  | 'tutorial_more_tapped'
  | 'tutorial_nearr_selected'
  | 'tutorial_favorite_added'
  | 'tutorial_video_opened'
  | 'tutorial_share_received'
  | 'tutorial_detective_started'
  | 'tutorial_detective_result_shown'
  | 'tutorial_detective_result_confirmed'
  | 'onboarding_signin_viewed'
  | 'onboarding_signin_started'
  | 'onboarding_signin_completed'
  | 'onboarding_account_viewed'
  | 'first_place_opened_after_signup'
  | 'place_tour_started'
  | 'place_tour_ai_note_seen'
  | 'place_tour_source_seen'
  | 'place_tour_directions_seen'
  | 'place_tour_closed'
  | 'onboarding_phase1_completed'
  | 'starter_map_prompt_shown'
  | 'starter_video_shelf_opened'
  | 'starter_card_impression'
  | 'starter_card_opened'
  | 'first_independent_video_opened'
  | 'first_independent_save_started'
  | 'first_independent_save_completed'
  | 'first_independent_save_failed'
  | 'second_independent_video_opened'
  | 'second_independent_save_started'
  | 'second_independent_save_completed'
  | 'second_independent_save_failed'
  | 'behavioral_onboarding_completed'
  | 'practice_started'
  | 'practice_source_opened'
  | 'practice_share_received'
  | 'practice_returned_without_share'
  | 'practice_help_opened'
  | 'practice_place_saved'
  | 'practice_progress_2_of_3'
  | 'practice_progress_3_of_3';

type Listener = (state: OnboardingV2State) => void;
const listeners = new Set<Listener>();
let cachedState: OnboardingV2State | null = null;
let mutationQueue: Promise<unknown> = Promise.resolve();
let serverSyncGeneration = 0;

function nowIso(): string {
  return new Date().toISOString();
}

async function readStateFresh(): Promise<OnboardingV2State> {
  try {
    const raw = await AsyncStorage.getItem(ONBOARDING_V2_STORAGE_KEY);
    cachedState = decodeOnboardingV2State(raw);
  } catch (error) {
    console.warn('[onboarding-v2] state_read_failed', error);
    cachedState = cachedState ?? createInitialOnboardingV2State();
  }
  return cachedState;
}

export async function getOnboardingV2State(): Promise<OnboardingV2State> {
  const current = cachedState ?? await readStateFresh();
  // Phase 1 shipped before Phase 2. Its valid terminal checkpoint must become
  // a visible Practice continuation when (and only when) the installed bundle
  // explicitly enables full V2. Persist through the normal mutation queue so
  // local storage, subscribers and the server checkpoint converge once.
  if (!isOnboardingV2Phase1Only()) {
    const planned = resumePhase2AfterCompletedPhase1(current, nowIso());
    if (planned.changed) return applyTransition(resumePhase2AfterCompletedPhase1);
  }
  return current;
}

export function getOnboardingV2Snapshot(): OnboardingV2State | null {
  return cachedState;
}

export function subscribeOnboardingV2(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(state: OnboardingV2State): void {
  cachedState = state;
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch {
      // A UI subscriber must never break durable progress.
    }
  });
}

async function emitEvents(events: OnboardingTransition['events']): Promise<void> {
  await Promise.all(
    events.map((event) =>
      trackEvent(event.name as OnboardingV2EventName, {
        onboarding_version: 2,
        ...(event.properties ?? {}),
      }),
    ),
  );
}

async function syncStateToServer(
  state: OnboardingV2State,
  generation = serverSyncGeneration,
): Promise<void> {
  try {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (generation !== serverSyncGeneration) return;
    const session = data.session;
    const credential = onboardingV2SyncCredentialDecision(state, session
      ? { userId: session.user.id, accessToken: session.access_token }
      : null);
    if (sessionError) {
      console.warn('[onboarding-v2] server_sync_skipped', 'session_read_failed');
      return;
    }
    if (!credential.allowed) {
      if (credential.reason !== 'state_not_syncable') {
        console.warn('[onboarding-v2] server_sync_skipped', credential.reason);
      }
      return;
    }
    const { error } = await supabase.rpc('upsert_onboarding_v2_session', {
      p_session_id: state.funnelSessionId,
      p_revision: state.revision,
      p_state: state,
      p_lifecycle: state.identityLifecycle,
      p_tutorial_saved_place_id: state.tutorialSave?.savedPlaceId ?? null,
      p_tutorial_source_url: state.tutorialSave?.sourceUrl ?? state.pendingShare?.sourceUrl ?? null,
    });
    if (error) console.warn('[onboarding-v2] server_sync_failed', error.message);
  } catch (error) {
    console.warn('[onboarding-v2] server_sync_threw', error);
  }
}

export async function flushOnboardingV2StateToServer(): Promise<void> {
  await syncStateToServer(await getOnboardingV2State());
}

async function applyTransition(
  reducer: (state: OnboardingV2State, now: string) => OnboardingTransition,
): Promise<OnboardingV2State> {
  const operation = mutationQueue.then(async () => {
    // Once hydrated, memory is the process authority. This prevents a failed
    // AsyncStorage write from rolling progress backward on the next action;
    // successful writes remain the process-death authority.
    const current = cachedState ?? await readStateFresh();
    const result = reducer(current, nowIso());
    if (!result.changed) return current;
    publish(result.state);
    try {
      await AsyncStorage.setItem(ONBOARDING_V2_STORAGE_KEY, encodeOnboardingV2State(result.state));
    } catch (error) {
      console.warn('[onboarding-v2] state_write_failed', error);
    }
    void syncStateToServer(result.state, serverSyncGeneration);
    void emitEvents(result.events);
    if (
      !current.phase1CompletedAt &&
      !current.behavioralCompletedAt &&
      (result.state.phase1CompletedAt || result.state.behavioralCompletedAt) &&
      result.state.boundUserId
    ) {
      await markOnboardingComplete(result.state.boundUserId);
    }
    return result.state;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

export function beginOnboardingV2(): Promise<OnboardingV2State> {
  return applyTransition(startOnboardingV2);
}

export function recordOnboardingV2GetStarted(): Promise<OnboardingV2State> {
  return applyTransition(tapGetStarted);
}

export function setOnboardingV2Platform(platform: OnboardingPlatform): Promise<OnboardingV2State> {
  return applyTransition((state, now) => selectPlatform(state, platform, now));
}

export function setOnboardingV2Interest(
  interest: OnboardingInterest,
  tutorialContentId: string | null,
): Promise<OnboardingV2State> {
  return applyTransition((state, now) => selectInterest(state, interest, tutorialContentId, now));
}

export function continueOnboardingV2ToTutorial(): Promise<OnboardingV2State> {
  return applyTransition(continueToTutorial);
}

export function advanceOnboardingV2SimulatedTutorial(
  action: SimulatedTutorialAction,
  input: { contentId: string; sourceUrl: string },
): Promise<OnboardingV2State> {
  return applyTransition((state, now) => advanceSimulatedTutorial(state, action, input, now));
}

export function goBackOnboardingV2(): Promise<OnboardingV2State> {
  return applyTransition(backOnboardingV2);
}

/**
 * Persist the curated tutorial result through the same authoritative service
 * used by normal saves, then advance only after a saved_places id exists.
 */
export async function saveOnboardingV2TutorialPlace(
  content: OnboardingStarterContent,
): Promise<OnboardingV2State> {
  if (!content.targetPlace) throw new Error('This tutorial place is not configured for saving.');
  const result = await saveSavedPlace({
    candidate: content.targetPlace,
    radiusValue: null,
    radiusUnit: null,
    sourceType: content.platform,
    sourceUrl: content.sourceUrl,
    aiNote: content.tutorialNote,
  });
  const savedPlaceId = result.savedPlaceId;
  const next = await applyTransition((state, now) => completePendingSave(
    state,
    { sourceUrl: content.sourceUrl, savedPlaceId },
    now,
  ));
  if (!next.tutorialSave || next.stage !== 'account_required') {
    throw new Error('Nearr saved the place but could not confirm tutorial progress.');
  }
  return next;
}

export async function recordOnboardingV2SignInStarted(method: string): Promise<void> {
  const state = await getOnboardingV2State();
  if (state.cohort !== 'new_user_v2' || state.stage !== 'account_required') return;
  void trackEvent('onboarding_signin_started', { onboarding_version: 2, method });
}

export function bindOnboardingV2AnonymousUser(
  userId: string,
  funnelSessionId: string,
): Promise<OnboardingV2State> {
  return applyTransition((state, now) => bindAnonymousUser(state, userId, funnelSessionId, now));
}

export function beginOnboardingV2PermanentAccountLink(): Promise<OnboardingV2State> {
  return applyTransition(beginPermanentAccountLink);
}

export function cancelOnboardingV2PermanentAccountLink(): Promise<OnboardingV2State> {
  return applyTransition(cancelPermanentAccountLink);
}

export function completeOnboardingV2PermanentAccountLink(input: {
  permanentUserId: string;
  destinationWasEstablished: boolean;
  tutorialSavedPlaceId?: string | null;
}): Promise<OnboardingV2State> {
  return applyTransition((state, now) => completePermanentAccountLink(state, input, now));
}

export function bypassOnboardingV2ForExistingUser(userId: string): Promise<OnboardingV2State> {
  return applyTransition((state, now) => bypassExistingUser(state, userId, now));
}

export async function shouldResumeOnboardingV2(userId: string): Promise<boolean> {
  const state = await getOnboardingV2State();
  return onboardingV2ResumeEligibility(state, {
    userId,
    identityExists: true,
    isAnonymous: state.identityLifecycle !== 'permanent_account',
  }).eligible;
}

/** Restore a newer server checkpoint after an app restart/reinstall. */
export async function hydrateOnboardingV2FromServer(userId: string): Promise<OnboardingV2State> {
  const local = await getOnboardingV2State();
  try {
    const { data, error } = await supabase
      .from('onboarding_v2_sessions')
      .select('state,revision')
      .eq('user_id', userId)
      .order('last_activity_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.state || Number(data.revision ?? -1) <= local.revision) return local;
    const restored = decodeOnboardingV2State(JSON.stringify(data.state));
    if (!onboardingV2ResumeEligibility(restored, {
      userId,
      identityExists: true,
      isAnonymous: true,
    }).eligible) return local;
    publish(restored);
    await AsyncStorage.setItem(ONBOARDING_V2_STORAGE_KEY, encodeOnboardingV2State(restored));
    await restoreOnboardingFunnelId(restored.funnelSessionId);
    return restored;
  } catch {
    return local;
  }
}

export async function isOnboardingV2InProgress(): Promise<boolean> {
  return isOnboardingV2InProgressState(await getOnboardingV2State());
}

export function openOnboardingV2Starter(input: {
  contentId: string;
  sourceUrl: string;
}): Promise<OnboardingV2State> {
  return applyTransition((state, now) => openExternalStarter(state, input, now));
}

export function selectOnboardingV2PracticeSource(
  contentId: string,
  replace = false,
): Promise<OnboardingV2State> {
  return applyTransition((state, now) => selectPracticeSource(state, contentId, now, replace));
}

export function recordOnboardingV2ReturnedWithoutShare(input: {
  attemptId: string;
  returnedAt: string;
  helpEligibleAt: string;
}): Promise<OnboardingV2State> {
  return applyTransition((state, now) => recordPracticeReturnedWithoutShare(state, input, now));
}

export function recordOnboardingV2PracticeHelpOpened(): Promise<OnboardingV2State> {
  return applyTransition(recordPracticeHelpOpened);
}

export function dismissOnboardingV2PracticeRecovery(): Promise<OnboardingV2State> {
  return applyTransition(dismissPracticeRecovery);
}

export function replaceOnboardingV2TutorialContent(contentId: string): Promise<OnboardingV2State> {
  return applyTransition((state, now) => replaceTutorialContent(state, contentId, now));
}

export function observeOnboardingV2ShareReceived(sourceUrl: string): Promise<OnboardingV2State> {
  return applyTransition((state, now) => receiveSharedSource(state, sourceUrl, now));
}

export function observeOnboardingV2Result(
  sourceUrl: string,
  resultClass: OnboardingResultClass,
): Promise<OnboardingV2State> {
  return applyTransition((state, now) =>
    observeOnboardingResult(state, sourceUrl, resultClass, now),
  );
}

export function failOnboardingV2PendingSave(reason: string): Promise<OnboardingV2State> {
  return applyTransition((state, now) => failPendingSave(state, reason, now));
}

export type OnboardingSavedPlacesReconcileResult = {
  state: OnboardingV2State;
  matchedSavedPlace: SavedPlaceWithPlace | null;
  completedKind: 'tutorial' | 'independent_1' | 'independent_2' | null;
};

/**
 * Observe the authoritative saved-place list. Exact source URL matching is the
 * qualifying signal, so unrelated shares and manual saves cannot advance V2.
 */
export async function reconcileOnboardingV2SavedPlaces(
  places: readonly SavedPlaceWithPlace[],
): Promise<OnboardingSavedPlacesReconcileResult> {
  let matchedSavedPlace: SavedPlaceWithPlace | null = null;
  let completedKind: OnboardingSavedPlacesReconcileResult['completedKind'] = null;
  const state = await applyTransition((current, now) => {
    const pending = current.pendingShare;
    if (!pending) return { state: current, changed: false, events: [] };
    const matched = places.find((place) =>
      isExpectedOnboardingSource(pending, place.source_url),
    );
    if (!matched) return { state: current, changed: false, events: [] };
    matchedSavedPlace = matched;
    completedKind = pending.kind;
    return completePendingSave(
      current,
      { sourceUrl: matched.source_url ?? '', savedPlaceId: matched.id },
      now,
    );
  });
  return { state, matchedSavedPlace, completedKind };
}

export function recordOnboardingV2PlaceTourOpened(savedPlaceId: string): Promise<OnboardingV2State> {
  return applyTransition((state, now) => openPlaceTour(state, savedPlaceId, now));
}

export function advanceOnboardingV2PlaceTour(availability: {
  aiNote: boolean;
  source: boolean;
}): Promise<OnboardingV2State> {
  return applyTransition((state, now) => advancePlaceTour(state, availability, now));
}

export function closeOnboardingV2PlaceTour(savedPlaceId: string): Promise<OnboardingV2State> {
  return applyTransition((state, now) => closePlaceTour(
    state,
    savedPlaceId,
    now,
    { phase1Only: isOnboardingV2Phase1Only() },
  ));
}

export function recordOnboardingV2StarterPrompt(): Promise<OnboardingV2State> {
  return applyTransition(showStarterPrompt);
}

export function recordOnboardingV2StarterShelfOpened(): Promise<OnboardingV2State> {
  return applyTransition(openStarterShelf);
}

export function recordOnboardingV2StarterImpressions(contentIds: string[]): Promise<OnboardingV2State> {
  return applyTransition((state, now) => recordStarterImpressions(state, contentIds, now));
}

export function acknowledgeOnboardingV2Graduation(): Promise<OnboardingV2State> {
  return applyTransition(acknowledgeGraduation);
}

async function replaceOnboardingV2AfterIdentityDeletion(): Promise<OnboardingV2State> {
  const operation = mutationQueue.then(async () => {
    const current = cachedState ?? await readStateFresh();
    const initial = freshOnboardingV2StateAfterAccountDeletion(current);
    // Publish first so the deleted identity cannot remain resumable in this
    // process even if device storage is temporarily unavailable.
    publish(initial);
    try {
      // Overwrite instead of merely removing. A failed/stale remove must not
      // expose the deleted account snapshot again after process death.
      await AsyncStorage.setItem(ONBOARDING_V2_STORAGE_KEY, encodeOnboardingV2State(initial));
    } catch (error) {
      console.warn('[onboarding-v2] deletion_reset_write_failed', error);
      try {
        await AsyncStorage.removeItem(ONBOARDING_V2_STORAGE_KEY);
      } catch {
        // Memory is already invalidated; a later bootstrap also rejects the
        // old checkpoint because no live identity owns it.
      }
    }
    return initial;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

/** Production identity-boundary reset. Call only after confirmed deletion. */
export function resetOnboardingV2AfterAccountDeletion(): Promise<OnboardingV2State> {
  serverSyncGeneration += 1;
  return replaceOnboardingV2AfterIdentityDeletion();
}

/** Self-heal a checkpoint whose auth identity no longer exists. */
export function discardOnboardingV2CheckpointForMissingIdentity(): Promise<OnboardingV2State> {
  serverSyncGeneration += 1;
  return replaceOnboardingV2AfterIdentityDeletion();
}

/** Test-only seam; never exposed through production UI. */
export async function resetOnboardingV2ForTests(): Promise<void> {
  await replaceOnboardingV2WithInitialLocalState();
}

async function replaceOnboardingV2WithInitialLocalState(): Promise<OnboardingV2State> {
  const operation = mutationQueue.then(async () => {
    await AsyncStorage.removeItem(ONBOARDING_V2_STORAGE_KEY);
    const initial = createInitialOnboardingV2State();
    publish(initial);
    return initial;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

/** Guarded local slice used by the development reset orchestrator. */
export async function resetOnboardingV2LocalStateForDevelopment(): Promise<OnboardingV2State> {
  if (!canRunOnboardingV2DevelopmentReset(getResolvedEnvironment())) {
    console.warn(ONBOARDING_DEV_RESET_BLOCKED_NON_DEV);
    throw new Error(ONBOARDING_DEV_RESET_BLOCKED_NON_DEV);
  }
  serverSyncGeneration += 1;
  return replaceOnboardingV2WithInitialLocalState();
}
