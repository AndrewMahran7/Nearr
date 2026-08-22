import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ANONYMOUS_BOOTSTRAP_TIMEOUT_MS,
  decideAnonymousBootstrap,
} from '../lib/anonymousOnboardingCore';
import {
  bindAnonymousUser,
  completePermanentAccountLink,
  continueToTutorial,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  freshOnboardingV2StateAfterAccountDeletion,
  onboardingV2ResumeEligibility,
  onboardingV2SyncCredentialDecision,
  selectInterest,
  selectPlatform,
  startOnboardingV2,
  tapGetStarted,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import { expectedOnboardingV2Route, shouldNavigateOnboarding } from '../lib/onboardingV2RoutingCore';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const now = '2026-08-21T22:00:00.000Z';
const pass = (label: string) => console.log(`PASS ${label}`);

const permanent: OnboardingV2State = {
  ...createInitialOnboardingV2State(now),
  cohort: 'new_user_v2',
  stage: 'place_tour',
  identityLifecycle: 'permanent_account',
  boundUserId: 'deleted-user',
  permanentUserId: 'deleted-user',
  permanentAccountEstablished: false,
  funnelSessionId: '11111111-1111-4111-8111-111111111111',
};

// 1-2. Confirmed deletion is a hard boundary whose routable state is Welcome.
const afterDelete = freshOnboardingV2StateAfterAccountDeletion(permanent, now);
assert.equal(afterDelete.stage, 'not_started');
assert.equal(afterDelete.identityLifecycle, 'none');
assert.equal(expectedOnboardingV2Route(afterDelete.stage), '/(onboarding)');
pass('1 permanent account -> deletion clears identity-bound journey');
pass('2 fresh V2 Welcome owns the post-delete route');

// 3-4. A real anonymous auth session is required and carries the authenticated role.
let local = startOnboardingV2(afterDelete, now).state;
assert.equal(decideAnonymousBootstrap({
  sessionUserId: null,
  sessionIsAnonymous: false,
  state: local,
}), 'create_anonymous_session');
local = bindAnonymousUser(local, 'fresh-anonymous', local.funnelSessionId ?? 'fresh-funnel', now).state;
assert.equal(onboardingV2SyncCredentialDecision(local, {
  userId: 'fresh-anonymous',
  accessToken: 'real-jwt',
}).allowed, true);
const migration = read('supabase/migrations/20260822000001_anonymous_onboarding_v2.sql');
assert.match(migration, /grant execute on function public\.upsert_onboarding_v2_session[\s\S]*to authenticated/);
pass('3 fresh anonymous bootstrap requires a valid Supabase session');
pass('4 authenticated-role anonymous JWT can execute checkpoint RPC by contract');

// 5-7. Local checkpoint persistence remains authoritative through mutations/reload.
const encodedWelcome = encodeOnboardingV2State(local);
assert.equal(decodeOnboardingV2State(encodedWelcome, now).stage, 'overview');
local = tapGetStarted(local, now).state;
local = selectPlatform(local, 'instagram', now).state;
local = selectInterest(local, 'food', 'ig-mad-yolks-santa-cruz', now).state;
local = continueToTutorial(local, now).state;
const restored = decodeOnboardingV2State(encodeOnboardingV2State(local), now);
assert.equal(restored.stage, 'tutorial_ready');
assert.equal(restored.preferredPlatform, 'instagram');
assert.equal(restored.interest, 'food');
assert.equal(decideAnonymousBootstrap({
  sessionUserId: 'fresh-anonymous',
  sessionIsAnonymous: true,
  state: restored,
}), 'use_anonymous_session');
pass('5 fresh checkpoint persists');
pass('6 platform/category/tutorial mutations persist locally');
pass('7 force-close with restored anonymous JWT resumes tutorial');

// 8. The deleted permanent identity never qualifies for resume.
assert.equal(onboardingV2ResumeEligibility(permanent, {
  userId: 'deleted-user', identityExists: false, isAnonymous: false,
}).eligible, false);
pass('8 deleted identity cannot resume');

// 9-10. Token loss before the real save self-heals and never renders empty UI.
assert.equal(decideAnonymousBootstrap({
  sessionUserId: null,
  sessionIsAnonymous: false,
  state: restored,
}), 'restart_with_new_anonymous_session');
assert.deepEqual(onboardingV2SyncCredentialDecision(restored, null), {
  allowed: false,
  reason: 'session_missing',
});
const preAuth = read('components/onboarding/v2/OnboardingV2PreAuth.tsx');
assert.match(preAuth, /<StartupSurface/);
assert.match(preAuth, /useStartupWatchdog/);
assert.match(preAuth, /ANONYMOUS_BOOTSTRAP_TIMEOUT_MS/);
assert.doesNotMatch(preAuth, /return <View style=\{styles\.loading\} \/>/);
assert.equal(ANONYMOUS_BOOTSTRAP_TIMEOUT_MS, 12_000);
const adapter = read('lib/onboardingV2.ts');
assert.ok(adapter.indexOf('publish(result.state)') < adapter.indexOf('syncStateToServer(result.state'));
assert.match(adapter, /server_sync_skipped/);
pass('9 missing JWT cannot leave an empty black onboarding surface');
pass('10 transient sync failure retains usable local onboarding');

// 11-12. Welcome is converged and root navigation still has one guarded owner.
let pending = null;
let transitions = 0;
for (let render = 0; render < 50; render += 1) {
  const route = expectedOnboardingV2Route(afterDelete.stage);
  if (shouldNavigateOnboarding({ currentRoute: '/(onboarding)', expectedRoute: route, pendingNavigation: pending })) {
    transitions += 1;
    pending = route ? { from: '/(onboarding)' as const, to: route } : null;
  }
}
assert.equal(transitions, 0);
const root = read('app/_layout.tsx');
assert.equal((root.match(/expectedOnboardingV2Route\(/g) ?? []).length, 1);
assert.match(root, /pendingOnboardingNavigationRef/);
pass('11 post-delete route does not ping-pong');
pass('12 maximum-update-depth single-authority fix is preserved');

// 13-15. Existing reset/link/resume behavior remains present.
assert.match(read('lib/onboardingV2DevReset.ts'), /resetOnboardingV2LocalStateForDevelopment/);
const linked = completePermanentAccountLink({
  ...restored,
  stage: 'account_required',
  tutorialSave: {
    kind: 'tutorial', contentId: 'tutorial', sourceUrl: 'https://instagram.com/p/tutorial',
    normalizedSourceUrl: 'instagram.com/p/tutorial', contentIdentity: null,
    savedPlaceId: 'tutorial-save', completedAt: now,
  },
}, {
  permanentUserId: 'permanent-user',
  destinationWasEstablished: false,
  tutorialSavedPlaceId: 'tutorial-save',
}, now).state;
assert.equal(linked.stage, 'place_tour');
assert.equal(decodeOnboardingV2State(encodeOnboardingV2State(restored), now).stage, 'tutorial_ready');
pass('13 development reset remains available');
pass('14 normal account linking remains valid');
pass('15 normal force-quit resume remains valid');

// 16. No-session traffic retains the minimum-deny privilege boundary.
assert.match(migration, /revoke all on function public\.upsert_onboarding_v2_session[\s\S]*from public, anon/);
assert.doesNotMatch(migration, /grant execute on function public\.upsert_onboarding_v2_session[\s\S]*to anon/);
const accountService = read('services/accountService.ts');
assert.match(accountService, /clearDeletedAccountSession/);
assert.match(read('services/auth.ts'), /signOut\(\{ scope: 'local' \}\)/);
const anonymousAdapter = read('lib/anonymousOnboarding.ts');
assert.ok(
  anonymousAdapter.indexOf('waitForAccountDeletionCleanup()') <
  anonymousAdapter.indexOf('supabase.auth.getSession()'),
  'replacement auth must wait until deletion cleanup releases its barrier',
);
pass('16 unauthenticated RPC remains denied and deletion clears only the dead local session');

console.log('\nAll post-delete black-screen regression scenarios passed.');
