import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NEARR_DEV_SUPABASE_REF, type ResolvedEnvironment } from '../lib/appEnvironmentCore';
import {
  canRunOnboardingV2DevelopmentReset,
  isFreshOnboardingV2State,
  ONBOARDING_DEV_RESET_BLOCKED_NON_DEV,
} from '../lib/onboardingV2DevResetCore';
import { createInitialOnboardingV2State, type OnboardingV2State } from '../lib/onboardingV2Core';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const runtime = read('lib/onboardingV2DevReset.ts');
const adapter = read('lib/onboardingV2.ts');
const settings = read('app/(tabs)/settings.tsx');
const fallback = read('app/dev-qa.tsx');
const resetEdge = read('supabase/functions/reset-onboarding-qa/index.ts');
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
]) assert.equal(canRunOnboardingV2DevelopmentReset(unsafe), false);
assert.ok(runtime.includes(ONBOARDING_DEV_RESET_BLOCKED_NON_DEV));
assert.match(resetEdge, /qnfxnmvxpjzfydgudtvs\.supabase\.co/);
assert.match(resetEdge, /if \(!isDevelopmentDeployment\(supabaseUrl\)\).*404/);
console.log('PASS reset is fail-closed in both client and server outside explicit Nearr-Dev');

const fresh = createInitialOnboardingV2State('2026-09-10T00:00:00.000Z');
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
    completedAt: '2026-09-10T00:00:01.000Z',
  },
  independentSaves: [],
  behavioralCompletedAt: '2026-09-10T00:00:03.000Z',
};
assert.equal(isFreshOnboardingV2State(fresh), true);
assert.equal(isFreshOnboardingV2State(progressed), false);
assert.match(adapter, /removeItem\(ONBOARDING_V2_STORAGE_KEY\)/);
assert.match(adapter, /createInitialOnboardingV2State\(\)/);
assert.match(runtime, /resetOnboardingV2LocalStateForDevelopment\(\)/);
assert.match(runtime, /resetOnboarding\(userId\)/);
assert.match(runtime, /removeItem\(ONBOARDING_V2_ACCOUNT_TRANSFER_KEY\)/);
assert.match(runtime, /rotateOnboardingFunnelId\(\)/);
console.log('PASS both actions clear V2 state, completion, transfer, fixture attempts, and pending navigation');

assert.match(runtime, /resetOnboardingV2OnlyForDevelopment/);
assert.match(runtime, /functions\.invoke\('reset-onboarding-qa'/);
assert.match(resetEdge, /auth\.getUser\(accessToken\)/);
assert.match(resetEdge, /from\('onboarding_v2_sessions'\)[\s\S]*\.delete\(\)[\s\S]*\.eq\('user_id', userData\.user\.id\)/);
assert.doesNotMatch(resetEdge, /from\('(saved_places|share_jobs|profiles)'\)[\s\S]*\.delete\(/);
assert.doesNotMatch(runtime, /deleteSavedPlace|deleteAccount|auth\.admin/);
console.log('PASS onboarding-only reset removes only token-owned server checkpoints and preserves product data');

assert.match(runtime, /resetOnboardingV2WithFreshAnonymousUserForDevelopment/);
assert.match(runtime, /signOut\(\{ scope: 'local' \}\)/);
assert.match(runtime, /clearOfflineUserData\(priorUserId\)/);
assert.match(runtime, /bootstrapFreshAnonymous\(priorUserId\)/);
assert.match(runtime, /bootstrap\.user\.id === priorUserId/);
assert.match(runtime, /priorWasAnonymous\) await removeOwnedServerSessions/);
assert.match(runtime, /serverData: priorWasAnonymous \? 'onboarding_sessions_removed' : 'prior_identity_preserved'/);
assert.doesNotMatch(runtime + adapter, /AsyncStorage\.clear\(|multiRemove\(/);
console.log('PASS fresh-user reset rotates auth locally without deleting permanent accounts or unrelated data');

assert.match(settings, /title="Reset onboarding only"/);
assert.match(settings, /title="Fresh anonymous QA user"/);
assert.match(settings, /title="Open standalone QA reset"/);
assert.match(fallback, /nearr:\/\/dev-qa/);
assert.match(fallback, /if \(!isOnboardingV2DevelopmentResetAvailable\(\)\) return <Redirect href="\/"/);
assert.match(rootLayout, /inDevelopmentQa[\s\S]*isOnboardingV2DevelopmentResetAvailable\(\)\) return/);
assert.match(rootLayout, /<Stack\.Screen name="dev-qa"/);
assert.doesNotMatch(settings, /useEffect\([\s\S]{0,250}resetOnboardingV2/);
console.log('PASS Settings and the independent direct route expose guarded explicit reset choices');

assert.match(settings, /router\.replace\('\/\(onboarding\)'\)/);
assert.match(fallback, /router\.replace\('\/\(onboarding\)'\)/);
assert.match(rootLayout, /pendingOnboardingNavigationRef/);
assert.match(rootLayout, /shouldNavigateOnboarding/);
console.log('PASS successful reset returns to Welcome through the bounded navigation authority');

console.log('\nAll Onboarding V2 development reset contracts passed.');
