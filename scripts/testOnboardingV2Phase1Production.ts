import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bindAnonymousUser,
  closePlaceTour,
  completePendingSave,
  completePermanentAccountLink,
  createInitialOnboardingV2State,
  isOnboardingV2InProgressState,
  onboardingV2ResumeEligibility,
  resolveOnboardingV2VisibleOwner,
  resumePhase2AfterCompletedPhase1,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import { expectedOnboardingV2Route } from '../lib/onboardingV2RoutingCore';

const at = '2026-08-22T00:00:00.000Z';

function placeTourState(): OnboardingV2State {
  let state = createInitialOnboardingV2State(at);
  state = {
    ...state,
    cohort: 'new_user_v2',
    stage: 'tutorial_result_seen',
    preferredPlatform: 'instagram',
    interest: 'food',
    tutorialContentId: 'ig-mad-yolks-santa-cruz',
    funnelSessionId: '11111111-1111-4111-8111-111111111111',
    pendingShare: {
      attemptId: 'tutorial:mad-yolks',
      kind: 'tutorial',
      contentId: 'ig-mad-yolks-santa-cruz',
      sourceUrl: 'https://www.instagram.com/p/C-BEtdnyGdR/',
      normalizedSourceUrl: 'instagram.com/p/c-betdnygdr',
      contentIdentity: { platform: 'instagram', contentId: 'c-betdnygdr' },
      openedAt: at,
      shareReceivedAt: at,
      resultSeenAt: at,
    },
  };
  state = bindAnonymousUser(
    state,
    'anonymous-user',
    state.funnelSessionId!,
    at,
  ).state;
  state = completePendingSave(state, {
    sourceUrl: 'https://www.instagram.com/p/C-BEtdnyGdR/',
    savedPlaceId: 'mad-yolks-saved-id',
  }, at).state;
  return completePermanentAccountLink(state, {
    permanentUserId: 'permanent-user',
    destinationWasEstablished: false,
    tutorialSavedPlaceId: 'mad-yolks-saved-id',
  }, at).state;
}

const before = placeTourState();
assert.equal(before.stage, 'place_tour');
const released = closePlaceTour(before, 'mad-yolks-saved-id', at, { phase1Only: true }).state;
assert.equal(released.stage, 'phase1_complete');
assert.equal(released.phase1CompletedAt, at);
assert.equal(released.behavioralCompletedAt, null, 'Phase 1 completion does not fake Phase 2/3 completion');
assert.equal(expectedOnboardingV2Route(released.stage), '/(tabs)/map');
assert.equal(isOnboardingV2InProgressState(released), false);
assert.deepEqual(
  onboardingV2ResumeEligibility(released, {
    userId: 'permanent-user',
    identityExists: true,
    isAnonymous: false,
  }),
  { eligible: false, reason: 'already_completed' },
  'the Phase-1-only checkpoint remains terminal while that mode is active',
);
assert.equal(resolveOnboardingV2VisibleOwner({
  state: released,
  phase1Only: true,
  selectedSourceAvailable: false,
  poolExhausted: false,
}), 'none');
const resumed = resumePhase2AfterCompletedPhase1(released, at).state;
assert.equal(resumed.stage, 'practice_ready', 'an explicit full Phase 2 rollout resumes the durable handoff');
assert.equal(resumed.phase1CompletedAt, released.phase1CompletedAt);
assert.equal(onboardingV2ResumeEligibility(resumed, {
  userId: 'permanent-user',
  identityExists: true,
  isAnonymous: false,
}).eligible, true);

const futureFullRollout = closePlaceTour(before, 'mad-yolks-saved-id', at).state;
assert.equal(futureFullRollout.stage, 'practice_ready', 'future Phase 2 remains an explicit rollout choice');

const root = process.cwd();
const coach = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2MapCoachmark.tsx'), 'utf8');
const picker = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2PreAuth.tsx'), 'utf8');
const anonymousRuntime = readFileSync(join(root, 'lib/anonymousOnboarding.ts'), 'utf8');
const settings = readFileSync(join(root, 'app/(tabs)/settings.tsx'), 'utf8');
const appConfig = readFileSync(join(root, 'app.config.js'), 'utf8');
assert.match(coach, /const phase1Only = isOnboardingV2Phase1Only\(\)/);
assert.match(coach, /resolveOnboardingV2VisibleOwner\(\{[\s\S]{0,180}phase1Only/);
assert.match(picker, /disabled=\{option\.value !== 'instagram'\}/);
assert.match(
  anonymousRuntime,
  /decision === 'restart_with_new_anonymous_session'/,
  'a missing session after Phase 1 rotates to a fresh journey instead of restoring completed onboarding',
);
assert.match(settings, /\{onboardingResetAvailable \? \(/);
assert.equal(existsSync(join(root, 'lib/onboardingV2DevReset.ts')), true);
assert.equal(existsSync(join(root, 'lib/onboardingV2DevResetCore.ts')), true);
assert.match(appConfig, /IS_DEVELOPMENT_APP \? 'false' : 'true'/);
assert.match(appConfig, /IS_DEVELOPMENT_APP \? 'true' : ''/);

console.log('PASS Phase 1 closes to the normal map without Phase 2/3');
console.log('PASS Phase 1 completion is durable and future-safe');
console.log('PASS non-Instagram immersive shells and production reset are unreachable');
