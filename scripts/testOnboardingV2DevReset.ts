import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NEARR_DEV_SUPABASE_REF, type ResolvedEnvironment } from '../lib/appEnvironmentCore';
import {
  canRunOnboardingV2DevelopmentReset,
  isFreshOnboardingV2State,
  ONBOARDING_DEV_RESET_BLOCKED_NON_DEV,
  tutorialSavedPlaceIdForDevelopmentReset,
} from '../lib/onboardingV2DevResetCore';
import {
  createInitialOnboardingV2State,
  startOnboardingV2,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const runtime = read('lib/onboardingV2DevReset.ts');
const adapter = read('lib/onboardingV2.ts');
const settings = read('app/(tabs)/settings.tsx');
const rootLayout = read('app/_layout.tsx');

function environment(overrides: Partial<ResolvedEnvironment> = {}): ResolvedEnvironment {
  return {
    appEnv: 'development',
    backendEnv: 'development',
    appEnvWasDefaulted: false,
    backendEnvWasDefaulted: false,
    allowProductionBackend: false,
    supabaseHost: NEARR_DEV_SUPABASE_REF + '.supabase.co',
    supabaseProjectRef: NEARR_DEV_SUPABASE_REF,
    processShareLinkHost: null,
    createShareJobHost: null,
    ...overrides,
  };
}

assert.equal(canRunOnboardingV2DevelopmentReset(environment()), true);
for (const unsafe of [
  environment({ appEnv: 'production' }),
  environment({ appEnv: 'preview' }),
  environment({ backendEnv: 'production' }),
  environment({ appEnvWasDefaulted: true }),
  environment({ backendEnvWasDefaulted: true }),
  environment({ supabaseProjectRef: 'not-nearr-dev' }),
]) {
  assert.equal(canRunOnboardingV2DevelopmentReset(unsafe), false);
}
assert.ok(runtime.includes(ONBOARDING_DEV_RESET_BLOCKED_NON_DEV));
console.log('PASS reset is fail-closed outside an explicit Nearr-Dev lane');

const fresh = createInitialOnboardingV2State('2026-08-21T00:00:00.000Z');
assert.equal(isFreshOnboardingV2State(fresh), true);
const progressed: OnboardingV2State = {
  ...fresh,
  revision: 9,
  cohort: 'new_user_v2',
  stage: 'first_independent_save_complete',
  preferredPlatform: 'instagram',
  interest: 'food',
  tutorialContentId: 'tutorial-food',
  funnelSessionId: '11111111-1111-4111-8111-111111111111',
  identityLifecycle: 'anonymous_active',
  anonymousUserId: 'anonymous-user',
  boundUserId: 'anonymous-user',
  tutorialSave: {
    kind: 'tutorial',
    contentId: 'tutorial-food',
    sourceUrl: 'https://www.instagram.com/p/tutorial/',
    normalizedSourceUrl: 'https://instagram.com/p/tutorial',
    contentIdentity: { platform: 'instagram', contentId: 'tutorial' },
    savedPlaceId: 'tutorial-place',
    completedAt: '2026-08-21T00:00:01.000Z',
  },
  independentSaves: [{
    kind: 'independent_1',
    contentId: 'independent',
    sourceUrl: 'https://www.instagram.com/p/independent/',
    normalizedSourceUrl: 'https://instagram.com/p/independent',
    contentIdentity: { platform: 'instagram', contentId: 'independent' },
    savedPlaceId: 'unrelated-place',
    completedAt: '2026-08-21T00:00:02.000Z',
  }],
  behavioralCompletedAt: '2026-08-21T00:00:03.000Z',
};
assert.equal(isFreshOnboardingV2State(progressed), false);
assert.match(adapter, /removeItem\(ONBOARDING_V2_STORAGE_KEY\)/);
assert.match(adapter, /createInitialOnboardingV2State\(\)/);
assert.match(adapter, /publish\(initial\)/);
assert.match(adapter, /resetOnboardingV2LocalStateForDevelopment[\s\S]{0,300}canRunOnboardingV2DevelopmentReset/);
console.log('PASS reset replaces stage, choices, progress, completion, and identity with initial state');

const trusted = [{ id: 'tutorial-food', sourceUrl: 'https://www.instagram.com/p/tutorial/' }];
assert.equal(tutorialSavedPlaceIdForDevelopmentReset(progressed, trusted), 'tutorial-place');
assert.equal(
  tutorialSavedPlaceIdForDevelopmentReset(
    { ...progressed, tutorialSave: { ...progressed.tutorialSave!, sourceUrl: 'https://example.com/not-trusted' } },
    trusted,
  ),
  null,
);
assert.equal(
  tutorialSavedPlaceIdForDevelopmentReset(
    { ...progressed, tutorialSave: { ...progressed.tutorialSave!, kind: 'independent_1' } },
    trusted,
  ),
  null,
);
assert.match(runtime, /deleteSavedPlace\(tutorialSavedPlaceId\)/);
assert.doesNotMatch(runtime, /deleteSavedPlace\(state\.|\.from\(['"]saved_places['"]\)\.delete/);
console.log('PASS only a registry-verified tutorial saved-place id is eligible for deletion');

assert.match(runtime, /removeItem\(ONBOARDING_V2_ACCOUNT_TRANSFER_KEY\)/);
assert.match(runtime, /rotateOnboardingFunnelId\(\)/);
assert.match(runtime, /signOut\(\{ scope: 'local' \}\)/);
assert.match(runtime, /clearOfflineUserData\(priorUserId\)/);
assert.doesNotMatch(runtime + adapter, /AsyncStorage\.clear\(|multiRemove\(/);
for (const unrelatedKey of ['theme', 'notifications', 'analytics.anonymousId', 'demo_completed']) {
  assert.equal(runtime.includes(unrelatedKey), false, 'unrelated preference must remain untouched: ' + unrelatedKey);
}
console.log('PASS account credentials on other devices, unrelated preferences, and unrelated saves are preserved');

const resetIndex = runtime.indexOf('await resetOnboardingV2LocalStateForDevelopment()');
const signOutIndex = runtime.indexOf("await supabase.auth.signOut({ scope: 'local' })");
assert.ok(resetIndex > -1 && signOutIndex > resetIndex, 'local state is fresh before the auth event can remount onboarding');
assert.doesNotMatch(runtime, /from\(['"]onboarding_v2_sessions['"]\)[\s\S]{0,100}delete/);
console.log('PASS stale server progress is isolated by a new local auth and funnel identity without broad server deletion');

assert.match(settings, /const onboardingResetAvailable = isOnboardingV2DevelopmentResetAvailable\(\)/);
assert.match(settings, /\{onboardingResetAvailable \? \(/);
assert.match(settings, /title="Reset onboarding"/);
assert.match(settings, /Reset onboarding progress for this development app\?/);
assert.doesNotMatch(settings, /useEffect\([\s\S]{0,250}resetOnboardingV2ForDevelopment/);
console.log('PASS production UI cannot expose or automatically invoke the reset');

const welcome = startOnboardingV2(fresh, '2026-08-21T00:00:04.000Z').state;
assert.equal(welcome.stage, 'overview');
assert.match(settings, /router\.replace\('\/\(onboarding\)'\)/);
assert.match(rootLayout, /pendingOnboardingNavigationRef/);
assert.match(rootLayout, /shouldNavigateOnboarding/);
console.log('PASS reset relaunch begins at Welcome through the existing bounded navigation authority');

console.log('\nAll Onboarding V2 development reset contracts passed.');
