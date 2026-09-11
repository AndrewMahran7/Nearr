import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  shouldNavigateOnboarding,
  shouldPreserveCompletedOnboardingTab,
  shouldPreserveOnboardingV2ProductRoute,
} from '../lib/onboardingV2RoutingCore';

const completedAt = '2026-09-10T20:00:00.000Z';

assert.equal(shouldPreserveCompletedOnboardingTab({
  currentRoute: '/(tabs)/settings', stage: 'onboarding_complete', behavioralCompletedAt: completedAt,
}), true, 'completed anonymous users keep Settings ownership');
assert.equal(shouldPreserveCompletedOnboardingTab({
  currentRoute: '/(onboarding)', stage: 'onboarding_complete', behavioralCompletedAt: completedAt,
}), false, 'a completed checkpoint can still leave onboarding for the map');

const mapOwnedStages = [
  'place_tour', 'phase1_complete', 'practice_ready',
  'first_independent_external_video_opened', 'first_independent_share_returned',
  'first_independent_save_complete', 'second_independent_external_video_opened',
  'second_independent_share_returned', 'graduated', 'onboarding_complete',
] as const;

for (const stage of mapOwnedStages) {
  for (const currentRoute of [
    '/(tabs)/settings', '/(tabs)/map', '/share-jobs', '/share-jobs/job-1', '/place/place-1',
  ]) {
    assert.equal(shouldPreserveOnboardingV2ProductRoute({ currentRoute, stage }), true,
      `${stage} preserves ${currentRoute}`);
  }
}

for (const currentRoute of ['/', '/(onboarding)', '/(onboarding)/account', '/(auth)/sign-in', '/activate']) {
  assert.equal(shouldPreserveOnboardingV2ProductRoute({ currentRoute, stage: 'practice_ready' }), false,
    `stale flow route ${currentRoute} still reconciles`);
}
assert.equal(shouldPreserveOnboardingV2ProductRoute({
  currentRoute: '/share-jobs', stage: 'activation_challenge',
}), false, 'pre-map onboarding still owns its expected screen');

for (let render = 0; render < 5; render += 1) {
  assert.equal(shouldPreserveOnboardingV2ProductRoute({
    currentRoute: '/share-jobs', stage: 'first_independent_share_returned',
  }), true);
}

assert.equal(shouldNavigateOnboarding({
  currentRoute: '/(onboarding)', expectedRoute: '/(tabs)/map', pendingNavigation: null,
}), true);
assert.equal(shouldNavigateOnboarding({
  currentRoute: '/(onboarding)', expectedRoute: '/(tabs)/map',
  pendingNavigation: { from: '/(onboarding)', to: '/(tabs)/map' },
}), false);

const layout = readFileSync(join(process.cwd(), 'app/_layout.tsx'), 'utf8');
const queueButton = readFileSync(join(process.cwd(), 'components/map/ShareQueueButton.tsx'), 'utf8');
const tabs = readFileSync(join(process.cwd(), 'app/(tabs)/_layout.tsx'), 'utf8');
const queue = readFileSync(join(process.cwd(), 'app/share-jobs/index.tsx'), 'utf8');
const settings = readFileSync(join(process.cwd(), 'app/(tabs)/settings.tsx'), 'utf8');
assert.match(layout, /shouldPreserveCompletedOnboardingTab\(/);
assert.match(layout, /shouldPreserveOnboardingV2ProductRoute\(/);
assert.match(layout, /recordOnboardingV2RouteDiagnostic\('auth_route_decision'/);
assert.match(queueButton, /recordOnboardingV2RouteDiagnostic\('route_request'/);
assert.match(tabs, /tabPress:[\s\S]{0,220}route_request/);
assert.match(queue, /screen_mounted[\s\S]{0,120}\/share-jobs/);
assert.match(settings, /screen_mounted[\s\S]{0,120}\(tabs\)\/settings/);

console.log('PASS map-owned onboarding preserves Settings, Queue, product routes, refresh, and repeated renders');
