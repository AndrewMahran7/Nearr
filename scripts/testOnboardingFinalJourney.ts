import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  advanceOnboardingSharingRehearsal,
  beginOnboardingInAppTutorialResolution,
  beginOnboardingRealPractice,
  beginOnboardingSecondHalf,
  beginOnboardingSharingRehearsal,
  beginPermanentAccountLink,
  bindAnonymousUser,
  bypassExistingUserFromWelcome,
  closePlaceTour,
  completeOnboardingInterests,
  completeOnboardingPlatforms,
  completeOnboardingSecondHalf,
  completePermanentAccountLink,
  continueOnboardingAfterAuth,
  continueOnboardingAfterMakingNearrYours,
  continueOnboardingFromPersonalizedPayoff,
  continueOnboardingToLocationEducation,
  continueOnboardingToNearbyValue,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  deferOnboardingPractice,
  encodeOnboardingV2State,
  markOnboardingPracticeWaitingForShare,
  openExternalStarter,
  reconcileOnboardingPracticeJob,
  receiveOnboardingTutorialFixture,
  recordOnboardingBackgroundLocationResult,
  recordOnboardingForegroundLocationResult,
  recordOnboardingNotificationResult,
  resolveOnboardingTutorialResult,
  showOnboardingActivationChallenge,
  startOnboardingV2,
  tapGetStarted,
  toggleOnboardingInterest,
  toggleOnboardingPlatform,
  type OnboardingTransition,
  type OnboardingTutorialFixture,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  expectedOnboardingV2Route,
  shouldPreserveOnboardingV2ProductRoute,
} from '../lib/onboardingV2RoutingCore';

const root = process.cwd();
const at = (second: number) => new Date(Date.UTC(2026, 8, 28, 21, 10, second)).toISOString();
const step = (
  state: OnboardingV2State,
  reducer: (current: OnboardingV2State, now: string) => OnboardingTransition,
  second: number,
) => reducer(state, at(second)).state;

const tutorialFixture: OnboardingTutorialFixture = {
  id: 'offline-country-roads', revision: 1, role: 'primary', platform: 'instagram',
  identityKey: 'v1:instagram:offlinecountryroads', identityVersion: 1,
  contentId: 'offlinecountryroads', canonicalUrl: 'onboarding://instagram/offlinecountryroads',
  launchUrl: 'onboarding://instagram/offlinecountryroads', thumbnailUrl: '', selectedAt: at(8),
};
const practiceFixture: OnboardingTutorialFixture = {
  id: 'phase2-shopping-country-roads', revision: 1, role: 'primary', platform: 'instagram',
  identityKey: 'v1:instagram:cm2qchdn2nk', identityVersion: 1,
  contentId: 'CM2QChDn2Nk', canonicalUrl: 'https://www.instagram.com/reel/CM2QChDn2Nk/',
  launchUrl: 'https://www.instagram.com/reel/CM2QChDn2Nk/', thumbnailUrl: '', selectedAt: at(20),
};

function freshToPhase2(): OnboardingV2State {
  let state = step(createInitialOnboardingV2State(at(0)), startOnboardingV2, 1);
  state = bindAnonymousUser(state, 'anonymous-founder', '11111111-1111-4111-8111-111111111111', at(2)).state;
  state = step(state, tapGetStarted, 3);
  state = toggleOnboardingPlatform(state, 'instagram', at(4)).state;
  state = completeOnboardingPlatforms(state, at(5)).state;
  state = toggleOnboardingInterest(state, 'shopping', at(6)).state;
  state = completeOnboardingInterests(state, at(7)).state;
  state = step(state, continueOnboardingFromPersonalizedPayoff, 8);
  state = receiveOnboardingTutorialFixture(state, tutorialFixture, at(9)).state;
  state = step(state, beginOnboardingSharingRehearsal, 10);
  state = advanceOnboardingSharingRehearsal(state, 'share', at(11)).state;
  state = advanceOnboardingSharingRehearsal(state, 'more', at(12)).state;
  state = step(state, beginOnboardingInAppTutorialResolution, 13);
  const tutorialJobId = state.tutorialJobId;
  assert.ok(tutorialJobId);
  state = resolveOnboardingTutorialResult(state, {
    jobId: tutorialJobId,
    savedPlaceId: 'offline-tutorial-place',
    fixtureId: tutorialFixture.id,
    fixtureRevision: tutorialFixture.revision,
    fixtureRole: tutorialFixture.role,
    resolutionSource: 'onboarding_scripted',
    sourceUrl: tutorialFixture.canonicalUrl,
    place: {
      googlePlaceId: 'offline-country-roads-google', name: 'Country Roads Antiques',
      formattedAddress: 'Orange, California', latitude: 33.7879, longitude: -117.8531,
      primaryType: 'antique_store', typeLabel: 'Antique store', photoUrl: null, photoUrls: [],
    },
  }, at(14)).state;
  assert.equal(state.stage, 'fixture_map_payoff', 'offline Phase 1 resolves without a live service');
  const restored = decodeOnboardingV2State(encodeOnboardingV2State(state), at(15));
  assert.ok(restored, 'force-close checkpoint decodes');
  state = closePlaceTour(restored, 'offline-tutorial-place', at(16)).state;
  assert.equal(state.stage, 'phase2_intro');
  return state;
}

function beginPractice(state: OnboardingV2State): OnboardingV2State {
  state = beginOnboardingRealPractice(state, at(17), practiceFixture, { name: 'Country Roads Antiques' }).state;
  state = openExternalStarter(state, { contentId: practiceFixture.contentId, sourceUrl: practiceFixture.canonicalUrl }, at(18)).state;
  state = markOnboardingPracticeWaitingForShare(state, at(19)).state;
  assert.equal(expectedOnboardingV2Route(state.stage), '/(onboarding)', 'external app return stays in the onboarding route');
  return state;
}

function runSecondHalf(state: OnboardingV2State, permission: 'granted' | 'denied'): OnboardingV2State {
  state = step(state, beginOnboardingSecondHalf, 23);
  state = step(state, continueOnboardingToNearbyValue, 24);
  state = step(state, continueOnboardingToLocationEducation, 25);
  state = recordOnboardingForegroundLocationResult(state, permission, at(26)).state;
  if (permission === 'granted') state = recordOnboardingBackgroundLocationResult(state, 'granted', at(27)).state;
  state = recordOnboardingNotificationResult(state, permission, at(28)).state;
  state = step(state, continueOnboardingAfterMakingNearrYours, 29);
  assert.equal(state.stage, 'account_required', 'anonymous users link an account before final activation');
  assert.equal(expectedOnboardingV2Route(state.stage), '/(onboarding)/account');
  state = step(state, beginPermanentAccountLink, 30);
  state = completePermanentAccountLink(state, {
    permanentUserId: 'permanent-founder', destinationWasEstablished: false,
    tutorialSavedPlaceId: 'transferred-tutorial-place',
  }, at(31)).state;
  assert.equal(state.stage, 'auth_success');
  state = step(state, continueOnboardingAfterAuth, 32);
  state = step(state, showOnboardingActivationChallenge, 33);
  state = completeOnboardingSecondHalf(state, 'explore_map', at(34)).state;
  assert.equal(state.stage, 'onboarding_complete');
  assert.equal(expectedOnboardingV2Route(state.stage), '/(tabs)/map');
  return state;
}

// Direct success: one continuous route, one account handoff, one final map entry.
let direct = beginPractice(freshToPhase2());
direct = reconcileOnboardingPracticeJob(direct, {
  jobId: 'real-job-success', clientRequestId: 'real-job-success', sourceUrl: practiceFixture.canonicalUrl,
  status: 'completed', savedPlaceId: 'country-roads-saved', failureReason: null, observedAt: at(21),
}, at(21)).state;
assert.equal(direct.stage, 'first_magic_moment_complete');
assert.equal(direct.realPracticeSession?.completionReason, 'resolved');
direct = runSecondHalf(direct, 'granted');
assert.equal(direct.independentSaves[0]?.savedPlaceId, 'country-roads-saved', 'the real saved place survives account transfer');
assert.equal(direct.identityLifecycle, 'permanent_account');
assert.equal([expectedOnboardingV2Route(direct.stage)].filter((route) => route === '/(tabs)/map').length, 1);

// Needs-review: Quick Check is the sole temporary child route and returns via durable state.
let review = beginPractice(freshToPhase2());
review = reconcileOnboardingPracticeJob(review, {
  jobId: 'real-job-review', clientRequestId: 'real-job-review', sourceUrl: practiceFixture.canonicalUrl,
  status: 'needs_help', savedPlaceId: null, failureReason: 'missing_video', observedAt: at(20),
}, at(20)).state;
assert.equal(review.stage, 'first_independent_share_returned');
assert.equal(review.realPracticeSession?.status, 'NEEDS_REVIEW');
assert.equal(shouldPreserveOnboardingV2ProductRoute({ currentRoute: '/share-jobs/real-job-review', stage: review.stage }), true);
review = reconcileOnboardingPracticeJob(review, {
  jobId: 'real-job-review', clientRequestId: 'real-job-review', sourceUrl: practiceFixture.canonicalUrl,
  status: 'completed', savedPlaceId: 'reviewed-place', failureReason: null, observedAt: at(22),
}, at(22)).state;
assert.equal(review.stage, 'first_magic_moment_complete');

// Opt-out remains intentional and cannot leave an unresolved practice gate behind.
let optOut = deferOnboardingPractice(beginPractice(freshToPhase2()), at(20)).state;
assert.equal(optOut.stage, 'first_magic_moment_complete');
assert.equal(optOut.realPracticeSession?.completionReason, 'declined');
optOut = runSecondHalf(optOut, 'denied');
assert.equal(optOut.locationForegroundResult, 'denied');
assert.equal(optOut.notificationPermissionResult, 'denied');

// Existing-account entry bypasses anonymous onboarding and reaches the map once.
let existing = step(createInitialOnboardingV2State(at(0)), startOnboardingV2, 1);
existing = bypassExistingUserFromWelcome(existing, 'existing-founder', at(2)).state;
assert.equal(existing.stage, 'graduated');
assert.equal(existing.identityLifecycle, 'permanent_account');
assert.equal(expectedOnboardingV2Route(existing.stage), '/(tabs)/map');

const preAuth = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2PreAuth.tsx'), 'utf8');
const practiceUi = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2RealPractice.tsx'), 'utf8');
const secondHalf = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2SecondHalf.tsx'), 'utf8');
const settings = readFileSync(join(root, 'app/(tabs)/settings.tsx'), 'utf8');
const account = readFileSync(join(root, 'app/(onboarding)/account.tsx'), 'utf8');
const authService = readFileSync(join(root, 'services/auth.ts'), 'utf8');
const video = readFileSync(join(root, 'components/onboarding/v2/OfflineFixtureVideo.tsx'), 'utf8');
assert.match(preAuth, /OnboardingV2RealPractice/);
assert.match(practiceUi, /useOnboardingTutorialJobs/);
assert.match(practiceUi, /Submission received - this button will not launch the post again/);
assert.match(video, /poster/);
assert.match(video, /!videoReady && styles\.videoPending/);
assert.match(video, /videoPending: \{ opacity: 0 \}/, 'poster remains visible until bundled video is ready');
assert.doesNotMatch(settings, /requestOnboardingV2MapBackup\(\)[\s\S]{0,240}router\.push\(/, 'Settings has one navigation owner');
assert.match(account, /activeOperationRef/, 'auth providers share one in-flight latch');
assert.equal((authService.match(/signInWithOAuth\(/g) ?? []).length, 1, 'Google OAuth has one provider launch site');
assert.doesNotMatch(secondHalf, /syncGeofences|syncProximity|registerPush/, 'final activation does not duplicate session initialization');
assert.doesNotMatch(secondHalf, /router\.replace\('\/\(tabs\)\/map'\)/, 'AuthGate is the only final-map navigation owner');
assert.match(secondHalf, /realResultHero/);

const appConfig = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
assert.equal(appConfig.expo.version, '1.6.59');
assert.equal(appConfig.expo.icon, './assets/icon.png');
assert.equal(appConfig.expo.ios.icon, './assets/icon.png');
assert.equal(appConfig.expo.android.adaptiveIcon.foregroundImage, './assets/icon.png');
assert.equal(appConfig.expo.android.adaptiveIcon.backgroundColor, '#F7F4EE');
const icon = readFileSync(join(root, 'assets/icon.png'));
assert.equal(createHash('sha256').update(icon).digest('hex').toUpperCase(), 'AC3ED31CF494843C72C5049E480E77F2AF2FC74DCC8B9A85CE636ABA0CC2DB2A');
assert.equal(icon.readUInt32BE(16), 1024);
assert.equal(icon.readUInt32BE(20), 1024);

console.log('Onboarding final journey: direct success, review, opt-out, existing/new account, denied permissions, restart, offline Phase 1, and native icon passed.');
