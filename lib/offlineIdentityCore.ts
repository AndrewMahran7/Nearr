/**
 * Nearr — pure decision logic for read-only offline authentication.
 *
 * Split out of `lib/offlineIdentity.ts` so the rule that decides whether a
 * failed session restore may open a user's local cache can be tested exactly,
 * with no storage and no React Native runtime. This is a privacy boundary;
 * it deserves to be provable rather than inferred from behaviour.
 *
 * See `lib/offlineIdentity.ts` for the full rationale.
 */

/**
 * Does this error mean "we could not reach the auth server", as opposed to
 * "the auth server rejected these credentials"?
 *
 * The distinction is the entire safety argument. supabase auth-js deliberately
 * does NOT clear the stored session when a token refresh fails with a
 * retryable fetch error, but DOES clear it when the refresh token is genuinely
 * invalid or revoked. So a network failure means "still signed in, unverified"
 * while anything else means "signed out".
 */
export function isAuthNetworkFailure(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: unknown })?.name;
  if (typeof name === 'string' && name === 'AuthRetryableFetchError') return true;
  // A 5xx is an outage on their side, not a credential rejection.
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 500) return true;
  const message = (err as { message?: unknown })?.message;
  if (typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused')
  );
}

export type OfflineIdentityDecision =
  | { kind: 'offline_readonly'; userId: string }
  | { kind: 'signed_out' };

/**
 * Decide whether an absent session should become a read-only offline session.
 *
 * Grants offline access ONLY when all of these hold:
 *   - there is no real session, and
 *   - the failure was a network failure, and
 *   - this device remembers a user who previously authenticated for real.
 *
 * Every other combination is `signed_out`. In particular, a missing session
 * with NO error is a genuine signed-out state and must never open a cache.
 */
export function decideOfflineIdentity(params: {
  hasSession: boolean;
  error: unknown;
  lastAuthenticatedUserId: string | null;
}): OfflineIdentityDecision {
  if (params.hasSession) return { kind: 'signed_out' };
  if (!isAuthNetworkFailure(params.error)) return { kind: 'signed_out' };
  const userId = params.lastAuthenticatedUserId;
  if (!userId) return { kind: 'signed_out' };
  return { kind: 'offline_readonly', userId };
}
