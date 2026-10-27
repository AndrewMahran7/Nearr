import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signedOutOnboardingV2Route } from '../lib/onboardingV2RoutingCore';

import {
  decideAuthResolutionRoute,
  routeAfterAuthenticatedUser,
} from '../lib/authDeepLinkCore';

/**
 * Pure routing tests for the post-account activation flow.
 *
 * A newly-authenticated user with no saved places ('required') must land on
 * the "Save your first place" activation screen; an established user
 * ('complete') goes straight to the map. Returning/existing users must never
 * be forced back through account creation.
 */
function run() {
  for (const stage of ['onboarding_complete', 'graduated', 'account_required'] as const) {
    assert.equal(signedOutOnboardingV2Route(stage), '/(onboarding)/account');
  }
  for (const stage of [null, undefined, 'overview', 'platform', 'tutorial_ready', 'place_tour', 'phase2_intro'] as const) {
    assert.equal(signedOutOnboardingV2Route(stage), '/(onboarding)', 'unfinished public practice remains available');
  }
  for (const file of ['app/index.tsx', 'app/_layout.tsx']) {
    assert.match(readFileSync(file, 'utf8'), /signedOutOnboardingV2Route\(onboardingV2\?\.stage\)/,
      `${file} must send a completed checkpoint with a revoked session to the account gateway`);
  }
  assert.equal(
    routeAfterAuthenticatedUser('required'),
    '/activate',
    'no-saves user should route to the activation screen',
  );
  assert.equal(
    routeAfterAuthenticatedUser('complete'),
    '/(tabs)/map',
    'established user should route to the map',
  );

  assert.equal(
    decideAuthResolutionRoute({
      hasSession: true,
      onboardingStatus: 'required',
      signedOutRoute: '/(onboarding)',
    }),
    '/activate',
    'session + required → activation',
  );
  assert.equal(
    decideAuthResolutionRoute({
      hasSession: true,
      onboardingStatus: 'complete',
      signedOutRoute: '/(onboarding)',
    }),
    '/(tabs)/map',
    'session + complete → map',
  );
  assert.equal(
    decideAuthResolutionRoute({
      hasSession: false,
      onboardingStatus: 'required',
      signedOutRoute: '/(onboarding)',
    }),
    '/(onboarding)',
    'no session → signed-out route (onboarding landing)',
  );
  assert.equal(
    decideAuthResolutionRoute({
      hasSession: false,
      onboardingStatus: 'complete',
      signedOutRoute: '/(auth)/sign-in',
    }),
    '/(auth)/sign-in',
    'no session → signed-out route (sign-in)',
  );

  console.log('testOnboardingRouting: all assertions passed');
}

run();
