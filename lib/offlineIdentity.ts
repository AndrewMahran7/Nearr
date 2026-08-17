/**
 * Nearr — last locally authenticated identity (offline V1).
 *
 * THE PROBLEM
 * -----------
 * Supabase access tokens are short-lived. `supabase.auth.getSession()` returns
 * the stored session directly while the token is still valid, but once it has
 * expired it tries to refresh — and on failure returns `{ session: null }`.
 *
 * That is correct behaviour online. Offline it is a trap: a user who signed in
 * yesterday, opens Nearr today in airplane mode, and gets `session: null` is
 * routed straight to the sign-in screen. Their saved places are sitting in the
 * cache, correctly scoped to their user id, and Nearr refuses to show them
 * because it cannot ask a server it cannot reach whether they are still who
 * they were an hour ago.
 *
 * THE NARROW FIX
 * --------------
 * Remember the id of the last user who authenticated FOR REAL against the
 * server, and allow a READ-ONLY offline session for exactly that id when all
 * of the following hold:
 *
 *   1. `getSession()` returned no session, AND
 *   2. it failed with a NETWORK error rather than an auth rejection, AND
 *   3. we have a remembered user id, AND
 *   4. the user has not explicitly signed out.
 *
 * Condition 2 is what keeps this safe, and it leans on a documented auth-js
 * behaviour: on a retryable fetch error `_callRefreshToken` deliberately does
 * NOT remove the stored session, whereas a genuine auth rejection (revoked or
 * invalid refresh token) DOES remove it. So "no session + network error" means
 * the credentials are still on the device and simply could not be checked.
 * "No session + any other error" means the server said no, and we honour that.
 *
 * WHAT AN OFFLINE SESSION CAN DO
 * ------------------------------
 * Read the user-scoped local cache. Nothing else. It carries no usable access
 * token, so every Supabase call it could possibly make fails at the network or
 * at RLS — there is no privilege here to escalate. It exists only so the UI
 * knows which cache to open.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  decideOfflineIdentity,
  type OfflineIdentityDecision,
} from './offlineIdentityCore';
import { clearReminderSnapshot } from './reminderSnapshot';
import { clearSavedPlacesCache } from './savedPlacesCache';

const LAST_USER_KEY = 'nearr:auth:lastAuthenticatedUserId:v1';

/**
 * Record that this user authenticated for real. Called whenever a genuine
 * server-issued session is observed.
 */
export async function rememberAuthenticatedUser(
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    // Best-effort. Losing this only costs offline access until the next
    // successful online launch.
  }
}

/** The last user who authenticated against the server on this device. */
export async function readLastAuthenticatedUserId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_USER_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Forget the local identity. Called on EXPLICIT sign-out and on account
 * deletion — never on a failed refresh, which is exactly the case this
 * module exists to survive.
 */
export async function clearLastAuthenticatedUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Best-effort; the caller also clears the caches this id would unlock.
  }
}

/**
 * Tear down every piece of local state that could render a signed-out
 * account's private data. Call on EXPLICIT sign-out and account deletion.
 *
 * Order matters: the identity pointer goes last, so that a crash midway
 * leaves an identity with no data rather than data with no identity — the
 * former shows an empty offline state, the latter would show the previous
 * user's places. Every step is independently best-effort, because a single
 * storage failure must not abort the rest of the teardown.
 */
export async function clearOfflineUserData(
  userId: string | null | undefined,
): Promise<void> {
  const targetUserId = userId ?? (await readLastAuthenticatedUserId());
  await Promise.all([
    clearSavedPlacesCache(targetUserId).catch(() => undefined),
    clearReminderSnapshot(targetUserId).catch(() => undefined),
  ]);
  await clearLastAuthenticatedUser();
}

/**
 * Decide whether a failed session restore should become a read-only offline
 * session. Pure except for the storage read, so it is directly testable.
 */
export async function resolveOfflineIdentity(params: {
  hasSession: boolean;
  error: unknown;
}): Promise<OfflineIdentityDecision> {
  return decideOfflineIdentity({
    hasSession: params.hasSession,
    error: params.error,
    lastAuthenticatedUserId: await readLastAuthenticatedUserId(),
  });
}

export { isAuthNetworkFailure } from './offlineIdentityCore';
export type { OfflineIdentityDecision } from './offlineIdentityCore';
