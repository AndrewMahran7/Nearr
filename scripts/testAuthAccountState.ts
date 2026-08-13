import assert from 'node:assert/strict';

import {
  applyEmailModeTransition,
  canStartOperation,
  checkEmailCopy,
  classifySignUpResult,
  initialEmailAuthState,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
  shouldRenderAppleButton,
  validateEmailOnly,
  validateNewPassword,
  validatePasswordSignIn,
  validatePasswordSignUp,
  type ActiveAuthOperation,
} from '../lib/authScreenState';
import { buildAppleNameMetadata, formatAppleFullName } from '../lib/appleName';

function emailValidation() {
  assert.equal(isValidEmail('person@example.com'), true);
  assert.equal(isValidEmail('  person@example.com  '), true, 'surrounding space is trimmed');
  assert.equal(isValidEmail('person@example'), false, 'domain needs a dot');
  assert.equal(isValidEmail('personexample.com'), false, 'missing @');
  assert.equal(isValidEmail('a@b@example.com'), false, 'double @');
  assert.equal(isValidEmail('person @example.com'), false, 'inner space');
  assert.equal(isValidEmail(''), false);

  assert.equal(validateEmailOnly('nope').ok, false);
  assert.equal(validateEmailOnly('person@example.com').ok, true);
}

function duplicateSubmitGuard() {
  const operations: Exclude<ActiveAuthOperation, null>[] = [
    'magic_link',
    'password_sign_in',
    'password_sign_up',
    'password_reset',
    'google',
    'apple',
  ];

  for (const next of operations) {
    assert.equal(canStartOperation(null, next), true, `${next} may start when idle`);
    // Duplicate submit of the same operation is blocked...
    assert.equal(canStartOperation(next, next), false, `${next} cannot be submitted twice`);
    // ...and so is every cross-provider race.
    for (const active of operations) {
      assert.equal(
        canStartOperation(active, next),
        false,
        `${next} must not start while ${active} is running`,
      );
    }
  }
}

function passwordValidation() {
  assert.equal(
    validatePasswordSignIn({ email: 'person@example.com', password: '' }).ok,
    false,
    'empty password blocks sign-in',
  );
  assert.equal(
    validatePasswordSignIn({ email: 'nope', password: 'secret123' }).ok,
    false,
    'invalid email blocks sign-in',
  );
  assert.equal(
    validatePasswordSignIn({ email: 'person@example.com', password: 'secret123' }).ok,
    true,
  );

  const mismatch = validatePasswordSignUp({
    email: 'person@example.com',
    password: 'secret123',
    confirmPassword: 'secret124',
  });
  assert.equal(mismatch.ok, false, 'mismatched confirmation blocks the API call');
  assert.equal(mismatch.ok === false && mismatch.message, "Passwords don't match.");

  const tooShort = validatePasswordSignUp({
    email: 'person@example.com',
    password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
    confirmPassword: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
  });
  assert.equal(tooShort.ok, false, 'short password blocks the API call');

  assert.equal(
    validatePasswordSignUp({
      email: 'person@example.com',
      password: 'a'.repeat(MIN_PASSWORD_LENGTH),
      confirmPassword: 'a'.repeat(MIN_PASSWORD_LENGTH),
    }).ok,
    true,
    'client validation must not be stricter than the Supabase minimum',
  );

  assert.equal(
    validateNewPassword({ password: 'brandnew1', confirmPassword: 'brandnew2' }).ok,
    false,
    'recovery confirmation must match',
  );
  assert.equal(
    validateNewPassword({ password: 'brandnew1', confirmPassword: 'brandnew1' }).ok,
    true,
  );
}

function modeTransitionsPreserveEmail() {
  const typed = { ...initialEmailAuthState('person@example.com') };
  assert.equal(typed.mode, 'magic_link', 'magic link is the default email path');

  const password = applyEmailModeTransition(typed, 'use_password');
  assert.equal(password.mode, 'password_sign_in');
  assert.equal(password.email, 'person@example.com', 'email survives entering password mode');

  const signUp = applyEmailModeTransition(password, 'create_account');
  assert.equal(signUp.mode, 'password_sign_up');
  assert.equal(signUp.email, 'person@example.com', 'email survives account-creation mode');

  const backToSignIn = applyEmailModeTransition(signUp, 'have_account');
  assert.equal(backToSignIn.mode, 'password_sign_in');
  assert.equal(backToSignIn.email, 'person@example.com');

  const backToMagic = applyEmailModeTransition(backToSignIn, 'use_magic_link');
  assert.equal(backToMagic.mode, 'magic_link');
  assert.equal(backToMagic.email, 'person@example.com');

  for (const transition of [
    'magic_link_sent',
    'signup_confirmation_required',
    'reset_email_sent',
  ] as const) {
    const parked = applyEmailModeTransition(typed, transition);
    assert.equal(parked.mode, 'check_email', `${transition} parks on the check-email state`);
    assert.equal(parked.email, 'person@example.com');
  }
}

function signUpOutcomes() {
  assert.equal(
    classifySignUpResult({ hasSession: true, hasUser: true }),
    'session',
    'an immediate session must route through the shared resolver',
  );
  assert.equal(
    classifySignUpResult({ hasSession: false, hasUser: true }),
    'confirmation_required',
    'a user without a session means confirmation is required — never navigate',
  );
  assert.equal(
    classifySignUpResult({ hasSession: false, hasUser: false }),
    'unusable',
    'no user and no session is an error, not a success',
  );
}

function passwordResetDoesNotRevealAccounts() {
  const copy = checkEmailCopy('password_reset', 'person@example.com');
  assert.match(
    copy.body,
    /^If /,
    'reset confirmation must be conditional so it never confirms an account exists',
  );
  assert.equal(
    /we sent you|your account/i.test(copy.body),
    false,
    'reset confirmation must not assert the account exists',
  );

  const signup = checkEmailCopy('signup_confirmation', 'person@example.com');
  assert.match(signup.title, /check your email/i);
  assert.match(signup.body, /confirmation link/i);
}

function appleButtonVisibility() {
  assert.equal(
    shouldRenderAppleButton({ platform: 'android', available: true }),
    false,
    'Apple must never render on Android',
  );
  assert.equal(
    shouldRenderAppleButton({ platform: 'android', available: null }),
    false,
    'Apple must never render on Android',
  );
  assert.equal(
    shouldRenderAppleButton({ platform: 'ios', available: null }),
    false,
    'Apple stays hidden until availability resolves',
  );
  assert.equal(
    shouldRenderAppleButton({ platform: 'ios', available: false }),
    false,
    'Apple stays hidden when unavailable',
  );
  assert.equal(shouldRenderAppleButton({ platform: 'ios', available: true }), true);
}

function appleNamePersistence() {
  // First authorization: Apple supplies a name → persist it.
  const first = buildAppleNameMetadata(
    { givenName: 'Ada', middleName: null, familyName: 'Lovelace' },
    {},
  );
  assert.deepEqual(first, {
    full_name: 'Ada Lovelace',
    given_name: 'Ada',
    family_name: 'Lovelace',
  });

  assert.equal(
    formatAppleFullName({ givenName: 'Ada', middleName: 'Byron', familyName: 'Lovelace' }),
    'Ada Byron Lovelace',
  );

  // Subsequent sign-ins: Apple returns nulls → never overwrite what we stored.
  assert.equal(
    buildAppleNameMetadata(null, { full_name: 'Ada Lovelace', given_name: 'Ada' }),
    null,
    'a null credential name must not clear stored metadata',
  );
  assert.equal(
    buildAppleNameMetadata(
      { givenName: null, middleName: null, familyName: null },
      { full_name: 'Ada Lovelace' },
    ),
    null,
    'all-null Apple name fields must not clear stored metadata',
  );
  assert.equal(
    buildAppleNameMetadata({ givenName: '   ', familyName: '' }, { full_name: 'Ada Lovelace' }),
    null,
    'blank Apple name fields must not clear stored metadata',
  );

  // Nothing changed → no pointless write.
  assert.equal(
    buildAppleNameMetadata(
      { givenName: 'Ada', familyName: 'Lovelace' },
      { full_name: 'Ada Lovelace', given_name: 'Ada', family_name: 'Lovelace' },
    ),
    null,
    'identical values skip the metadata write',
  );

  // Partial data: only the non-empty parts are written.
  assert.deepEqual(
    buildAppleNameMetadata({ givenName: 'Ada', familyName: null }, {}),
    { full_name: 'Ada', given_name: 'Ada' },
    'a missing family name must not be written as empty',
  );
}

function run() {
  emailValidation();
  duplicateSubmitGuard();
  passwordValidation();
  modeTransitionsPreserveEmail();
  signUpOutcomes();
  passwordResetDoesNotRevealAccounts();
  appleButtonVisibility();
  appleNamePersistence();
  console.log('testAuthAccountState: all assertions passed');
}

run();
