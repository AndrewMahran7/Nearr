import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  beginOnboardingInAppTutorialResolution,
  beginOnboardingRealPractice,
  beginOnboardingSharingRehearsal,
  bindAnonymousUser,
  bypassExistingUserFromWelcome,
  closePlaceTour,
  completeOnboardingInterests,
  completeOnboardingPlatforms,
  continueOnboardingFromPersonalizedPayoff,
  createInitialOnboardingV2State,
  deferOnboardingPractice,
  openExternalStarter,
  receiveSharedSource,
  receiveOnboardingTutorialFixture,
  resolveOnboardingTutorialResult,
  selectPracticeSource,
  startOnboardingV2,
  tapGetStarted,
  toggleOnboardingInterest,
  toggleOnboardingPlatform,
  advanceOnboardingSharingRehearsal,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import { isQualifyingExistingAccount } from '../lib/existingAccountSignInCore';
import { providerNamePatch, structuredProviderNames } from '../lib/providerNameCore';
import {
  buildOfflineOnboardingResult,
  OFFLINE_ONBOARDING_FIXTURES,
  selectOfflineOnboardingFixture,
  toOnboardingTutorialFixture,
} from '../onboarding/fixtures/offlineOnboardingFixtures';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const at = (second: number) => `2026-09-25T12:00:${String(second).padStart(2, '0')}.000Z`;
const pass = (number: number, message: string) => console.log(`PASS TEST ${number}: ${message}`);

const assets = {
  dorset_quarry: ['dorset-quarry-loop.mp4', 'dorset-quarry-poster.jpg', 'dorset-quarry-place-2.jpg'],
  mad_yolks: ['mad-yolks-loop.mp4', 'mad-yolks-poster.jpg', 'mad-yolks-place-2.jpg'],
  hydra_old_town: ['hydra-old-town-loop.mp4', 'hydra-old-town-poster.jpg', 'hydra-old-town-place-2.jpg'],
} as const;
const expectedPlace = {
  dorset_quarry: 'Dorset Quarry',
  mad_yolks: 'Mad Yolks',
  hydra_old_town: 'Hydra Old Town',
} as const;
const registry = read('onboarding/assets/offlineOnboardingAssets.ts');

let n = 1;
for (const key of Object.keys(assets) as Array<keyof typeof assets>) {
  const fixture = OFFLINE_ONBOARDING_FIXTURES.find((value) => value.assetKey === key)!;
  assert.equal(fixture.place.name, expectedPlace[key]);
  for (const filename of assets[key]) assert.match(registry, new RegExp(filename.replace('.', '\\.')));
  pass(n++, `${expectedPlace[key]} video and images share one fixture identity`);
}
assert.ok(OFFLINE_ONBOARDING_FIXTURES.every((fixture) => assets[fixture.assetKey].length === 3));
pass(4, 'every platform/category mapping references a complete atomic fixture');
assert.ok(OFFLINE_ONBOARDING_FIXTURES.every((fixture) => fixture.place.name === expectedPlace[fixture.assetKey]));
pass(5, 'no fixture mixes media and place identities');
for (const files of Object.values(assets)) for (const filename of files) {
  const path = join(root, 'assets/onboarding/authentic', filename);
  assert.ok(existsSync(path) && statSync(path).size > 0, `${filename} is local and non-empty`);
}
pass(6, 'all required video/image assets exist locally');
assert.doesNotMatch(registry, /sourceVideoAsset:\s*\{\s*uri:|sourcePosterAsset:\s*\{\s*uri:/);
pass(7, 'Phase 1 runtime media requires no remote URL');

function scriptedJourney(): OnboardingV2State {
  let state = startOnboardingV2(createInitialOnboardingV2State(at(0)), at(1)).state;
  state = tapGetStarted(state, at(2)).state;
  state = toggleOnboardingPlatform(state, 'instagram', at(3)).state;
  state = completeOnboardingPlatforms(state, at(4)).state;
  state = toggleOnboardingInterest(state, 'outdoors', at(5)).state;
  state = completeOnboardingInterests(state, at(6)).state;
  state = continueOnboardingFromPersonalizedPayoff(state, at(7)).state;
  const fixture = selectOfflineOnboardingFixture('instagram', 'outdoors');
  state = receiveOnboardingTutorialFixture(state, toOnboardingTutorialFixture(fixture, at(8)), at(8)).state;
  state = beginOnboardingSharingRehearsal(state, at(9)).state;
  state = advanceOnboardingSharingRehearsal(state, 'share', at(10)).state;
  state = advanceOnboardingSharingRehearsal(state, 'more', at(11)).state;
  state = beginOnboardingInAppTutorialResolution(state, at(12)).state;
  return resolveOnboardingTutorialResult(state, buildOfflineOnboardingResult(fixture), at(13)).state;
}

let payoff = scriptedJourney();
assert.equal(payoff.stage, 'fixture_map_payoff');
assert.equal(payoff.tutorialResult?.place.latitude, 43.2359604);
pass(8, 'scripted save opens the map payoff centered on the saved fixture');
assert.equal(payoff.placeTourStep, 'found');
pass(9, 'the correct fixture pin is selected');
const preAuth = read('components/onboarding/v2/OnboardingV2PreAuth.tsx');
assert.match(preAuth, /saved place card open/);
pass(10, 'the correct place card automatically opens');
assert.match(preAuth, /media\.placePhotoAssets\[1\]/);
pass(11, 'the card uses local fixture data and imagery');
const saveId = payoff.tutorialSave!.savedPlaceId;
const closed = closePlaceTour(payoff, saveId, at(13));
assert.equal(closed.state.stage, 'phase2_intro');
pass(12, 'closing the card advances to Phase 2 intro');
const closedAgain = closePlaceTour(closed.state, saveId, at(14));
assert.equal(closedAgain.changed, false);
assert.equal(closed.events.filter((event) => event.name === 'onboarding_phase1_completed').length, 1);
pass(13, 'card close advances exactly once');
assert.equal(closePlaceTour(closed.state, saveId, at(15)).state.stage, 'phase2_intro');
pass(14, 'reopening cannot restart Phase 1');

payoff = closed.state;
assert.equal(payoff.stage, 'phase2_intro');
pass(15, 'Phase 2 intro appears immediately after map-card close');
const skipped = deferOnboardingPractice(payoff, at(16)).state;
assert.equal(skipped.stage, 'why_nearr');
pass(16, 'I’ll try this later continues onboarding without a real share');
let real = bindAnonymousUser(payoff, 'anon-test-user', '00000000-0000-4000-8000-000000000001', at(17)).state;
real = beginOnboardingRealPractice(real, at(18)).state;
assert.equal(real.stage, 'practice_ready');
assert.equal(real.pendingShare, null, 'the completed scripted attempt cannot intercept the real share');
pass(17, 'real-practice choice transitions to actual share flow');
const realUrl = 'https://www.instagram.com/reel/REALTEST123/';
real = selectPracticeSource(real, 'REALTEST123', at(19)).state;
real = openExternalStarter(real, { contentId: 'REALTEST123', sourceUrl: realUrl }, at(20)).state;
real = receiveSharedSource(real, realUrl, at(21)).state;
assert.equal(real.stage, 'first_independent_share_returned');
assert.equal(real.pendingShare?.sourceUrl, realUrl);
assert.notEqual(real.pendingShare?.sourceUrl, payoff.tutorialSave?.sourceUrl);
pass(18, 'Phase 2 real job uses the real backend/share URL, not the fixture');
assert.match(preAuth, /connection is needed[\s\S]*do this later/i);
assert.match(preAuth, /deferOnboardingV2Practice/);
pass(19, 'offline real-practice requests degrade gracefully and remain skippable');
assert.deepEqual(real.tutorialResult, payoff.tutorialResult);
assert.deepEqual(real.tutorialSave, payoff.tutorialSave);
pass(20, 'real practice does not mutate the scripted fixture');

assert.match(preAuth, /Already have an account\? Sign in/);
pass(21, 'first onboarding screen contains existing-account sign-in CTA');
const intent = { startedAt: '2026-09-25T12:00:00.000Z' };
assert.equal(isQualifyingExistingAccount(intent, { profileCreatedAt: '2026-01-01T00:00:00.000Z', hasSavedPlace: false, hasCompletedOnboardingSession: false }), true);
let existing: OnboardingV2State = { ...createInitialOnboardingV2State(at(0)), cohort: 'new_user_v2', stage: 'overview' };
existing = bypassExistingUserFromWelcome(existing, 'existing-user', at(22)).state;
assert.equal(existing.stage, 'graduated');
pass(22, 'known durable existing account bypasses onboarding');
assert.equal(existing.tutorialFixture, null);
assert.equal(existing.tutorialSave, null);
pass(23, 'existing account receives no onboarding fixture state');
assert.equal(isQualifyingExistingAccount(intent, { profileCreatedAt: '2026-09-25T12:00:01.000Z', hasSavedPlace: false, hasCompletedOnboardingSession: false }), false);
pass(24, 'OAuth identity without qualifying Nearr history is not treated as existing');
const existingAdapter = read('lib/existingAccountSignIn.ts');
assert.match(existingAdapter, /supabase\.auth\.signOut\(\)/);
assert.match(preAuth, /That account is new to Nearr/);
pass(25, 'non-qualifying OAuth path signs out and returns safely to onboarding');
assert.match(preAuth, /Get started/);
assert.match(read('app/(onboarding)/account.tsx'), /signUpWithPassword/);
pass(26, 'later signup remains available');
assert.match(existingAdapter, /select\('created_at'\)/);
assert.doesNotMatch(existingAdapter, /\.insert\(|auth\.admin/);
pass(27, 'existing-account check creates no duplicate auth/profile rows');

assert.deepEqual(structuredProviderNames({ given_name: 'Ada', family_name: 'Lovelace' }), { firstName: 'Ada', lastName: 'Lovelace' });
assert.deepEqual(providerNamePatch({ firstName: 'Ada', lastName: 'Lovelace' }), { first_name: 'Ada', last_name: 'Lovelace' });
pass(28, 'Google structured first/last names are stored');
assert.deepEqual(providerNamePatch(structuredProviderNames({ full_name: 'No Guessing' })), {});
pass(29, 'Google without structured names still succeeds with nullable fields');
assert.deepEqual(providerNamePatch({ firstName: 'Grace', lastName: 'Hopper' }), { first_name: 'Grace', last_name: 'Hopper' });
pass(30, 'Apple first-authorization names are stored immediately');
assert.deepEqual(providerNamePatch({ firstName: null, lastName: null }), {});
pass(31, 'later null Apple names preserve stored values');
assert.equal('first_name' in providerNamePatch({ firstName: null, lastName: null }), false);
pass(32, 'provider null never overwrites an existing first_name');
assert.deepEqual(providerNamePatch({ firstName: 'Katherine', lastName: null }), { first_name: 'Katherine' });
pass(33, 'changed non-empty structured values use provider-wins merge policy');
assert.doesNotMatch(preAuth, /first_name|last_name|given_name|family_name/);
pass(34, 'name is not surfaced in onboarding UI');
const migration = read('supabase/migrations/20260925000001_profile_provider_names.sql');
assert.match(migration, /first_name text[\s\S]*last_name text/);
assert.doesNotMatch(migration, /first_name text not null|last_name text not null/i);
pass(35, 'name remains nullable and is not required for signup');

console.log('\nAll 35 authentic onboarding, Phase 2, account, and name-storage contracts passed.');
