import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { selectTutorialContent } from '../constants/onboardingStarterContent';
import {
  advanceSimulatedTutorial,
  bindAnonymousUser,
  completePendingSave,
  completePermanentAccountLink,
  continueToTutorial,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  freshOnboardingV2StateAfterAccountDeletion,
  onboardingV2ResumeEligibility,
  selectInterest,
  selectPlatform,
  startOnboardingV2,
  tapGetStarted,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import { expectedOnboardingV2Route, shouldNavigateOnboarding } from '../lib/onboardingV2RoutingCore';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const selectedTutorial = selectTutorialContent('instagram', 'food');
if (!selectedTutorial) throw new Error('Instagram + Food tutorial fixture missing');
const tutorial = selectedTutorial as NonNullable<typeof selectedTutorial>;
const input = { contentId: tutorial.id, sourceUrl: tutorial.sourceUrl };
let tick = 0;
const now = () => `2026-08-21T18:00:${String(tick++).padStart(2, '0')}.000Z`;
const apply = (state: OnboardingV2State, reducer: (value: OnboardingV2State, at: string) => { state: OnboardingV2State }) => reducer(state, now()).state;
const pass = (label: string) => console.log(`PASS ${label}`);

function anonymousTutorialReady(userId = 'anonymous-user') {
  let state = apply(createInitialOnboardingV2State(now()), startOnboardingV2);
  state = bindAnonymousUser(state, userId, '11111111-1111-4111-8111-111111111111', now()).state;
  state = apply(state, tapGetStarted);
  state = selectPlatform(state, 'instagram', now()).state;
  state = selectInterest(state, 'food', tutorial.id, now()).state;
  return apply(state, continueToTutorial);
}

function permanentProgress() {
  let state = anonymousTutorialReady();
  for (const action of ['share', 'more', 'nearr', 'favorite', 'process', 'result'] as const) {
    state = advanceSimulatedTutorial(state, action, input, now()).state;
  }
  state = completePendingSave(state, {
    sourceUrl: tutorial.sourceUrl,
    savedPlaceId: 'anonymous-tutorial-place',
  }, now()).state;
  return completePermanentAccountLink(state, {
    permanentUserId: 'deleted-permanent-user',
    destinationWasEstablished: false,
    tutorialSavedPlaceId: 'transferred-tutorial-place',
  }, now()).state;
}

const beforeDelete = permanentProgress();
assert.equal(beforeDelete.stage, 'place_tour');
assert.equal(onboardingV2ResumeEligibility(beforeDelete, {
  userId: 'deleted-permanent-user', identityExists: true, isAnonymous: false,
}).eligible, true);
const afterDelete = freshOnboardingV2StateAfterAccountDeletion(beforeDelete, now());
assert.equal(afterDelete.stage, 'not_started');
assert.equal(afterDelete.identityLifecycle, 'none');
assert.equal(expectedOnboardingV2Route(afterDelete.stage), '/(onboarding)');
pass('1 permanent progress -> confirmed delete -> fresh Welcome owner state');

assert.equal(onboardingV2ResumeEligibility(beforeDelete, {
  userId: 'deleted-permanent-user', identityExists: false, isAnonymous: false,
}).eligible, false);
assert.notEqual(afterDelete.stage, beforeDelete.stage);
pass('2 deleted identity cannot qualify for Pick up where you left off');

const edge = read('supabase/functions/delete-account/index.ts');
const checkpointLookup = edge.indexOf(".from('onboarding_v2_sessions')");
const authDelete = edge.indexOf('admin.auth.admin.deleteUser');
const checkpointDelete = edge.indexOf(".in('id', onboardingSessionIds)");
assert.ok(checkpointLookup > -1 && checkpointLookup < authDelete);
assert.ok(checkpointDelete > authDelete);
assert.match(edge, /user_id\.eq\.\$\{userId\},permanent_user_id\.eq\.\$\{userId\}/);
assert.match(edge, /step: 'onboarding_v2_sessions_lookup'/);
assert.match(edge, /onboardingCleanupPending/);
pass('3 server checkpoint is captured narrowly, then deleted after auth cannot hydrate it');

assert.equal(afterDelete.tutorialSave, null);
assert.equal(afterDelete.pendingShare, null);
assert.equal(afterDelete.placeTourStep, null);
assert.equal(afterDelete.preferredPlatform, null);
assert.equal(afterDelete.interest, null);
pass('4 tutorial saved-place continuation and selections are cleared');

let nextAnonymous = apply(afterDelete, startOnboardingV2);
nextAnonymous = bindAnonymousUser(nextAnonymous, 'new-anonymous-user', '22222222-2222-4222-8222-222222222222', now()).state;
assert.equal(nextAnonymous.stage, 'overview');
assert.equal(nextAnonymous.boundUserId, 'new-anonymous-user');
assert.equal(nextAnonymous.anonymousUserId, 'new-anonymous-user');
assert.equal(nextAnonymous.tutorialSave, null);
pass('5 next anonymous identity starts a new funnel at Welcome');

let pending = null;
let transitions = 0;
for (let render = 0; render < 50; render += 1) {
  const expectedRoute = expectedOnboardingV2Route(nextAnonymous.stage);
  if (shouldNavigateOnboarding({ currentRoute: '/(onboarding)', expectedRoute, pendingNavigation: pending })) {
    transitions += 1;
    pending = expectedRoute ? { from: '/(onboarding)' as const, to: expectedRoute } : null;
  }
}
assert.equal(transitions, 0);
pass('6 post-delete Welcome remains converged across 50 renders');

const forceQuitState = anonymousTutorialReady('resume-anonymous-user');
const restored = decodeOnboardingV2State(encodeOnboardingV2State(forceQuitState), now());
assert.equal(onboardingV2ResumeEligibility(restored, {
  userId: 'resume-anonymous-user', identityExists: true, isAnonymous: true,
}).eligible, true);
assert.equal(restored.stage, 'tutorial_ready');
const restoredPractice = decodeOnboardingV2State(encodeOnboardingV2State(beforeDelete), now());
assert.equal(restoredPractice.stage, 'place_tour');
assert.equal(onboardingV2ResumeEligibility(restoredPractice, {
  userId: 'deleted-permanent-user', identityExists: true, isAnonymous: false,
}).eligible, true);
pass('7 legitimate force-quit Learn and Practice resumes remain eligible');

assert.equal(beforeDelete.tutorialSave?.savedPlaceId, 'transferred-tutorial-place');
pass('8 normal account linking still preserves the transferred tutorial place');

const settings = read('app/(tabs)/settings.tsx');
const signOutStart = settings.indexOf('function handleSignOut()');
const deleteStart = settings.indexOf('function handleDeleteAccount()');
const signOutBranch = settings.slice(signOutStart, deleteStart);
assert.doesNotMatch(signOutBranch, /resetOnboardingV2AfterAccountDeletion|cleanupAfterAccountDeletion/);
assert.match(signOutBranch, /await signOut\(\)/);
pass('9 ordinary sign-out behavior is unchanged');

const deleteBranch = settings.slice(settings.indexOf('async function runAccountDeletion()'));
const failureReturn = deleteBranch.indexOf('return;');
const cleanupCall = deleteBranch.indexOf('cleanupAfterAccountDeletion');
assert.ok(failureReturn > -1 && cleanupCall > failureReturn);
const service = read('services/accountService.ts');
assert.match(service, /resetOnboardingV2AfterAccountDeletion/);
assert.match(service, /clearOnboardingAccountTransferAfterDeletion/);
assert.match(service, /rotateOnboardingFunnelId/);
pass('10 failed deletion returns before identity-bound local cleanup');

assert.equal(existsSync(join(process.cwd(), 'lib/onboardingV2DevReset.ts')), true);
assert.match(settings, /\{onboardingResetAvailable \? \(/);
assert.match(read('lib/onboardingV2DevResetCore.ts'), /appEnv === 'development'[\s\S]{0,200}backendEnv === 'development'/);
pass('11 development reset remains unavailable outside the explicit Nearr-Dev lane');

const root = read('app/_layout.tsx');
assert.match(root, /pendingOnboardingNavigationRef/);
assert.match(root, /shouldNavigateOnboarding/);
assert.equal((root.match(/expectedOnboardingV2Route\(/g) ?? []).length, 1);
pass('12 root max-update-depth guard remains the sole V2 navigation authority');

const preAuth = read('components/onboarding/v2/OnboardingV2PreAuth.tsx');
assert.match(preAuth, /identityLifecycle === 'anonymous_active'/);
assert.doesNotMatch(preAuth, /identityLifecycle !== 'none'/);
assert.doesNotMatch(preAuth, /Pick up where you left off|router\.replace\('\/activate'\)/);
const anonymousRuntime = read('lib/anonymousOnboarding.ts');
assert.match(anonymousRuntime, /discardOnboardingV2CheckpointForMissingIdentity/);
assert.match(anonymousRuntime, /onboardingV2ResumeEligibility/);
pass('invalid persisted identities self-heal instead of entering the resume surface');

console.log('\nAll deleted-account Onboarding V2 regression scenarios passed.');
