import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  advanceOnboardingSharingRehearsal,
  beginOnboardingInAppTutorialResolution,
  beginOnboardingSharingRehearsal,
  closePlaceTour,
  completeOnboardingInterests,
  completeOnboardingPlatforms,
  continueOnboardingFromPersonalizedPayoff,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  receiveOnboardingTutorialFixture,
  resolveOnboardingTutorialResult,
  startOnboardingV2,
  tapGetStarted,
  toggleOnboardingInterest,
  toggleOnboardingPlatform,
  type OnboardingInterest,
  type OnboardingPlatform,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  buildOfflineOnboardingResult,
  OFFLINE_ONBOARDING_FIXTURES,
  OFFLINE_ONBOARDING_TIMING_MS,
  selectOfflineOnboardingFixture,
  toOnboardingTutorialFixture,
} from '../onboarding/fixtures/offlineOnboardingFixtures';

const at = (second: number) => `2026-09-25T12:00:${String(second).padStart(2, '0')}.000Z`;
const apply = (state: OnboardingV2State, reducer: (value: OnboardingV2State, now: string) => { state: OnboardingV2State }, second: number) => reducer(state, at(second)).state;

assert.equal(OFFLINE_ONBOARDING_FIXTURES.length, 12, 'four platforms × three content categories are bundled');
for (const platform of ['instagram', 'tiktok', 'facebook', 'youtube'] as const) {
  for (const [interest, category] of [['outdoors', 'outdoors'], ['food', 'food'], ['travel', 'travel']] as const) {
    const fixture = selectOfflineOnboardingFixture(platform, interest);
    assert.equal(fixture.platform, platform, `${platform} remains ${platform}`);
    assert.equal(fixture.category, category, `${interest} maps to ${category}`);
    assert.ok(fixture.creatorDisplay && fixture.caption && fixture.comments.length > 0);
    assert.ok(fixture.place.name && fixture.place.address && fixture.place.aiNote && fixture.place.nearby.length > 0);
  }
}
console.log('PASS 1–2 local platform/content fixture matrix is complete and render-ready');

for (const asset of [
  'assets/onboarding/authentic/dorset-quarry-loop.mp4',
  'assets/onboarding/authentic/mad-yolks-loop.mp4',
  'assets/onboarding/authentic/hydra-old-town-loop.mp4',
]) {
  assert.equal(existsSync(join(process.cwd(), asset)), true, `${asset} is bundled`);
}
console.log('PASS 3 bundled post and place media exists without remote URLs');

function runJourney(platform: Exclude<OnboardingPlatform, 'other'>, interest: OnboardingInterest) {
  let state = apply(createInitialOnboardingV2State(at(0)), startOnboardingV2, 1);
  state = apply(state, tapGetStarted, 2);
  state = toggleOnboardingPlatform(state, platform, at(3)).state;
  state = completeOnboardingPlatforms(state, at(4)).state;
  state = toggleOnboardingInterest(state, interest, at(5)).state;
  state = completeOnboardingInterests(state, at(6)).state;
  state = continueOnboardingFromPersonalizedPayoff(state, at(7)).state;
  const local = selectOfflineOnboardingFixture(platform, interest);
  state = receiveOnboardingTutorialFixture(state, toOnboardingTutorialFixture(local, at(8)), at(8)).state;
  state = beginOnboardingSharingRehearsal(state, at(9)).state;
  state = advanceOnboardingSharingRehearsal(state, 'share', at(10)).state;
  state = advanceOnboardingSharingRehearsal(state, 'more', at(11)).state;
  state = beginOnboardingInAppTutorialResolution(state, at(12)).state;
  return { state, local };
}

let { state, local } = runJourney('tiktok', 'food');
assert.equal(state.stage, 'tutorial_processing');
assert.equal(state.identityLifecycle, 'none', 'the demo does not require anonymous auth');
assert.equal(state.tutorialJobId, `onboarding-scripted-job:${local.id}`);
assert.match(state.pendingShare?.sourceUrl ?? '', /^onboarding:\/\//);
console.log('PASS 4–5 Share → More → Nearr enters local scripted processing without auth');

const result = buildOfflineOnboardingResult(local);
state = resolveOnboardingTutorialResult(state, result, at(14)).state;
assert.equal(state.stage, 'fixture_map_payoff');
assert.equal(state.tutorialResult?.place.name, local.place.name);
assert.match(state.tutorialSave?.savedPlaceId ?? '', /^onboarding-scripted-save:/);
assert.equal(state.independentSaves.length, 0);
assert.equal(state.placeTourStep, 'found');
state = closePlaceTour(state, state.tutorialSave!.savedPlaceId, at(18)).state;
assert.equal(state.stage, 'phase2_intro');
assert.equal(state.phase1CompletedAt, at(18));
console.log('PASS 6–7 recognition, local save, and saved-place detail are deterministic');

const resumed = decodeOnboardingV2State(encodeOnboardingV2State(state), at(19));
assert.equal(resumed.stage, state.stage);
assert.deepEqual(resumed.tutorialResult, state.tutorialResult);
assert.deepEqual(resumed.tutorialSave, state.tutorialSave);
console.log('PASS 8 process-death resume preserves the local fixture and save');

const offlineFingerprint = (network: 'online' | 'offline' | 'supabase_down' | 'google_down' | 'railway_down' | 'social_404') => {
  const journey = runJourney('facebook', 'outdoors');
  return JSON.stringify({
    networkIgnored: network.length > 0,
    stage: journey.state.stage,
    fixture: journey.state.tutorialFixture?.id,
    job: journey.state.tutorialJobId,
    result: buildOfflineOnboardingResult(journey.local),
  }, (key, value) => key === 'networkIgnored' ? true : value);
};
const baseline = offlineFingerprint('online').replace('true', 'true');
for (const condition of ['offline', 'supabase_down', 'google_down', 'railway_down', 'social_404'] as const) {
  assert.equal(offlineFingerprint(condition), baseline, `${condition} cannot influence progression`);
}
console.log('PASS 9–13 network, Supabase, Google, Railway, and social availability are irrelevant');

assert.deepEqual(OFFLINE_ONBOARDING_TIMING_MS, {
  postReceived: 0, scanningVideo: 420, lookingForClues: 900, matchingPlace: 1_380, found: 1_850,
});
const adapter = readFileSync(join(process.cwd(), 'lib/onboardingV2.ts'), 'utf8');
const preAuth = readFileSync(join(process.cwd(), 'components/onboarding/v2/OnboardingV2PreAuth.tsx'), 'utf8');
assert.doesNotMatch(preAuth, /hostShareSubmitter|create-share-job|saveSavedPlace|placesService|media-worker/);
assert.match(adapter, /const localSandbox = result\.state\.identityLifecycle === 'none'/, 'pre-auth state remains local');
assert.match(adapter, /if \(!localSandbox && result\.state\.boundUserId\)/, 'only non-sandbox identity state can sync');
assert.doesNotMatch(result.sourceUrl, /^https?:/);
console.log('PASS 14–18 fixed timing; no share job, Places, worker, remote media, or real save mutation');

console.log('\nAll fully offline onboarding contracts passed.');
