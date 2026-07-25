import assert from 'node:assert/strict';

import {
  createAuthLinkDuplicateGuard,
  decideAuthResolutionRoute,
  parseAuthCallbackUrl,
} from '../lib/authDeepLinkCore';

function run() {
  const codeUrl = 'nearr://auth-callback?code=abc123&type=magiclink';
  const codeParsed = parseAuthCallbackUrl(codeUrl);
  assert.equal(codeParsed.matches, true, 'code callback should match auth callback');
  assert.equal(codeParsed.hasCode, true, 'code callback should expose hasCode');
  assert.equal(codeParsed.hasTokens, false, 'code callback should not report tokens');
  assert.equal(codeParsed.params.code, 'abc123');

  const tokenUrl =
    'nearr:///auth-callback#access_token=at123&refresh_token=rt123&type=magiclink';
  const tokenParsed = parseAuthCallbackUrl(tokenUrl);
  assert.equal(tokenParsed.matches, true, 'token callback should match auth callback');
  assert.equal(tokenParsed.hasCode, false, 'token callback should not report code');
  assert.equal(tokenParsed.hasTokens, true, 'token callback should report token params');

  const nonAuthUrl = 'nearr://share?url=https%3A%2F%2Fexample.com';
  const nonAuthParsed = parseAuthCallbackUrl(nonAuthUrl);
  assert.equal(nonAuthParsed.matches, false, 'non-auth deep link must be ignored');

  // Log-safe path must not include auth secrets from query/fragment.
  assert.equal(
    tokenParsed.safePath.includes('access_token'),
    false,
    'safePath must not include token params',
  );
  assert.equal(
    tokenParsed.safePath.includes('refresh_token'),
    false,
    'safePath must not include token params',
  );

  const duplicateGuard = createAuthLinkDuplicateGuard(5_000);
  const firstDuplicateCheck = duplicateGuard.shouldIgnore(codeUrl, codeParsed.params, 1_000);
  const secondDuplicateCheck = duplicateGuard.shouldIgnore(codeUrl, codeParsed.params, 2_000);
  const thirdDuplicateCheck = duplicateGuard.shouldIgnore(codeUrl, codeParsed.params, 7_001);

  assert.equal(firstDuplicateCheck, false, 'first auth link should not be ignored');
  assert.equal(secondDuplicateCheck, true, 'repeated auth link within window should be ignored');
  assert.equal(thirdDuplicateCheck, false, 'auth link after dedupe window should be processed');

  assert.equal(
    decideAuthResolutionRoute({
      hasSession: true,
      onboardingStatus: 'complete',
      signedOutRoute: '/(onboarding)',
    }),
    '/(tabs)/map',
    'session + onboarding complete should route to map',
  );

  assert.equal(
    decideAuthResolutionRoute({
      hasSession: true,
      onboardingStatus: 'required',
      signedOutRoute: '/(onboarding)',
    }),
    '/(onboarding)',
    'session + onboarding required should route to onboarding',
  );

  assert.equal(
    decideAuthResolutionRoute({
      hasSession: false,
      onboardingStatus: 'complete',
      signedOutRoute: '/(auth)/sign-in',
    }),
    '/(auth)/sign-in',
    'no session should route to signed-out route',
  );

  console.log('[test:auth-deeplink] all assertions passed');
}

run();
