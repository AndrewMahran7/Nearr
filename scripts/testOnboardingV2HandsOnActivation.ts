import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  completePendingSave,
  createInitialOnboardingV2State,
  openExternalStarter,
  receiveSharedSource,
  recordOnboardingMapEntered,
  resumeDeferredOnboardingPractice,
  type CompletedOnboardingSave,
  type OnboardingTutorialFixture,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';

const at = (n: number) => `2026-09-10T20:00:${String(n).padStart(2, '0')}.000Z`;
const tutorial: CompletedOnboardingSave = {
  kind: 'tutorial', contentId: 'C9Z963muLHI', sourceUrl: 'https://www.instagram.com/reel/C9Z963muLHI/',
  normalizedSourceUrl: 'instagram.com/reel/c9z963mulhi', contentIdentity: { platform: 'instagram', contentId: 'c9z963mulhi' },
  savedPlaceId: 'dorset', completedAt: at(1),
};
const practice: OnboardingTutorialFixture = {
  id: '2b6fc7fe-2d88-46e8-a8ae-140680862da7', revision: 1, role: 'backup', platform: 'instagram',
  identityKey: 'v1:instagram:DUWyZkfgbT4', identityVersion: 1, contentId: 'DUWyZkfgbT4',
  canonicalUrl: 'https://www.instagram.com/reel/DUWyZkfgbT4/', launchUrl: 'https://www.instagram.com/reel/DUWyZkfgbT4/',
  thumbnailUrl: null, selectedAt: at(2),
};
const completed: OnboardingV2State = {
  ...createInitialOnboardingV2State(at(0)), cohort: 'new_user_v2', stage: 'onboarding_complete',
  startedAt: at(0), funnelSessionId: '11111111-1111-4111-8111-111111111111', preferredPlatform: 'instagram',
  identityLifecycle: 'anonymous_active', anonymousUserId: 'anon', boundUserId: 'anon', tutorialSave: tutorial,
  tutorialContentId: tutorial.contentId, practiceFixture: practice, practiceContentIds: [practice.contentId],
  behavioralCompletedAt: at(10), onboardingV2CompletedAt: at(10), activationChoice: 'explore_map',
};

let transition = recordOnboardingMapEntered(completed, false, at(11));
assert.equal(transition.changed, false, 'a loading/empty dataset is not called a usable map');
transition = recordOnboardingMapEntered(completed, true, at(12));
assert.equal(transition.state.mapEnteredAt, at(12));
assert.equal(transition.events[0]?.name, 'onboarding_map_entered');
assert.equal(recordOnboardingMapEntered(transition.state, true, at(13)).changed, false, 'map entry is recorded once');

let state = resumeDeferredOnboardingPractice(completed, at(14)).state;
assert.equal(state.stage, 'practice_ready');
assert.equal(state.behavioralCompletedAt, at(10), 'quiet practice does not undo completed onboarding');
state = openExternalStarter(state, { contentId: practice.contentId, sourceUrl: practice.canonicalUrl }, at(15)).state;
state = receiveSharedSource(state, practice.canonicalUrl, at(16)).state;
state = completePendingSave(state, { sourceUrl: practice.canonicalUrl, savedPlaceId: 'capones' }, at(17)).state;
assert.equal(state.stage, 'onboarding_complete', 'late practice returns to the existing map instead of replaying onboarding');
assert.equal(state.independentSaves.length, 1);
assert.equal(state.behavioralCompletedAt, at(10));

const root = process.cwd();
const preAuth = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2PreAuth.tsx'), 'utf8');
const immersive = readFileSync(join(root, 'components/onboarding/v2/ImmersiveGuidedSave.tsx'), 'utf8');
const secondHalf = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2SecondHalf.tsx'), 'utf8');
const coach = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2MapCoachmark.tsx'), 'utf8');
const map = readFileSync(join(root, 'app/(tabs)/map.tsx'), 'utf8');

const forwardProgress = [0.14, 0.22, 0.3, 0.34, 0.38, 0.44, 0.5, 0.56, 0.6, 0.68, 0.73, 0.8, 0.84, 0.87, 0.93, 1];
assert.deepEqual([...forwardProgress].sort((a, b) => a - b), forwardProgress);
for (const marker of ['progress={0.38}', 'progress={0.6}', 'progress={0.68}']) assert.match(preAuth, new RegExp(marker.replace(/[{}\.]/g, '\\$&')));
for (const marker of ['tutorial_ready: 0.44', 'tutorial_share_tapped: 0.5', 'tutorial_more_tapped: 0.56']) assert.match(immersive, new RegExp(marker.replace('.', '\\.')));
for (const marker of ['progress={0.73}', 'progress={0.8}', 'progress={0.84}', 'progress={0.87}', 'progress={0.93}', 'progress={1}']) assert.match(secondHalf, new RegExp(marker.replace(/[{}\.]/g, '\\$&')));
assert.doesNotMatch(secondHalf, /Linking\.openURL\(url\)|instagram\.com\/['"]/i, 'final activation never opens a generic social feed');
assert.match(secondHalf, /router\.replace\('\/\(tabs\)\/map'\)/, 'final exit opens the ordinary map without a repeated focus instruction');
assert.match(coach, /Practice sharing/);
assert.match(map, /recordOnboardingV2MapEntered\(liveData\.some/);
assert.match(preAuth, /onboardingTutorialSourceAsset\(state\.tutorialFixture\.contentId\)/);
assert.doesNotMatch(preAuth, /ONE LAST CHOICE|Favorites yet/);
assert.match(immersive, /useWindowDimensions/);
assert.match(immersive, /minHeight: 84|width: 50, height: 50/);
assert.match(preAuth, /useOnboardingReduceMotion/);
assert.match(secondHalf, /EXAMPLE · NOT LIVE DISTANCE/);

console.log('PASS pacing, late-practice recovery, truthful map handoff, accessibility, and final activation');
