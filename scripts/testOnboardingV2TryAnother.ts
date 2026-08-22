import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ONBOARDING_STARTER_CONTENT,
  getNextPracticeSource,
} from '../constants/onboardingStarterContent';
import {
  completePendingSave,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  onboardingV2SavedPlaceProgress,
  openExternalStarter,
  receiveSharedSource,
  recordPracticeReturnedWithoutShare,
  selectPracticeSource,
  type CompletedOnboardingSave,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import { expectedOnboardingV2Route } from '../lib/onboardingV2RoutingCore';

const at = (seconds: number) => `2026-08-22T12:00:${String(seconds).padStart(2, '0')}.000Z`;
const pass = (number: number, label: string) => console.log(`PASS ${number} ${label}`);
const tutorialSave: CompletedOnboardingSave = {
  kind: 'tutorial',
  contentId: 'ig-mad-yolks-santa-cruz',
  sourceUrl: 'https://www.instagram.com/p/C-BEtdnyGdR/',
  normalizedSourceUrl: 'instagram.com/p/c-betdnygdr',
  contentIdentity: { platform: 'instagram', contentId: 'c-betdnygdr' },
  savedPlaceId: 'saved-tutorial',
  completedAt: at(0),
};

function practiceState(independentSaves: CompletedOnboardingSave[] = []): OnboardingV2State {
  return {
    ...createInitialOnboardingV2State(at(0)),
    cohort: 'new_user_v2',
    stage: independentSaves.length === 0 ? 'practice_ready' : 'first_independent_save_complete',
    preferredPlatform: 'instagram',
    interest: 'food',
    funnelSessionId: 'try-another-session',
    identityLifecycle: 'permanent_account',
    boundUserId: 'user-1',
    permanentUserId: 'user-1',
    authCompletedAt: at(0),
    tutorialContentId: tutorialSave.contentId,
    tutorialSave,
    independentSaves,
    practiceContentIds: independentSaves.map((save) => save.contentId),
    practiceAttemptedContentIds: independentSaves.map((save) => save.contentId),
    placeTourClosedAt: at(0),
  };
}

function nextFor(state: OnboardingV2State, suffix: string) {
  return getNextPracticeSource({
    platform: state.preferredPlatform,
    interest: state.interest,
    excludeContentIds: [
      state.tutorialContentId!,
      ...state.independentSaves.map((save) => save.contentId),
      ...state.practiceAttemptedContentIds,
      ...state.practiceContentIds,
    ],
    rotationKey: `${state.funnelSessionId}:${state.independentSaves.length}:${suffix}`,
  });
}

function openAndRecover(state: OnboardingV2State, contentId: string, sourceUrl: string, start: number) {
  let next = selectPracticeSource(state, contentId, at(start)).state;
  next = openExternalStarter(next, { contentId, sourceUrl }, at(start + 1)).state;
  next = recordPracticeReturnedWithoutShare(next, {
    attemptId: next.pendingShare!.attemptId,
    returnedAt: at(start + 5),
    helpEligibleAt: at(start + 12),
  }, at(start + 12)).state;
  return next;
}

// 1-6. Physical 1/3 sequence rotates durably without leaving Phase 2.
let one = practiceState();
const firstChoice = nextFor(one, 'first');
assert.equal(firstChoice.kind, 'FOUND');
if (firstChoice.kind !== 'FOUND') throw new Error('starter pool unexpectedly exhausted');
one = openAndRecover(one, firstChoice.source.id, firstChoice.source.sourceUrl, 1);
assert.equal(one.stage, 'first_independent_external_video_opened');
assert.equal(expectedOnboardingV2Route(one.stage), '/(tabs)/map');
pass(1, '1/3 open external -> return without share -> recovery');
const replacementOne = nextFor(one, 'replacement');
assert.equal(replacementOne.kind, 'FOUND');
if (replacementOne.kind !== 'FOUND') throw new Error('replacement pool unexpectedly exhausted');
one = selectPracticeSource(one, replacementOne.source.id, at(20), true).state;
assert.equal(onboardingV2SavedPlaceProgress(one).count, 1);
pass(2, 'Try another preserves 1/3');
assert.equal(one.stage, 'practice_ready');
assert.equal(one.behavioralCompletedAt, null);
assert.equal(expectedOnboardingV2Route(one.stage), '/(tabs)/map');
pass(3, 'Phase 2 remains active on the map-owned practice stage');
assert.equal(one.practiceContentIds[0], replacementOne.source.id);
assert.notEqual(one.practiceContentIds[0], firstChoice.source.id);
pass(4, 'next unused source is selected');
assert.ok(one.practiceAttemptedContentIds.includes(firstChoice.source.id));
pass(5, 'previous source remains marked attempted');
const restoredOne = decodeOnboardingV2State(encodeOnboardingV2State(one), at(21));
assert.equal(restoredOne.practiceContentIds[0], replacementOne.source.id);
assert.equal(restoredOne.stage, 'practice_ready');
pass(6, 'force-close at 1/3 restores the replacement preview');

// 7. The same transition preserves a durable 2/3 checkpoint.
const firstSave: CompletedOnboardingSave = {
  kind: 'independent_1',
  contentId: replacementOne.source.id,
  sourceUrl: replacementOne.source.sourceUrl,
  normalizedSourceUrl: replacementOne.source.sourceUrl,
  contentIdentity: null,
  savedPlaceId: 'saved-first',
  completedAt: at(22),
};
let two = practiceState([firstSave]);
const secondChoice = nextFor(two, 'second');
assert.equal(secondChoice.kind, 'FOUND');
if (secondChoice.kind !== 'FOUND') throw new Error('second slot unexpectedly exhausted');
two = openAndRecover(two, secondChoice.source.id, secondChoice.source.sourceUrl, 23);
assert.equal(two.stage, 'second_independent_external_video_opened');
assert.equal(expectedOnboardingV2Route(two.stage), '/(tabs)/map');
const replacementTwo = nextFor(two, 'replacement-two');
assert.equal(replacementTwo.kind, 'FOUND');
if (replacementTwo.kind !== 'FOUND') throw new Error('second replacement unexpectedly exhausted');
two = selectPracticeSource(two, replacementTwo.source.id, at(40), true).state;
const restoredTwo = decodeOnboardingV2State(encodeOnboardingV2State(two), at(41));
assert.equal(onboardingV2SavedPlaceProgress(restoredTwo).count, 2);
assert.equal(restoredTwo.stage, 'first_independent_save_complete');
assert.equal(restoredTwo.practiceContentIds[1], replacementTwo.source.id);
pass(7, '2/3 Try another and force-close preserve the replacement preview');

// 8-10. Exhaustion is explicit and no transition completes or reroutes onboarding.
const exhausted = getNextPracticeSource({
  platform: 'instagram',
  interest: 'food',
  excludeContentIds: ONBOARDING_STARTER_CONTENT.map((source) => source.id),
  rotationKey: 'exhausted',
});
assert.deepEqual(exhausted, { kind: 'EXHAUSTED' });
const coachmark = readFileSync(join(process.cwd(), 'components/onboarding/v2/OnboardingV2MapCoachmark.tsx'), 'utf8');
assert.match(coachmark, /No more suggestions right now/);
assert.match(coachmark, /Retry current source/);
pass(8, 'exhausted source pool has a visible bounded fallback');
const tryAnotherBody = coachmark.slice(coachmark.indexOf('async function tryAnother'), coachmark.indexOf('async function showHelp'));
assert.doesNotMatch(tryAnotherBody, /router\.(replace|push)|\/(tabs)\/map/);
pass(9, 'Try another never performs a route reset');
assert.equal(one.behavioralCompletedAt, null);
assert.equal(two.behavioralCompletedAt, null);
assert.notEqual(one.stage, 'graduated');
assert.notEqual(two.stage, 'graduated');
pass(10, 'Try another never writes completion or graduation');

// 11-12. Previously validated safety boundaries remain wired.
const preAuth = readFileSync(join(process.cwd(), 'components/onboarding/v2/OnboardingV2PreAuth.tsx'), 'utf8');
assert.match(preAuth, /<StartupSurface/);
assert.match(preAuth, /useStartupWatchdog/);
assert.match(preAuth, /ANONYMOUS_BOOTSTRAP_TIMEOUT_MS/);
pass(11, 'post-delete black-screen fail-safe remains intact');
assert.match(readFileSync(join(process.cwd(), 'services/accountService.ts'), 'utf8'), /finishAccountDeletionCleanupBoundary/);
pass(12, 'account-deletion identity boundary remains intact');

// 13-14. Real distinct saves still advance, while duplicates do not.
let success = openExternalStarter(one, {
  contentId: replacementOne.source.id,
  sourceUrl: replacementOne.source.sourceUrl,
}, at(42)).state;
success = receiveSharedSource(success, replacementOne.source.sourceUrl, at(43)).state;
success = completePendingSave(success, {
  sourceUrl: replacementOne.source.sourceUrl,
  savedPlaceId: 'saved-first-real',
}, at(44)).state;
assert.equal(onboardingV2SavedPlaceProgress(success).count, 2);
pass(13, 'normal successful share/save still advances to 2/3');
const duplicateChoice = nextFor(success, 'duplicate');
assert.equal(duplicateChoice.kind, 'FOUND');
if (duplicateChoice.kind !== 'FOUND') throw new Error('duplicate test source missing');
let duplicate = selectPracticeSource(success, duplicateChoice.source.id, at(45)).state;
duplicate = openExternalStarter(duplicate, {
  contentId: duplicateChoice.source.id,
  sourceUrl: duplicateChoice.source.sourceUrl,
}, at(46)).state;
duplicate = receiveSharedSource(duplicate, duplicateChoice.source.sourceUrl, at(47)).state;
duplicate = completePendingSave(duplicate, {
  sourceUrl: duplicateChoice.source.sourceUrl,
  savedPlaceId: 'saved-first-real',
}, at(48)).state;
assert.equal(onboardingV2SavedPlaceProgress(duplicate).count, 2);
pass(14, 'duplicate saved place does not increment progress');

assert.match(readFileSync(join(process.cwd(), 'lib/onboardingV2DevReset.ts'), 'utf8'), /resetOnboardingV2LocalStateForDevelopment/);
pass(15, 'development reset remains available');

console.log('\nAll Phase 2 Try another regression scenarios passed.');
