import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  claimOnboardingAccountTransition,
  resetOnboardingAccountTransitionForTests,
} from '../lib/onboardingAccountTransition';
import {
  backOnboardingV2FromAccount,
  createInitialOnboardingV2State,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  expectedOnboardingV2Route,
  shouldNavigateOnboarding,
} from '../lib/onboardingV2RoutingCore';

const root = path.resolve(__dirname, '..');
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 13, 20, 0, seconds)).toISOString();
let count = 0;

function pass(name: string) {
  count += 1;
  console.log(`PASS ${count}: ${name}`);
}

function accountRequiredState(overrides: Partial<OnboardingV2State> = {}): OnboardingV2State {
  return {
    ...createInitialOnboardingV2State(at(0), 'installation-create-map-regression'),
    revision: 30,
    cohort: 'new_user_v2',
    stage: 'account_required',
    startedAt: at(1),
    secondHalfStartedAt: at(2),
    makingNearrYoursViewedAt: at(3),
    notificationEducationShownAt: at(2),
    identityLifecycle: 'permanent_account_linking',
    anonymousUserId: 'anonymous-user',
    boundUserId: 'anonymous-user',
    accountRequiredAt: at(4),
    accountLinkStartedAt: at(5),
    tutorialSave: {
      kind: 'tutorial',
      contentId: 'scripted-fixture',
      sourceUrl: 'onboarding://scripted-fixture',
      normalizedSourceUrl: 'onboarding://scripted-fixture',
      contentIdentity: null,
      savedPlaceId: 'onboarding-local-only',
      completedAt: at(1),
    },
    updatedAt: at(5),
    ...overrides,
  };
}

async function main() {
  resetOnboardingAccountTransitionForTests();
  let resolveSlow!: (route: '/(tabs)/map') => void;
  const slow = new Promise<'/(tabs)/map'>((resolve) => { resolveSlow = resolve; });
  let executions = 0;
  const first = claimOnboardingAccountTransition({
    userId: 'new-google-user',
    run: async () => {
      executions += 1;
      return slow;
    },
  });
  assert.equal(first.owner, true);
  assert.equal(first.navigationOwner, true);
  assert.equal(executions, 0);
  await Promise.resolve();
  assert.equal(executions, 1);
  pass('Continue once owns one transition and one navigation');

  const doubleTap = claimOnboardingAccountTransition({
    userId: 'new-google-user',
    recoverCompletedNavigation: true,
    run: async () => '/duplicate' as const,
  });
  assert.equal(doubleTap.replay, 'in_flight');
  assert.equal(doubleTap.owner, false);
  assert.equal(doubleTap.navigationOwner, false);
  assert.strictEqual(doubleTap.promise, first.promise);
  pass('Continue double tap coalesces without a second navigation owner');

  const authListener = claimOnboardingAccountTransition({
    userId: 'new-google-user',
    run: async () => '/listener' as const,
  });
  assert.equal(authListener.replay, 'in_flight');
  assert.equal(authListener.navigationOwner, false);
  pass('auth-listener replay cannot navigate');

  const remount = claimOnboardingAccountTransition({
    userId: 'new-google-user',
    recoverCompletedNavigation: true,
    run: async () => '/remount' as const,
  });
  assert.equal(remount.replay, 'in_flight');
  assert.equal(remount.navigationOwner, false);
  pass('remount during a slow transition observes without navigating');

  resolveSlow('/(tabs)/map');
  assert.equal(await first.promise, '/(tabs)/map');
  assert.equal(executions, 1);
  const explicitRecovery = claimOnboardingAccountTransition({
    userId: 'new-google-user',
    recoverCompletedNavigation: true,
    run: async () => '/must-not-run' as const,
  });
  assert.equal(explicitRecovery.replay, 'complete');
  assert.equal(explicitRecovery.owner, false);
  assert.equal(explicitRecovery.navigationOwner, true);
  assert.equal(await explicitRecovery.promise, '/(tabs)/map');
  assert.equal(executions, 1);
  pass('signed-in Continue can recover the cached completed route without repeating transfer');

  const duplicateRecovery = claimOnboardingAccountTransition({
    userId: 'new-google-user',
    recoverCompletedNavigation: true,
    run: async () => '/must-not-run' as const,
  });
  assert.equal(duplicateRecovery.navigationOwner, false);
  const foregroundReplay = claimOnboardingAccountTransition({
    userId: 'new-google-user',
    run: async () => '/foreground' as const,
  });
  assert.equal(foregroundReplay.navigationOwner, false);
  assert.equal(executions, 1);
  pass('repeated Continue and foreground replay cannot duplicate recovered navigation');

  const backed = backOnboardingV2FromAccount(accountRequiredState(), at(6));
  assert.equal(backed.changed, true);
  assert.equal(backed.state.stage, 'notification_education');
  assert.equal(backed.state.identityLifecycle, 'anonymous_active');
  assert.equal(backed.state.accountLinkStartedAt, null);
  assert.equal(expectedOnboardingV2Route(backed.state.stage), '/(onboarding)');
  pass('Back commits the stable previous onboarding stage before routing');

  assert.equal(shouldNavigateOnboarding({
    currentRoute: '/(onboarding)',
    expectedRoute: expectedOnboardingV2Route(backed.state.stage),
  }), false);
  const backedAgain = backOnboardingV2FromAccount(backed.state, at(7));
  assert.equal(backedAgain.changed, false);
  assert.equal(backedAgain.state.stage, 'notification_education');
  pass('Back plus AuthGate and remount stay on the previous route without bouncing forward');

  const established = accountRequiredState({
    stage: 'graduated',
    identityLifecycle: 'permanent_account',
    permanentUserId: 'established-user',
    permanentAccountEstablished: true,
    authCompletedAt: at(6),
  });
  assert.equal(expectedOnboardingV2Route(established.stage), '/(tabs)/map');
  assert.equal(expectedOnboardingV2Route(accountRequiredState().stage), '/(onboarding)/account');
  pass('established accounts stay on map while fresh pre-auth users still reach Create your map');

  const accountSource = fs.readFileSync(path.join(root, 'app/(onboarding)/account.tsx'), 'utf8');
  const rootLayoutSource = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
  assert.match(accountSource, /onBack=\{signedIn \? undefined/);
  assert.match(accountSource, /await goBackOnboardingV2FromAccount\(\);[\s\S]*return;/);
  assert.match(accountSource, /recoverCompletedNavigation: true/);
  assert.match(accountSource, /if \(signedInContinueRef\.current\) return;/);
  assert.match(
    accountSource,
    /await goBackOnboardingV2FromAccount\(\);\s*return;/,
  );
  assert.match(
    rootLayoutSource,
    /if \(\(inAuth \|\| inOnboarding\) && isPostAuthRoutingPending\(\)\) \{[\s\S]*hold:post_auth_resolver/,
  );
  pass('account screen hides invalid signed-in Back and AuthGate yields to the post-auth navigation owner');

  assert.equal(count, 10);
  console.log('Create your map navigation regression: 10/10 passed.');
}

void main();
