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
  'a future release cannot unexpectedly force Phase-1 users back into onboarding',
);

const futureFullRollout = closePlaceTour(before, 'mad-yolks-saved-id', at).state;
assert.equal(futureFullRollout.stage, 'practice_ready', 'future Phase 2 remains an explicit rollout choice');

const root = process.cwd();
const coach = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2MapCoachmark.tsx'), 'utf8');
const picker = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2PreAuth.tsx'), 'utf8');
const anonymousRuntime = readFileSync(join(root, 'lib/anonymousOnboarding.ts'), 'utf8');
const settings = readFileSync(join(root, 'app/(tabs)/settings.tsx'), 'utf8');
assert.match(coach, /if \(isOnboardingV2Phase1Only\(\)\) return null;/);
assert.match(picker, /disabled=\{option\.value !== 'instagram'\}/);
assert.match(
  anonymousRuntime,
  /prior\.cohort === 'existing_user_bypassed' \|\|\s+!!prior\.phase1CompletedAt \|\|\s+!!prior\.behavioralCompletedAt/,
  'a missing session after Phase 1 rotates to a fresh journey instead of restoring completed onboarding',
);
assert.doesNotMatch(settings, /Reset onboarding|Development QA/);
assert.equal(existsSync(join(root, 'lib/onboardingV2DevReset.ts')), false);
assert.equal(existsSync(join(root, 'lib/onboardingV2DevResetCore.ts')), false);

console.log('PASS Phase 1 closes to the normal map without Phase 2/3');
console.log('PASS Phase 1 completion is durable and future-safe');
console.log('PASS non-Instagram immersive shells and production reset are unreachable');
