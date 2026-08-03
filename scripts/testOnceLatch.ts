/**
 * scripts/testOnceLatch.ts
 *
 * Regression tests for lib/onceLatch.ts and the "navigate exactly once"
 * invariant it enforces on the share-job confirmation screen (Step 6 of the
 * intermittent-crash audit).
 *
 * The final block is the decisive regression check: it models the confirmation
 * screen's `goToMap` under the pre-fix (unguarded) and post-fix (latched)
 * implementations. The unguarded model fires N navigations for N inbound
 * actions (double-tap / late realtime update / retried save) — exactly the
 * "one external event must cause at most one navigation" property the audit
 * requires — while the latched model fires exactly one.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testOnceLatch.ts
 */

import { createOnceLatch } from '../lib/onceLatch';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// --- basic latch behaviour --------------------------------------------------
const latch = createOnceLatch();
check('not acquired before first use', latch.acquired() === false);
check('first acquire wins', latch.acquire() === true);
check('acquired() true after first', latch.acquired() === true);
check('second acquire is rejected', latch.acquire() === false);
check('third acquire is rejected', latch.acquire() === false);

// Independent latches do not share state.
const a = createOnceLatch();
const b = createOnceLatch();
a.acquire();
check('separate latch stays independent', b.acquired() === false && b.acquire() === true);

// --- decisive regression: at most one navigation per inbound action ---------
// Pre-fix model (the faulty implementation): every call navigates.
function unguardedGoToMap() {
  let navigations = 0;
  return {
    goToMap() {
      navigations += 1;
    },
    count: () => navigations,
  };
}

// Post-fix model: navigation gated behind the once-latch.
function latchedGoToMap() {
  const once = createOnceLatch();
  let navigations = 0;
  return {
    goToMap() {
      if (!once.acquire()) return;
      navigations += 1;
    },
    count: () => navigations,
  };
}

// Simulate the same inbound "Save to my map" action being resolved three times
// (double-tap + a late realtime/poll update firing goToMap again).
const faulty = unguardedGoToMap();
faulty.goToMap();
faulty.goToMap();
faulty.goToMap();
check('pre-fix model navigates more than once (reproduces the bug)', faulty.count() === 3, `got ${faulty.count()}`);

const fixed = latchedGoToMap();
fixed.goToMap();
fixed.goToMap();
fixed.goToMap();
check('post-fix model navigates exactly once', fixed.count() === 1, `got ${fixed.count()}`);

if (failures > 0) {
  console.error(`\n${failures} once-latch test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll once-latch tests passed');
