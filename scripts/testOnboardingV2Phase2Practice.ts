import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  completePendingSave,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  dismissPracticeRecovery,
  encodeOnboardingV2State,
  failPendingSave,
  freshOnboardingV2StateAfterAccountDeletion,
  onboardingV2SavedPlaceProgress,
  onboardingV2SyncCredentialDecision,
  openExternalStarter,
  planOnboardingPracticeRecovery,
  receiveSharedSource,
  recordPracticeHelpOpened,
  recordPracticeReturnedWithoutShare,
  selectPracticeSource,
  type CompletedOnboardingSave,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  selectPracticeContent,
  starterContentById,
} from '../constants/onboardingStarterContent';

const at = (seconds: number) => `2026-08-21T12:00:${String(seconds).padStart(2, '0')}.000Z`;
const tutorialSave: CompletedOnboardingSave = {
  kind: 'tutorial',
  contentId: 'ig-mad-yolks-santa-cruz',
  sourceUrl: 'https://www.instagram.com/p/C-BEtdnyGdR/',
  normalizedSourceUrl: 'instagram.com/p/c-betdnygdr',
  contentIdentity: { platform: 'instagram', contentId: 'c-betdnygdr' },
  savedPlaceId: 'saved-tutorial',
  completedAt: at(0),
};

function practiceState(stage: OnboardingV2State['stage'] = 'practice_ready'): OnboardingV2State {
  return {
    ...createInitialOnboardingV2State(at(0)),
    cohort: 'new_user_v2',
    stage,
    preferredPlatform: 'tiktok',
    interest: 'food',
    funnelSessionId: 'phase2-session',
    identityLifecycle: 'permanent_account',
    boundUserId: 'user-1',
    permanentUserId: 'user-1',
    permanentAccountEstablished: false,
    authCompletedAt: at(0),
    tutorialSave,
    placeTourClosedAt: at(0),
  };
}

const root = process.cwd();
const map = readFileSync(join(root, 'app/(tabs)/map.tsx'), 'utf8');
const detail = readFileSync(join(root, 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
const coach = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2MapCoachmark.tsx'), 'utf8');
const routing = readFileSync(join(root, 'lib/onboardingV2RoutingCore.ts'), 'utf8');

// 1-4: Phase 1 handoff, exact transferred detail, exact tour target, real map return.
let state = practiceState('place_tour');
assert.equal(state.tutorialSave?.savedPlaceId, 'saved-tutorial');
assert.match(map, /tutorialSave\?\.savedPlaceId/);
assert.match(detail, /onboardingState\.tutorialSave\?\.savedPlaceId === saved\.id/);
assert.doesNotMatch(detail, /closeOnboardingV2PlaceTour/);
assert.match(
  map,
  /const dismissSelectedPlace[\s\S]{0,180}closeOnboardingV2PlaceTour\(selected\.id\)/,
  'map dismissal owns the single durable Place Detail close transition',
);

// 5-7: personalization, preview-before-open, and real external URL.
const pool = selectPracticeContent({ platform: 'tiktok', interest: 'food', excludeContentIds: [tutorialSave.contentId] });
assert.equal(pool[0]?.platform, 'tiktok');
assert.equal(pool[0]?.category, 'food');
assert.match(coach, /TRY THIS ONE[\s\S]*openSource\(selected\)/);
assert.match(coach, /Linking\.openURL\(card\.sourceUrl\)/);

const first = pool[0]!;
state = practiceState();
state = selectPracticeSource(state, first.id, at(1)).state;
state = openExternalStarter(state, { contentId: first.id, sourceUrl: first.sourceUrl }, at(2)).state;

// 8-9: bounded return recovery and delayed-share grace.
const wait = planOnboardingPracticeRecovery({
  pendingShare: state.pendingShare,
  backgroundedAt: at(3),
  returnedAt: at(7),
  now: at(8),
});
assert.equal(wait.status, 'wait');
const offer = planOnboardingPracticeRecovery({
  pendingShare: state.pendingShare,
  backgroundedAt: at(3),
  returnedAt: at(7),
  now: at(14),
});
assert.equal(offer.status, 'offer');
if (offer.status === 'offer') {
  state = recordPracticeReturnedWithoutShare(state, {
    attemptId: state.pendingShare!.attemptId,
    returnedAt: offer.returnedAt,
    helpEligibleAt: offer.helpEligibleAt,
  }, at(14)).state;
}
state = recordPracticeHelpOpened(state, at(15)).state;
assert.ok(state.practiceRecovery?.helpOfferedAt);
state = dismissPracticeRecovery(state, at(16)).state;
assert.ok(state.practiceRecovery?.dismissedAt);

// 10: first authoritative distinct save advances to 2/3.
state = receiveSharedSource(state, first.sourceUrl, at(17)).state;
state = completePendingSave(state, { sourceUrl: first.sourceUrl, savedPlaceId: 'saved-first' }, at(18)).state;
assert.equal(onboardingV2SavedPlaceProgress(state).count, 2);

// 11: a source resolving to the existing tutorial place cannot increment.
const second = pool[1]!;
state = selectPracticeSource(state, second.id, at(19)).state;
state = openExternalStarter(state, { contentId: second.id, sourceUrl: second.sourceUrl }, at(20)).state;
state = receiveSharedSource(state, second.sourceUrl, at(21)).state;
state = completePendingSave(state, { sourceUrl: second.sourceUrl, savedPlaceId: 'saved-tutorial' }, at(22)).state;
assert.equal(onboardingV2SavedPlaceProgress(state).count, 2);
assert.equal(state.lastFailure?.reason, 'duplicate_place');

// 12: the normal candidate confirmation path counts only once a saved_places ID exists.
const third = pool[2]!;
state = selectPracticeSource(state, third.id, at(23), true).state;
state = openExternalStarter(state, { contentId: third.id, sourceUrl: third.sourceUrl }, at(24)).state;
state = receiveSharedSource(state, third.sourceUrl, at(25)).state;
assert.equal(onboardingV2SavedPlaceProgress(state).count, 2);

// 13: failures keep progress stable.
const failed = failPendingSave(state, 'not_enough', at(26)).state;
assert.equal(onboardingV2SavedPlaceProgress(failed).count, 2);

// 14: rotation excludes every opened source.
const replacement = selectPracticeContent({
  platform: failed.preferredPlatform,
  interest: failed.interest,
  excludeContentIds: [failed.tutorialContentId!, ...failed.practiceAttemptedContentIds],
  limit: 1,
  rotationKey: 'replacement',
})[0];
assert.ok(replacement);
assert.ok(!failed.practiceAttemptedContentIds.includes(replacement!.id));

// 15: a second distinct saved place reaches 3/3 and the existing graduation stage.
state = completePendingSave(state, { sourceUrl: third.sourceUrl, savedPlaceId: 'saved-second' }, at(27)).state;
assert.equal(onboardingV2SavedPlaceProgress(state).count, 3);
assert.equal(state.stage, 'graduated');

// 16-17: force-close restores both 1/3 and 2/3 permanent-account checkpoints.
const oneOfThree = decodeOnboardingV2State(encodeOnboardingV2State(practiceState()));
assert.equal(onboardingV2SavedPlaceProgress(oneOfThree).count, 1);
assert.equal(oneOfThree.stage, 'practice_ready');
assert.equal(oneOfThree.identityLifecycle, 'permanent_account');
assert.equal(onboardingV2SyncCredentialDecision(oneOfThree, {
  userId: 'user-1',
  accessToken: 'permanent-account-jwt',
}).allowed, true);
const twoOfThree = { ...practiceState('first_independent_save_complete'), independentSaves: [state.independentSaves[0]!] };
const restoredTwoOfThree = decodeOnboardingV2State(encodeOnboardingV2State(twoOfThree));
assert.equal(onboardingV2SavedPlaceProgress(restoredTwoOfThree).count, 2);
assert.equal(restoredTwoOfThree.stage, 'first_independent_save_complete');
assert.equal(restoredTwoOfThree.identityLifecycle, 'permanent_account');
assert.equal(onboardingV2SyncCredentialDecision(restoredTwoOfThree, {
  userId: 'user-1',
  accessToken: 'permanent-account-jwt',
}).allowed, true);

// 18: deletion is a hard Phase 2 identity boundary.
assert.equal(freshOnboardingV2StateAfterAccountDeletion(twoOfThree, at(28)).stage, 'not_started');

// 19-20: development reset and the sole root-routing authority remain wired.
assert.ok(readFileSync(join(root, 'lib/onboardingV2DevResetCore.ts'), 'utf8').includes('canRunOnboardingV2DevelopmentReset'));
assert.match(routing, /place_tour/);
assert.match(readFileSync(join(root, 'app/_layout.tsx'), 'utf8'), /expectedOnboardingV2Route/);

// 21: current-main immersive Phase 1 remains authoritative and keeps its
// visible startup recovery rather than being replaced by the older branch.
const activation = readFileSync(
  join(root, 'components/onboarding/v2/OnboardingV2Activation.tsx'),
  'utf8',
);
assert.match(activation, /<ImmersiveGuidedSave/);
assert.match(activation, /title="Save to my map"/);
assert.match(activation, /<StartupSurface/);
assert.match(activation, /useStartupWatchdog/);

// 22: the proven black-screen protections are present on top of current main.
const preAuth = readFileSync(
  join(root, 'components/onboarding/v2/OnboardingV2PreAuth.tsx'),
  'utf8',
);
assert.match(preAuth, /useAuth\(\)/);
assert.match(preAuth, /ANONYMOUS_BOOTSTRAP_TIMEOUT_MS/);
assert.match(preAuth, /anonymousSessionReady/);
assert.match(preAuth, /<StartupSurface/);
assert.match(preAuth, /useStartupWatchdog/);

assert.ok(starterContentById(first.id));
console.log('PASS 22 focused Onboarding V2 Phase 2 + black-screen integration regressions');
