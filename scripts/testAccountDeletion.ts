/**
 * Unit tests for the account-deletion pure logic.
 *
 * Covers the parts of the flow that are deterministic and RN-free:
 *   - exact confirmation copy (Apple 5.1.1(v) compliance)
 *   - Bearer-token extraction + forged-user-id rejection (Edge Function)
 *   - error classification (keeps the user signed in on any failure)
 *   - single-flight guard (rapid taps / racing calls invoke once)
 *
 * The native Alert confirmation UI, navigation reset, and AsyncStorage
 * teardown are validated by the manual physical-device steps in the report.
 *
 * Run: npm run test:account
 */

import assert from 'node:assert/strict';

import {
  DELETE_ACCOUNT_FAILURE_MESSAGE,
  DELETE_ACCOUNT_FINAL_CONFIRM,
  DELETE_ACCOUNT_FIRST_CONFIRM,
  beginAccountDeletionCleanupBoundary,
  classifyDeletionError,
  createSingleFlightGuard,
  finishAccountDeletionCleanupBoundary,
  isAccountDeletionCleanupPending,
  waitForAccountDeletionCleanup,
} from '../lib/accountDeletionCore';
import {
  extractBearerToken,
  resolveDeleteAuthority,
} from '../supabase/functions/delete-account/authToken';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function run() {
  console.log('[test] account deletion');

  // --- Confirmation copy (verbatim) ------------------------------------
  check('first confirmation copy is exact', () => {
    assert.equal(DELETE_ACCOUNT_FIRST_CONFIRM.title, 'Delete your account?');
    assert.equal(
      DELETE_ACCOUNT_FIRST_CONFIRM.body,
      'This permanently deletes your Nearr account, saved places, notes, reminder history, and other account data. This cannot be undone.',
    );
    assert.equal(DELETE_ACCOUNT_FIRST_CONFIRM.cancelLabel, 'Cancel');
    assert.equal(DELETE_ACCOUNT_FIRST_CONFIRM.continueLabel, 'Continue');
  });

  check('final confirmation copy is exact', () => {
    assert.equal(DELETE_ACCOUNT_FINAL_CONFIRM.title, 'Permanently delete account?');
    assert.equal(DELETE_ACCOUNT_FINAL_CONFIRM.body, 'This action cannot be undone.');
    assert.equal(DELETE_ACCOUNT_FINAL_CONFIRM.cancelLabel, 'Cancel');
    assert.equal(DELETE_ACCOUNT_FINAL_CONFIRM.confirmLabel, 'Delete my account');
  });

  check('retryable failure message is exact', () => {
    assert.equal(
      DELETE_ACCOUNT_FAILURE_MESSAGE,
      "We couldn't delete your account. Please try again.",
    );
  });

  // --- Bearer token extraction -----------------------------------------
  check('extracts a bearer token', () => {
    assert.equal(extractBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
    assert.equal(extractBearerToken('bearer   spaced.token  '), 'spaced.token');
  });

  check('rejects missing / non-bearer auth', () => {
    assert.equal(extractBearerToken(null), '');
    assert.equal(extractBearerToken(undefined), '');
    assert.equal(extractBearerToken(''), '');
    assert.equal(extractBearerToken('Basic abc'), '');
    assert.equal(extractBearerToken('abc.def.ghi'), '');
  });

  // --- Forged-user-id rejection ----------------------------------------
  check('deletion authority is always the token user', () => {
    const authed = 'real-user-id';
    const noBody = resolveDeleteAuthority({ authenticatedUserId: authed });
    assert.equal(noBody.userId, authed);
    assert.equal(noBody.ignoredBodyUserId, false);

    const forged = resolveDeleteAuthority({
      authenticatedUserId: authed,
      requestBodyUserId: 'someone-elses-id',
    });
    assert.equal(forged.userId, authed, 'must never delete the body-supplied id');
    assert.equal(forged.ignoredBodyUserId, true);

    const matching = resolveDeleteAuthority({
      authenticatedUserId: authed,
      requestBodyUserId: authed,
    });
    assert.equal(matching.userId, authed);
    assert.equal(matching.ignoredBodyUserId, false);
  });

  // --- Error classification --------------------------------------------
  check('classifies errors into stable reasons', () => {
    assert.equal(classifyDeletionError(new Error('x'), 401), 'unauthorized');
    assert.equal(classifyDeletionError(new Error('x'), 403), 'unauthorized');
    assert.equal(classifyDeletionError(new Error('x'), 500), 'server');
    assert.equal(classifyDeletionError(new Error('x'), 503), 'server');
    assert.equal(
      classifyDeletionError(new Error('Network request failed')),
      'network',
    );
    assert.equal(classifyDeletionError('unauthorized'), 'unauthorized');
    assert.equal(classifyDeletionError(new Error('weird')), 'server');
  });

  // --- Single-flight guard ---------------------------------------------
  await (async () => {
    let calls = 0;
    let resolveInner: (v: string) => void = () => {};
    const guard = createSingleFlightGuard<string>();
    const fn = () =>
      new Promise<string>((resolve) => {
        calls += 1;
        resolveInner = resolve;
      });

    const a = guard.run(fn);
    const b = guard.run(fn);
    const c = guard.run(fn);
    assert.equal(guard.isRunning(), true, 'guard reports in-flight');
    resolveInner('done');
    const [ra, rb, rc] = await Promise.all([a, b, c]);

    check('rapid repeated calls invoke the operation once', () => {
      assert.equal(calls, 1, 'underlying operation called exactly once');
      assert.equal(ra, 'done');
      assert.equal(rb, 'done');
      assert.equal(rc, 'done');
    });

    check('guard resets after settle so a retry can run again', () => {
      assert.equal(guard.isRunning(), false);
    });

    let secondCalls = 0;
    await guard.run(async () => {
      secondCalls += 1;
      return 'again';
    });
    check('a later call runs a fresh operation', () => {
      assert.equal(secondCalls, 1);
    });
  })();

  // --- Post-delete bootstrap sequencing --------------------------------
  await (async () => {
    beginAccountDeletionCleanupBoundary();
    assert.equal(isAccountDeletionCleanupPending(), true);
    let bootstrapReleased = false;
    const waitingBootstrap = waitForAccountDeletionCleanup().then(() => {
      bootstrapReleased = true;
    });
    await Promise.resolve();
    assert.equal(bootstrapReleased, false, 'bootstrap remains blocked during cleanup');
    finishAccountDeletionCleanupBoundary();
    await waitingBootstrap;
    check('fresh anonymous bootstrap waits for deletion cleanup', () => {
      assert.equal(bootstrapReleased, true);
      assert.equal(isAccountDeletionCleanupPending(), false);
    });
  })();

  console.log(`\n[test] account deletion: ${passed} checks passed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
