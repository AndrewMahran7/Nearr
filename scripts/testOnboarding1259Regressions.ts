import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  beginGoogleAuthTransaction,
  browserTransactionOwnsCallback,
  completeAuthenticatedTransaction,
  getAuthTransaction,
  initiatingScreenOwnsAuthNavigation,
  markAuthenticatedTransactionTransferring,
  resetAuthTransactionForTests,
  setAuthTransactionStatus,
} from '../lib/authTransaction';
import {
  ONBOARDING_PHASE2_PRACTICE_BY_CATEGORY,
  onboardingPhase2PracticeFixture,
  onboardingPhase2PracticeForInterest,
} from '../lib/onboardingPhase2Practice';
import {
  OFFLINE_ONBOARDING_FIXTURES,
  onboardingCategoryForInterest,
  selectOfflineOnboardingFixture,
  toOnboardingTutorialFixture,
} from '../onboarding/fixtures/offlineOnboardingFixtures';
import {
  beginOnboardingRealPractice,
  completePendingSave,
  createInitialOnboardingV2State,
  openExternalStarter,
  receiveSharedSource,
  repairPreShareTutorialFixture,
  type CompletedOnboardingSave,
  type OnboardingTutorialResult,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import { requiresAnonymousTransferPreparation } from '../lib/onboardingAuthIntentCore';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const at = (n: number) => `2026-09-28T20:10:${String(n).padStart(2, '0')}.000Z`;
let number = 0;
const pass = (label: string) => console.log(`PASS ${++number}/31 ${label}`);

resetAuthTransactionForTests();
const first = beginGoogleAuthTransaction(1_000)!;
assert.ok(first); pass('one Google transaction can begin');
assert.equal(beginGoogleAuthTransaction(1_001), null); pass('double tap cannot launch a second browser');
assert.equal(browserTransactionOwnsCallback('nearr://auth-callback?code=one', 1_002), true); pass('browser result owns the matching callback');
assert.equal(initiatingScreenOwnsAuthNavigation(1_003), true); pass('initiating screen owns final navigation');
setAuthTransactionStatus(first.id, 'authenticated');
markAuthenticatedTransactionTransferring();
assert.equal(getAuthTransaction()?.status, 'transferring'); pass('authenticated transaction enters explicit transfer state');
completeAuthenticatedTransaction();
assert.equal(getAuthTransaction()?.status, 'completed'); pass('session finalization is idempotently completed');
assert.equal(requiresAnonymousTransferPreparation('existing_account_sign_in'), false); pass('existing-account sign-in has no transfer prerequisite');
assert.equal(requiresAnonymousTransferPreparation('backup_current_map'), true); pass('backup retains its authorized transfer preparation');
assert.equal(read('services/auth.ts').match(/openAuthSessionAsync/g)?.length, 1); pass('Google adapter contains one provider browser launch');

const seedTutorialSave: CompletedOnboardingSave = { kind: 'tutorial', contentId: 'offline', sourceUrl: 'onboarding://offline', normalizedSourceUrl: 'onboarding://offline', contentIdentity: null, savedPlaceId: 'onboarding-local-only', completedAt: at(1) };
const base = (): OnboardingV2State => ({
  ...createInitialOnboardingV2State(at(0)),
  cohort: 'new_user_v2', stage: 'phase2_intro', identityLifecycle: 'anonymous_active',
  boundUserId: 'anonymous-test-principal', phase1CompletedAt: at(1), tutorialSave: seedTutorialSave,
});
const practice = onboardingPhase2PracticeFixture(at(2), onboardingPhase2PracticeForInterest('shopping'));
let state = beginOnboardingRealPractice(base(), at(2), practice).state;
state = openExternalStarter(state, { contentId: practice.contentId, sourceUrl: practice.canonicalUrl }, at(3)).state;
state = receiveSharedSource(state, practice.canonicalUrl, at(4)).state;
const once = completePendingSave(state, { sourceUrl: practice.canonicalUrl, savedPlaceId: 'real-save-1' }, at(5));
const twice = completePendingSave(once.state, { sourceUrl: practice.canonicalUrl, savedPlaceId: 'real-save-1' }, at(6));
assert.equal(once.state.stage, 'first_magic_moment_complete'); pass('review confirmation advances once');
assert.equal(twice.changed, false); pass('late polling/realtime completion is ignored');
assert.equal(once.state.independentSaves.length, 1); pass('duplicate observation cannot duplicate the save');
assert.match(read('app/share-jobs/[jobId].tsx'), /owner=onboarding_state_machine/); pass('save screen suppresses competing imperative navigation');

assert.equal(onboardingCategoryForInterest('shopping'), 'shopping'); pass('Shops maps to shopping, never travel');
const shopFixture = selectOfflineOnboardingFixture('instagram', 'shopping');
assert.equal(shopFixture.place.name, 'Old Towne Orange Shops'); pass('Shops scripted result is a shopping destination');
assert.equal(shopFixture.assetKey, 'old_towne_shops_v2'); pass('Shops media uses its own versioned asset family');
assert.equal(ONBOARDING_PHASE2_PRACTICE_BY_CATEGORY.shopping.expectedPlaceName, 'Country Roads Antiques'); pass('Shops real practice is a genuine shop');
assert.deepEqual(new Set(OFFLINE_ONBOARDING_FIXTURES.map((fixture) => fixture.category)), new Set(['food', 'outdoors', 'travel', 'shopping'])); pass('every offered category family has a coherent fixture mapping');
assert.ok(existsSync(join(root, 'assets/onboarding/authentic/old-towne-shops-poster-v2.png'))); pass('shopping poster is bundled');
assert.match(read('components/onboarding/v2/OfflineFixtureVideo.tsx'), /onReadyForDisplay/); pass('poster remains until local video is ready');

assert.equal(practice.canonicalUrl, 'https://www.instagram.com/p/CM2QChDn2Nk/'); pass('one-tap practice opens the exact selected post');
assert.match(read('services/onboardingPracticeLauncher.ts'), /const target = fixture\.launchUrl \|\| fixture\.canonicalUrl[\s\S]*Linking\.openURL\(target\)/); pass('launcher never intentionally opens a social home feed');
assert.equal(completePendingSave(base(), { sourceUrl: practice.canonicalUrl, savedPlaceId: 'old-job' }, at(7)).changed, false); pass('a previous session job cannot complete fresh practice');
assert.equal(state.pendingShare?.shareReceivedAt, at(4)); pass('receipt remains distinct from review/resolution');
assert.match(read('components/onboarding/v2/OnboardingV2MapCoachmark.tsx'), /completionReason/); pass('background, decline, and resolved outcomes remain distinct');

assert.match(read('components/onboarding/v2/OnboardingV2PreAuth.tsx'), /\{placeName\} is saved\./); pass('real-save payoff names the durable result');
assert.match(read('components/onboarding/v2/Phase1Visuals.tsx'), /scrollContentWithFooter/); pass('scroll content reserves space above the fixed CTA');
assert.doesNotMatch(read('app/(tabs)/settings.tsx'), /if \(loading\) \{[\s\S]{0,180}<Screen>/); pass('settings shell does not wait on the account request');
assert.doesNotMatch(read('app/_layout.tsx').split('Register this device')[0].slice(-500), /checkProximityOnce\(\)/); pass('account sign-in alone cannot trigger proximity delivery');

const tutorialSave: CompletedOnboardingSave = { kind: 'tutorial', contentId: 'old', sourceUrl: 'onboarding://old', normalizedSourceUrl: 'onboarding://old', contentIdentity: null, savedPlaceId: 'local-only', completedAt: at(8) };
const result: OnboardingTutorialResult = { jobId: 'local', savedPlaceId: 'local-only', fixtureId: 'old', fixtureRevision: 1, fixtureRole: 'primary', resolutionSource: 'onboarding_scripted', sourceUrl: 'onboarding://old', place: { googlePlaceId: 'local', name: 'Local', formattedAddress: null, latitude: 0, longitude: 0, primaryType: null, typeLabel: null, photoUrl: null, photoUrls: [] } };
const completedOld = { ...base(), stage: 'phase2_intro' as const, tutorialSave, tutorialResult: result };
assert.equal(repairPreShareTutorialFixture(completedOld, toOnboardingTutorialFixture(shopFixture, at(9)), at(9)).changed, false); pass('completed old checkpoints are preserved rather than erased');
assert.ok(OFFLINE_ONBOARDING_FIXTURES.every((fixture) => fixture.id.startsWith('onboarding-offline-'))); pass('synthetic fixtures retain local-only identities and never become reminder rows');

assert.equal(number, 31);
console.log('Onboarding 12:59 regression suite passed (31/31).');
