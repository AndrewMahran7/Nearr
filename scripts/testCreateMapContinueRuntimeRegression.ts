import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  claimOnboardingAccountTransition,
  resetOnboardingAccountTransitionForTests,
} from '../lib/onboardingAccountTransition';
import {
  completePermanentAccountLink,
  createInitialOnboardingV2State,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import { expectedOnboardingV2Route } from '../lib/onboardingV2RoutingCore';

const root = process.cwd();
const at = (second: number) => new Date(Date.UTC(2026, 9, 15, 21, 11, second)).toISOString();

function founderAccountState(savedPlaceId: string | null): OnboardingV2State {
  return {
    ...createInitialOnboardingV2State(at(0), 'founder-installation'),
    revision: 33,
    cohort: 'new_user_v2',
    stage: 'account_required',
    startedAt: at(1),
    secondHalfStartedAt: at(2),
    accountRequiredAt: at(3),
    accountLinkStartedAt: at(4),
    identityLifecycle: 'permanent_account_linking',
    anonymousUserId: 'anonymous-founder',
    boundUserId: 'anonymous-founder',
    funnelSessionId: '11111111-1111-4111-8111-111111111111',
    tutorialSave: {
      kind: 'tutorial',
      contentId: 'scripted-fixture',
      sourceUrl: 'onboarding://scripted-fixture',
      normalizedSourceUrl: 'onboarding://scripted-fixture',
      contentIdentity: null,
      savedPlaceId: 'onboarding-local-only',
      completedAt: at(1),
    },
    independentSaves: savedPlaceId ? [{
      kind: 'independent_1',
      contentId: 'real-post',
      sourceUrl: 'https://www.instagram.com/reel/REALPOST/',
      normalizedSourceUrl: 'https://www.instagram.com/reel/REALPOST',
      contentIdentity: { platform: 'instagram', contentId: 'realpost' },
      savedPlaceId,
      completedAt: at(2),
    }] : [],
    realPracticeSession: {
      fixtureId: 'phase2-founder-practice',
      expectedSourceUrl: 'https://www.instagram.com/reel/REALPOST/',
      expectedNormalizedSourceUrl: 'https://www.instagram.com/reel/REALPOST',
      expectedContentIdentity: { platform: 'instagram', contentId: 'realpost' },
      expectedPlaceId: null,
      expectedPlaceName: 'Founder deferred place',
      clientRequestId: 'founder-client-request',
      shareJobId: 'founder-share-job',
      realJobStatus: 'processing',
      savedPlaceId,
      status: 'PROCESSING',
      failureReason: null,
      completionReason: 'background_processing',
      submissionObservedAt: at(2),
      startedAt: at(1),
      updatedAt: at(2),
    },
    updatedAt: at(4),
  };
}

async function assertMapOnce(state: OnboardingV2State, userId: string) {
  const completed = completePermanentAccountLink(state, {
    permanentUserId: userId,
    destinationWasEstablished: false,
    tutorialSavedPlaceId: null,
  }, at(5)).state;
  assert.equal(completed.stage, 'onboarding_complete');
  assert.equal(completed.identityLifecycle, 'permanent_account');
  assert.ok(completed.behavioralCompletedAt, 'durable behavioral completion is persisted');
  assert.ok(completed.onboardingV2CompletedAt, 'durable V2 completion is persisted');
  assert.equal(expectedOnboardingV2Route(completed.stage), '/(tabs)/map');

  resetOnboardingAccountTransitionForTests();
  let routeExecutions = 0;
  const first = claimOnboardingAccountTransition({
    userId,
    run: async () => {
      routeExecutions += 1;
      return expectedOnboardingV2Route(completed.stage)!;
    },
  });
  const replay = claimOnboardingAccountTransition({
    userId,
    recoverCompletedNavigation: true,
    run: async () => '/(onboarding)/account' as const,
  });
  assert.equal(first.navigationOwner, true);
  assert.equal(replay.navigationOwner, false);
  assert.equal(await first.promise, '/(tabs)/map');
  assert.equal(await replay.promise, '/(tabs)/map');
  assert.equal(routeExecutions, 1, 'Continue owns exactly one map route resolution');
  return completed;
}

async function main() {
  const zeroSave = await assertMapOnce(founderAccountState(null), 'new-google-founder');
  assert.equal(zeroSave.independentSaves.length, 0, 'zero real saves are valid');
  assert.equal(zeroSave.realPracticeSession?.shareJobId, 'founder-share-job');
  assert.equal(zeroSave.realPracticeSession?.completionReason, 'background_processing');

  const oneSave = await assertMapOnce(
    founderAccountState('22222222-2222-4222-8222-222222222222'),
    'one-save-founder',
  );
  assert.equal(oneSave.independentSaves.length, 1, 'one UUID-backed save survives completion');

  const established = completePermanentAccountLink(founderAccountState(null), {
    permanentUserId: 'established-founder',
    destinationWasEstablished: true,
    tutorialSavedPlaceId: null,
  }, at(6)).state;
  assert.equal(established.stage, 'onboarding_complete');
  assert.equal(established.permanentAccountEstablished, true);
  assert.equal(expectedOnboardingV2Route(established.stage), '/(tabs)/map');

  const account = readFileSync(join(root, 'app/(onboarding)/account.tsx'), 'utf8');
  assert.match(
    account,
    /if \(!mountedRef\.current\) \{\s*router\.replace\(\{ pathname: '\/\(onboarding\)\/account'/,
    'only an unmounted OAuth callback restores the recoverable account screen',
  );

  const routing = readFileSync(join(root, 'lib/postAuthRouting.ts'), 'utf8');
  assert.match(
    routing,
    /onboardingTransitionRoute = transition\.route;[\s\S]*if \(onboardingTransitionRoute\) return onboardingTransitionRoute/,
    'post-auth routing consumes the completed transition destination',
  );

  const transferClient = readFileSync(join(root, 'lib/anonymousOnboarding.ts'), 'utf8');
  assert.match(transferClient, /TRANSFER_RECOVERY_GRACE_MS = 29 \* 24 \* 60 \* 60_000/);
  assert.match(transferClient, /expiresAt \+ TRANSFER_RECOVERY_GRACE_MS <= Date\.now\(\)/);
  const recoveryMigration = readFileSync(
    join(root, 'supabase/migrations/20261015000001_onboarding_transfer_grace_recovery.sql'),
    'utf8',
  );
  assert.match(recoveryMigration, /status not in \('pending', 'expired'\)/);
  assert.match(recoveryMigration, /expires_at <= now\(\) - interval '29 days'/);
  assert.ok(
    recoveryMigration.indexOf('update public.share_jobs set user_id = v_destination') <
      recoveryMigration.indexOf('update public.share_media_tasks set user_id = v_destination'),
    'deferred job ownership moves before its guarded media task',
  );

  console.log('Create your map Continue runtime regression: zero-save deferred job, one save, established account, durable completion, map once, and no remount passed.');
}

void main();
