import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { selectTutorialContent } from '../constants/onboardingStarterContent';
import {
  advanceSimulatedTutorial,
  backOnboardingV2,
  bindAnonymousUser,
  completePendingSave,
  completePermanentAccountLink,
  continueToTutorial,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  selectInterest,
  selectPlatform,
  startOnboardingV2,
  tapGetStarted,
  type OnboardingV2State,
  type SimulatedTutorialAction,
} from '../lib/onboardingV2Core';
import { personalizedSavePrompt, sourceChoiceLayout, SUPPORTED_ONBOARDING_WIDTHS } from '../lib/onboardingV2ImmersiveCore';
import { resolveOpenSavedPlaceRoute, shouldExpandSavedPlaceDetails } from '../lib/openSavedPlace';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const tutorial = selectTutorialContent('instagram', 'food');
if (!tutorial) throw new Error('Instagram + Food tutorial fixture missing');
const input = { contentId: tutorial.id, sourceUrl: tutorial.sourceUrl };
let tick = 0;
const now = () => `2026-08-21T14:00:${String(tick++).padStart(2, '0')}.000Z`;
const apply = (state: OnboardingV2State, reducer: (value: OnboardingV2State, at: string) => { state: OnboardingV2State }) => reducer(state, now()).state;
const pass = (label: string) => console.log(`PASS ${label}`);

let state = apply(createInitialOnboardingV2State(now()), startOnboardingV2);
state = bindAnonymousUser(state, 'anonymous-user', '11111111-1111-4111-8111-111111111111', now()).state;
state = apply(state, tapGetStarted);
assert.equal(state.stage, 'platform');
state = selectPlatform(state, 'instagram', now()).state;
assert.equal(state.preferredPlatform, 'instagram');
pass('1 Welcome -> Instagram');

for (const width of SUPPORTED_ONBOARDING_WIDTHS) {
  const layout = sourceChoiceLayout(width);
  assert.ok(layout.cardWidth > 0);
  assert.ok(layout.labelWidth >= 90, `${width}px leaves only ${layout.labelWidth}px for Instagram`);
}
const preAuth = read('components/onboarding/v2/OnboardingV2PreAuth.tsx');
assert.match(preAuth, /numberOfLines=\{1\}/);
pass('2 Instagram single-line layout contract at 375/390/430px');

state = selectInterest(state, 'food', tutorial.id, now()).state;
assert.equal(state.stage, 'interest_selected');
assert.equal(state.interest, 'food');
pass('3 Instagram -> Food');
assert.equal(personalizedSavePrompt('Instagram', 'Food'), "Let's save a restaurant from Instagram.");
pass('4 personalized tutorial uses Instagram + Food');
state = apply(state, continueToTutorial);

const expectedActions: Array<[SimulatedTutorialAction, OnboardingV2State['stage']]> = [
  ['share', 'tutorial_share_tapped'],
  ['more', 'tutorial_more_tapped'],
  ['nearr', 'tutorial_nearr_selected'],
  ['favorite', 'tutorial_favorite_added'],
  ['process', 'tutorial_processing'],
  ['result', 'tutorial_result_seen'],
];
const labels = [
  '5 Reel requires Share',
  '6 share surface requires Share to',
  '7 system share requires Nearr',
  '8 Favorites requires +',
  '9 Favorites success continues after Send',
  '10 Vayrin/result occurs after send',
];
for (let index = 0; index < expectedActions.length; index += 1) {
  const [correctAction, expectedStage] = expectedActions[index];
  const wrongAction: SimulatedTutorialAction = correctAction === 'share' ? 'more' : 'share';
  const unchanged = advanceSimulatedTutorial(state, wrongAction, input, now()).state;
  assert.equal(unchanged.revision, state.revision, `${state.stage} accepted ${wrongAction}`);
  state = advanceSimulatedTutorial(state, correctAction, input, now()).state;
  assert.equal(state.stage, expectedStage);
  pass(labels[index]);
}

const activation = read('components/onboarding/v2/OnboardingV2Activation.tsx');
const resultBranch = activation.slice(activation.indexOf("if (stage === 'tutorial_result_seen')"), activation.indexOf("stage === 'tutorial_ready'"));
assert.doesNotMatch(resultBranch, />Saved<|Saved badge/);
assert.match(resultBranch, /Save to my map/);
assert.equal(state.tutorialSave, null);
pass('11 result is not saved before explicit CTA');

state = completePendingSave(state, { sourceUrl: tutorial.sourceUrl, savedPlaceId: 'anonymous-mad-yolks' }, now()).state;
assert.equal(state.tutorialSave?.savedPlaceId, 'anonymous-mad-yolks');
assert.equal(state.stage, 'account_required');
pass('12 explicit save creates authoritative tutorial save');
assert.equal(1 + state.independentSaves.length, 1);
pass('13 tutorial place is exactly 1/3');

state = completePermanentAccountLink(state, {
  permanentUserId: 'permanent-user',
  destinationWasEstablished: false,
  tutorialSavedPlaceId: 'transferred-mad-yolks',
}, now()).state;
assert.equal(state.stage, 'place_tour');
assert.equal(state.tutorialSave?.savedPlaceId, 'transferred-mad-yolks');
pass('14 account link transfers tutorial place');
const route = resolveOpenSavedPlaceRoute({ savedPlaceId: state.tutorialSave?.savedPlaceId, source: 'onboarding_tutorial' });
assert.equal(route.pathname, '/(tabs)/map');
assert.equal(route.params.savedPlaceId, 'transferred-mad-yolks');
assert.ok(shouldExpandSavedPlaceDetails(route.params.placeSource));
pass('15 post-login opens transferred tutorial Place Detail');
assert.equal(route.params.savedPlaceId, state.tutorialSave?.savedPlaceId);
pass('16 the transferred saved_place identity is used end to end');
assert.equal(state.tutorialSave?.sourceUrl, tutorial.sourceUrl);
assert.equal(state.independentSaves.length, 0);
pass('17 account conversion creates no duplicate Mad Yolks save');

let backward = apply(createInitialOnboardingV2State(now()), startOnboardingV2);
backward = bindAnonymousUser(backward, 'a', '22222222-2222-4222-8222-222222222222', now()).state;
backward = apply(backward, tapGetStarted);
backward = selectPlatform(backward, 'instagram', now()).state;
backward = selectInterest(backward, 'food', tutorial.id, now()).state;
backward = apply(backward, continueToTutorial);
for (const [action] of expectedActions.slice(0, 4)) backward = advanceSimulatedTutorial(backward, action, input, now()).state;
for (const expected of ['tutorial_nearr_selected', 'tutorial_more_tapped', 'tutorial_share_tapped', 'tutorial_ready', 'interest_selected'] as const) {
  backward = apply(backward, backOnboardingV2);
  assert.equal(backward.stage, expected);
}
pass('18 Back moves through immersive checkpoints without route mutation');

let resume = apply(createInitialOnboardingV2State(now()), startOnboardingV2);
resume = bindAnonymousUser(resume, 'a', '33333333-3333-4333-8333-333333333333', now()).state;
resume = apply(resume, tapGetStarted);
resume = selectPlatform(resume, 'instagram', now()).state;
resume = selectInterest(resume, 'food', tutorial.id, now()).state;
resume = apply(resume, continueToTutorial);
for (const action of ['share', 'more', 'nearr'] as const) resume = advanceSimulatedTutorial(resume, action, input, now()).state;
assert.equal(decodeOnboardingV2State(encodeOnboardingV2State(resume), now()).stage, 'tutorial_nearr_selected');
pass('19 immersive stable checkpoint resumes after force quit');

const settings = read('app/(tabs)/settings.tsx');
assert.match(settings, /\{onboardingResetAvailable \? \(/);
assert.equal(existsSync(join(process.cwd(), 'lib/onboardingV2DevReset.ts')), true);
assert.match(read('lib/onboardingV2DevResetCore.ts'), /appEnv === 'development'[\s\S]{0,200}backendEnv === 'development'/);
pass('20 development reset remains fail-closed outside the declared development lane');

const layout = read('app/_layout.tsx');
assert.match(layout, /pendingOnboardingNavigationRef/);
assert.match(layout, /shouldNavigateOnboarding/);
assert.equal((layout.match(/expectedOnboardingV2Route\(/g) ?? []).length, 1);
pass('21 root navigation remains single-authority and loop guarded');

const postAuth = read('lib/postAuthRouting.ts');
const anonymousRuntime = read('lib/anonymousOnboarding.ts');
const map = read('app/(tabs)/map.tsx');
assert.match(postAuth, /savedPlaceId: transition\.tutorialSavedPlaceId/);
assert.match(postAuth, /source: 'onboarding_tutorial'/);
assert.match(anonymousRuntime, /tutorialSavedPlaceId: result\.tutorialSavedPlaceId/);
assert.match(map, /placeSource === 'onboarding_tutorial'[\s\S]{0,120}recordOnboardingV2PlaceTourOpened\(target\.id\)/);
pass('post-auth continuation preserves exact identity and starts the Place Detail tour');

console.log('\nAll immersive Onboarding V2 scenarios passed.');
