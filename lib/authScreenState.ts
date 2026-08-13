/**
 * Pure state machine + validation for the Nearr account screen.
 *
 * The screen shows ONE account gateway with several email modes plus the
 * native/social providers. Rather than a pile of unrelated booleans it keeps
 * exactly two pieces of mode state:
 *
 *   - `EmailAuthMode`      — which email form is on screen.
 *   - `ActiveAuthOperation` — the single in-flight auth request, if any.
 *
 * Everything here is dependency-free so it can be exercised by a plain
 * ts-node test without a React Native runtime.
 */

/** Which email form the single account screen is currently showing. */
export type EmailAuthMode =
  | 'magic_link'
  | 'password_sign_in'
  | 'password_sign_up'
  | 'check_email';

/**
 * Why the `check_email` terminal state is showing. Both cases park the user
 * on the screen — neither may navigate into the app, because no session
 * exists yet.
 */
export type CheckEmailReason =
  | 'magic_link'
  | 'signup_confirmation'
  | 'password_reset';

/**
 * The ONE auth request allowed to be in flight. `null` means idle. Every
 * entry point (Apple, Google, email, password, reset) checks this first so a
 * user cannot start two providers at once or double-submit a form.
 */
export type ActiveAuthOperation =
  | null
  | 'magic_link'
  | 'password_sign_in'
  | 'password_sign_up'
  | 'password_reset'
  | 'google'
  | 'apple';

/**
 * Supabase's default minimum password length. The server remains the
 * authority — this only avoids a pointless round trip and gives an instant
 * inline error. It must never be higher than the project policy and must
 * never be used to bypass the server's own (possibly stricter) rules.
 */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Deliberately permissive: real deliverability is decided by Supabase and the
 * mail provider. This only catches obvious typos before a network call.
 */
export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 320) return false;
  if (/\s/.test(trimmed)) return false;
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

export type ValidationResult = { ok: true } | { ok: false; message: string };

const OK: ValidationResult = { ok: true };

export function validateEmailOnly(email: string): ValidationResult {
  return isValidEmail(email) ? OK : { ok: false, message: 'Enter a valid email address.' };
}

export function validatePasswordSignIn(input: {
  email: string;
  password: string;
}): ValidationResult {
  if (!isValidEmail(input.email)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }
  if (!input.password) {
    return { ok: false, message: 'Enter your password.' };
  }
  return OK;
}

export function validatePasswordSignUp(
  input: { email: string; password: string; confirmPassword: string },
  minLength: number = MIN_PASSWORD_LENGTH,
): ValidationResult {
  if (!isValidEmail(input.email)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }
  if (input.password.length < minLength) {
    return {
      ok: false,
      message: `Use at least ${minLength} characters for your password.`,
    };
  }
  if (input.password !== input.confirmPassword) {
    return { ok: false, message: "Passwords don't match." };
  }
  return OK;
}

export function validateNewPassword(
  input: { password: string; confirmPassword: string },
  minLength: number = MIN_PASSWORD_LENGTH,
): ValidationResult {
  if (input.password.length < minLength) {
    return {
      ok: false,
      message: `Use at least ${minLength} characters for your password.`,
    };
  }
  if (input.password !== input.confirmPassword) {
    return { ok: false, message: "Passwords don't match." };
  }
  return OK;
}

/**
 * Single source of truth for "may this tap start work?". Blocks duplicate
 * submits of the same operation AND cross-provider races (e.g. tapping Google
 * while Apple's sheet is resolving).
 */
export function canStartOperation(
  active: ActiveAuthOperation,
  _next: Exclude<ActiveAuthOperation, null>,
): boolean {
  // Idle is the only state a new request may start from: a matching `active`
  // means a duplicate submit, a differing one means a cross-provider race.
  return active === null;
}

/**
 * Whether the native Apple button may render. iOS only, and only once
 * `AppleAuthentication.isAvailableAsync()` has resolved true — Android and
 * unsupported iOS versions must never see Apple branding.
 */
export function shouldRenderAppleButton(input: {
  platform: string;
  available: boolean | null;
}): boolean {
  return input.platform === 'ios' && input.available === true;
}

/**
 * Mode transitions. Keeping them here (instead of inline `setMode` calls)
 * makes the "entering password mode must preserve the typed email" rule
 * testable and impossible to regress.
 */
export type EmailModeTransition =
  | 'use_password'
  | 'use_magic_link'
  | 'create_account'
  | 'have_account'
  | 'magic_link_sent'
  | 'signup_confirmation_required'
  | 'reset_email_sent'
  | 'restart';

export type EmailAuthScreenState = {
  mode: EmailAuthMode;
  /** Only meaningful while `mode === 'check_email'`. */
  checkEmailReason: CheckEmailReason | null;
  /** The address typed by the user; preserved across every transition. */
  email: string;
};

export function initialEmailAuthState(email = ''): EmailAuthScreenState {
  return { mode: 'magic_link', checkEmailReason: null, email };
}

export function applyEmailModeTransition(
  state: EmailAuthScreenState,
  transition: EmailModeTransition,
): EmailAuthScreenState {
  // The email is NEVER cleared by a mode change — switching between magic
  // link, password sign-in and account creation keeps what the user typed.
  const base = { email: state.email };
  switch (transition) {
    case 'use_password':
      return { ...base, mode: 'password_sign_in', checkEmailReason: null };
    case 'use_magic_link':
      return { ...base, mode: 'magic_link', checkEmailReason: null };
    case 'create_account':
      return { ...base, mode: 'password_sign_up', checkEmailReason: null };
    case 'have_account':
      return { ...base, mode: 'password_sign_in', checkEmailReason: null };
    case 'magic_link_sent':
      return { ...base, mode: 'check_email', checkEmailReason: 'magic_link' };
    case 'signup_confirmation_required':
      return { ...base, mode: 'check_email', checkEmailReason: 'signup_confirmation' };
    case 'reset_email_sent':
      return { ...base, mode: 'check_email', checkEmailReason: 'password_reset' };
    case 'restart':
      return { ...base, mode: 'magic_link', checkEmailReason: null };
    default:
      return state;
  }
}

export type CheckEmailCopy = { title: string; body: string };

export function checkEmailCopy(
  reason: CheckEmailReason,
  email: string,
): CheckEmailCopy {
  const address = email.trim();
  switch (reason) {
    case 'signup_confirmation':
      return {
        title: 'Check your email',
        body: `We sent a confirmation link to ${address}. Open it to finish creating your Nearr account.`,
      };
    case 'password_reset':
      return {
        title: 'Check your email',
        body: `If ${address} has a Nearr account, we've sent a link to reset the password.`,
      };
    case 'magic_link':
    default:
      return {
        title: 'Check your email',
        body: `We sent a one-tap sign-in link to ${address}. Open it on this device to finish.`,
      };
  }
}

/**
 * Classify the result of `supabase.auth.signUp`.
 *
 * Supabase returns a session ONLY when email confirmation is disabled. When
 * confirmation is required it returns a user with no session — navigating
 * into the app at that point would be wrong, because the user is not
 * authenticated yet.
 */
export type SignUpOutcomeKind = 'session' | 'confirmation_required' | 'unusable';

export function classifySignUpResult(result: {
  hasSession: boolean;
  hasUser: boolean;
}): SignUpOutcomeKind {
  if (result.hasSession) return 'session';
  if (result.hasUser) return 'confirmation_required';
  return 'unusable';
}
