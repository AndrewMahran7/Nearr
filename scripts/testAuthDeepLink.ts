import assert from 'node:assert/strict';

import {
  createAuthLinkDuplicateGuard,
  decideAuthCallbackNavigation,
  decideAuthResolutionRoute,
  parseAuthCallbackUrl,
  type AuthLinkStatus,
} from '../lib/authDeepLinkCore';

type CallbackStep = {
  status: AuthLinkStatus;
  hasSession: boolean;
};

function firstNonWaitDecision(steps: CallbackStep[]): ReturnType<typeof decideAuthCallbackNavigation> {
  for (const step of steps) {
    const decision = decideAuthCallbackNavigation(step);
    if (decision !== 'wait') return decision;
  }
  return 'wait';
}

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
    '/activate',
    'session + onboarding required should route to the activation screen',
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

  // --- auth-callback mount-ordering matrix (the sticky terminal-state model) ---
  // The screen's navigation is a pure function of (status, hasSession); it must
  // resolve correctly no matter WHEN the screen mounts relative to the exchange.

  // callback mounts BEFORE processing starts (idle, no session) → wait.
  assert.equal(
    decideAuthCallbackNavigation({ status: 'idle', hasSession: false }),
    'wait',
    'idle + no session should wait for processing to begin',
  );

  // callback mounts DURING processing (no session yet) → wait.
  assert.equal(
    decideAuthCallbackNavigation({ status: 'processing', hasSession: false }),
    'wait',
    'processing + no session should keep waiting',
  );

  // callback mounts AFTER a failed exchange (the warm-link race) → sign-in.
  // This is the exact case the transient boolean could miss.
  assert.equal(
    decideAuthCallbackNavigation({ status: 'failed', hasSession: false }),
    'navigate_sign_in',
    'failed + no session (late mount) must route to sign-in, not hang',
  );

  // callback mounts AFTER a successful exchange, session not yet propagated →
  // still route into the app (sticky `succeeded`).
  assert.equal(
    decideAuthCallbackNavigation({ status: 'succeeded', hasSession: false }),
    'navigate_app',
    'succeeded should route into the app even before session propagates',
  );

  // callback mounts AFTER success with the session already present → app.
  assert.equal(
    decideAuthCallbackNavigation({ status: 'succeeded', hasSession: true }),
    'navigate_app',
    'succeeded + session should route into the app',
  );

  // Robustness: a present session always wins, even if a duplicate link was
  // labelled `failed` — never bounce an already-signed-in user to sign-in.
  assert.equal(
    decideAuthCallbackNavigation({ status: 'failed', hasSession: true }),
    'navigate_app',
    'a present session overrides a failed label',
  );

  // Expired/invalid link → failed → sign-in (no session).
  assert.equal(
    decideAuthCallbackNavigation({ status: 'idle', hasSession: true }),
    'navigate_app',
    'a restored session with no auth link in flight should route into the app',
  );

  // Warm / repeated link timeline: a terminal state is reset to `processing`
  // for the new link and only the new terminal state resolves. The screen only
  // ever leaves `wait` at a real outcome.
  const warmTimeline: AuthLinkStatus[] = ['failed', 'processing', 'succeeded'];
  const warmDecisions = warmTimeline.map((s) =>
    decideAuthCallbackNavigation({ status: s, hasSession: false }),
  );
  assert.deepEqual(
    warmDecisions,
    ['navigate_sign_in', 'wait', 'navigate_app'],
    'warm-link timeline should resolve only at terminal states',
  );

  // --- focused ordering audit matrix ---
  // 1) cold-start valid magic link
  assert.equal(
    firstNonWaitDecision([
      { status: 'idle', hasSession: false },
      { status: 'processing', hasSession: false },
      { status: 'succeeded', hasSession: false },
    ]),
    'navigate_app',
    'cold-start valid link should resolve into app',
  );

  // 2) cold-start invalid/expired magic link
  assert.equal(
    firstNonWaitDecision([
      { status: 'idle', hasSession: false },
      { status: 'processing', hasSession: false },
      { status: 'failed', hasSession: false },
    ]),
    'navigate_sign_in',
    'cold-start invalid link should resolve to sign-in',
  );

  // 3) warm-start valid magic link
  assert.equal(
    firstNonWaitDecision([
      { status: 'processing', hasSession: false },
      { status: 'succeeded', hasSession: false },
    ]),
    'navigate_app',
    'warm-start valid link should resolve into app',
  );

  // 4) warm-start invalid/expired magic link
  assert.equal(
    firstNonWaitDecision([
      { status: 'processing', hasSession: false },
      { status: 'failed', hasSession: false },
    ]),
    'navigate_sign_in',
    'warm-start invalid link should resolve to sign-in',
  );

  // 5) callback route mounts BEFORE processing starts
  assert.equal(
    firstNonWaitDecision([
      { status: 'idle', hasSession: false },
      { status: 'processing', hasSession: false },
      { status: 'failed', hasSession: false },
    ]),
    'navigate_sign_in',
    'mount-before-processing should still resolve when terminal state arrives',
  );

  // 6) callback route mounts AFTER processing completes
  assert.equal(
    firstNonWaitDecision([{ status: 'failed', hasSession: false }]),
    'navigate_sign_in',
    'late mount after failed processing must resolve immediately',
  );
  assert.equal(
    firstNonWaitDecision([{ status: 'succeeded', hasSession: false }]),
    'navigate_app',
    'late mount after successful processing must resolve immediately',
  );

  // New incoming link must reset terminal state before re-resolving.
  const resetTimeline: AuthLinkStatus[] = ['failed', 'processing', 'succeeded'];
  assert.deepEqual(
    resetTimeline.map((status) =>
      decideAuthCallbackNavigation({ status, hasSession: false }),
    ),
    ['navigate_sign_in', 'wait', 'navigate_app'],
    'new links should reset terminal state through processing before new outcome',
  );

  console.log('[test:auth-deeplink] all assertions passed');
}

run();
