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
  beginOnboardingSecondHalf,
  beginOnboardingInAppTutorialResolution,
  beginPermanentAccountLink,
  bindAnonymousUser,
  bypassExistingUser,
  cancelPermanentAccountLink,
  completeOnboardingSecondHalf,
  continueOnboardingAfterMakingNearrYours,
  continueOnboardingFromPersonalizedPayoff,
  closePlaceTour,
  completeOnboardingInterests,
  completeOnboardingPlatforms,
  confirmOnboardingFirstMagicMoment,
  completePermanentAccountLink,
  continueOnboardingAfterAuth,
  continueOnboardingToAccount,
  continueOnboardingToLocationEducation,
  continueOnboardingToNearbyValue,
  completePendingSave,
  continueToTutorial,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  dismissPracticeRecovery,
  encodeOnboardingV2State,
  failPendingSave,
  failOnboardingTutorialFixture,
  failOnboardingAuth,
  finishOnboardingFirstMagicMoment,
  freshOnboardingV2StateAfterAccountDeletion,
  isExpectedOnboardingSource,
  isOnboardingV2InProgressState,
  observeOnboardingResult,
  observeOnboardingTutorialJob,
  observeWrongOnboardingTutorialJob,
  onboardingV2SyncCredentialDecision,
  onboardingV2ResumeEligibility,
  openExternalStarter,
  openPlaceTour,
  openStarterShelf,
  recordPracticeHelpOpened,
  recordOnboardingBackgroundLocationResult,
  recordOnboardingForegroundLocationResult,
  recordOnboardingNotificationResult,
  recordPracticeReturnedWithoutShare,
  receiveSharedSource,
  receiveOnboardingTutorialFixture,
  resolveOnboardingTutorialResult,
  retryOnboardingTutorialShare,
  resumePhase2AfterCompletedPhase1,
  replaceTutorialContent,
  recordStarterImpressions,
  selectInterest,
  selectOnboardingPainPoint,
  selectOnboardingDesiredValue,
  selectOnboardingPrimaryPlatformDraft,
  selectPracticeSource,
  selectPlatform,
  showOnboardingCelebration,
  showOnboardingActivationChallenge,
  showOnboardingShareInstructions,
  showStarterPrompt,
  startOnboardingV2,
  startOnboardingAuth,
  requestOnboardingMapBackup,
  tapGetStarted,
  toggleOnboardingInterest,
  toggleOnboardingPlatform,
  launchOnboardingTutorial,
  migrateInterruptedOnboardingToFirstMagic,
  type OnboardingInterest,
  type OnboardingActivationChoice,
  type OnboardingDesiredValue,
  type OnboardingPainPoint,
  type OnboardingPermissionResult,
  type OnboardingPlatform,
  type OnboardingTutorialFixture,
  type OnboardingTutorialResult,
  type OnboardingResultClass,
  type OnboardingTransition,
  type OnboardingV2State,
  type SimulatedTutorialAction,
} from '@/lib/onboardingV2Core';
import type { OnboardingStarterContent } from '@/constants/onboardingStarterContent';
import { saveSavedPlace } from '@/services/savedPlacesService';

export const ONBOARDING_V2_STORAGE_KEY = 'nearr:onboarding:v2:state';

export type OnboardingV2EventName =
  | 'onboarding_v2_started'
  | 'onboarding_platform_selection_completed'
  | 'onboarding_interests_completed'
  | 'onboarding_personalized_payoff_viewed'
  | 'onboarding_pain_point_completed'
  | 'onboarding_desired_value_selected'
  | 'onboarding_tutorial_challenge_shown'
  | 'onboarding_magic_post_shown'
  | 'onboarding_demo_viewed'
  | 'onboarding_find_place_tapped'
  | 'onboarding_fixture_resolution_started'
  | 'onboarding_magic_processing_started'
  | 'onboarding_tutorial_launched'
  | 'onboarding_tutorial_share_received'
  | 'onboarding_tutorial_processing_started'
  | 'onboarding_tutorial_wrong_source'
  | 'onboarding_tutorial_fixture_resolved'
  | 'onboarding_place_reveal_shown'
  | 'onboarding_first_tutorial_save_completed'
  | 'onboarding_first_save_celebration_shown'
  | 'onboarding_why_nearr_viewed'
  | 'onboarding_share_education_shown'
  | 'onboarding_nearby_value_viewed'
  | 'onboarding_location_education_shown'
  | 'onboarding_location_permission_requested'
  | 'onboarding_location_permission_result'
  | 'onboarding_notification_education_shown'
  | 'onboarding_notification_permission_requested'
  | 'onboarding_notification_permission_result'
  | 'onboarding_making_nearr_yours_viewed'
  | 'onboarding_growing_map_viewed'
  | 'onboarding_auth_viewed'
  | 'onboarding_auth_started'
  | 'onboarding_auth_completed'
  | 'onboarding_auth_failed'
  | 'onboarding_personalized_activation_shown'
  | 'onboarding_activation_challenge_shown'
  | 'onboarding_activation_choice'
  | 'onboarding_map_ready_viewed'
  | 'onboarding_map_backup_started'
  | 'onboarding_map_backup_completed'
  | 'onboarding_v2_completed'
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

function elapsedMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null;
}

async function emitEvents(events: OnboardingTransition['events'], state: OnboardingV2State): Promise<void> {
  const context = {
    primary_platform: state.preferredPlatform,
    interests: state.selectedInterests,
    pain_point: state.painPoint,
    desired_value: state.desiredValue,
    fixture_id: state.tutorialFixture?.id ?? state.tutorialResult?.fixtureId ?? null,
    time_to_first_save: elapsedMs(state.startedAt, state.tutorialSave?.completedAt ?? null),
    time_to_magic_moment: elapsedMs(state.startedAt, state.firstMagicMomentCompletedAt),
    time_to_map: elapsedMs(state.startedAt, state.onboardingV2CompletedAt),
    location_foreground_result: state.locationForegroundResult,
    location_background_result: state.locationBackgroundResult,
    notification_permission_result: state.notificationPermissionResult,
    auth_provider: state.authProvider,
  };
  await Promise.all(
    events.map((event) =>
      trackEvent(event.name as OnboardingV2EventName, {
        onboarding_version: 2,
        ...context,
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
    void emitEvents(result.events, result.state);
    const reachedDurableCompletion =
      (!current.phase1CompletedAt && !!result.state.phase1CompletedAt) ||
      (!current.behavioralCompletedAt && !!result.state.behavioralCompletedAt);
    if (reachedDurableCompletion && result.state.boundUserId) {
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

export function toggleOnboardingV2Platform(platform: OnboardingPlatform): Promise<OnboardingV2State> {
  return applyTransition((state, now) => toggleOnboardingPlatform(state, platform, now));
}

export function chooseOnboardingV2PrimaryPlatform(platform: OnboardingPlatform): Promise<OnboardingV2State> {
  return applyTransition((state, now) => selectOnboardingPrimaryPlatformDraft(state, platform, now));
}

export function completeOnboardingV2Platforms(): Promise<OnboardingV2State> {
  return applyTransition(completeOnboardingPlatforms);
}

export function setOnboardingV2Interest(
  interest: OnboardingInterest,
  tutorialContentId: string | null,
): Promise<OnboardingV2State> {
  return applyTransition((state, now) => selectInterest(state, interest, tutorialContentId, now));
}

export function toggleOnboardingV2Interest(interest: OnboardingInterest): Promise<OnboardingV2State> {
  return applyTransition((state, now) => toggleOnboardingInterest(state, interest, now));
}

export function completeOnboardingV2Interests(): Promise<OnboardingV2State> {
  return applyTransition(completeOnboardingInterests);
}

export function continueOnboardingV2FromPersonalizedPayoff(): Promise<OnboardingV2State> {
  return applyTransition(continueOnboardingFromPersonalizedPayoff);
}

export function setOnboardingV2PainPoint(painPoint: OnboardingPainPoint): Promise<OnboardingV2State> {
  return applyTransition((state, now) => selectOnboardingPainPoint(state, painPoint, now));
}

export function setOnboardingV2DesiredValue(desiredValue: OnboardingDesiredValue): Promise<OnboardingV2State> {
  return applyTransition((state, now) => selectOnboardingDesiredValue(state, desiredValue, now));
}

export function migrateInterruptedOnboardingV2ToFirstMagic(): Promise<OnboardingV2State> {
  return applyTransition(migrateInterruptedOnboardingToFirstMagic);
}

export function setOnboardingV2TutorialFixture(fixture: OnboardingTutorialFixture): Promise<OnboardingV2State> {
  return applyTransition((state, now) => receiveOnboardingTutorialFixture(state, fixture, now));
}

export function setOnboardingV2TutorialFixtureError(reason: string): Promise<OnboardingV2State> {
  return applyTransition((state, now) => failOnboardingTutorialFixture(state, reason, now));
}

export function continueOnboardingV2ToShareInstructions(): Promise<OnboardingV2State> {
  return applyTransition(showOnboardingShareInstructions);
}

export function beginOnboardingV2InAppTutorialResolution(): Promise<OnboardingV2State> {
  return applyTransition(beginOnboardingInAppTutorialResolution);
}

export function recordOnboardingV2TutorialLaunch(): Promise<OnboardingV2State> {
  return applyTransition(launchOnboardingTutorial);
}

export function observeOnboardingV2TutorialJob(input: { jobId: string; sourceUrl: string }): Promise<OnboardingV2State> {
  return applyTransition((state, now) => observeOnboardingTutorialJob(state, input, now));
}

export function observeWrongOnboardingV2TutorialJob(jobId: string): Promise<OnboardingV2State> {
  return applyTransition((state, now) => observeWrongOnboardingTutorialJob(state, jobId, now));
}

export function resolveOnboardingV2TutorialResult(result: OnboardingTutorialResult): Promise<OnboardingV2State> {
  return applyTransition((state, now) => resolveOnboardingTutorialResult(state, result, now));
}

export function retryOnboardingV2TutorialShare(): Promise<OnboardingV2State> {
  return applyTransition(retryOnboardingTutorialShare);
}

export function confirmOnboardingV2FirstMagicMoment(): Promise<OnboardingV2State> {
  return applyTransition(confirmOnboardingFirstMagicMoment);
}

export function recordOnboardingV2CelebrationShown(): Promise<OnboardingV2State> {
  return applyTransition(showOnboardingCelebration);
}

export function finishOnboardingV2FirstMagicMoment(): Promise<OnboardingV2State> {
  return applyTransition(finishOnboardingFirstMagicMoment);
}

export function beginOnboardingV2SecondHalf(): Promise<OnboardingV2State> {
  return applyTransition(beginOnboardingSecondHalf);
}

export function continueOnboardingV2ToNearbyValue(): Promise<OnboardingV2State> {
  return applyTransition(continueOnboardingToNearbyValue);
}

export function continueOnboardingV2ToLocationEducation(): Promise<OnboardingV2State> {
  return applyTransition(continueOnboardingToLocationEducation);
}

export function recordOnboardingV2ForegroundLocationResult(result: OnboardingPermissionResult): Promise<OnboardingV2State> {
  return applyTransition((state, now) => recordOnboardingForegroundLocationResult(state, result, now));
}

export function recordOnboardingV2BackgroundLocationResult(result: OnboardingPermissionResult): Promise<OnboardingV2State> {
  return applyTransition((state, now) => recordOnboardingBackgroundLocationResult(state, result, now));
}

export function recordOnboardingV2NotificationResult(result: OnboardingPermissionResult): Promise<OnboardingV2State> {
  return applyTransition((state, now) => recordOnboardingNotificationResult(state, result, now));
}

export function continueOnboardingV2AfterMakingNearrYours(): Promise<OnboardingV2State> {
  return applyTransition(continueOnboardingAfterMakingNearrYours);
}

export function continueOnboardingV2ToAccount(): Promise<OnboardingV2State> {
  return applyTransition(continueOnboardingToAccount);
}

export function continueOnboardingV2AfterAuth(): Promise<OnboardingV2State> {
  return applyTransition(continueOnboardingAfterAuth);
}

export function showOnboardingV2ActivationChallenge(): Promise<OnboardingV2State> {
  return applyTransition(showOnboardingActivationChallenge);
}

export function completeOnboardingV2SecondHalf(choice: OnboardingActivationChoice): Promise<OnboardingV2State> {
  return applyTransition((state, now) => completeOnboardingSecondHalf(state, choice, now));
}

export function requestOnboardingV2MapBackup(): Promise<OnboardingV2State> {
  return applyTransition(requestOnboardingMapBackup);
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
  await applyTransition((state, now) => startOnboardingAuth(state, method, now));
}

export async function recordOnboardingV2AuthFailed(method: string, result: 'cancelled' | 'failed'): Promise<void> {
  await applyTransition((state, now) => failOnboardingAuth(state, method, result, now));
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
