/**
 * Pure Onboarding V2 state machine.
 *
 * No React Native imports and no I/O. The persisted adapter lives in
 * `lib/onboardingV2.ts`; keeping transitions here makes process-death,
 * duplicate-callback, and wrong-share behavior deterministic and testable.
 */

export const ONBOARDING_V2_VERSION = 2 as const;

export type OnboardingPlatform =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'facebook'
  | 'other';

export type OnboardingInterest =
  | 'food'
  | 'outdoors'
  | 'travel'
  | 'beaches'
  | 'shopping'
  | 'anything';

export type OnboardingV2Stage =
  | 'not_started'
  | 'overview'
  | 'platform'
  | 'platform_selected'
  | 'interest'
  | 'interest_selected'
  | 'tutorial_ready'
  | 'tutorial_share_tapped'
  | 'tutorial_more_tapped'
  | 'tutorial_nearr_selected'
  | 'tutorial_favorite_added'
  | 'tutorial_processing'
  | 'tutorial_result_seen'
  /** Legacy persisted stages; decoded back to tutorial_ready and never emitted by Learn V2. */
  | 'tutorial_external_video_opened'
  | 'tutorial_share_returned'
  | 'account_required'
  | 'place_tour'
  | 'phase1_complete'
  | 'practice_ready'
  | 'first_independent_external_video_opened'
  | 'first_independent_share_returned'
  | 'first_independent_save_complete'
  | 'second_independent_external_video_opened'
  | 'second_independent_share_returned'
  | 'graduated';

const ONBOARDING_V2_STAGES = new Set<OnboardingV2Stage>([
  'not_started', 'overview', 'platform', 'platform_selected', 'interest',
  'interest_selected', 'tutorial_ready', 'tutorial_share_tapped',
  'tutorial_more_tapped', 'tutorial_nearr_selected', 'tutorial_favorite_added',
  'tutorial_processing', 'tutorial_result_seen', 'tutorial_external_video_opened',
  'tutorial_share_returned', 'account_required', 'place_tour', 'phase1_complete',
  'practice_ready', 'first_independent_external_video_opened',
  'first_independent_share_returned', 'first_independent_save_complete',
  'second_independent_external_video_opened', 'second_independent_share_returned',
  'graduated',
]);
const LEGACY_ONBOARDING_V2_STAGES = new Set(['signin']);

const IDENTITY_LIFECYCLES = new Set<OnboardingIdentityLifecycle>([
  'none', 'anonymous_active', 'permanent_account_linking', 'permanent_account',
]);

export type OnboardingSaveKind = 'tutorial' | 'independent_1' | 'independent_2';

export type OnboardingIdentityLifecycle =
  | 'none'
  | 'anonymous_active'
  | 'permanent_account_linking'
  | 'permanent_account';

export type OnboardingContentIdentity = {
  platform: Exclude<OnboardingPlatform, 'other'> | 'web';
  contentId: string;
};

export type PendingOnboardingShare = {
  attemptId: string;
  kind: OnboardingSaveKind;
  contentId: string;
  sourceUrl: string;
  normalizedSourceUrl: string;
  contentIdentity: OnboardingContentIdentity | null;
  openedAt: string;
  shareReceivedAt: string | null;
  resultSeenAt: string | null;
};

export type CompletedOnboardingSave = {
  kind: OnboardingSaveKind;
  contentId: string;
  sourceUrl: string;
  normalizedSourceUrl: string;
  contentIdentity: OnboardingContentIdentity | null;
  savedPlaceId: string;
  completedAt: string;
};

export type OnboardingPracticeRecovery = {
  attemptId: string;
  returnedAt: string;
  helpEligibleAt: string;
  helpOfferedAt: string | null;
  dismissedAt: string | null;
};

export type OnboardingPlaceTourStep =
  | 'found'
  | 'ai_note'
  | 'source'
  | 'directions'
  | 'close';

export type OnboardingV2State = {
  version: typeof ONBOARDING_V2_VERSION;
  revision: number;
  cohort: 'new_user_v2' | 'existing_user_bypassed' | null;
  stage: OnboardingV2Stage;
  preferredPlatform: OnboardingPlatform | null;
  interest: OnboardingInterest | null;
  tutorialContentId: string | null;
  funnelSessionId: string | null;
  identityLifecycle: OnboardingIdentityLifecycle;
  anonymousUserId: string | null;
  boundUserId: string | null;
  authCompletedAt: string | null;
  accountRequiredAt: string | null;
  accountLinkStartedAt: string | null;
  permanentUserId: string | null;
  permanentAccountEstablished: boolean | null;
  pendingShare: PendingOnboardingShare | null;
  tutorialSave: CompletedOnboardingSave | null;
  independentSaves: CompletedOnboardingSave[];
  placeTourStep: OnboardingPlaceTourStep | null;
  placeTourOpenedAt: string | null;
  placeTourClosedAt: string | null;
  phase1CompletedAt: string | null;
  starterPromptShownAt: string | null;
  starterShelfOpenedAt: string | null;
  impressedContentIds: string[];
  practiceContentIds: string[];
  practiceAttemptedContentIds: string[];
  practiceRecovery: OnboardingPracticeRecovery | null;
  lastFailure: { kind: OnboardingSaveKind; at: string; reason: string } | null;
  behavioralCompletedAt: string | null;
  graduationAcknowledgedAt: string | null;
  updatedAt: string;
};

export type OnboardingTransition = {
  state: OnboardingV2State;
  changed: boolean;
  events: Array<{ name: string; properties?: Record<string, unknown> }>;
};

export type OnboardingV2SyncCredentialDecision =
  | { allowed: true }
  | { allowed: false; reason: 'state_not_syncable' | 'session_missing' | 'session_mismatch' | 'token_missing' };

export function onboardingV2SyncCredentialDecision(
  state: Pick<OnboardingV2State, 'funnelSessionId' | 'boundUserId' | 'cohort'>,
  session: { userId: string; accessToken: string } | null,
): OnboardingV2SyncCredentialDecision {
  if (!state.funnelSessionId || !state.boundUserId || state.cohort !== 'new_user_v2') {
    return { allowed: false, reason: 'state_not_syncable' };
  }
  if (!session) return { allowed: false, reason: 'session_missing' };
  if (session.userId !== state.boundUserId) return { allowed: false, reason: 'session_mismatch' };
  if (!session.accessToken.trim()) return { allowed: false, reason: 'token_missing' };
  return { allowed: true };
}

function transition(
  state: OnboardingV2State,
  patch: Partial<OnboardingV2State>,
  now: string,
  events: OnboardingTransition['events'] = [],
): OnboardingTransition {
  const changesSemanticState = (Object.keys(patch) as Array<keyof OnboardingV2State>)
    .some((key) => JSON.stringify(state[key]) !== JSON.stringify(patch[key]));
  if (!changesSemanticState) return unchanged(state);
  return {
    state: { ...state, ...patch, revision: state.revision + 1, updatedAt: now },
    changed: true,
    events,
  };
}

function unchanged(state: OnboardingV2State): OnboardingTransition {
  return { state, changed: false, events: [] };
}

export function createInitialOnboardingV2State(now = new Date().toISOString()): OnboardingV2State {
  return {
    version: ONBOARDING_V2_VERSION,
    revision: 0,
    cohort: null,
    stage: 'not_started',
    preferredPlatform: null,
    interest: null,
    tutorialContentId: null,
    funnelSessionId: null,
    identityLifecycle: 'none',
    anonymousUserId: null,
    boundUserId: null,
    authCompletedAt: null,
    accountRequiredAt: null,
    accountLinkStartedAt: null,
    permanentUserId: null,
    permanentAccountEstablished: null,
    pendingShare: null,
    tutorialSave: null,
    independentSaves: [],
    placeTourStep: null,
    placeTourOpenedAt: null,
    placeTourClosedAt: null,
    phase1CompletedAt: null,
    starterPromptShownAt: null,
    starterShelfOpenedAt: null,
    impressedContentIds: [],
    practiceContentIds: [],
    practiceAttemptedContentIds: [],
    practiceRecovery: null,
    lastFailure: null,
    behavioralCompletedAt: null,
    graduationAcknowledgedAt: null,
    updatedAt: now,
  };
}

export type OnboardingV2ResumeEligibility =
  | { eligible: true; reason: 'eligible' }
  | {
      eligible: false;
      reason:
        | 'identity_missing'
        | 'identity_mismatch'
        | 'identity_lifecycle_mismatch'
        | 'not_resumable_cohort'
        | 'already_completed'
        | 'inconsistent_checkpoint';
    };

const TUTORIAL_SAVE_REQUIRED_STAGES = new Set<OnboardingV2Stage>([
  'account_required',
  'place_tour',
  'phase1_complete',
  'practice_ready',
  'first_independent_external_video_opened',
  'first_independent_share_returned',
  'first_independent_save_complete',
  'second_independent_external_video_opened',
  'second_independent_share_returned',
  'graduated',
]);

/**
 * A checkpoint is resumable only when a currently valid auth identity owns it
 * and its durable references are internally complete. Account deletion passes
 * `identityExists: false`, making stale local JSON categorically ineligible.
 */
export function onboardingV2ResumeEligibility(
  state: OnboardingV2State,
  identity: { userId: string | null | undefined; identityExists: boolean; isAnonymous: boolean },
): OnboardingV2ResumeEligibility {
  const userId = typeof identity.userId === 'string' ? identity.userId.trim() : '';
  if (!identity.identityExists || !userId) return { eligible: false, reason: 'identity_missing' };
  if (state.cohort !== 'new_user_v2') return { eligible: false, reason: 'not_resumable_cohort' };
  // `phase1CompletedAt` is a durable milestone, not completion of the full
  // behavioral journey. A full-Phase-2 client upgrades phase1_complete to
  // practice_ready while preserving that timestamp; that repaired checkpoint
  // must remain resumable after a force-close.
  if (state.behavioralCompletedAt || (state.phase1CompletedAt && state.stage === 'phase1_complete')) {
    return { eligible: false, reason: 'already_completed' };
  }
  if (state.boundUserId !== userId) return { eligible: false, reason: 'identity_mismatch' };

  if (identity.isAnonymous) {
    if (
      !['anonymous_active', 'permanent_account_linking'].includes(state.identityLifecycle) ||
      state.anonymousUserId !== userId
    ) {
      return { eligible: false, reason: 'identity_lifecycle_mismatch' };
    }
  } else if (
    state.identityLifecycle !== 'permanent_account' ||
    state.permanentUserId !== userId
  ) {
    return { eligible: false, reason: 'identity_lifecycle_mismatch' };
  }

  if (!state.funnelSessionId || state.stage === 'not_started') {
    return { eligible: false, reason: 'inconsistent_checkpoint' };
  }
  if (
    (state.stage === 'interest' && !state.preferredPlatform) ||
    ((state.stage === 'interest_selected' || state.stage.startsWith('tutorial_')) &&
      (!state.preferredPlatform || !state.interest || !state.tutorialContentId)) ||
    (TUTORIAL_SAVE_REQUIRED_STAGES.has(state.stage) && !state.tutorialSave?.savedPlaceId)
  ) {
    return { eligible: false, reason: 'inconsistent_checkpoint' };
  }
  return { eligible: true, reason: 'eligible' };
}

/** Account deletion is a hard identity boundary, not a normal Back/sign-out. */
export function freshOnboardingV2StateAfterAccountDeletion(
  _state: OnboardingV2State,
  now = new Date().toISOString(),
): OnboardingV2State {
  return createInitialOnboardingV2State(now);
}

export function encodeOnboardingV2State(state: OnboardingV2State): string {
  return JSON.stringify(state);
}

export function decodeOnboardingV2State(
  raw: string | null | undefined,
  now = new Date().toISOString(),
): OnboardingV2State {
  const initial = createInitialOnboardingV2State(now);
  if (!raw) return initial;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingV2State>;
    if (
      !parsed ||
      parsed.version !== ONBOARDING_V2_VERSION ||
      typeof parsed.stage !== 'string' ||
      (!ONBOARDING_V2_STAGES.has(parsed.stage as OnboardingV2Stage) &&
        !LEGACY_ONBOARDING_V2_STAGES.has(parsed.stage)) ||
      (parsed.identityLifecycle != null &&
        !IDENTITY_LIFECYCLES.has(parsed.identityLifecycle as OnboardingIdentityLifecycle))
    ) {
      return initial;
    }
    const legacyPermanent = !!parsed.authCompletedAt && !!parsed.boundUserId;
    const persistedStage = parsed.stage as string;
    const stage: OnboardingV2Stage = persistedStage === 'signin'
      ? 'interest_selected'
      : persistedStage === 'platform_selected'
        ? 'interest'
        : ['tutorial_external_video_opened', 'tutorial_share_returned'].includes(persistedStage)
          ? 'tutorial_ready'
          : persistedStage as OnboardingV2Stage;
    const pendingShare = parsed.pendingShare
      ? {
          ...parsed.pendingShare,
          contentIdentity: parsed.pendingShare.contentIdentity ??
            extractOnboardingContentIdentity(parsed.pendingShare.sourceUrl),
        }
      : null;
    const tutorialSave = parsed.tutorialSave
      ? {
          ...parsed.tutorialSave,
          contentIdentity: parsed.tutorialSave.contentIdentity ??
            extractOnboardingContentIdentity(parsed.tutorialSave.sourceUrl),
        }
      : null;
    return {
      ...initial,
      ...parsed,
      version: ONBOARDING_V2_VERSION,
      stage,
      identityLifecycle: parsed.identityLifecycle ?? (legacyPermanent ? 'permanent_account' : 'none'),
      permanentUserId: parsed.permanentUserId ?? (legacyPermanent ? parsed.boundUserId ?? null : null),
      pendingShare,
      tutorialSave,
      independentSaves: Array.isArray(parsed.independentSaves)
        ? parsed.independentSaves.map((save) => ({
            ...save,
            contentIdentity: save.contentIdentity ?? extractOnboardingContentIdentity(save.sourceUrl),
          }))
        : [],
      impressedContentIds: Array.isArray(parsed.impressedContentIds)
        ? parsed.impressedContentIds.filter((id): id is string => typeof id === 'string')
        : [],
      practiceContentIds: Array.isArray(parsed.practiceContentIds)
        ? parsed.practiceContentIds.filter((id): id is string => typeof id === 'string').slice(0, 2)
        : [],
      practiceAttemptedContentIds: Array.isArray(parsed.practiceAttemptedContentIds)
        ? parsed.practiceAttemptedContentIds.filter((id): id is string => typeof id === 'string')
        : [],
      practiceRecovery: parsed.practiceRecovery?.attemptId
        ? {
            attemptId: parsed.practiceRecovery.attemptId,
            returnedAt: parsed.practiceRecovery.returnedAt,
            helpEligibleAt: parsed.practiceRecovery.helpEligibleAt,
            helpOfferedAt: parsed.practiceRecovery.helpOfferedAt ?? null,
            dismissedAt: parsed.practiceRecovery.dismissedAt ?? null,
          }
        : null,
    };
  } catch {
    return initial;
  }
}

export function normalizeOnboardingSourceUrl(raw: string): string | null {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let path = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    if (!path) path = '/';

    // Social tracking parameters are deliberately ignored. The post/video
    // identity is host + path; arbitrary redirects and generic feeds never
    // match a curated starter item.
    const identityParams = new URLSearchParams();
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const videoId = parsed.searchParams.get('v');
      if (videoId) identityParams.set('v', videoId);
    }
    const query = identityParams.toString();
    return `${host}${path}${query ? `?${query}` : ''}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Prefer the provider's immutable post/video identifier over URL spelling. */
export function extractOnboardingContentIdentity(
  raw: string,
): OnboardingContentIdentity | null {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'instagram.com') {
      const marker = parts.findIndex((part) => ['p', 'reel', 'reels', 'tv'].includes(part));
      return marker >= 0 && parts[marker + 1]
        ? { platform: 'instagram', contentId: parts[marker + 1].toLowerCase() }
        : null;
    }
    if (host.endsWith('tiktok.com')) {
      const marker = parts.findIndex((part) => part === 'video');
      return marker >= 0 && /^\d+$/.test(parts[marker + 1] ?? '')
        ? { platform: 'tiktok', contentId: parts[marker + 1] }
        : null;
    }
    if (host === 'youtu.be' && parts[0]) {
      return { platform: 'youtube', contentId: parts[0].toLowerCase() };
    }
    if (host === 'youtube.com') {
      const id = url.searchParams.get('v') ??
        (['shorts', 'embed'].includes(parts[0] ?? '') ? parts[1] : null);
      return id ? { platform: 'youtube', contentId: id.toLowerCase() } : null;
    }
    if (host === 'facebook.com' || host === 'fb.watch') {
      const marker = parts.findIndex((part) => ['videos', 'reel'].includes(part));
      const id = marker >= 0 ? parts[marker + 1] : host === 'fb.watch' ? parts[0] : null;
      return id ? { platform: 'facebook', contentId: id.toLowerCase() } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function isExpectedOnboardingSource(
  pending: PendingOnboardingShare | null,
  sourceUrl: string | null | undefined,
): boolean {
  if (!pending || !sourceUrl) return false;
  const incomingIdentity = extractOnboardingContentIdentity(sourceUrl);
  if (pending.contentIdentity && incomingIdentity) {
    return pending.contentIdentity.platform === incomingIdentity.platform &&
      pending.contentIdentity.contentId === incomingIdentity.contentId;
  }
  return normalizeOnboardingSourceUrl(sourceUrl) === pending.normalizedSourceUrl;
}

export function startOnboardingV2(
  state: OnboardingV2State,
  now: string,
): OnboardingTransition {
  if (
    state.stage !== 'not_started' &&
    state.cohort === 'new_user_v2' &&
    !state.behavioralCompletedAt &&
    state.identityLifecycle !== 'permanent_account'
  ) {
    return unchanged(state);
  }
  const fresh = createInitialOnboardingV2State(now);
  return transition(
    fresh,
    { cohort: 'new_user_v2', stage: 'overview' },
    now,
    [{ name: 'onboarding_overview_viewed' }],
  );
}

export function tapGetStarted(state: OnboardingV2State, now: string): OnboardingTransition {
  if (state.cohort !== 'new_user_v2' || state.stage !== 'overview') return unchanged(state);
  return transition(state, { stage: 'platform' }, now, [{ name: 'onboarding_get_started_tapped' }]);
}

export function selectPlatform(
  state: OnboardingV2State,
  platform: OnboardingPlatform,
  now: string,
): OnboardingTransition {
  if (state.cohort !== 'new_user_v2' || state.stage !== 'platform') return unchanged(state);
  return transition(
    state,
    { preferredPlatform: platform, stage: 'interest' },
    now,
    [{ name: 'onboarding_platform_selected', properties: { platform } }],
  );
}

export function selectInterest(
  state: OnboardingV2State,
  interest: OnboardingInterest,
  tutorialContentId: string | null,
  now: string,
): OnboardingTransition {
  if (state.cohort !== 'new_user_v2' || state.stage !== 'interest' || !state.preferredPlatform) {
    return unchanged(state);
  }
  return transition(
    state,
    { interest, tutorialContentId, stage: 'interest_selected' },
    now,
    [{ name: 'onboarding_interest_selected', properties: { interest } }],
  );
}

export function continueToTutorial(state: OnboardingV2State, now: string): OnboardingTransition {
  if (state.stage !== 'interest_selected') return unchanged(state);
  if (!state.tutorialContentId || state.identityLifecycle !== 'anonymous_active') {
    return unchanged(state);
  }
  return transition(state, { stage: 'tutorial_ready' }, now, [
    { name: 'onboarding_tutorial_opened' },
  ]);
}

export type SimulatedTutorialAction =
  | 'share'
  | 'more'
  | 'nearr'
  | 'favorite'
  | 'process'
  | 'result';

/**
 * Advance the Learn-phase simulation one required tap at a time. The pending
 * source is created locally when Share is tapped; no external app, deep link,
 * or Share Extension is involved in the tutorial.
 */
export function advanceSimulatedTutorial(
  state: OnboardingV2State,
  action: SimulatedTutorialAction,
  input: { contentId: string; sourceUrl: string },
  now: string,
): OnboardingTransition {
  if (state.cohort !== 'new_user_v2' || state.tutorialSave) return unchanged(state);
  const normalizedSourceUrl = normalizeOnboardingSourceUrl(input.sourceUrl);
  if (!normalizedSourceUrl || state.tutorialContentId !== input.contentId) return unchanged(state);

  if (action === 'share' && state.stage === 'tutorial_ready') {
    const pendingShare: PendingOnboardingShare = {
      attemptId: `tutorial:${input.contentId}:${now}`,
      kind: 'tutorial',
      contentId: input.contentId,
      sourceUrl: input.sourceUrl,
      normalizedSourceUrl,
      contentIdentity: extractOnboardingContentIdentity(input.sourceUrl),
      openedAt: now,
      shareReceivedAt: now,
      resultSeenAt: null,
    };
    return transition(state, { stage: 'tutorial_share_tapped', pendingShare, lastFailure: null }, now, [
      { name: 'tutorial_share_tapped', properties: { content_id: input.contentId } },
    ]);
  }
  if (action === 'more' && state.stage === 'tutorial_share_tapped') {
    return transition(state, { stage: 'tutorial_more_tapped' }, now, [{ name: 'tutorial_more_tapped' }]);
  }
  if (action === 'nearr' && state.stage === 'tutorial_more_tapped') {
    return transition(state, { stage: 'tutorial_nearr_selected' }, now, [{ name: 'tutorial_nearr_selected' }]);
  }
  if (action === 'favorite' && state.stage === 'tutorial_nearr_selected') {
    return transition(state, { stage: 'tutorial_favorite_added' }, now, [{ name: 'tutorial_favorite_added' }]);
  }
  if (action === 'process' && state.stage === 'tutorial_favorite_added') {
    return transition(state, { stage: 'tutorial_processing' }, now, [{ name: 'tutorial_detective_started' }]);
  }
  if (action === 'result' && state.stage === 'tutorial_processing') {
    const pendingShare = state.pendingShare
      ? { ...state.pendingShare, resultSeenAt: now }
      : null;
    return transition(state, { stage: 'tutorial_result_seen', pendingShare }, now, [
      { name: 'tutorial_detective_result_shown', properties: { result_class: 'found' } },
    ]);
  }
  return unchanged(state);
}

export function backOnboardingV2(state: OnboardingV2State, now: string): OnboardingTransition {
  const previous: Partial<Record<OnboardingV2Stage, OnboardingV2Stage>> = {
    platform: 'overview',
    interest: 'platform',
    interest_selected: 'interest',
    tutorial_ready: 'interest_selected',
    tutorial_share_tapped: 'tutorial_ready',
    tutorial_more_tapped: 'tutorial_share_tapped',
    tutorial_nearr_selected: 'tutorial_more_tapped',
    tutorial_favorite_added: 'tutorial_nearr_selected',
    tutorial_processing: 'tutorial_favorite_added',
    tutorial_result_seen: 'tutorial_favorite_added',
  };
  const stage = previous[state.stage];
  if (!stage) return unchanged(state);
  const clearsAttempt = stage === 'tutorial_ready' || stage === 'interest_selected' || stage === 'interest';
  return transition(
    state,
    { stage, ...(clearsAttempt ? { pendingShare: null, lastFailure: null } : {}) },
    now,
    [{ name: 'onboarding_back_tapped', properties: { from: state.stage, to: stage } }],
  );
}

export function bindAnonymousUser(
  state: OnboardingV2State,
  userId: string,
  funnelSessionId: string,
  now: string,
): OnboardingTransition {
  if (!userId || state.cohort !== 'new_user_v2' || state.stage === 'not_started') {
    return unchanged(state);
  }
  if (state.identityLifecycle === 'permanent_account') return unchanged(state);
  if (state.anonymousUserId && state.anonymousUserId !== userId) return unchanged(state);
  if (
    state.identityLifecycle === 'anonymous_active' &&
    state.boundUserId === userId &&
    state.funnelSessionId === funnelSessionId
  ) return unchanged(state);
  return transition(
    state,
    {
      funnelSessionId,
      identityLifecycle: 'anonymous_active',
      anonymousUserId: userId,
      boundUserId: userId,
    },
    now,
    [{ name: 'onboarding_anonymous_session_established' }],
  );
}

export function beginPermanentAccountLink(
  state: OnboardingV2State,
  now: string,
): OnboardingTransition {
  if (state.stage !== 'account_required' || state.identityLifecycle !== 'anonymous_active') {
    return unchanged(state);
  }
  return transition(state, {
    identityLifecycle: 'permanent_account_linking',
    accountLinkStartedAt: now,
  }, now);
}

export function cancelPermanentAccountLink(
  state: OnboardingV2State,
  now: string,
): OnboardingTransition {
  if (state.identityLifecycle !== 'permanent_account_linking' || state.authCompletedAt) {
    return unchanged(state);
  }
  return transition(state, { identityLifecycle: 'anonymous_active' }, now);
}

export function completePermanentAccountLink(
  state: OnboardingV2State,
  input: {
    permanentUserId: string;
    destinationWasEstablished: boolean;
    tutorialSavedPlaceId?: string | null;
  },
  now: string,
): OnboardingTransition {
  if (!state.tutorialSave || !input.permanentUserId) return unchanged(state);
  const tutorialSave = input.tutorialSavedPlaceId
    ? { ...state.tutorialSave, savedPlaceId: input.tutorialSavedPlaceId }
    : state.tutorialSave;
  if (input.destinationWasEstablished) {
    return transition(state, {
      cohort: 'existing_user_bypassed',
      stage: 'graduated',
      identityLifecycle: 'permanent_account',
      boundUserId: input.permanentUserId,
      permanentUserId: input.permanentUserId,
      permanentAccountEstablished: true,
      authCompletedAt: now,
      graduationAcknowledgedAt: now,
      tutorialSave,
    }, now, [{ name: 'onboarding_signin_completed', properties: { established_account: true } }]);
  }
  return transition(state, {
    stage: 'place_tour',
    identityLifecycle: 'permanent_account',
    boundUserId: input.permanentUserId,
    permanentUserId: input.permanentUserId,
    permanentAccountEstablished: false,
    authCompletedAt: now,
    tutorialSave,
    placeTourStep: 'found',
  }, now, [{ name: 'onboarding_signin_completed', properties: { established_account: false } }]);
}

export function bypassExistingUser(
  state: OnboardingV2State,
  userId: string,
  now: string,
): OnboardingTransition {
  if (state.cohort !== 'new_user_v2' || state.boundUserId !== userId) return unchanged(state);
  if (state.tutorialSave || state.independentSaves.length > 0) return unchanged(state);
  return transition(
    state,
    {
      cohort: 'existing_user_bypassed',
      stage: 'graduated',
      pendingShare: null,
      graduationAcknowledgedAt: now,
    },
    now,
  );
}

function expectedKind(state: OnboardingV2State): OnboardingSaveKind | null {
  if (!state.tutorialSave) return 'tutorial';
  if (state.independentSaves.length === 0) return 'independent_1';
  if (state.independentSaves.length === 1) return 'independent_2';
  return null;
}

export const ONBOARDING_PRACTICE_MIN_EXTERNAL_DWELL_MS = 3_000;
export const ONBOARDING_PRACTICE_SHARE_GRACE_MS = 7_000;

export function onboardingV2SavedPlaceProgress(state: OnboardingV2State): {
  count: 0 | 1 | 2 | 3;
  savedPlaceIds: string[];
} {
  const savedPlaceIds = [...new Set([
    state.tutorialSave?.savedPlaceId,
    ...state.independentSaves.map((save) => save.savedPlaceId),
  ].filter((id): id is string => !!id))].slice(0, 3);
  return { count: savedPlaceIds.length as 0 | 1 | 2 | 3, savedPlaceIds };
}

const PHASE2_MAP_STAGES = new Set<OnboardingV2Stage>([
  // A Phase-1-only release persisted this stage before Phase 2 was enabled.
  // Treat it as a visible continuation immediately while the durable upgrade
  // to practice_ready is queued, so no frame can lose both Practice and its
  // required map controls.
  'phase1_complete',
  'practice_ready',
  'first_independent_external_video_opened',
  'first_independent_share_returned',
  'first_independent_save_complete',
  'second_independent_external_video_opened',
  'second_independent_share_returned',
  'graduated',
]);

export function isOnboardingV2Phase2MapState(state: OnboardingV2State): boolean {
  return state.cohort === 'new_user_v2' && !!state.tutorialSave && PHASE2_MAP_STAGES.has(state.stage);
}

export type OnboardingV2VisibleOwner =
  | 'none'
  | 'graduation'
  | 'practice_loading'
  | 'practice_preview'
  | 'practice_pending'
  | 'practice_recovery'
  | 'practice_failure'
  | 'practice_exhausted';

/**
 * The map's single visible-owner invariant for Phase 2. Every eligible,
 * non-graduated checkpoint resolves to a concrete surface, including the
 * short source-selection window and old phase1_complete checkpoints.
 */
export function resolveOnboardingV2VisibleOwner(input: {
  state: OnboardingV2State | null | undefined;
  phase1Only: boolean;
  selectedSourceAvailable: boolean;
  poolExhausted: boolean;
}): OnboardingV2VisibleOwner {
  const state = input.state;
  if (
    !state ||
    input.phase1Only ||
    state.cohort !== 'new_user_v2' ||
    state.stage === 'place_tour' ||
    !isOnboardingV2Phase2MapState(state)
  ) return 'none';
  if (state.behavioralCompletedAt) {
    return state.graduationAcknowledgedAt ? 'none' : 'graduation';
  }
  if (input.poolExhausted) return 'practice_exhausted';
  if (state.practiceRecovery && !state.practiceRecovery.dismissedAt) return 'practice_recovery';
  if (state.lastFailure && state.lastFailure.kind !== 'tutorial') return 'practice_failure';
  if (state.pendingShare?.kind === 'independent_1' || state.pendingShare?.kind === 'independent_2') {
    return 'practice_pending';
  }
  if (input.selectedSourceAvailable) return 'practice_preview';
  return 'practice_loading';
}

export function selectPracticeSource(
  state: OnboardingV2State,
  contentId: string,
  now: string,
  replace = false,
): OnboardingTransition {
  if (
    state.cohort !== 'new_user_v2' ||
    state.identityLifecycle !== 'permanent_account' ||
    state.behavioralCompletedAt ||
    !state.tutorialSave ||
    !contentId
  ) return unchanged(state);
  const slot = state.independentSaves.length;
  if (slot > 1) return unchanged(state);
  const excluded = new Set([
    state.tutorialContentId,
    ...state.independentSaves.map((save) => save.contentId),
    ...state.practiceAttemptedContentIds,
  ].filter((id): id is string => !!id));
  if (excluded.has(contentId)) return unchanged(state);
  const current = state.practiceContentIds[slot];
  if (current && !replace) return unchanged(state);
  const practiceContentIds = state.practiceContentIds.slice(0, slot);
  practiceContentIds[slot] = contentId;
  const practiceAttemptedContentIds = replace && current && !state.practiceAttemptedContentIds.includes(current)
    ? [...state.practiceAttemptedContentIds, current]
    : state.practiceAttemptedContentIds;
  return transition(state, {
    practiceContentIds,
    practiceAttemptedContentIds,
    stage: replace
      ? (slot === 0 ? 'practice_ready' : 'first_independent_save_complete')
      : state.stage,
    pendingShare: replace ? null : state.pendingShare,
    lastFailure: replace ? null : state.lastFailure,
    practiceRecovery: null,
  }, now, [{ name: 'practice_started', properties: { content_id: contentId, save_number: slot + 2 } }]);
}

export function openExternalStarter(
  state: OnboardingV2State,
  input: { contentId: string; sourceUrl: string },
  now: string,
): OnboardingTransition {
  if (state.cohort !== 'new_user_v2' || state.behavioralCompletedAt) return unchanged(state);
  const kind = expectedKind(state);
  const normalizedSourceUrl = normalizeOnboardingSourceUrl(input.sourceUrl);
  if (!kind || !normalizedSourceUrl) return unchanged(state);
  if (state.independentSaves.some((save) => save.normalizedSourceUrl === normalizedSourceUrl)) {
    return unchanged(state);
  }
  if (kind === 'tutorial' && state.tutorialContentId !== input.contentId) return unchanged(state);
  if (kind !== 'tutorial') {
    const slot = kind === 'independent_1' ? 0 : 1;
    if (state.practiceContentIds[slot] !== input.contentId) return unchanged(state);
  }
  const pendingShare: PendingOnboardingShare = {
    attemptId: `${kind}:${input.contentId}:${now}`,
    kind,
    contentId: input.contentId,
    sourceUrl: input.sourceUrl,
    normalizedSourceUrl,
    contentIdentity: extractOnboardingContentIdentity(input.sourceUrl),
    openedAt: now,
    shareReceivedAt: null,
    resultSeenAt: null,
  };
  const stage: OnboardingV2Stage =
    kind === 'tutorial'
      ? 'tutorial_external_video_opened'
      : kind === 'independent_1'
        ? 'first_independent_external_video_opened'
        : 'second_independent_external_video_opened';
  const event = kind === 'tutorial'
    ? 'tutorial_video_opened'
    : kind === 'independent_1'
      ? 'first_independent_video_opened'
      : 'second_independent_video_opened';
  return transition(state, {
    pendingShare,
    stage,
    lastFailure: null,
    practiceRecovery: null,
    practiceAttemptedContentIds: kind === 'tutorial' || state.practiceAttemptedContentIds.includes(input.contentId)
      ? state.practiceAttemptedContentIds
      : [...state.practiceAttemptedContentIds, input.contentId],
  }, now, [
    { name: event, properties: { content_id: input.contentId } },
    ...(kind === 'tutorial' ? [] : [
      { name: 'starter_card_opened', properties: { content_id: input.contentId } },
      { name: 'practice_source_opened', properties: { content_id: input.contentId } },
    ]),
  ]);
}

export function replaceTutorialContent(
  state: OnboardingV2State,
  contentId: string,
  now: string,
): OnboardingTransition {
  if (
    state.cohort !== 'new_user_v2' ||
    state.tutorialSave ||
    !contentId ||
    state.tutorialContentId === contentId
  ) {
    return unchanged(state);
  }
  return transition(
    state,
    { tutorialContentId: contentId, pendingShare: null, stage: 'tutorial_ready', lastFailure: null },
    now,
  );
}

export function receiveSharedSource(
  state: OnboardingV2State,
  sourceUrl: string,
  now: string,
): OnboardingTransition {
  if (!isExpectedOnboardingSource(state.pendingShare, sourceUrl)) return unchanged(state);
  const pending = state.pendingShare!;
  if (pending.shareReceivedAt) return unchanged(state);
  const stage: OnboardingV2Stage = pending.kind === 'tutorial'
    ? 'tutorial_share_returned'
    : pending.kind === 'independent_1'
      ? 'first_independent_share_returned'
      : 'second_independent_share_returned';
  const event = pending.kind === 'tutorial'
    ? 'tutorial_detective_started'
    : pending.kind === 'independent_1'
      ? 'first_independent_save_started'
      : 'second_independent_save_started';
  return transition(
    state,
    { stage, pendingShare: { ...pending, shareReceivedAt: now } },
    now,
    [
      ...(pending.kind === 'tutorial'
        ? [{ name: 'tutorial_share_received', properties: { content_id: pending.contentId } }]
        : [{ name: 'practice_share_received', properties: { content_id: pending.contentId } }]),
      { name: event, properties: { content_id: pending.contentId } },
    ],
  );
}

export type OnboardingResultClass = 'found' | 'uncertain' | 'multiple' | 'not_enough';

export function observeOnboardingResult(
  state: OnboardingV2State,
  sourceUrl: string,
  result: OnboardingResultClass,
  now: string,
): OnboardingTransition {
  if (!isExpectedOnboardingSource(state.pendingShare, sourceUrl)) return unchanged(state);
  const pending = state.pendingShare!;
  if (pending.resultSeenAt) return unchanged(state);
  if (pending.kind !== 'tutorial' && result === 'not_enough') {
    return failPendingSave(state, 'not_enough', now);
  }
  return transition(
    state,
    {
      stage: pending.kind === 'tutorial' ? 'tutorial_result_seen' : state.stage,
      pendingShare: { ...pending, resultSeenAt: now },
    },
    now,
    pending.kind === 'tutorial'
      ? [{ name: 'tutorial_detective_result_shown', properties: { result_class: result } }]
      : [],
  );
}

export function completePendingSave(
  state: OnboardingV2State,
  input: { sourceUrl: string; savedPlaceId: string },
  now: string,
): OnboardingTransition {
  if (!isExpectedOnboardingSource(state.pendingShare, input.sourceUrl)) return unchanged(state);
  if (!input.savedPlaceId) return unchanged(state);
  const pending = state.pendingShare!;
  if (pending.kind === 'tutorial' && state.stage !== 'tutorial_result_seen') return unchanged(state);
  if (onboardingV2SavedPlaceProgress(state).savedPlaceIds.includes(input.savedPlaceId)) {
    if (pending.kind === 'tutorial') return unchanged(state);
    return transition(state, {
      lastFailure: { kind: pending.kind, at: now, reason: 'duplicate_place' },
      pendingShare: null,
      practiceRecovery: null,
    }, now, [{
      name: pending.kind === 'independent_1'
        ? 'first_independent_save_failed'
        : 'second_independent_save_failed',
      properties: { reason: 'duplicate_place' },
    }]);
  }
  const save: CompletedOnboardingSave = {
    kind: pending.kind,
    contentId: pending.contentId,
    sourceUrl: input.sourceUrl,
    normalizedSourceUrl: pending.normalizedSourceUrl,
    contentIdentity: pending.contentIdentity,
    savedPlaceId: input.savedPlaceId,
    completedAt: now,
  };

  if (pending.kind === 'tutorial') {
    return transition(
      state,
      {
        stage: 'account_required',
        pendingShare: null,
        tutorialSave: save,
        accountRequiredAt: now,
        placeTourStep: null,
      },
      now,
      [
        ...(pending.shareReceivedAt
          ? []
          : [{ name: 'tutorial_detective_started', properties: { content_id: pending.contentId } }]),
        ...(pending.resultSeenAt
          ? []
          : [{ name: 'tutorial_detective_result_shown', properties: { result_class: 'found' } }]),
        { name: 'tutorial_detective_result_confirmed', properties: { saved_place_id: input.savedPlaceId } },
        { name: 'onboarding_account_viewed' },
      ],
    );
  }

  const independentSaves = [...state.independentSaves, save];
  if (independentSaves.length === 1) {
    return transition(
      state,
      { stage: 'first_independent_save_complete', pendingShare: null, independentSaves, practiceRecovery: null },
      now,
      [
        ...(pending.shareReceivedAt
          ? []
          : [{ name: 'first_independent_save_started', properties: { content_id: pending.contentId } }]),
        { name: 'first_independent_save_completed', properties: { saved_place_id: input.savedPlaceId } },
        { name: 'practice_place_saved', properties: { saved_place_id: input.savedPlaceId, progress: 2 } },
        { name: 'practice_progress_2_of_3' },
      ],
    );
  }

  return transition(
    state,
    {
      stage: 'graduated',
      pendingShare: null,
      independentSaves: independentSaves.slice(0, 2),
      behavioralCompletedAt: now,
      practiceRecovery: null,
    },
    now,
    [
      ...(pending.shareReceivedAt
        ? []
        : [{ name: 'second_independent_save_started', properties: { content_id: pending.contentId } }]),
      { name: 'second_independent_save_completed', properties: { saved_place_id: input.savedPlaceId } },
      { name: 'practice_place_saved', properties: { saved_place_id: input.savedPlaceId, progress: 3 } },
      { name: 'practice_progress_3_of_3' },
      { name: 'behavioral_onboarding_completed' },
    ],
  );
}

export function failPendingSave(
  state: OnboardingV2State,
  reason: string,
  now: string,
): OnboardingTransition {
  const pending = state.pendingShare;
  if (!pending) return unchanged(state);
  const event = pending.kind === 'independent_1'
    ? 'first_independent_save_failed'
    : pending.kind === 'independent_2'
      ? 'second_independent_save_failed'
      : null;
  return transition(
    state,
    { lastFailure: { kind: pending.kind, at: now, reason } },
    now,
    event ? [{ name: event, properties: { reason } }] : [],
  );
}

export type OnboardingPracticeRecoveryPlan =
  | { status: 'ignore' }
  | { status: 'wait'; delayMs: number }
  | { status: 'offer'; returnedAt: string; helpEligibleAt: string };

export function planOnboardingPracticeRecovery(input: {
  pendingShare: PendingOnboardingShare | null;
  backgroundedAt: string | null;
  returnedAt: string;
  now: string;
}): OnboardingPracticeRecoveryPlan {
  const pending = input.pendingShare;
  if (!pending || pending.kind === 'tutorial' || pending.shareReceivedAt) return { status: 'ignore' };
  const backgroundedMs = input.backgroundedAt ? Date.parse(input.backgroundedAt) : Number.NaN;
  const returnedMs = Date.parse(input.returnedAt);
  const nowMs = Date.parse(input.now);
  const openedMs = Date.parse(pending.openedAt);
  if (![backgroundedMs, returnedMs, nowMs, openedMs].every(Number.isFinite)) return { status: 'ignore' };
  if (returnedMs - Math.max(backgroundedMs, openedMs) < ONBOARDING_PRACTICE_MIN_EXTERNAL_DWELL_MS) {
    return { status: 'ignore' };
  }
  const eligibleMs = returnedMs + ONBOARDING_PRACTICE_SHARE_GRACE_MS;
  if (nowMs < eligibleMs) return { status: 'wait', delayMs: eligibleMs - nowMs };
  return {
    status: 'offer',
    returnedAt: new Date(returnedMs).toISOString(),
    helpEligibleAt: new Date(eligibleMs).toISOString(),
  };
}

export function recordPracticeReturnedWithoutShare(
  state: OnboardingV2State,
  input: { attemptId: string; returnedAt: string; helpEligibleAt: string },
  now: string,
): OnboardingTransition {
  const pending = state.pendingShare;
  if (!pending || pending.kind === 'tutorial' || pending.shareReceivedAt || pending.attemptId !== input.attemptId) {
    return unchanged(state);
  }
  if (state.practiceRecovery?.attemptId === pending.attemptId) return unchanged(state);
  return transition(state, {
    practiceRecovery: { ...input, helpOfferedAt: null, dismissedAt: null },
  }, now, [{ name: 'practice_returned_without_share', properties: { content_id: pending.contentId } }]);
}

export function recordPracticeHelpOpened(state: OnboardingV2State, now: string): OnboardingTransition {
  const recovery = state.practiceRecovery;
  if (!recovery || recovery.dismissedAt || recovery.helpOfferedAt) return unchanged(state);
  return transition(state, { practiceRecovery: { ...recovery, helpOfferedAt: now } }, now, [
    { name: 'practice_help_opened' },
  ]);
}

export function dismissPracticeRecovery(state: OnboardingV2State, now: string): OnboardingTransition {
  const recovery = state.practiceRecovery;
  if (!recovery || recovery.dismissedAt) return unchanged(state);
  return transition(state, { practiceRecovery: { ...recovery, dismissedAt: now } }, now);
}

export function openPlaceTour(
  state: OnboardingV2State,
  savedPlaceId: string,
  now: string,
): OnboardingTransition {
  if (state.stage !== 'place_tour' || state.tutorialSave?.savedPlaceId !== savedPlaceId) {
    return unchanged(state);
  }
  if (state.placeTourOpenedAt) return unchanged(state);
  return transition(state, { placeTourOpenedAt: now, placeTourStep: 'found' }, now, [
    { name: 'first_place_opened_after_signup', properties: { saved_place_id: savedPlaceId } },
    { name: 'place_tour_started', properties: { saved_place_id: savedPlaceId } },
  ]);
}

export function advancePlaceTour(
  state: OnboardingV2State,
  availability: { aiNote: boolean; source: boolean },
  now: string,
): OnboardingTransition {
  if (state.stage !== 'place_tour' || !state.placeTourStep) return unchanged(state);
  let next: OnboardingPlaceTourStep;
  const events: OnboardingTransition['events'] = [];
  if (state.placeTourStep === 'found') {
    next = availability.source ? 'source' : 'directions';
  } else if (state.placeTourStep === 'ai_note') {
    events.push({ name: 'place_tour_ai_note_seen' });
    next = availability.source ? 'source' : 'directions';
  } else if (state.placeTourStep === 'source') {
    events.push({ name: 'place_tour_source_seen' });
    next = 'directions';
  } else if (state.placeTourStep === 'directions') {
    events.push({ name: 'place_tour_directions_seen' });
    next = 'close';
  } else {
    return unchanged(state);
  }
  return transition(state, { placeTourStep: next }, now, events);
}

export function closePlaceTour(
  state: OnboardingV2State,
  savedPlaceId: string,
  now: string,
  options: { phase1Only?: boolean } = {},
): OnboardingTransition {
  if (state.stage !== 'place_tour' || state.tutorialSave?.savedPlaceId !== savedPlaceId) {
    return unchanged(state);
  }
  return transition(
    state,
    options.phase1Only
      ? {
          stage: 'phase1_complete',
          placeTourClosedAt: now,
          placeTourStep: null,
          phase1CompletedAt: now,
        }
      : { stage: 'practice_ready', placeTourClosedAt: now, placeTourStep: null },
    now,
    [
      { name: 'place_tour_closed', properties: { saved_place_id: savedPlaceId } },
      ...(options.phase1Only ? [{ name: 'onboarding_phase1_completed' }] : []),
    ],
  );
}

/**
 * Upgrade the exact checkpoint written by the Phase-1-only production OTA.
 * The Phase 1 milestone and identity stay intact; only ownership moves from a
 * terminal Phase-1 surface to the visible Phase 2 practice surface.
 */
export function resumePhase2AfterCompletedPhase1(
  state: OnboardingV2State,
  now: string,
): OnboardingTransition {
  if (
    state.cohort !== 'new_user_v2' ||
    state.stage !== 'phase1_complete' ||
    !state.phase1CompletedAt ||
    !state.tutorialSave ||
    state.identityLifecycle !== 'permanent_account' ||
    !state.permanentUserId ||
    state.behavioralCompletedAt
  ) return unchanged(state);
  return transition(state, { stage: 'practice_ready' }, now, [
    { name: 'practice_started', properties: { resumed_after_phase1: true } },
  ]);
}

export function showStarterPrompt(state: OnboardingV2State, now: string): OnboardingTransition {
  if (state.cohort !== 'new_user_v2' || state.starterPromptShownAt) return unchanged(state);
  return transition(state, { starterPromptShownAt: now }, now, [
    { name: 'starter_map_prompt_shown' },
  ]);
}

export function openStarterShelf(state: OnboardingV2State, now: string): OnboardingTransition {
  if (state.cohort !== 'new_user_v2' || state.behavioralCompletedAt) return unchanged(state);
  return transition(state, { starterShelfOpenedAt: now }, now, [
    { name: 'starter_video_shelf_opened' },
  ]);
}

export function recordStarterImpressions(
  state: OnboardingV2State,
  contentIds: string[],
  now: string,
): OnboardingTransition {
  const unseen = contentIds.filter((id) => id && !state.impressedContentIds.includes(id));
  if (unseen.length === 0) return unchanged(state);
  return transition(
    state,
    { impressedContentIds: [...state.impressedContentIds, ...unseen] },
    now,
    unseen.map((contentId) => ({ name: 'starter_card_impression', properties: { content_id: contentId } })),
  );
}

export function acknowledgeGraduation(
  state: OnboardingV2State,
  now: string,
): OnboardingTransition {
  if (!state.behavioralCompletedAt || state.graduationAcknowledgedAt) return unchanged(state);
  return transition(state, { graduationAcknowledgedAt: now }, now);
}

export function isOnboardingV2InProgressState(state: OnboardingV2State): boolean {
  return state.cohort === 'new_user_v2' &&
    !state.behavioralCompletedAt &&
    state.stage !== 'phase1_complete' &&
    state.stage !== 'graduated';
}
