/**
 * User-facing translation of Supabase auth failures.
 *
 * Two hard rules:
 *   1. NEVER return a raw Supabase error object / JSON / status code to the UI.
 *   2. NEVER reveal whether a particular email address has an account.
 *
 * Pure module (no React Native / Supabase imports) so it is unit-testable
 * from a plain ts-node script.
 */

export type AuthOperationKind =
  | 'magic_link'
  | 'password_sign_in'
  | 'password_sign_up'
  | 'password_reset'
  | 'password_update'
  | 'google'
  | 'apple';

/** Minimal structural shape shared by Supabase `AuthError` and plain errors. */
export type AuthErrorLike = {
  code?: string | null;
  status?: number | null;
  message?: string | null;
  name?: string | null;
} | null | undefined;

const GENERIC_MESSAGE = "Couldn't sign you in. Please try again.";

/** Apple's "user closed the sheet" code, plus the generic cancel shapes. */
const CANCELLATION_CODES = new Set([
  'ERR_REQUEST_CANCELED',
  'ERR_CANCELED',
  'ERR_REQUEST_CANCELLED',
  '1001',
]);

function readCode(error: AuthErrorLike): string {
  if (!error) return '';
  return (error.code ?? '').toString().toLowerCase();
}

function readMessage(error: AuthErrorLike): string {
  if (!error) return '';
  return (error.message ?? '').toString().toLowerCase();
}

/**
 * True when the failure is just the user backing out of a provider sheet or
 * browser tab. These must be treated as a normal action — no red error UI.
 */
export function isAuthCancellation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const rawCode = candidate.code == null ? '' : String(candidate.code);
  if (CANCELLATION_CODES.has(rawCode)) return true;
  const message = candidate.message == null ? '' : String(candidate.message).toLowerCase();
  return (
    message.includes('canceled') ||
    message.includes('cancelled') ||
    message.includes('the user canceled the sign-in')
  );
}

/** True when the network/device (not the credentials) is the problem. */
function isNetworkFailure(error: AuthErrorLike): boolean {
  const code = readCode(error);
  const message = readMessage(error);
  return (
    code === 'network_error' ||
    error?.name === 'AuthRetryableFetchError' ||
    message.includes('network request failed') ||
    message.includes('failed to fetch')
  );
}

/**
 * Supabase surfaces password-policy violations with a safe, human-readable
 * message (e.g. "Password should be at least 8 characters"). Those are worth
 * showing verbatim; everything else is replaced with our own copy.
 */
function safePasswordPolicyMessage(error: AuthErrorLike): string | null {
  const code = readCode(error);
  if (code !== 'weak_password') return null;
  const raw = (error?.message ?? '').toString().trim();
  if (!raw || raw.length > 160 || raw.includes('{') || raw.includes('<')) {
    return 'Choose a stronger password.';
  }
  // Capitalise for consistency with the rest of the inline errors.
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Map a Supabase auth error onto concise Nearr copy.
 *
 * `password_reset` deliberately has NO error branch for "user not found":
 * callers must report success regardless so the screen never leaks whether an
 * account exists.
 */
export function toUserFacingAuthError(
  error: AuthErrorLike,
  operation: AuthOperationKind,
): string {
  if (isNetworkFailure(error)) {
    return "Couldn't reach Nearr. Check your connection and try again.";
  }

  const code = readCode(error);
  const message = readMessage(error);

  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return 'Too many attempts. Wait a minute and try again.';
  }

  switch (operation) {
    case 'password_sign_in':
      // `invalid_credentials` and `email_not_confirmed` are deliberately
      // collapsed for sign-in EXCEPT confirmation, which the user can act on
      // without learning anything about other accounts (they just tried it).
      if (code === 'email_not_confirmed') {
        return 'Confirm your email first. Open the link we sent you.';
      }
      return 'Email or password is incorrect.';

    case 'password_sign_up': {
      const policy = safePasswordPolicyMessage(error);
      if (policy) return policy;
      // Never confirm that an address is already registered.
      if (code === 'user_already_exists' || code === 'email_exists') {
        return "Couldn't create that account. Try signing in instead.";
      }
      if (code === 'email_address_invalid' || code === 'validation_failed') {
        return 'Enter a valid email address.';
      }
      if (code === 'signup_disabled') {
        return 'New accounts are temporarily unavailable. Try again later.';
      }
      return "Couldn't create your account. Please try again.";
    }

    case 'password_update': {
      const policy = safePasswordPolicyMessage(error);
      if (policy) return policy;
      if (
        code === 'session_expired' ||
        code === 'session_not_found' ||
        message.includes('expired') ||
        message.includes('invalid')
      ) {
        return 'This password reset link has expired. Request a new one.';
      }
      if (code === 'same_password') {
        return 'Choose a password you have not used before.';
      }
      return "Couldn't update your password. Please try again.";
    }

    case 'password_reset':
      return "Couldn't send the reset email. Please try again.";

    case 'magic_link':
      if (code === 'email_address_invalid' || code === 'validation_failed') {
        return 'Enter a valid email address.';
      }
      return "Couldn't send your sign-in link. Please try again.";

    case 'google':
    case 'apple':
    default:
      return GENERIC_MESSAGE;
  }
}

/** Copy for an expired/malformed recovery deep link. */
export const RECOVERY_LINK_EXPIRED_MESSAGE =
  'This password reset link has expired. Request a new one.';

export { GENERIC_MESSAGE as GENERIC_AUTH_ERROR_MESSAGE };
