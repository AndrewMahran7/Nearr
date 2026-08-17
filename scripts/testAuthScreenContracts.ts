import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source contracts for the production auth surface.
 *
 * These cover the rules that cannot be exercised without launching a real
 * provider UI: what is wired to what, what is gated, and what must never be
 * logged or tracked.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/** Comments explain the rules; assertions about behaviour must read code only. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const account = read('app/(onboarding)/account.tsx');
const authService = read('services/auth.ts');
const callback = read('app/auth-callback.tsx');
const resetPassword = read('app/reset-password.tsx');
const rootLayout = read('app/_layout.tsx');
const postAuthRouting = read('lib/postAuthRouting.ts');
const googleButton = read('components/onboarding/GoogleSignInButton.tsx');

function sharedPostAuthRouting() {
  assert.match(
    postAuthRouting,
    /export async function resolvePostAuthRoute/,
    'there is one shared post-auth resolver',
  );
  assert.match(postAuthRouting, /routeAfterAuthenticatedUser/, 'it reuses the existing routing rule');
  assert.doesNotMatch(
    stripComments(postAuthRouting),
    /first_save_completed|setOnboardingComplete|markOnboarding/,
    'authentication must never mark onboarding/first-save complete',
  );

  // Every success path on the account screen funnels through the same call.
  assert.match(account, /async function completeAuthentication/);
  assert.match(account, /resolvePostAuthRoute/);
  for (const handler of [
    'handlePasswordSignIn',
    'handlePasswordSignUp',
    'handleGoogle',
    'handleApple',
    'handleDeveloperSignIn',
  ]) {
    const start = account.indexOf(`function ${handler}`);
    assert.ok(start > -1, `${handler} exists`);
    const body = account.slice(start, account.indexOf('\n  }', start));
    if (handler === 'handlePasswordSignUp') {
      assert.match(
        body,
        /completeAuthentication|confirmation_required/,
        `${handler} either routes through the shared resolver or parks on confirmation`,
      );
    } else {
      assert.match(
        body,
        /completeAuthentication\(/,
        `${handler} must route through the shared resolver`,
      );
    }
  }
  // The only hardcoded map destination is the resolver's own catch fallback.
  const mapReplaces = account.match(/router\.replace\('\/\(tabs\)\/map'\)/g) ?? [];
  assert.equal(
    mapReplaces.length,
    1,
    'the map route is only reachable via the shared resolver fallback',
  );
  const completeBody = account.slice(
    account.indexOf('async function completeAuthentication'),
    account.indexOf('// Email: magic link (default)'),
  );
  assert.match(
    completeBody,
    /catch \{\s*router\.replace\('\/\(tabs\)\/map'\);/,
    'that single hardcoded route is the resolver fallback',
  );

  // The magic-link callback screen uses the same resolver.
  assert.match(callback, /resolvePostAuthRoute/);
  assert.match(callback, /hasNavigated\.current/, 'the callback screen navigates at most once');
}

function appleRules() {
  assert.match(
    account,
    /shouldRenderAppleButton\(\{\s*platform: Platform\.OS/,
    'the Apple button is gated on platform + availability',
  );
  assert.match(
    account,
    /showApple \?[\s\S]{0,400}AppleAuthentication\.AppleAuthenticationButton/,
    'the NATIVE Apple button is used, behind the availability gate',
  );
  assert.doesNotMatch(
    account,
    /Pressable[\s\S]{0,200}Continue with Apple/,
    'Apple branding must not be recreated with a generic Pressable',
  );

  assert.match(
    authService,
    /AppleAuthenticationScope\.FULL_NAME[\s\S]{0,120}AppleAuthenticationScope\.EMAIL/,
    'FULL_NAME and EMAIL scopes are requested',
  );
  assert.match(authService, /isAvailableAsync/, 'availability is checked before showing the button');
  assert.match(
    authService,
    /Platform\.OS !== 'ios'/,
    'Apple availability is false on Android without touching the native module',
  );

  // Nonce: hashed to Apple, raw to Supabase — never skipped.
  assert.match(authService, /CryptoDigestAlgorithm\.SHA256/);
  assert.match(authService, /nonce: nonce\.hashed/, 'Apple receives the hashed nonce');
  assert.match(authService, /nonce: nonce\.raw/, 'Supabase receives the raw nonce');
  assert.doesNotMatch(authService, /skip_nonce_check/, 'nonce checking is never disabled');

  assert.match(
    authService,
    /ERR_REQUEST_CANCELED'\) return \{ status: 'cancelled' \}/,
    'Apple cancellation is a normal outcome',
  );
  assert.match(
    authService,
    /!credential\.identityToken[\s\S]{0,160}missing_identity_token/,
    'a missing identity token is handled explicitly',
  );
  assert.match(
    authService,
    /signInWithIdToken\(\{[\s\S]{0,120}provider: 'apple'/,
    'the native credential is exchanged with Supabase',
  );

  // Name persistence must never invalidate the session.
  const persist = authService.slice(authService.indexOf('async function persistAppleFullName'));
  assert.match(persist, /catch \{/, 'name persistence failure is swallowed');
  assert.doesNotMatch(persist, /signOut|return \{ status: 'failed'/);

  // Cancellation must not surface an error banner.
  const appleHandler = account.slice(
    account.indexOf('async function handleApple'),
    account.indexOf('// Dev/QA preview'),
  );
  assert.match(
    appleHandler,
    /status === 'cancelled'[\s\S]{0,220}return;/,
    'cancellation returns before any error UI',
  );
  const cancelBranch = appleHandler.slice(
    appleHandler.indexOf("status === 'cancelled'"),
    appleHandler.indexOf('onboarding_apple_failed'),
  );
  assert.doesNotMatch(cancelBranch, /setErrorMessage/, 'cancelling Apple shows no error');
}

function googleRules() {
  assert.match(
    authService,
    /signInWithOAuth\(\{[\s\S]{0,200}skipBrowserRedirect: true/,
    'Google uses Supabase OAuth with skipBrowserRedirect',
  );
  assert.match(
    authService,
    /redirectTo,\s*skipBrowserRedirect/,
    'the real repo callback URI is used as the redirect',
  );
  assert.match(authService, /getAuthCallbackUrl\(\)/);
  assert.match(
    authService,
    /!providerUrl[\s\S]{0,160}missing_oauth_url/,
    'a missing OAuth url is handled',
  );
  assert.match(
    authService,
    /result\.type === 'cancel' \|\| result\.type === 'dismiss'/,
    'cancellation and browser dismissal are handled',
  );
  assert.match(
    authService,
    /handleAuthDeepLink\(result\.url, \{ source: 'oauth_result' \}\)/,
    'the OAuth callback reuses the existing exchange pipeline',
  );
  assert.doesNotMatch(authService, /firebase|react-native-google-signin/i);

  const googleHandler = account.slice(
    account.indexOf('async function handleGoogle'),
    account.indexOf('async function handleApple'),
  );
  const cancelBranch = googleHandler.slice(
    googleHandler.indexOf("status === 'cancelled'"),
    googleHandler.indexOf('onboarding_google_failed'),
  );
  assert.doesNotMatch(cancelBranch, /setErrorMessage/, 'cancelling Google shows no error');

  assert.doesNotMatch(googleButton, /OnboardingColors\.orange/, 'Google is never Nearr orange');
  assert.match(googleButton, /Continue with Google/);
  assert.match(googleButton, /OnboardingSizes\.primaryButtonHeight/, 'height matches the other CTAs');
}

function magicLinkPreserved() {
  assert.match(authService, /signInWithOtp/, 'the magic-link call is unchanged');
  assert.match(authService, /emailRedirectTo: redirectTo/);
  assert.match(account, /handleSendMagicLink/);
  assert.match(
    account,
    /beginOperation\('magic_link'\)/,
    'magic link goes through the duplicate-submit guard',
  );
  // The magic link still both signs in and creates accounts; the COPY no longer
  // says so in developer language ("New users are created automatically").
  assert.match(
    account,
    /We&apos;ll email you a secure sign-in link\. No password needed\./,
    'magic-link copy is consumer-facing and states no password is needed',
  );
  assert.doesNotMatch(
    account,
    /New users are created/,
    'internal account-provisioning wording must not reach the user',
  );
  assert.doesNotMatch(account, />Sign up</, 'no separate Sign up vs Sign in for the magic-link path');
}

function recoveryWiring() {
  assert.match(
    authService,
    /resetPasswordForEmail\([\s\S]{0,120}redirectTo: getAuthCallbackUrl\(\)/,
    'recovery reuses the already-allow-listed callback',
  );
  assert.match(rootLayout, /result\.isRecovery \? 'recovery' : 'succeeded'/);
  assert.match(rootLayout, /<Stack\.Screen name="reset-password" \/>/);
  assert.match(callback, /navigate_reset_password[\s\S]{0,400}router\.replace\('\/reset-password'\)/);
  assert.match(resetPassword, /updateRecoveredPassword/);
  assert.match(resetPassword, /resolvePostAuthRoute/, 'a successful reset uses the shared routing');
  assert.match(resetPassword, /Link expired/, 'an expired/malformed link is handled gracefully');
}

function developerLoginIsUnchangedAndSeparate() {
  assert.match(
    account,
    /const DEV_PASSWORD_LOGIN_ENABLED =\s*\n?\s*__DEV__ && process\.env\.EXPO_PUBLIC_ENABLE_DEV_PASSWORD_LOGIN === 'true';/,
    'the developer gate is exactly as before',
  );
  assert.match(account, /DEV_PASSWORD_LOGIN_ENABLED \? \(/, 'the panel is still gated on it');

  // The production password mode must not depend on the developer gate.
  const productionPasswordBlock = account.slice(
    account.indexOf("{mode === 'password_sign_in' ?"),
    account.indexOf('{DEV_PASSWORD_LOGIN_ENABLED ?'),
  );
  assert.ok(productionPasswordBlock.length > 0);
  assert.doesNotMatch(
    productionPasswordBlock,
    /DEV_PASSWORD_LOGIN_ENABLED|isDevAuthEnabled|devAuth/,
    'production password auth must not depend on the developer gate or Local UI Mode',
  );
  // Separate state: the developer panel has its own email/password/error.
  for (const name of [
    'developerEmail',
    'developerPassword',
    'developerError',
    'developerSigningIn',
  ]) {
    assert.ok(account.includes(name), `${name} keeps the developer panel state separate`);
  }
  assert.doesNotMatch(account, /devAuth|isDevAuthEnabled|setDevAuth/, 'Local UI Mode is untouched');
}

function analyticsAndLoggingAreSafe() {
  const requiredEvents = [
    'onboarding_google_started',
    'onboarding_google_completed',
    'onboarding_google_cancelled',
    'onboarding_google_failed',
    'onboarding_apple_started',
    'onboarding_apple_completed',
    'onboarding_apple_cancelled',
    'onboarding_apple_failed',
    'onboarding_password_mode_opened',
    'onboarding_password_signin_started',
    'onboarding_password_signin_completed',
    'onboarding_password_signin_failed',
    'onboarding_password_signup_started',
    'onboarding_password_signup_completed',
    'onboarding_password_signup_confirmation_required',
    'onboarding_password_signup_failed',
    'onboarding_password_reset_requested',
  ];
  for (const event of requiredEvents) {
    assert.ok(account.includes(event), `analytics event ${event} is emitted`);
  }
  assert.ok(
    resetPassword.includes('onboarding_password_reset_completed'),
    'analytics event onboarding_password_reset_completed is emitted',
  );

  // Nothing sensitive may reach analytics or the logs.
  const sensitive = [
    'email:',
    'password:',
    'access_token',
    'refresh_token',
    'identityToken',
    'id_token',
    'nonce',
    'credential',
  ];
  const trackCalls = [...account.matchAll(/trackEvent\([^)]*\)/g)].map((m) => m[0]);
  assert.ok(trackCalls.length > 0);
  for (const call of trackCalls) {
    for (const token of sensitive) {
      assert.equal(
        call.includes(token),
        false,
        `trackEvent payload must not contain ${token}: ${call}`,
      );
    }
  }

  const logCalls = [...authService.matchAll(/console\.(log|warn|error)\([^\n]*\)/g)].map(
    (m) => m[0],
  );
  for (const call of logCalls) {
    for (const token of [
      'identityToken',
      'access_token',
      'refresh_token',
      'providerUrl',
      'result.url',
      'nonce',
      'credential',
      'email',
      'password',
    ]) {
      assert.equal(call.includes(token), false, `log must not contain ${token}: ${call}`);
    }
  }
}

function accessibilityAndKeyboard() {
  assert.match(account, /KeyboardAvoidingView/);
  assert.match(account, /minHeight: 44/, 'text links keep a 44pt target');
  assert.match(account, /accessibilityRole="alert"/, 'inline errors are announced');
  assert.match(account, /accessibilityLabel="Email address"/);
  assert.match(account, /accessibilityLabel="Password"/);
  assert.match(account, /accessibilityLabel="Confirm password"/);
  assert.match(resetPassword, /KeyboardAvoidingView/);

  const passwordField = read('components/onboarding/OnboardingPasswordField.tsx');
  assert.match(passwordField, /secureTextEntry=\{!visible\}/, 'passwords are secure inputs');
  assert.match(passwordField, /accessibilityRole="button"/);
  assert.match(passwordField, /Show password|Hide password/);
}

function legacySignInRouteIsNeutralised() {
  const legacy = read('app/(auth)/sign-in.tsx');
  assert.match(legacy, /<Redirect href="\/\(onboarding\)\/account" \/>/);
  for (const banned of ['dev@nearr.test', 'signInWithPassword', 'sendMagicLink', 'secureTextEntry']) {
    assert.equal(
      legacy.includes(banned),
      false,
      `the legacy sign-in route must not contain ${banned}`,
    );
  }

  // No production failure path may send a user to the legacy route.
  for (const file of [
    'app/auth-callback.tsx',
    'app/(tabs)/settings.tsx',
    'components/ShareJobHandoff.tsx',
    'app/(onboarding)/account.tsx',
    'app/reset-password.tsx',
  ]) {
    assert.equal(
      read(file).includes("'/(auth)/sign-in'"),
      false,
      `${file} must route signed-out users to /(onboarding)/account`,
    );
  }

  // The hardcoded test-account path is gone repo-wide.
  for (const file of ['services/auth.ts', 'app/(onboarding)/account.tsx']) {
    assert.equal(read(file).includes('dev@nearr.test'), false, `${file} has no hardcoded account`);
  }
}

function run() {
  sharedPostAuthRouting();
  appleRules();
  googleRules();
  magicLinkPreserved();
  recoveryWiring();
  legacySignInRouteIsNeutralised();
  developerLoginIsUnchangedAndSeparate();
  analyticsAndLoggingAreSafe();
  accessibilityAndKeyboard();
  console.log('testAuthScreenContracts: all assertions passed');
}

run();
