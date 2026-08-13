import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { handleAuthDeepLink } from '@/lib/authDeepLink';
import { buildAppleNameMetadata } from '@/lib/appleName';
import { classifySignUpResult, type SignUpOutcomeKind } from '@/lib/authScreenState';

/**
 * The single Nearr auth callback URL.
 *
 * `Linking.createURL` builds the right scheme for prod (`nearr://`) and Expo
 * Go dev (`exp://...`). Magic link, Google OAuth and password recovery all use
 * THIS url, so the Supabase redirect allow-list needs no new entry.
 */
export function getAuthCallbackUrl(): string {
  return Linking.createURL('auth-callback');
}

// ---------------------------------------------------------------------------
// Email: magic link (default path — unchanged behaviour)
// ---------------------------------------------------------------------------

export async function sendMagicLink(email: string) {
  const redirectTo = getAuthCallbackUrl();
  const redirectScheme = redirectTo.split(':')[0] || 'unknown';
  console.log(
    `[auth] magic_link_redirect_configured scheme=${redirectScheme} path=auth-callback`,
  );
  return supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirectTo },
  });
}

// ---------------------------------------------------------------------------
// Email + password
// ---------------------------------------------------------------------------

/**
 * Password sign-in.
 *
 * Used by BOTH the production password mode on the account screen and the
 * ``__DEV__``-gated developer login panel. Returns Supabase's native
 * ``{ data, error }`` shape unchanged; callers must translate `error` through
 * `toUserFacingAuthError` before showing anything to a real user.
 */
export async function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

export type PasswordSignUpResult =
  | { outcome: Extract<SignUpOutcomeKind, 'session'>; user: User }
  | { outcome: Extract<SignUpOutcomeKind, 'confirmation_required'>; user: User }
  | { outcome: Extract<SignUpOutcomeKind, 'unusable'> }
  | { outcome: 'error'; error: unknown };

/**
 * Create an email + password account.
 *
 * Supabase returns a live session only when email confirmation is DISABLED.
 * With confirmation enabled it returns a user and no session — the caller must
 * park on a "check your email" state rather than navigating into the app.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<PasswordSignUpResult> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: getAuthCallbackUrl() },
  });

  if (error) return { outcome: 'error', error };

  const user = data.session?.user ?? data.user ?? null;
  const kind = classifySignUpResult({
    hasSession: !!data.session,
    hasUser: !!user,
  });

  if (kind === 'unusable' || !user) return { outcome: 'unusable' };
  return kind === 'session'
    ? { outcome: 'session', user }
    : { outcome: 'confirmation_required', user };
}

/**
 * Request a password-reset email. Supabase does not report whether the address
 * exists, and callers must show the same confirmation either way.
 */
export async function requestPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: getAuthCallbackUrl(),
  });
}

/**
 * Set a new password for the user that arrived through a recovery link. The
 * recovery deep link has already established a session by this point.
 */
export async function updateRecoveredPassword(password: string) {
  return supabase.auth.updateUser({ password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// ---------------------------------------------------------------------------
// Google — Supabase OAuth through the system auth session
// ---------------------------------------------------------------------------

export type SocialSignInOutcome =
  | { status: 'signed_in'; user: User }
  | { status: 'cancelled' }
  | { status: 'failed'; code: string };

/**
 * Continue with Google.
 *
 *   1. Ask Supabase for the provider URL (`skipBrowserRedirect` — React Native
 *      has no `window.location` for supabase-js to redirect).
 *   2. Open it in the system auth session, which dismisses itself the moment
 *      the provider redirects back to the Nearr callback.
 *   3. Feed that redirect URL into the SAME `handleAuthDeepLink` exchange used
 *      by magic link, so exactly one code path turns a callback URL into a
 *      Supabase session.
 *
 * Never logs the provider URL, the callback URL, tokens or the auth code.
 */
export async function startGoogleSignIn(): Promise<SocialSignInOutcome> {
  const redirectTo = getAuthCallbackUrl();

  let providerUrl: string | null = null;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) {
      console.warn('[auth] google oauth_start_failed');
      return { status: 'failed', code: 'oauth_start_failed' };
    }
    providerUrl = data?.url ?? null;
  } catch {
    console.warn('[auth] google oauth_start_threw');
    return { status: 'failed', code: 'oauth_start_failed' };
  }

  if (!providerUrl) {
    console.warn('[auth] google missing_oauth_url');
    return { status: 'failed', code: 'missing_oauth_url' };
  }

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(providerUrl, redirectTo);
  } catch {
    console.warn('[auth] google auth_session_failed');
    return { status: 'failed', code: 'auth_session_failed' };
  }

  // `cancel` = the user tapped Cancel/back, `dismiss` = the sheet was swiped
  // away. Both are ordinary user actions, not failures.
  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { status: 'cancelled' };
  }
  if (result.type !== 'success' || !result.url) {
    console.warn(`[auth] google callback_missing type=${result.type}`);
    return { status: 'failed', code: 'callback_missing' };
  }

  const linkResult = await handleAuthDeepLink(result.url, { source: 'oauth_result' });
  const user = await resolveSessionUser(linkResult.sessionEstablished);
  if (user) return { status: 'signed_in', user };

  console.warn(`[auth] google exchange_failed reason=${linkResult.reason}`);
  return { status: 'failed', code: linkResult.reason };
}

/**
 * Read back the authenticated user after an exchange.
 *
 * The OS may ALSO deliver the OAuth redirect as a normal deep-link event, in
 * which case the root layout's handler can win the race and our own exchange
 * reports `duplicate`. Re-reading the session is what makes either ordering
 * resolve to the same successful outcome.
 */
async function resolveSessionUser(exchangeSucceeded: boolean): Promise<User | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user;
  if (!exchangeSucceeded) return null;
  // The exchange reported success but the session read raced it — retry once.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const retry = await supabase.auth.getSession();
  return retry.data.session?.user ?? null;
}

// ---------------------------------------------------------------------------
// Apple — native Sign in with Apple (iOS only)
// ---------------------------------------------------------------------------

/** iOS 13+ with Sign in with Apple available. Always false on Android. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Nonce handling, per the installed versions:
 *
 *   - `expo-apple-authentication` assigns `options.nonce` to
 *     `ASAuthorizationAppleIDRequest.nonce` VERBATIM, and Apple echoes that
 *     exact string into the ID token's `nonce` claim.
 *   - `supabase-js` documents `signInWithIdToken({ nonce })` as: "the hash of
 *     this value is compared to the value in the ID token".
 *
 * So Apple receives the SHA-256 hex digest and Supabase receives the raw
 * value. Nonce checking is never skipped.
 */
async function createAppleNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const raw = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const hashed = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    raw,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
  return { raw, hashed };
}

/**
 * Continue with Apple using the native credential, exchanged with Supabase via
 * `signInWithIdToken`. Cancellation is reported as `cancelled` so the UI can
 * stay quiet instead of showing an error.
 */
export async function signInWithApple(): Promise<SocialSignInOutcome> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  let nonce: { raw: string; hashed: string };
  try {
    nonce = await createAppleNonce();
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: nonce.hashed,
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'ERR_REQUEST_CANCELED') return { status: 'cancelled' };
    console.warn(`[auth] apple native_failed code=${code ?? 'unknown'}`);
    return { status: 'failed', code: 'apple_native_failed' };
  }

  if (!credential.identityToken) {
    console.warn('[auth] apple missing_identity_token');
    return { status: 'failed', code: 'missing_identity_token' };
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: nonce.raw,
  });

  if (error || !data.user) {
    console.warn('[auth] apple id_token_rejected');
    return { status: 'failed', code: 'id_token_rejected' };
  }

  await persistAppleFullName(credential.fullName, data.user);
  return { status: 'signed_in', user: data.user };
}

/**
 * Apple supplies the user's name only on the FIRST authorization. Persist it
 * right after a successful exchange, skipping any null/empty value so a later
 * nameless sign-in can never wipe the stored name.
 *
 * Failure here is logged and swallowed: the user IS authenticated, and a
 * metadata write must not invalidate that.
 */
async function persistAppleFullName(
  fullName: AppleAuthentication.AppleAuthenticationFullName | null,
  user: User,
): Promise<void> {
  const metadata = buildAppleNameMetadata(fullName, user.user_metadata ?? null);
  if (!metadata) return;
  try {
    const { error } = await supabase.auth.updateUser({ data: metadata });
    if (error) console.warn('[auth] apple name_persist_failed');
  } catch {
    console.warn('[auth] apple name_persist_threw');
  }
}
