import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { shouldPreserveCompletedOnboardingTab } from '../lib/onboardingV2RoutingCore';

const completedAt = '2026-09-10T20:00:00.000Z';

assert.equal(shouldPreserveCompletedOnboardingTab({
  currentRoute: '/(tabs)/settings',
  stage: 'onboarding_complete',
  behavioralCompletedAt: completedAt,
}), true, 'completed anonymous users keep Settings ownership');

assert.equal(shouldPreserveCompletedOnboardingTab({
  currentRoute: '/(tabs)/map',
  stage: 'onboarding_complete',
  behavioralCompletedAt: completedAt,
}), true, 'completed map ownership is already converged');

assert.equal(shouldPreserveCompletedOnboardingTab({
  currentRoute: '/(tabs)/settings',
  stage: 'activation_challenge',
  behavioralCompletedAt: null,
}), false, 'an unfinished checkpoint still reconciles to its owning route');

assert.equal(shouldPreserveCompletedOnboardingTab({
  currentRoute: '/(onboarding)',
  stage: 'onboarding_complete',
  behavioralCompletedAt: completedAt,
}), false, 'a completed checkpoint can still leave onboarding for the map');

const layout = readFileSync(join(process.cwd(), 'app/_layout.tsx'), 'utf8');
assert.match(layout, /shouldPreserveCompletedOnboardingTab\(/);
assert.match(layout, /if \(shouldPreserveCompletedOnboardingTab\([\s\S]{0,260}\)\) return;/);

console.log('PASS completed anonymous onboarding no longer hijacks Map ↔ Settings navigation');
