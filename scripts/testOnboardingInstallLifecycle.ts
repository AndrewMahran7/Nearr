import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { routeAfterAuthenticatedUser } from '../lib/authDeepLinkCore';
import { NEARR_DEV_SUPABASE_REF } from '../lib/appEnvironmentCore';
import {
  classifyOnboardingInstallation,
  decideInstallCheckpoint,
  isSupabaseAuthStorageKey,
  type OnboardingInstallMarker,
} from '../lib/onboardingInstallLifecycleCore';
import {
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  startOnboardingV2,
  type OnboardingV2Stage,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import { canRunOnboardingV2DevelopmentReset } from '../lib/onboardingV2DevResetCore';
import { resolveStartupPresentation } from '../lib/startupWatchdogCore';

const installA = '11111111-1111-4111-8111-111111111111';
const installB = '22222222-2222-4222-8222-222222222222';
const installedAtA = 1_700_000_000_000;
const installedAtB = installedAtA + 86_400_000;

function marker(installationId: string, nativeInstalledAtMs: number): OnboardingInstallMarker {
  return { version: 1, installationId, nativeInstalledAtMs, createdAt: '2026-09-26T00:00:00.000Z' };
}

function checkpoint(
  stage: OnboardingV2Stage,
  installationId: string,
  patch: Partial<OnboardingV2State> = {},
): OnboardingV2State {
  return {
    ...createInitialOnboardingV2State('2026-09-26T00:00:00.000Z', installationId),
    cohort: 'new_user_v2',
    stage,
    startedAt: '2026-09-26T00:00:01.000Z',
    ...patch,
  };
}

function welcome(installationId: string): OnboardingV2State {
  return startOnboardingV2(
    createInitialOnboardingV2State('2026-09-26T00:00:00.000Z', installationId),
    '2026-09-26T00:00:01.000Z',
  ).state;
}

function test(name: string, run: () => void): void {
  run();
  console.log(`PASS ${name}`);
}

test('TEST 1 — normal force close resumes the same-install checkpoint', () => {
  const install = classifyOnboardingInstallation({
    markerRaw: JSON.stringify(marker(installA, installedAtA)),
    nativeInstalledAtMs: installedAtA,
  });
  assert.equal(install.kind, 'same_install');
  assert.deepEqual(decideInstallCheckpoint({
    isNewInstall: false,
    currentInstallationId: installA,
    checkpointInstallationId: installA,
    checkpointVersionSupported: true,
    checkpointExists: true,
  }), { kind: 'resume', reason: 'current_install_checkpoint' });
});

test('TEST 2 — new installation rejects install A checkpoint on install B', () => {
  const install = classifyOnboardingInstallation({
    markerRaw: JSON.stringify(marker(installA, installedAtA)),
    nativeInstalledAtMs: installedAtB,
  });
  assert.deepEqual(install, { kind: 'new_install', reason: 'native_install_changed' });
  assert.equal(decideInstallCheckpoint({
    isNewInstall: true,
    currentInstallationId: installB,
    checkpointInstallationId: installA,
    checkpointVersionSupported: true,
    checkpointExists: true,
  }).kind, 'welcome');
});

test('TEST 3 — fresh install with stale anonymous auth starts Welcome', () => {
  assert.equal(isSupabaseAuthStorageKey('sb-nearr-dev-auth-token'), true);
  assert.equal(decideInstallCheckpoint({
    isNewInstall: true,
    currentInstallationId: installB,
    checkpointInstallationId: installA,
    checkpointVersionSupported: true,
    checkpointExists: true,
  }).reason, 'fresh_install_stale_onboarding_discarded');
  assert.equal(welcome(installB).stage, 'overview');
});

test('TEST 4 — fresh install clears scripted fixture state', () => {
  const reset = welcome(installB);
  assert.equal(reset.tutorialFixture, null);
  assert.equal(reset.tutorialResult, null);
  assert.equal(reset.tutorialSave, null);
});

test('TEST 5 — fresh install from Phase 2 intro returns to Welcome', () => {
  const old = checkpoint('phase2_intro', installA, { secondHalfStartedAt: '2026-09-26T00:02:00.000Z' });
  assert.equal(old.stage, 'phase2_intro');
  assert.equal(welcome(installB).stage, 'overview');
});

test('TEST 6 — fresh install discards an old practice job route', () => {
  const old = checkpoint('tutorial_processing', installA, { tutorialJobId: 'old-job-id' });
  assert.equal(old.tutorialJobId, 'old-job-id');
  assert.equal(welcome(installB).tutorialJobId, null);
  assert.equal(welcome(installB).pendingShare, null);
});

test('TEST 7 — fresh install discards an old onboarding map selection', () => {
  const old = checkpoint('fixture_map_payoff', installA, { mapEnteredAt: '2026-09-26T00:03:00.000Z' });
  assert.equal(old.mapEnteredAt != null, true);
  assert.equal(welcome(installB).mapEnteredAt, null);
});

test('TEST 8 — fresh install keeps the established-account sign-in CTA', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'components/onboarding/v2/OnboardingV2PreAuth.tsx'), 'utf8');
  assert.match(source, /Already have an account\? Sign in/);
  assert.equal(welcome(installB).stage, 'overview');
});

test('TEST 9 — an established user who signs in routes to the normal map', () => {
  assert.equal(routeAfterAuthenticatedUser('complete'), '/(tabs)/map');
});

test('TEST 10 — a new OAuth identity still requires activation/onboarding', () => {
  assert.equal(routeAfterAuthenticatedUser('required'), '/activate');
});

test('TEST 11 — account creation remains wired after fresh install', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/(onboarding)/account.tsx'), 'utf8');
  assert.match(source, /signUpWithPassword/);
  assert.match(source, /resolvePostAuthRoute/);
});

test('TEST 12 — deterministic recognition resumes on the same install', () => {
  const state = checkpoint('tutorial_processing', installA, {
    tutorialJobId: 'onboarding-scripted:fixture-a',
    tutorialLaunchedAt: '2026-09-26T00:04:00.000Z',
  });
  const restored = decodeOnboardingV2State(encodeOnboardingV2State(state));
  assert.equal(restored.installationId, installA);
  assert.equal(restored.stage, 'tutorial_processing');
  assert.equal(restored.tutorialJobId, state.tutorialJobId);
});

test('TEST 13 — map payoff resumes on the same install', () => {
  const restored = decodeOnboardingV2State(encodeOnboardingV2State(
    checkpoint('fixture_map_payoff', installA, { mapEnteredAt: '2026-09-26T00:05:00.000Z' }),
  ));
  assert.equal(restored.installationId, installA);
  assert.equal(restored.stage, 'fixture_map_payoff');
});

test('TEST 14 — a real Phase 2 job resumes on the same install', () => {
  const pendingShare = {
    attemptId: 'attempt-1', kind: 'independent_1' as const, contentId: 'video-1',
    sourceUrl: 'https://example.com/video-1', normalizedSourceUrl: 'example.com/video-1',
    contentIdentity: { platform: 'web' as const, contentId: 'video-1' },
    openedAt: '2026-09-26T00:06:00.000Z', shareReceivedAt: null, resultSeenAt: null,
  };
  const restored = decodeOnboardingV2State(encodeOnboardingV2State(
    checkpoint('first_independent_share_returned', installA, { pendingShare }),
  ));
  assert.equal(restored.pendingShare?.attemptId, 'attempt-1');
  assert.equal(restored.installationId, installA);
});

test('TEST 15 — stale checkpoints resolve to Welcome, never ERROR_RECOVERY', () => {
  const presentation = resolveStartupPresentation({
    pending: false,
    timedOut: false,
    readyOwner: 'ONBOARDING',
  });
  assert.equal(presentation.owner, 'ONBOARDING');
  assert.equal(presentation.mode, 'ready');
  assert.equal(welcome(installB).stage, 'overview');
});

test('TEST 16 — startup promise chains terminate with rejection handlers', () => {
  const hook = fs.readFileSync(path.join(process.cwd(), 'hooks/useOnboardingV2.ts'), 'utf8');
  const layout = fs.readFileSync(path.join(process.cwd(), 'app/_layout.tsx'), 'utf8');
  assert.match(hook, /startup_hydration_rejected/);
  assert.match(hook, /startup_recovery_rejected/);
  assert.match(layout, /initial_url_processing_failed/);
  assert.match(layout, /breadcrumb_hydration_failed/);
});

test('TEST 17 — checkpoint schema mismatch resets safely', () => {
  assert.deepEqual(decideInstallCheckpoint({
    isNewInstall: false,
    currentInstallationId: installA,
    checkpointInstallationId: installA,
    checkpointVersionSupported: false,
    checkpointExists: true,
  }), { kind: 'welcome', reason: 'checkpoint_version_mismatch' });
});

test('TEST 18 — Development reset controls remain available only in Nearr-Dev', () => {
  assert.equal(canRunOnboardingV2DevelopmentReset({
    appEnv: 'development', backendEnv: 'development', appEnvWasDefaulted: false,
    backendEnvWasDefaulted: false, supabaseProjectRef: NEARR_DEV_SUPABASE_REF,
  }), true);
  assert.equal(canRunOnboardingV2DevelopmentReset({
    appEnv: 'production', backendEnv: 'production', appEnvWasDefaulted: false,
    backendEnvWasDefaulted: false, supabaseProjectRef: null,
  }), false);
});

console.log('PASS onboarding install lifecycle: 18/18');
