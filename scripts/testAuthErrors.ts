import assert from 'node:assert/strict';

import {
  isAuthCancellation,
  toUserFacingAuthError,
  type AuthOperationKind,
} from '../lib/authErrors';

const ALL_OPERATIONS: AuthOperationKind[] = [
  'magic_link',
  'password_sign_in',
  'password_sign_up',
  'password_reset',
  'password_update',
  'google',
  'apple',
];

/** Anything that would betray internals or account existence. */
const FORBIDDEN_FRAGMENTS = [
  '{',
  '}',
  '[object',
  'AuthApiError',
  'supabase',
  'http',
  'status',
  'stack',
];

function neverLeaksInternals() {
  const nastyErrors = [
    { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
    { code: 'user_not_found', status: 404, message: 'User not found' },
    { code: 'user_already_exists', status: 422, message: 'User already registered' },
    { name: 'AuthApiError', message: '{"error":"server_error","status":500}' },
    { message: 'https://xyz.supabase.co/auth/v1/token returned 500' },
    null,
    undefined,
  ];

  for (const operation of ALL_OPERATIONS) {
    for (const error of nastyErrors) {
      const message = toUserFacingAuthError(error, operation);
      assert.ok(message.length > 0, 'a message is always produced');
      assert.ok(message.length < 160, 'messages stay short');
      for (const fragment of FORBIDDEN_FRAGMENTS) {
        assert.equal(
          message.toLowerCase().includes(fragment.toLowerCase()),
          false,
          `"${message}" must not expose "${fragment}"`,
        );
      }
    }
  }
}

function doesNotRevealAccountExistence() {
  // Wrong password and unknown address must be indistinguishable.
  const wrongPassword = toUserFacingAuthError(
    { code: 'invalid_credentials', message: 'Invalid login credentials' },
    'password_sign_in',
  );
  const unknownUser = toUserFacingAuthError(
    { code: 'user_not_found', message: 'User not found' },
    'password_sign_in',
  );
  assert.equal(wrongPassword, 'Email or password is incorrect.');
  assert.equal(
    wrongPassword,
    unknownUser,
    'unknown email and wrong password must produce identical copy',
  );

  const alreadyRegistered = toUserFacingAuthError(
    { code: 'user_already_exists', message: 'User already registered' },
    'password_sign_up',
  );
  assert.equal(
    /already registered|already exists|taken/i.test(alreadyRegistered),
    false,
    'signup failure must not confirm the address is registered',
  );
}

function usefulSpecificCases() {
  assert.equal(
    toUserFacingAuthError(
      { code: 'weak_password', message: 'Password should be at least 8 characters' },
      'password_sign_up',
    ),
    'Password should be at least 8 characters',
    'the safe Supabase password-policy message is surfaced verbatim',
  );

  assert.equal(
    toUserFacingAuthError({ code: 'weak_password', message: '{"raw":"json"}' }, 'password_sign_up'),
    'Choose a stronger password.',
    'an unsafe-looking policy message is replaced',
  );

  assert.equal(
    toUserFacingAuthError(
      { code: 'session_not_found', message: 'Session from session_id claim not found' },
      'password_update',
    ),
    'This password reset link has expired. Request a new one.',
  );

  assert.match(
    toUserFacingAuthError({ name: 'AuthRetryableFetchError', message: '' }, 'google'),
    /connection/i,
    'network failures get connection copy, not a credentials error',
  );

  assert.equal(
    toUserFacingAuthError({ message: 'boom' }, 'google'),
    "Couldn't sign you in. Please try again.",
  );
  assert.equal(
    toUserFacingAuthError({ message: 'boom' }, 'apple'),
    "Couldn't sign you in. Please try again.",
  );

  assert.match(
    toUserFacingAuthError({ code: 'over_email_send_rate_limit' }, 'magic_link'),
    /too many attempts/i,
  );
}

function cancellationIsNotAFailure() {
  assert.equal(
    isAuthCancellation({ code: 'ERR_REQUEST_CANCELED' }),
    true,
    'Apple sheet dismissal is a cancellation',
  );
  assert.equal(isAuthCancellation({ message: 'The user canceled the sign-in.' }), true);
  assert.equal(isAuthCancellation({ code: 'invalid_credentials' }), false);
  assert.equal(isAuthCancellation(null), false);
  assert.equal(isAuthCancellation('cancelled'), false, 'non-objects are not cancellations');
}

function run() {
  neverLeaksInternals();
  doesNotRevealAccountExistence();
  usefulSpecificCases();
  cancellationIsNotAFailure();
  console.log('testAuthErrors: all assertions passed');
}

run();
