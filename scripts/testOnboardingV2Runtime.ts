import assert from 'node:assert/strict';

import { selectTutorialContent } from '../constants/onboardingStarterContent';
import {
  acknowledgeGraduation,
  advanceSimulatedTutorial,
  backOnboardingV2,
  beginPermanentAccountLink,
  bindAnonymousUser,
  closePlaceTour,
  completePendingSave,
  completePermanentAccountLink,
  continueToTutorial,
  createInitialOnboardingV2State,
  failPendingSave,
  openExternalStarter,
  selectInterest,
  selectPracticeSource,
  selectPlatform,
  startOnboardingV2,
  tapGetStarted,
  type OnboardingTransition,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  expectedOnboardingV2Route,
  onboardingRouteKey,
  shouldNavigateOnboarding,
  type PendingOnboardingNavigation,
} from '../lib/onboardingV2RoutingCore';

let tick = 0;
const now = () => `2026-08-21T12:00:${String(tick++).padStart(2, '0')}.000Z`;
const selectedTutorial = selectTutorialContent('instagram', 'food');
if (!selectedTutorial) throw new Error('Onboarding tutorial fixture is missing.');
const tutorial = selectedTutorial as NonNullable<typeof selectedTutorial>;
const tutorialInput = { contentId: tutorial.id, sourceUrl: tutorial.sourceUrl };

function apply(
  state: OnboardingV2State,
  reducer: (state: OnboardingV2State, at: string) => OnboardingTransition,
): OnboardingV2State {
  return reducer(state, now()).state;
}

function assertBounded(name: string, before: number, after: number, maximum: number): void {
  const count = after - before;
  assert.ok(count >= 0 && count <= maximum, `${name}: ${count} transitions exceeded ${maximum}`);
  console.log(`PASS ${name} (transitions=${count}, max=${maximum})`);
}

function freshWelcome(): OnboardingV2State {
  return apply(createInitialOnboardingV2State(now()), startOnboardingV2);
}

function anonymousWelcome(): OnboardingV2State {
  return bindAnonymousUser(
    freshWelcome(),
    'anonymous-user',
    '11111111-1111-4111-8111-111111111111',
    now(),
  ).state;
}

function tutorialReady(): OnboardingV2State {
  let state = anonymousWelcome();
  state = apply(state, tapGetStarted);
  state = selectPlatform(state, 'instagram', now()).state;
  state = selectInterest(state, 'food', tutorial.id, now()).state;
  return apply(state, continueToTutorial);
}

function tutorialResult(): OnboardingV2State {
  let state = tutorialReady();
  for (const action of ['share', 'more', 'nearr', 'favorite', 'process', 'result'] as const) {
    state = advanceSimulatedTutorial(state, action, tutorialInput, now()).state;
  }
  return state;
}

function accountRequired(): OnboardingV2State {
  return completePendingSave(
    tutorialResult(),
    { sourceUrl: tutorial.sourceUrl, savedPlaceId: 'tutorial-place' },
    now(),
  ).state;
}

function practiceReady(): OnboardingV2State {
  let state = accountRequired();
  state = apply(state, beginPermanentAccountLink);
  state = completePermanentAccountLink(state, {
    permanentUserId: 'permanent-user',
    destinationWasEstablished: false,
    tutorialSavedPlaceId: 'tutorial-place',
  }, now()).state;
  return closePlaceTour(state, 'tutorial-place', now()).state;
}

function dispatchedNavigationCount(
  currentRoute: string,
  stage: OnboardingV2State['stage'],
  rendersBeforeCommit: number,
): number {
  const expectedRoute = expectedOnboardingV2Route(stage);
  let pending: PendingOnboardingNavigation = null;
  let dispatches = 0;
  for (let render = 0; render < rendersBeforeCommit; render += 1) {
    if (shouldNavigateOnboarding({ currentRoute, expectedRoute, pendingNavigation: pending })) {
      dispatches += 1;
      pending = expectedRoute ? { from: currentRoute, to: expectedRoute } : null;
    }
  }
  return dispatches;
}

// 1. Fresh launch -> Welcome.
{
  const initial = createInitialOnboardingV2State(now());
  const state = apply(initial, startOnboardingV2);
  assert.equal(state.stage, 'overview');
  assertBounded('fresh launch -> Welcome', initial.revision, state.revision, 1);
}

// 2. Welcome -> Platform.
{
  const before = anonymousWelcome();
  const state = apply(before, tapGetStarted);
  assert.equal(state.stage, 'platform');
  assertBounded('Welcome -> Platform', before.revision, state.revision, 1);
}

// 3. Platform -> Back -> Welcome.
{
  const platform = apply(anonymousWelcome(), tapGetStarted);
  const state = apply(platform, backOnboardingV2);
  assert.equal(state.stage, 'overview');
  assertBounded('Platform -> Back -> Welcome', platform.revision, state.revision, 1);
}

// 4. Platform -> Category -> Back -> Platform.
{
  const platform = apply(anonymousWelcome(), tapGetStarted);
  let category = selectPlatform(platform, 'instagram', now()).state;
  const selectedRevision = category.revision;
  category = selectPlatform(category, 'instagram', now()).state;
  assert.equal(category.revision, selectedRevision, 'stale duplicate platform tap is a semantic no-op');
  const state = apply(category, backOnboardingV2);
  assert.equal(state.stage, 'platform');
  assertBounded('Platform -> Category -> Back -> Platform', platform.revision, state.revision, 2);
}

// 5. Tutorial progression is monotonic; duplicate callbacks do not write.
{
  let state = tutorialReady();
  const before = state.revision;
  state = advanceSimulatedTutorial(state, 'share', tutorialInput, now()).state;
  const once = state.revision;
  state = advanceSimulatedTutorial(state, 'share', tutorialInput, now()).state;
  assert.equal(state.revision, once);
  for (const action of ['more', 'nearr', 'favorite', 'process', 'result'] as const) {
    state = advanceSimulatedTutorial(state, action, tutorialInput, now()).state;
  }
  assert.equal(state.stage, 'tutorial_result_seen');
  assertBounded('tutorial step progression', before, state.revision, 6);
}

// 6. Tutorial Back is one mutation and cannot be undone by route reconciliation.
{
  const shared = advanceSimulatedTutorial(tutorialReady(), 'share', tutorialInput, now()).state;
  const state = apply(shared, backOnboardingV2);
  assert.equal(state.stage, 'tutorial_ready');
  assert.equal(dispatchedNavigationCount('/activate', state.stage, 20), 0);
  assertBounded('tutorial step Back', shared.revision, state.revision, 1);
}

// 7. A persisted Learn step resumes with one route edge, even across 20 renders.
{
  const state = JSON.parse(JSON.stringify(tutorialReady())) as OnboardingV2State;
  assert.equal(dispatchedNavigationCount('/(onboarding)', state.stage, 20), 1);
  assertBounded('resume persisted Learn step', state.revision, state.revision, 0);
}

// 8. Restoring the same anonymous binding is a semantic no-op.
{
  const before = anonymousWelcome();
  const state = bindAnonymousUser(before, before.anonymousUserId!, before.funnelSessionId!, now()).state;
  assertBounded('anonymous session restored', before.revision, state.revision, 0);
}

// 9. Tutorial save -> account linking route.
{
  const before = tutorialResult();
  const state = completePendingSave(before, {
    sourceUrl: tutorial.sourceUrl,
    savedPlaceId: 'tutorial-place',
  }, now()).state;
  assert.equal(state.stage, 'account_required');
  assert.equal(dispatchedNavigationCount('/activate', state.stage, 20), 1);
  assertBounded('tutorial save -> account linking', before.revision, state.revision, 1);
}

// 10. Account linking -> Practice.
{
  const before = accountRequired();
  let state = apply(before, beginPermanentAccountLink);
  state = completePermanentAccountLink(state, {
    permanentUserId: 'permanent-user',
    destinationWasEstablished: false,
    tutorialSavedPlaceId: 'tutorial-place',
  }, now()).state;
  assert.equal(state.stage, 'place_tour');
  assert.equal(dispatchedNavigationCount('/(onboarding)/account', state.stage, 20), 1);
  assertBounded('account linking -> Practice', before.revision, state.revision, 2);
}

// 11. Practice 1/3 -> external attempt -> return without share.
{
  const before = practiceReady();
  let state = selectPracticeSource(before, 'practice-one', now()).state;
  state = openExternalStarter(state, {
    contentId: 'practice-one',
    sourceUrl: 'https://www.instagram.com/reel/practice-one/',
  }, now()).state;
  state = failPendingSave(state, 'returned_without_share', now()).state;
  assert.equal(state.independentSaves.length, 0);
  assertBounded('Practice 1/3 -> external attempt -> return', before.revision, state.revision, 3);
}

// 12. Graduation -> map.
{
  let state = practiceReady();
  const before = state.revision;
  for (const [index, contentId] of ['practice-one', 'practice-two'].entries()) {
    const sourceUrl = `https://www.instagram.com/reel/${contentId}/`;
    state = selectPracticeSource(state, contentId, now()).state;
    state = openExternalStarter(state, { contentId, sourceUrl }, now()).state;
    state = completePendingSave(state, { sourceUrl, savedPlaceId: `saved-${index}` }, now()).state;
  }
  assert.equal(state.stage, 'graduated');
  state = apply(state, acknowledgeGraduation);
  assert.equal(dispatchedNavigationCount('/(tabs)/map', state.stage, 20), 0);
  assertBounded('Graduation -> map', before, state.revision, 7);
}

// 13. Already-graduated user -> map exactly once from a stale route.
{
  const state = { ...practiceReady(), stage: 'graduated' as const, behavioralCompletedAt: now() };
  assert.equal(dispatchedNavigationCount('/(onboarding)', state.stage, 20), 1);
  assertBounded('already-graduated user -> map', state.revision, state.revision, 0);
}

// 14. A converged route never replaces itself; an uncommitted edge dispatches once.
{
  assert.equal(dispatchedNavigationCount('/activate', 'tutorial_ready', 50), 0);
  assert.equal(dispatchedNavigationCount('/(onboarding)', 'tutorial_ready', 50), 1);
  assert.equal(onboardingRouteKey(['(onboarding)']), '/(onboarding)');
  assert.equal(onboardingRouteKey(['(onboarding)', 'account']), '/(onboarding)/account');
  assert.equal(onboardingRouteKey(['activate']), '/activate');
  assert.equal(onboardingRouteKey(['(tabs)', 'map']), '/(tabs)/map');
  console.log('PASS no route continuously replaces itself (dispatches=0/1, renders=50)');
}

// 15. The former signed-out hydration race cannot ping-pong onboarding/activate.
{
  let legacyRoute = '/(onboarding)';
  let legacyDispatches = 0;
  for (let render = 0; render < 20; render += 1) {
    // Former screen effect: persisted tutorial stage sent onboarding to activate.
    if (legacyRoute === '/(onboarding)') legacyRoute = '/activate';
    // Former AuthGate effect: the not-yet-restored session sent activate back.
    else legacyRoute = '/(onboarding)';
    legacyDispatches += 1;
  }
  assert.equal(legacyDispatches, 20, 'bounded diagnostic reproduces the former redirect cycle');
  assert.equal(
    shouldNavigateOnboarding({
      currentRoute: '/(onboarding)',
      expectedRoute: '/(onboarding)',
      pendingNavigation: null,
    }),
    false,
    'signed-out AuthGate remains converged while anonymous auth restores',
  );
  assert.equal(dispatchedNavigationCount('/(onboarding)', 'tutorial_ready', 20), 1);
  console.log('PASS signed-out hydration race cannot ping-pong routes (legacy=20, repaired=0/1)');
}

console.log('\nAll Onboarding V2 bounded runtime scenarios passed.');
