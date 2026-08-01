/**
 * scripts/testSharedAuthSync.ts
 *
 * Unit tests for the PURE shared-token ordering reducer (lib/sharedAuthSync.ts).
 * Proves that a stale/duplicate/out-of-order tokenless auth signal can never
 * clear a valid App Group token once one has been established — the exact
 * startup race that left the iOS Share Extension seeing "Open Nearr to sign in"
 * while the host app was signed in.
 *
 * Run: npx ts-node -P scripts/tsconfig.json scripts/testSharedAuthSync.ts
 */

import {
  initialSharedAuthSyncState,
  reduceSharedTokenWrite,
  type SharedAuthSyncState,
  type SharedTokenInput,
} from '../lib/sharedAuthSync';

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/** Fold a sequence of signals and return the actions + final state. */
function run(seq: SharedTokenInput[]): { actions: string[]; state: SharedAuthSyncState } {
  let state = initialSharedAuthSyncState();
  const actions: string[] = [];
  for (const input of seq) {
    const { action, next } = reduceSharedTokenWrite(state, input);
    actions.push(action);
    state = next;
  }
  return { actions, state };
}

// ---- THE BUG: valid startup write, then a late null INITIAL_SESSION ---------
{
  const { actions, state } = run([
    { trigger: 'STARTUP_RESTORE', sessionHasToken: true },
    { trigger: 'INITIAL_SESSION', sessionHasToken: false }, // late/stale null
  ]);
  check('startup(valid) writes', actions[0] === 'write');
  check('late INITIAL_SESSION(null) is IGNORED (token preserved)', actions[1] === 'ignore');
  check('state stays established', state.establishedValidToken === true);
}

// ---- Reverse ordering: INITIAL_SESSION(valid) then a stray null -------------
{
  const { actions } = run([
    { trigger: 'INITIAL_SESSION', sessionHasToken: true },
    { trigger: 'TOKEN_REFRESHED', sessionHasToken: false }, // transient refresh gap
    { trigger: 'STARTUP_RESTORE', sessionHasToken: false }, // backfill resolves null late
  ]);
  check('INITIAL_SESSION(valid) writes', actions[0] === 'write');
  check('tokenless TOKEN_REFRESHED after valid is ignored', actions[1] === 'ignore');
  check('tokenless STARTUP_RESTORE after valid is ignored', actions[2] === 'ignore');
}

// ---- Explicit sign-out ALWAYS clears (even after established) ---------------
{
  const { actions, state } = run([
    { trigger: 'SIGNED_IN', sessionHasToken: true },
    { trigger: 'SIGNED_OUT', sessionHasToken: false },
  ]);
  check('SIGNED_IN writes', actions[0] === 'write');
  check('SIGNED_OUT clears', actions[1] === 'clear');
  check('state reset after sign-out', state.establishedValidToken === false);
}
{
  const { actions } = run([
    { trigger: 'SIGNED_IN', sessionHasToken: true },
    { trigger: 'USER_DELETED', sessionHasToken: false },
  ]);
  check('USER_DELETED clears', actions[1] === 'clear');
}

// ---- Genuine signed-out startup: tokenless INITIAL_SESSION clears -----------
{
  const { actions, state } = run([
    { trigger: 'INITIAL_SESSION', sessionHasToken: false },
  ]);
  check('genuine startup signed-out clears (absent)', actions[0] === 'clear');
  check('state not established', state.establishedValidToken === false);
}
{
  const { actions } = run([{ trigger: 'STARTUP_RESTORE', sessionHasToken: false }]);
  check('startup restore with no session clears', actions[0] === 'clear');
}

// ---- Sign in AFTER sign out works (re-establish) ---------------------------
{
  const { actions, state } = run([
    { trigger: 'SIGNED_IN', sessionHasToken: true },
    { trigger: 'SIGNED_OUT', sessionHasToken: false },
    { trigger: 'INITIAL_SESSION', sessionHasToken: false }, // must NOT resurrect
    { trigger: 'SIGNED_IN', sessionHasToken: true }, // real re-sign-in
  ]);
  check('after sign-out, tokenless INITIAL_SESSION clears (still signed out)', actions[2] === 'clear');
  check('re-sign-in writes', actions[3] === 'write');
  check('final state established', state.establishedValidToken === true);
}

// ---- Token refresh writes the fresh token ----------------------------------
{
  const { actions } = run([
    { trigger: 'SIGNED_IN', sessionHasToken: true },
    { trigger: 'TOKEN_REFRESHED', sessionHasToken: true },
  ]);
  check('TOKEN_REFRESHED(valid) writes', actions[1] === 'write');
}

// ---- Weird tokenless event before any session is a no-op -------------------
{
  const { actions, state } = run([
    { trigger: 'TOKEN_REFRESHED', sessionHasToken: false },
  ]);
  check('tokenless non-startup event before session is ignored', actions[0] === 'ignore');
  check('state untouched', state.establishedValidToken === false);
}

if (failures > 0) {
  console.error(`\n${failures} shared-auth-sync test(s) FAILED`);
  process.exit(1);
}
console.log('\nALL SHARED AUTH SYNC TESTS PASSED');
