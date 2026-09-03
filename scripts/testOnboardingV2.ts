import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  acknowledgeGraduation,
  advanceSimulatedTutorial,
  advancePlaceTour,
  backOnboardingV2,
  beginPermanentAccountLink,
  bindAnonymousUser,
  closePlaceTour,
  completePermanentAccountLink,
  completePendingSave,
  continueToTutorial,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  failPendingSave,
  isExpectedOnboardingSource,
  normalizeOnboardingSourceUrl,
  openExternalStarter,
  openPlaceTour,
  receiveSharedSource,
  selectInterest,
  selectPracticeSource,
  selectPlatform,
  startOnboardingV2,
  tapGetStarted,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  ONBOARDING_STARTER_CONTENT,
  ONBOARDING_TUTORIAL_CONFIG,
  selectPracticeContent,
  selectTutorialContent,
} from '../constants/onboardingStarterContent';

let tick = 0;
const now = () => `2026-08-19T12:00:${String(tick++).padStart(2, '0')}.000Z`;
const next = (
  state: OnboardingV2State,
  reducer: (state: OnboardingV2State, at: string) => { state: OnboardingV2State },
) => reducer(state, now()).state;
const restart = (state: OnboardingV2State): OnboardingV2State => JSON.parse(JSON.stringify(state));

const tutorial = selectTutorialContent('instagram', 'food');
assert.ok(tutorial, 'a real-place tutorial fixture is available');
assert.equal(tutorial.id, 'ig-mad-yolks-santa-cruz', 'food uses the verified Mad Yolks fixture');
for (const platform of ['instagram', 'tiktok', 'youtube', 'facebook'] as const) {
  for (const interest of ['food', 'outdoors', 'travel', 'beaches', 'anything'] as const) {
    const selected = selectTutorialContent(platform, interest);
    assert.ok(selected?.targetPlace?.googlePlaceId, `${platform} + ${interest} resolves a durable real place`);
  }
}
assert.equal(Object.keys(ONBOARDING_TUTORIAL_CONFIG).length, 4, 'one explicit tutorial config exists per supported platform');
assert.equal(
  Object.values(ONBOARDING_TUTORIAL_CONFIG).flatMap((slots) => Object.values(slots)).length,
  24,
  'every persisted interest has an explicit platform-specific tutorial slot',
);

const activationSource = readFileSync(join(process.cwd(), 'components/onboarding/v2/OnboardingV2Activation.tsx'), 'utf8');
const preAuthSource = readFileSync(join(process.cwd(), 'components/onboarding/v2/OnboardingV2PreAuth.tsx'), 'utf8');
const mapCoachmarkSource = readFileSync(join(process.cwd(), 'components/onboarding/v2/OnboardingV2MapCoachmark.tsx'), 'utf8');
assert.doesNotMatch(activationSource, /\bLinking\b|openURL/, 'Learn never launches an external app');
assert.match(activationSource, /title="Save to my map"/, 'Learn ends with an explicit save CTA');
assert.match(activationSource, /saveOnboardingV2TutorialPlace/, 'the explicit CTA uses the durable save adapter');
for (const action of ['share', 'more', 'nearr', 'favorite', 'process', 'result']) {
  assert.ok(activationSource.includes(`'${action}'`), `interactive tutorial wires ${action}`);
}
assert.match(mapCoachmarkSource, /AppState\.addEventListener/, 'Practice detects a return without sharing');
assert.match(mapCoachmarkSource, /TRY THIS ONE/, 'Practice previews a place before opening the source');
assert.match(mapCoachmarkSource, /ONBOARDING_PRACTICE_HELP_VIDEO/, 'Practice exposes the future help-video hook');
const finderStart = activationSource.indexOf("if (stage === 'tutorial_processing')");
const finderEnd = activationSource.indexOf("if (stage === 'tutorial_result_seen')", finderStart);
assert.ok(finderStart > -1 && finderEnd > finderStart, 'the finder stage is explicit');
const finderSource = activationSource.slice(finderStart, finderEnd);
assert.match(finderSource, />NEARR</, 'the product identity appears while it is finding the place');
const payoffEnd = activationSource.indexOf("stage === 'tutorial_ready'", finderEnd);
const payoffSource = activationSource.slice(finderEnd, payoffEnd);
assert.match(payoffSource, /PLACE FOUND/, 'the result describes the completed place match');
assert.doesNotMatch(
  `${activationSource}\n${preAuthSource}\n${mapCoachmarkSource}`,
  /\bVayrin\b/i,
  'the retired character name is absent from onboarding',
);
assert.ok(tutorial.sourceUrl.startsWith('https://www.instagram.com/'));
assert.ok(ONBOARDING_STARTER_CONTENT.every((item) => item.sourceUrl.startsWith('https://')));

let state = createInitialOnboardingV2State(now());
state = next(state, startOnboardingV2);
assert.equal(state.stage, 'overview');
state = bindAnonymousUser(state, 'anon-user', '11111111-1111-4111-8111-111111111111', now()).state;
assert.equal(state.identityLifecycle, 'anonymous_active');
assert.equal(state.boundUserId, 'anon-user');
state = next(state, tapGetStarted);
assert.equal(state.stage, 'platform');
state = selectPlatform(state, 'instagram', now()).state;
assert.equal(state.stage, 'interest');
state = selectInterest(state, 'food', tutorial.id, now()).state;
assert.equal(state.stage, 'interest_selected');
state = next(state, continueToTutorial);
assert.equal(state.stage, 'tutorial_ready');

// Resume after app restart without changing the anonymous identity.
state = restart(state);
const resumeRevision = state.revision;
state = bindAnonymousUser(state, 'anon-user', state.funnelSessionId!, now()).state;
assert.equal(state.revision, resumeRevision, 'same anonymous session resumes idempotently');

const tutorialInput = { contentId: tutorial.id, sourceUrl: tutorial.sourceUrl };
const beforeOutOfOrder = state.revision;
state = advanceSimulatedTutorial(state, 'more', tutorialInput, now()).state;
assert.equal(state.revision, beforeOutOfOrder, 'required tutorial actions cannot be skipped');
state = advanceSimulatedTutorial(state, 'share', tutorialInput, now()).state;
assert.equal(state.stage, 'tutorial_share_tapped');
assert.ok(state.pendingShare, 'simulated share establishes a durable tutorial attempt');
state = advanceSimulatedTutorial(state, 'more', tutorialInput, now()).state;
assert.equal(state.stage, 'tutorial_more_tapped');

// Back navigation preserves choices and returns one interaction at a time.
state = backOnboardingV2(state, now()).state;
assert.equal(state.stage, 'tutorial_share_tapped');
state = backOnboardingV2(state, now()).state;
assert.equal(state.stage, 'tutorial_ready');
assert.equal(state.pendingShare, null, 'back to the post clears only the in-flight simulated attempt');
assert.equal(state.preferredPlatform, 'instagram');
assert.equal(state.interest, 'food');

state = advanceSimulatedTutorial(state, 'share', tutorialInput, now()).state;
state = advanceSimulatedTutorial(state, 'more', tutorialInput, now()).state;
state = advanceSimulatedTutorial(state, 'nearr', tutorialInput, now()).state;
assert.equal(state.stage, 'tutorial_nearr_selected');
state = advanceSimulatedTutorial(state, 'favorite', tutorialInput, now()).state;
assert.equal(state.stage, 'tutorial_favorite_added');
state = advanceSimulatedTutorial(state, 'process', tutorialInput, now()).state;
assert.equal(state.stage, 'tutorial_processing');
const beforeExplicitResult = state.revision;
state = completePendingSave(state, { sourceUrl: tutorial.sourceUrl, savedPlaceId: 'too-early' }, now()).state;
assert.equal(state.revision, beforeExplicitResult, 'tutorial place cannot save before the result and explicit CTA');
state = advanceSimulatedTutorial(state, 'result', tutorialInput, now()).state;
assert.equal(state.stage, 'tutorial_result_seen');
state = completePendingSave(
  state,
  { sourceUrl: tutorial.sourceUrl, savedPlaceId: 'saved-tutorial' },
  now(),
).state;
assert.equal(state.stage, 'account_required');
assert.equal(state.independentSaves.length, 0, 'tutorial save is not independent activation');
assert.equal(state.behavioralCompletedAt, null, 'tutorial save does not graduate');

state = beginPermanentAccountLink(state, now()).state;
assert.equal(state.identityLifecycle, 'permanent_account_linking');
state = completePermanentAccountLink(state, {
  permanentUserId: 'anon-user',
  destinationWasEstablished: false,
  tutorialSavedPlaceId: 'saved-tutorial',
}, now()).state;
assert.equal(state.stage, 'place_tour');
assert.equal(state.identityLifecycle, 'permanent_account');

// Place education survives restart and skips an unavailable AI note.
state = restart(state);
state = openPlaceTour(state, 'saved-tutorial', now()).state;
assert.ok(state.placeTourOpenedAt);
state = advancePlaceTour(state, { aiNote: false, source: true }, now()).state;
assert.equal(state.placeTourStep, 'source');
state = advancePlaceTour(state, { aiNote: false, source: true }, now()).state;
assert.equal(state.placeTourStep, 'directions');
state = advancePlaceTour(state, { aiNote: false, source: true }, now()).state;
assert.equal(state.placeTourStep, 'close');
state = closePlaceTour(state, 'saved-tutorial', now()).state;
assert.equal(state.stage, 'practice_ready');

const practice = selectPracticeContent({
  platform: state.preferredPlatform,
  interest: state.interest,
  excludeContentIds: [tutorial.id],
  limit: 3,
});
assert.equal(practice.length, 3, 'starter shelf returns three cards');
assert.ok(practice.some((item) => item.category !== practice[0]!.category), 'shelf diversifies category when possible');

const first = practice[0]!;
state = selectPracticeSource(state, first.id, now()).state;
state = openExternalStarter(state, { contentId: first.id, sourceUrl: first.sourceUrl }, now()).state;
assert.equal(state.pendingShare?.kind, 'independent_1');
state = receiveSharedSource(state, first.sourceUrl, now()).state;
state = completePendingSave(state, { sourceUrl: first.sourceUrl, savedPlaceId: 'saved-first' }, now()).state;
assert.equal(state.independentSaves.length, 1);
assert.equal(state.behavioralCompletedAt, null, 'one independent save is not graduation');

// Duplicate save notification cannot increment a second time.
const firstRevision = state.revision;
state = completePendingSave(state, { sourceUrl: first.sourceUrl, savedPlaceId: 'saved-first' }, now()).state;
assert.equal(state.revision, firstRevision);
assert.equal(state.independentSaves.length, 1);

// Resume after the first independent save.
state = restart(state);
const second = practice[1]!;
state = selectPracticeSource(state, second.id, now()).state;
state = openExternalStarter(state, { contentId: second.id, sourceUrl: second.sourceUrl }, now()).state;
assert.equal(state.pendingShare?.kind, 'independent_2');
const wrongSecondRevision = state.revision;
state = receiveSharedSource(state, 'https://www.tiktok.com/@someone/video/999', now()).state;
assert.equal(state.revision, wrongSecondRevision);
state = receiveSharedSource(state, second.sourceUrl, now()).state;
state = completePendingSave(state, { sourceUrl: second.sourceUrl, savedPlaceId: 'saved-second' }, now()).state;
assert.equal(state.independentSaves.length, 2);
assert.equal(state.stage, 'graduated');
assert.ok(state.behavioralCompletedAt, 'two independent saves graduate');

const graduatedRevision = state.revision;
state = openExternalStarter(state, { contentId: practice[2]!.id, sourceUrl: practice[2]!.sourceUrl }, now()).state;
assert.equal(state.revision, graduatedRevision, 'graduated user cannot restart practice');
state = acknowledgeGraduation(state, now()).state;
assert.ok(state.graduationAcknowledgedAt);
assert.ok(restart(state).behavioralCompletedAt, 'graduation survives restart');
assert.deepEqual(
  decodeOnboardingV2State(encodeOnboardingV2State(state)),
  state,
  'persisted codec round-trips graduated state exactly',
);
assert.equal(
  decodeOnboardingV2State('{broken').stage,
  'not_started',
  'corrupt persisted state recovers safely',
);
const nextInstallJourney = startOnboardingV2(state, now()).state;
assert.equal(nextInstallJourney.stage, 'overview', 'a later signed-out account journey starts cleanly');
assert.equal(nextInstallJourney.boundUserId, null);

// Failure remains recoverable and never fakes a save.
let recovery = createInitialOnboardingV2State(now());
recovery = startOnboardingV2(recovery, now()).state;
recovery = bindAnonymousUser(recovery, 'recovery-anon', '22222222-2222-4222-8222-222222222222', now()).state;
recovery = tapGetStarted(recovery, now()).state;
recovery = selectPlatform(recovery, 'instagram', now()).state;
recovery = selectInterest(recovery, 'food', tutorial.id, now()).state;
recovery = continueToTutorial(recovery, now()).state;
recovery = advanceSimulatedTutorial(recovery, 'share', tutorialInput, now()).state;
recovery = failPendingSave(recovery, 'dead_link', now()).state;
assert.equal(recovery.tutorialSave, null);
assert.equal(recovery.pendingShare?.contentId, tutorial.id, 'failed attempt remains retryable');

// Existing-account login merges the tutorial but deliberately bypasses practice.
let existing = createInitialOnboardingV2State(now());
existing = startOnboardingV2(existing, now()).state;
existing = bindAnonymousUser(existing, 'existing-anon', '33333333-3333-4333-8333-333333333333', now()).state;
existing = tapGetStarted(existing, now()).state;
existing = selectPlatform(existing, 'instagram', now()).state;
existing = selectInterest(existing, 'food', tutorial.id, now()).state;
existing = continueToTutorial(existing, now()).state;
existing = advanceSimulatedTutorial(existing, 'share', tutorialInput, now()).state;
existing = advanceSimulatedTutorial(existing, 'more', tutorialInput, now()).state;
existing = advanceSimulatedTutorial(existing, 'nearr', tutorialInput, now()).state;
existing = advanceSimulatedTutorial(existing, 'favorite', tutorialInput, now()).state;
existing = advanceSimulatedTutorial(existing, 'process', tutorialInput, now()).state;
existing = advanceSimulatedTutorial(existing, 'result', tutorialInput, now()).state;
existing = completePendingSave(existing, { sourceUrl: tutorial.sourceUrl, savedPlaceId: 'source-tutorial' }, now()).state;
existing = beginPermanentAccountLink(existing, now()).state;
existing = completePermanentAccountLink(existing, {
  permanentUserId: 'existing-user',
  destinationWasEstablished: true,
  tutorialSavedPlaceId: 'existing-deduped-place',
}, now()).state;
assert.equal(existing.cohort, 'existing_user_bypassed');
assert.equal(existing.behavioralCompletedAt, null);
assert.equal(existing.tutorialSave?.savedPlaceId, 'existing-deduped-place');

assert.equal(
  normalizeOnboardingSourceUrl('https://www.instagram.com/p/ABC/?igsh=one'),
  normalizeOnboardingSourceUrl('https://instagram.com/p/ABC/?utm_source=two'),
  'social tracking parameters do not break exact post identity',
);

assert.equal(
  isExpectedOnboardingSource({
    attemptId: 'canonical-test',
    kind: 'tutorial',
    contentId: 'tt-test',
    sourceUrl: 'https://www.tiktok.com/@one/video/1234567890',
    normalizedSourceUrl: 'tiktok.com/@one/video/1234567890',
    contentIdentity: { platform: 'tiktok', contentId: '1234567890' },
    openedAt: now(),
    shareReceivedAt: null,
    resultSeenAt: null,
  }, 'https://m.tiktok.com/@different/video/1234567890?is_from_webapp=1'),
  true,
  'canonical-equivalent provider video IDs match despite URL spelling',
);

console.log('PASS onboarding v2 state progression');
console.log('PASS persistence/resume snapshots');
console.log('PASS tutorial versus independent activation');
console.log('PASS wrong-share and duplicate callback guards');
console.log('PASS existing-user migration and recovery');
console.log('All Onboarding V2 tests passed.');
