/**
 * lib/sharedAuthSync.ts
 *
 * PURE, dependency-free reducer that decides how a Supabase auth signal (or the
 * cold-start getSession() backfill) should update the App Group shared access
 * token that the iOS Share Extension reads.
 *
 * ROOT CAUSE THIS FIXES
 * ---------------------
 * lib/supabase.ts previously called `sharedAuth.setToken(token)` from BOTH
 * `onAuthStateChange` AND the cold-start `getSession()` backfill with no
 * ordering guard. supabase-js can deliver an `INITIAL_SESSION` (or a transient
 * refresh-gap) with a NULL session AFTER a valid token was already written on
 * startup — that late `setToken(null)` clears a perfectly good token. The
 * extension then reads `initialized = true` (the App Group works) but
 * `token = absent`, so `selectExtensionAuthAction` returns `signed_out` and the
 * user sees "Open Nearr to sign in" even though the host app is signed in.
 *
 * The guarantee: once a valid token has been established in this app process,
 * ONLY an explicit sign-out (`SIGNED_OUT` / `USER_DELETED`) may clear it. A
 * stale/duplicate/out-of-order tokenless signal is ignored.
 *
 * NEVER handles the token value — callers pass only whether the session carries
 * a usable access token.
 */

/** Supabase auth event names we care about (a superset is tolerated). */
export type SupabaseAuthEventName =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'PASSWORD_RECOVERY'
  | 'MFA_CHALLENGE_VERIFIED';

/** Synthetic trigger for the one-shot cold-start getSession() backfill. */
export type SharedAuthTrigger = SupabaseAuthEventName | 'STARTUP_RESTORE' | (string & {});

export type SharedTokenAction = 'write' | 'clear' | 'ignore';

export type SharedAuthSyncState = {
  /** True once a valid (non-empty) token has been written this app process. */
  establishedValidToken: boolean;
};

export function initialSharedAuthSyncState(): SharedAuthSyncState {
  return { establishedValidToken: false };
}

/** Events that authoritatively mean "signed out" — always clear the token. */
const SIGN_OUT_TRIGGERS: ReadonlySet<string> = new Set(['SIGNED_OUT', 'USER_DELETED']);

/**
 * Triggers that represent an authoritative startup / initial read. A tokenless
 * one of these BEFORE any valid token was established means "genuinely signed
 * out at launch" → ensure the shared token is absent.
 */
const STARTUP_TRIGGERS: ReadonlySet<string> = new Set(['STARTUP_RESTORE', 'INITIAL_SESSION']);

export type SharedTokenInput = {
  trigger: SharedAuthTrigger;
  /** Whether the session for this signal carries a usable (non-empty) token. */
  sessionHasToken: boolean;
};

export type SharedTokenDecision = {
  action: SharedTokenAction;
  next: SharedAuthSyncState;
};

/**
 * Decide the shared-token write for one auth signal, ordering-safe.
 */
export function reduceSharedTokenWrite(
  state: SharedAuthSyncState,
  input: SharedTokenInput,
): SharedTokenDecision {
  // Explicit sign-out always clears and resets — regardless of ordering.
  if (SIGN_OUT_TRIGGERS.has(input.trigger)) {
    return { action: 'clear', next: { establishedValidToken: false } };
  }

  // Any signal carrying a usable token writes it (authoritative "signed in").
  if (input.sessionHasToken) {
    return { action: 'write', next: { establishedValidToken: true } };
  }

  // Tokenless, not a sign-out. Ordering guard: once a valid token exists this
  // process, a late/duplicate/out-of-order null signal must NOT clear it —
  // only an explicit SIGNED_OUT can. This is the core fix.
  if (state.establishedValidToken) {
    return { action: 'ignore', next: state };
  }

  // No token yet established. An authoritative startup/initial signal means the
  // user is genuinely signed out at launch → ensure the shared token is absent.
  if (STARTUP_TRIGGERS.has(input.trigger)) {
    return { action: 'clear', next: state };
  }

  // Any other tokenless signal before a session exists: leave state untouched.
  return { action: 'ignore', next: state };
}
