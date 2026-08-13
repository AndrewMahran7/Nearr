import assert from 'node:assert/strict';

import {
  createAuthLinkDuplicateGuard,
  decideAuthCallbackNavigation,
  parseAuthCallbackUrl,
  routeAfterAuthenticatedUser,
} from '../lib/authDeepLinkCore';

const RECOVERY_URL =
  'nearr://auth-callback#access_token=at123&refresh_token=rt123&type=recovery';
const MAGIC_LINK_URL =
  'nearr://auth-callback#access_token=at456&refresh_token=rt456&type=magiclink';
const GOOGLE_OAUTH_URL =
  'nearr://auth-callback#access_token=at789&refresh_token=rt789&provider_token=pt789';

function recoveryLinksAreIdentified() {
  const recovery = parseAuthCallbackUrl(RECOVERY_URL);
  assert.equal(recovery.matches, true);
  assert.equal(recovery.hasTokens, true);
  assert.equal(recovery.isRecovery, true, 'type=recovery must be detected');

  assert.equal(
    parseAuthCallbackUrl(MAGIC_LINK_URL).isRecovery,
    false,
    'a magic link is not a recovery link',
  );
  assert.equal(
    parseAuthCallbackUrl(GOOGLE_OAUTH_URL).isRecovery,
    false,
    'an OAuth callback is not a recovery link',
  );

  // A PKCE-shaped recovery link is handled too.
  assert.equal(
    parseAuthCallbackUrl('nearr://auth-callback?code=abc&type=recovery').isRecovery,
    true,
  );

  // Log-safe path never contains the secrets.
  const safePath = parseAuthCallbackUrl(RECOVERY_URL).safePath;
  assert.equal(safePath.includes('access_token'), false);
  assert.equal(safePath.includes('refresh_token'), false);
}

function recoveryDoesNotRunNormalLoginRouting() {
  // The recovery exchange DOES create a session — that must not be enough to
  // send the user into the app.
  assert.equal(
    decideAuthCallbackNavigation({ status: 'recovery', hasSession: true }),
    'navigate_reset_password',
    'a recovery session must land on the reset screen, not the app',
  );
  assert.equal(
    decideAuthCallbackNavigation({ status: 'recovery', hasSession: false }),
    'navigate_reset_password',
  );

  // Non-recovery behaviour is unchanged.
  assert.equal(
    decideAuthCallbackNavigation({ status: 'succeeded', hasSession: true }),
    'navigate_app',
  );
  assert.equal(
    decideAuthCallbackNavigation({ status: 'succeeded', hasSession: false }),
    'navigate_app',
  );
  assert.equal(
    decideAuthCallbackNavigation({ status: 'failed', hasSession: false }),
    'navigate_sign_in',
    'an expired/malformed link never authenticates',
  );
  assert.equal(
    decideAuthCallbackNavigation({ status: 'failed', hasSession: true }),
    'navigate_app',
    'a real session still wins over a duplicate-link failure',
  );
  assert.equal(decideAuthCallbackNavigation({ status: 'idle', hasSession: false }), 'wait');
  assert.equal(
    decideAuthCallbackNavigation({ status: 'processing', hasSession: false }),
    'wait',
  );
}

function malformedCallbacksNeverAuthenticate() {
  for (const url of [
    'not a url at all',
    'nearr://share?url=https%3A%2F%2Fexample.com',
    'https://example.com/auth-callback',
  ]) {
    const parsed = parseAuthCallbackUrl(url);
    if (parsed.matches) {
      // An https callback can still match on the path segment, but with no
      // tokens and no code there is nothing to exchange.
      assert.equal(parsed.hasCode, false, `${url} must not carry a code`);
      assert.equal(parsed.hasTokens, false, `${url} must not carry tokens`);
    }
  }

  // A token-less auth-callback resolves to `failed`, i.e. sign-in, not the app.
  assert.equal(
    decideAuthCallbackNavigation({ status: 'failed', hasSession: false }),
    'navigate_sign_in',
  );
}

function duplicateCallbacksCannotNavigateTwice() {
  const guard = createAuthLinkDuplicateGuard(12_000);
  const params = parseAuthCallbackUrl(GOOGLE_OAUTH_URL).params;

  assert.equal(guard.shouldIgnore(GOOGLE_OAUTH_URL, params, 1_000), false, 'first delivery runs');
  assert.equal(
    guard.shouldIgnore(GOOGLE_OAUTH_URL, params, 1_050),
    true,
    'an immediate repeat of the same OAuth callback is ignored',
  );
  assert.equal(
    guard.shouldIgnore(GOOGLE_OAUTH_URL, params, 2_000),
    true,
    'repeats stay ignored inside the window',
  );

  // A genuinely different callback is still processed.
  const otherParams = parseAuthCallbackUrl(MAGIC_LINK_URL).params;
  assert.equal(
    guard.shouldIgnore(MAGIC_LINK_URL, otherParams, 2_100),
    false,
    'a different auth link is not treated as a duplicate',
  );
}

function recoverySuccessUsesSharedRouting() {
  // Once the new password is saved, the user joins the SAME resolver every
  // other auth method uses.
  assert.equal(routeAfterAuthenticatedUser('required'), '/activate');
  assert.equal(routeAfterAuthenticatedUser('complete'), '/(tabs)/map');
}

function run() {
  recoveryLinksAreIdentified();
  recoveryDoesNotRunNormalLoginRouting();
  malformedCallbacksNeverAuthenticate();
  duplicateCallbacksCannotNavigateTwice();
  recoverySuccessUsesSharedRouting();
  console.log('testAuthRecovery: all assertions passed');
}

run();
