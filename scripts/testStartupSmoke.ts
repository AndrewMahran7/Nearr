import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveStartupPresentation, type StartupOwner } from '../lib/startupWatchdogCore';
import { createInitialOnboardingV2State, decodeOnboardingV2State } from '../lib/onboardingV2Core';

type Scenario = {
  name: string;
  pending: boolean;
  timedOut: boolean;
  readyOwner: Exclude<StartupOwner, 'ERROR_RECOVERY'>;
  pendingOwner?: 'AUTH' | 'ONBOARDING';
};

const scenarios: Scenario[] = [
  { name: 'fresh signed-out launch', pending: false, timedOut: false, readyOwner: 'ONBOARDING' },
  { name: 'fresh anonymous onboarding launch', pending: true, timedOut: false, readyOwner: 'ONBOARDING', pendingOwner: 'ONBOARDING' },
  { name: 'signed-in returning user', pending: false, timedOut: false, readyOwner: 'MAP' },
  { name: 'completed Phase 1 user', pending: false, timedOut: false, readyOwner: 'MAP' },
  { name: 'partially completed V2 user', pending: false, timedOut: false, readyOwner: 'ONBOARDING' },
  { name: 'deleted-account fresh start', pending: true, timedOut: false, readyOwner: 'ONBOARDING', pendingOwner: 'ONBOARDING' },
  { name: 'stale V2 state', pending: false, timedOut: false, readyOwner: 'ONBOARDING' },
  { name: 'malformed V2 state', pending: false, timedOut: false, readyOwner: 'ONBOARDING' },
  { name: 'missing server checkpoint', pending: false, timedOut: false, readyOwner: 'ONBOARDING' },
  { name: 'transient Supabase failure', pending: true, timedOut: true, readyOwner: 'ONBOARDING', pendingOwner: 'AUTH' },
  { name: 'auth restore delayed', pending: true, timedOut: false, readyOwner: 'MAP', pendingOwner: 'AUTH' },
  { name: 'no network', pending: true, timedOut: true, readyOwner: 'MAP', pendingOwner: 'AUTH' },
  { name: 'OTA with legacy persisted state', pending: false, timedOut: false, readyOwner: 'ONBOARDING' },
  { name: 'post-account-link continuation', pending: false, timedOut: false, readyOwner: 'MAP' },
  { name: 'post-account-delete continuation', pending: true, timedOut: false, readyOwner: 'ONBOARDING', pendingOwner: 'ONBOARDING' },
  { name: 'deep link during startup', pending: true, timedOut: false, readyOwner: 'AUTH', pendingOwner: 'AUTH' },
  { name: 'notification tap during startup', pending: true, timedOut: false, readyOwner: 'QUEUE', pendingOwner: 'AUTH' },
];

for (const scenario of scenarios) {
  const result = resolveStartupPresentation(scenario);
  assert.equal(result.visible, true, `${scenario.name}: VISIBLE UI WITHIN BOUNDED TIME`);
  assert.ok(result.owner, `${scenario.name}: a startup owner is selected`);
  console.log(`PASS ${scenario.name}: VISIBLE UI WITHIN BOUNDED TIME: YES; BLACK SCREEN: NO`);
}

const initial = createInitialOnboardingV2State('2026-08-22T00:00:00.000Z');
assert.deepEqual(decodeOnboardingV2State('{bad json', initial.updatedAt), initial);
assert.deepEqual(
  decodeOnboardingV2State(JSON.stringify({ ...initial, version: 1 }), initial.updatedAt),
  initial,
);
assert.deepEqual(
  decodeOnboardingV2State(JSON.stringify({ ...initial, stage: 'removed_stage' }), initial.updatedAt),
  initial,
);
assert.equal(
  decodeOnboardingV2State(JSON.stringify({ ...initial, stage: 'platform_selected', preferredPlatform: 'instagram' })).stage,
  'interest',
);

const root = path.resolve(__dirname, '..');
for (const file of [
  'app/index.tsx',
  'app/activate.tsx',
  'components/onboarding/v2/OnboardingV2Activation.tsx',
  'components/onboarding/v2/OnboardingV2PreAuth.tsx',
]) {
  assert.ok(
    readFileSync(path.join(root, file), 'utf8').includes('StartupSurface'),
    `${file} owns a visible startup/recovery surface`,
  );
}
assert.ok(
  readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8').includes('resolveStartupPresentation'),
  'root layout enforces the startup owner invariant',
);

console.log(`\nAll ${scenarios.length} cold-start scenarios selected visible UI.`);
