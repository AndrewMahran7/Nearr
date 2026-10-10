import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  claimOnboardingAccountTransition,
  getOnboardingAccountTransitionSnapshot,
  resetOnboardingAccountTransitionForTests,
} from '../lib/onboardingAccountTransition';

const root = path.resolve(__dirname, '..');
let count = 0;
function pass(name: string) {
  count += 1;
  console.log(`PASS ${count}: ${name}`);
}

async function main() {
  resetOnboardingAccountTransitionForTests();
  let resolveSlow!: (value: string) => void;
  let calls = 0;
  const slow = new Promise<string>((resolve) => { resolveSlow = resolve; });
  const first = claimOnboardingAccountTransition({
    userId: 'google-user',
    run: async () => {
      calls += 1;
      return slow;
    },
  });
  const authListenerReplay = claimOnboardingAccountTransition({
    userId: 'google-user',
    run: async () => 'duplicate-auth-listener',
  });
  const remountReplay = claimOnboardingAccountTransition({
    userId: 'google-user',
    run: async () => 'duplicate-remount',
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(first.owner, true);
  assert.equal(authListenerReplay.owner, false);
  assert.equal(remountReplay.owner, false);
  assert.strictEqual(first.promise, authListenerReplay.promise);
  assert.strictEqual(first.promise, remountReplay.promise);
  pass('slow Google transfer coalesces auth-listener and remount replays');

  resolveSlow('/(tabs)/map');
  assert.deepEqual(await Promise.all([first.promise, authListenerReplay.promise, remountReplay.promise]), [
    '/(tabs)/map', '/(tabs)/map', '/(tabs)/map',
  ]);
  const foregroundReplay = claimOnboardingAccountTransition({
    userId: 'google-user',
    run: async () => 'duplicate-foreground',
  });
  assert.equal(foregroundReplay.owner, false);
  assert.equal(await foregroundReplay.promise, '/(tabs)/map');
  assert.equal(calls, 1);
  assert.equal(getOnboardingAccountTransitionSnapshot()?.phase, 'ACCOUNT_TRANSITION_COMPLETE');
  pass('completed transition ignores foreground and callback replay');

  resetOnboardingAccountTransitionForTests();
  let failures = 0;
  const failed = claimOnboardingAccountTransition({
    userId: 'retry-user',
    run: async () => {
      failures += 1;
      throw new Error('transfer_failed');
    },
  });
  await assert.rejects(failed.promise, /transfer_failed/);
  const passiveReplay = claimOnboardingAccountTransition({
    userId: 'retry-user',
    run: async () => 'must-not-run',
  });
  assert.equal(passiveReplay.owner, false);
  await assert.rejects(passiveReplay.promise, /transfer_failed/);
  assert.equal(failures, 1);
  pass('failed transition remains stable until a user requests retry');

  const retried = claimOnboardingAccountTransition({
    userId: 'retry-user',
    retry: true,
    run: async () => {
      failures += 1;
      return '/(tabs)/map';
    },
  });
  assert.equal(retried.owner, true);
  assert.equal(await retried.promise, '/(tabs)/map');
  assert.equal(failures, 2);
  assert.equal(getOnboardingAccountTransitionSnapshot()?.phase, 'ACCOUNT_TRANSITION_COMPLETE');
  pass('one explicit retry advances error to complete');

  resetOnboardingAccountTransitionForTests();
  for (const realSaveCount of [0, 1]) {
    let transfers = 0;
    const claim = claimOnboardingAccountTransition({
      userId: `save-count-${realSaveCount}`,
      run: async () => {
        transfers += 1;
        return { route: '/(tabs)/map', realSaveCount };
      },
    });
    const duplicate = claimOnboardingAccountTransition({
      userId: `save-count-${realSaveCount}`,
      run: async () => ({ route: '/duplicate', realSaveCount }),
    });
    assert.equal((await claim.promise).realSaveCount, realSaveCount);
    assert.equal((await duplicate.promise).route, '/(tabs)/map');
    assert.equal(transfers, 1);
  }
  pass('zero-save and one-real-save transitions each execute once');

  const account = fs.readFileSync(path.join(root, 'app/(onboarding)/account.tsx'), 'utf8');
  assert.match(account, /claimOnboardingAccountTransition/);
  assert.match(account, /if \(!claim\.owner\) \{/);
  assert.match(account, /handleContinueSignedIn[\s\S]*retry: true/);
  assert.doesNotMatch(account, /console\.warn\('\[onboarding-v2\] account_transition_failed'/);
  pass('account screen grants navigation and error ownership only to the transition claimant');

  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20261009000001_onboarding_transfer_owner_order.sql'),
    'utf8',
  );
  const jobs = migration.indexOf('update public.share_jobs set user_id = v_destination');
  const tasks = migration.indexOf('update public.share_media_tasks set user_id = v_destination');
  assert.ok(jobs > -1 && tasks > jobs);
  assert.match(migration, /owner guard reads/);
  pass('transfer moves the parent job before its owner-guarded media task');

  assert.equal(count, 7);
  console.log('Onboarding account-transition regression: 7/7 passed.');
}

void main();
