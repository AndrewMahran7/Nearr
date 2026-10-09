import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  onboardingAuthCopy,
  requiresAnonymousTransferPreparation,
  resolveOnboardingAuthEntryIntent,
} from '../lib/onboardingAuthIntentCore';
import { isQualifyingExistingAccount } from '../lib/existingAccountSignInCore';
import {
  ONBOARDING_PHASE2_PRACTICE,
  onboardingPhase2PracticeFixture,
} from '../lib/onboardingPhase2Practice';
import {
  beginOnboardingRealPractice,
  bypassExistingUserFromWelcome,
  closePlaceTour,
  completeOnboardingSecondHalf,
  completePendingSave,
  createInitialOnboardingV2State,
  deferOnboardingPractice,
  observeOnboardingResult,
  openExternalStarter,
  receiveSharedSource,
  selectPracticeSource,
  type CompletedOnboardingSave,
  type OnboardingTutorialResult,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  shouldRenderMapTopChrome,
  shouldRestoreNormalMapChrome,
  shouldShowLocalTutorialPlace,
} from '../lib/onboardingV2MapPresentation';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const at = (second: number) => `2026-09-26T12:00:${String(second).padStart(2, '0')}.000Z`;
const pass = (number: number, message: string) => console.log(`PASS TEST ${number}: ${message}`);

const tutorialSave: CompletedOnboardingSave = {
  kind: 'tutorial',
  contentId: 'offline-mad-yolks',
  sourceUrl: 'onboarding://offline/mad-yolks',
  normalizedSourceUrl: 'onboarding://offline/mad-yolks',
  contentIdentity: null,
  savedPlaceId: 'onboarding-local-saved-mad-yolks',
  completedAt: at(1),
};
const tutorialResult: OnboardingTutorialResult = {
  jobId: 'offline-job',
  savedPlaceId: tutorialSave.savedPlaceId,
  fixtureId: 'offline-mad-yolks',
  fixtureRevision: 1,
  fixtureRole: 'primary',
  resolutionSource: 'onboarding_scripted',
  sourceUrl: tutorialSave.sourceUrl,
  place: {
    googlePlaceId: 'offline-mad-yolks-place',
    name: 'Mad Yolks',
    formattedAddress: 'Santa Cruz, CA',
    latitude: 36.9741,
    longitude: -122.0308,
    primaryType: 'restaurant',
    typeLabel: 'Restaurant',
    photoUrl: null,
    photoUrls: [],
  },
};

function phase2State(stage: OnboardingV2State['stage'] = 'phase2_intro'): OnboardingV2State {
  return {
    ...createInitialOnboardingV2State(at(0)),
    cohort: 'new_user_v2',
    stage,
    identityLifecycle: 'anonymous_active',
    boundUserId: 'anonymous-user',
    installationId: '00000000-0000-4000-8000-000000000001',
    tutorialFixture: {
      id: tutorialResult.fixtureId,
      revision: 1,
      role: 'primary',
      platform: 'instagram',
      identityKey: 'v1:instagram:offline-mad-yolks',
      identityVersion: 1,
      contentId: tutorialSave.contentId,
      canonicalUrl: tutorialSave.sourceUrl,
      launchUrl: tutorialSave.sourceUrl,
      thumbnailUrl: null,
      selectedAt: at(1),
    },
    tutorialResult,
    tutorialSave,
    firstMagicMomentCompletedAt: at(1),
    phase1CompletedAt: at(1),
  };
}

const accountSource = read('app/(onboarding)/account.tsx');
const welcomeSource = read('components/onboarding/v2/OnboardingV2PreAuth.tsx');
const mapSource = read('app/(tabs)/map.tsx');
const tabsSource = read('app/(tabs)/_layout.tsx');
const coachSource = read('components/onboarding/v2/OnboardingV2MapCoachmark.tsx');
const shareSource = read('app/share.tsx');

// 1-10: existing-account auth intent and failure isolation.
const existingIntent = resolveOnboardingAuthEntryIntent({ routeIntent: 'existing', storedExistingAccountIntent: false, mapBackupContext: true });
assert.equal(existingIntent, 'existing_account_sign_in');
pass(1, 'Welcome existing-account route resolves explicit existing-account intent');
assert.equal(isQualifyingExistingAccount({ startedAt: at(10) }, { profileCreatedAt: at(1), hasSavedPlace: false, hasCompletedOnboardingSession: false }), true);
assert.equal(bypassExistingUserFromWelcome(phase2State(), 'existing-user', at(11)).state.stage, 'graduated');
pass(2, 'established account resolves into the normal app lifecycle');
assert.equal(requiresAnonymousTransferPreparation(existingIntent), false);
pass(3, 'existing-account entry does not require anonymous transfer preparation');
const bypassedWithFixture = bypassExistingUserFromWelcome(phase2State(), 'existing-user', at(12)).state;
assert.equal(bypassedWithFixture.tutorialFixture, null);
assert.equal(bypassedWithFixture.tutorialSave, null);
pass(4, 'local tutorial fixture is discarded instead of transferred into an existing account');
assert.equal(isQualifyingExistingAccount({ startedAt: at(10) }, { profileCreatedAt: at(11), hasSavedPlace: false, hasCompletedOnboardingSession: false }), false);
pass(5, 'new OAuth identity is not misclassified as an established Nearr account');
assert.match(welcomeSource, /That account is new to Nearr/);
assert.match(accountSource, /signUpWithPassword/);
pass(6, 'new identity can return to onboarding and later use normal signup');
assert.match(accountSource, /if \(!requiresAnonymousTransferPreparation\(intent\)\) return true/);
pass(7, 'transfer-preparation failure cannot block an established-account attempt');
assert.match(accountSource, /outcome\.status === 'cancelled'/);
assert.match(accountSource, /authEntryIntent !== 'existing_account_sign_in'/);
pass(8, 'provider cancellation returns without cancelling nonexistent existing-user transfer state');
assert.match(accountSource, /toUserFacingAuthError/);
assert.doesNotMatch(onboardingAuthCopy(existingIntent).subtext, /connection|backup/i);
pass(9, 'actual auth failures retain provider-aware recoverable error handling');
const checkpointBeforeFailure = phase2State();
assert.equal(requiresAnonymousTransferPreparation(existingIntent), false);
assert.equal(checkpointBeforeFailure.tutorialSave?.savedPlaceId, tutorialSave.savedPlaceId);
pass(10, 'failed existing-account auth leaves the onboarding checkpoint untouched');

// 11-18: map ownership, local place continuity, chrome and viewport.
assert.match(welcomeSource, /fixture_map_payoff/);
assert.match(welcomeSource, /<FieldnotesPracticeScene[^>]*stage="place" onClose=\{closeCard\}/);
pass(11, 'Phase 1 payoff focuses the correct tutorial place and open card');
const payoff = phase2State('fixture_map_payoff');
assert.equal(closePlaceTour(payoff, tutorialSave.savedPlaceId, at(13)).state.stage, 'phase2_intro');
pass(12, 'closing the tutorial card advances exactly to Phase 2');
assert.equal(shouldShowLocalTutorialPlace(phase2State('practice_ready')), true);
pass(13, 'tutorial place remains visible during Phase 2');
const skipped = deferOnboardingPractice(phase2State('practice_ready'), at(14)).state;
assert.equal(skipped.stage, 'first_magic_moment_complete');
assert.equal(shouldShowLocalTutorialPlace(skipped), true);
pass(14, 'Phase 2 opt-out preserves the tutorial place through the completion beat');
const completed = completeOnboardingSecondHalf({ ...phase2State('activation_challenge') }, 'explore_map', at(15)).state;
assert.equal(completed.stage, 'onboarding_complete');
assert.equal(shouldRestoreNormalMapChrome({ wasPhase2MapActive: true, phase2MapActive: false, stage: completed.stage }), true);
assert.equal(shouldRenderMapTopChrome({ searchVisible: false, hasSelectedPlace: true, previewExpanded: false }), true);
pass(15, 'onboarding completion restores normal map filter chrome');
assert.match(mapSource, /<MapCategoryFilterBar/);
assert.match(mapSource, /<ShareQueueButton/);
assert.match(tabsSource, /name="settings"/);
assert.match(mapSource, /PHASE2_REQUIRED_MAP_FILTERS/);
pass(16, 'normal map owns canonical filters, Queue and Settings');
assert.doesNotMatch(coachSource, /onboarding_complete/);
assert.match(mapSource, /!phase2MapActive/);
pass(17, 'no Phase 2 coachmark or expanded diagnostics owns the completed map');
assert.match(mapSource, /shouldShowLocalTutorialPlace\(onboardingV2State\)/);
assert.match(mapSource, /if \(validPlaces\.length > 0\)/);
assert.match(mapSource, /previousPhase2MapActiveRef/);
pass(18, 'tutorial anchor survives ownership end and no onboarding camera reset is introduced');

// 19-26: exact real practice and forgiving normal-pipeline behavior.
assert.equal(ONBOARDING_PHASE2_PRACTICE.canonicalUrl, 'https://www.instagram.com/p/DYpcd2ZBTsZ/');
assert.match(coachSource, /Open practice video/);
pass(19, 'primary CTA resolves the exact curated practice-post URL');
assert.notEqual(ONBOARDING_PHASE2_PRACTICE.canonicalUrl, 'https://www.instagram.com/');
assert.doesNotMatch(coachSource, /instagram:\/\/app|target\.web|Open Instagram/);
pass(20, 'CTA never resolves Instagram home or a random feed');
const practiceFixture = onboardingPhase2PracticeFixture(at(16));
let guided = beginOnboardingRealPractice(phase2State(), at(16), practiceFixture).state;
guided = openExternalStarter(guided, { contentId: practiceFixture.contentId, sourceUrl: practiceFixture.canonicalUrl }, at(17)).state;
guided = receiveSharedSource(guided, practiceFixture.canonicalUrl, at(18)).state;
const guidedComplete = completePendingSave(guided, { sourceUrl: practiceFixture.canonicalUrl, savedPlaceId: 'real-guided-save' }, at(19));
assert.ok(guidedComplete.events.some((event) => event.name === 'onboarding_real_external_practice_completed'));
pass(21, 'expected practice share is recognized as guided practice');
const otherUrl = 'https://www.instagram.com/reel/OTHERREALPOST/';
let other = beginOnboardingRealPractice(phase2State(), at(20), practiceFixture).state;
other = selectPracticeSource(other, 'otherrealpost', at(21), true).state;
other = openExternalStarter(other, { contentId: 'otherrealpost', sourceUrl: otherUrl }, at(22)).state;
other = receiveSharedSource(other, otherUrl, at(23)).state;
const otherComplete = completePendingSave(other, { sourceUrl: otherUrl, savedPlaceId: 'real-other-save' }, at(24));
assert.equal(otherComplete.state.stage, 'first_magic_moment_complete');
assert.ok(!otherComplete.events.some((event) => event.name === 'onboarding_real_external_practice_completed'));
pass(22, 'another real share works normally without claiming guided-post success');
assert.match(coachSource, /could not open[\s\S]*connection[\s\S]*try this later/i);
assert.equal(deferOnboardingPractice(guided, at(25)).state.stage, 'first_magic_moment_complete');
pass(23, 'offline/open failure is recoverable and remains skippable');
assert.match(coachSource, /useOnboardingTutorialJobs/);
assert.match(coachSource, /reconcileOnboardingV2PracticeJob/);
assert.match(coachSource, /practiceSession\.completionReason/);
assert.equal(guided.pendingShare?.shareReceivedAt != null, true);
let returnedWithoutShare = beginOnboardingRealPractice(phase2State(), at(26), practiceFixture).state;
returnedWithoutShare = openExternalStarter(returnedWithoutShare, { contentId: practiceFixture.contentId, sourceUrl: practiceFixture.canonicalUrl }, at(27)).state;
assert.equal(returnedWithoutShare.stage, 'first_independent_external_video_opened');
pass(24, 'returning without a share leaves Phase 2 available');
assert.equal(guidedComplete.state.stage, 'first_magic_moment_complete');
assert.match(welcomeSource, /is saved\./);
pass(25, 'real share completion advances through the short tutorial-complete beat');
const needsReview = observeOnboardingResult(guided, practiceFixture.canonicalUrl, 'multiple', at(28));
assert.equal(needsReview.state.stage, 'first_independent_share_returned');
assert.equal(needsReview.state.pendingShare?.resultSeenAt, at(28));
assert.equal(needsReview.state.independentSaves.length, 0);
assert.match(shareSource, /phase === 'multi-choose'/);
pass(26, 'real share needing review remains in the normal authoritative review flow');

console.log('Onboarding Phase 2/auth/map hardening regression suite passed (26/26).');
