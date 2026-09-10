import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  advanceOnboardingSharingRehearsal,
  beginOnboardingInAppTutorialResolution,
  beginOnboardingSharingRehearsal,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  type OnboardingTutorialFixture,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';

const fixture: OnboardingTutorialFixture = {
  id: '93b1ded0-02ae-49c6-a03f-1786162fde2f', revision: 8, role: 'primary', platform: 'instagram',
  identityKey: 'v1:instagram:C9Z963muLHI', identityVersion: 1, contentId: 'C9Z963muLHI',
  canonicalUrl: 'https://www.instagram.com/reel/C9Z963muLHI/', launchUrl: 'https://www.instagram.com/reel/C9Z963muLHI/',
  thumbnailUrl: null, selectedAt: '2026-09-10T12:00:00.000Z',
};
const at = (second: number) => `2026-09-10T12:00:${String(second).padStart(2, '0')}.000Z`;
let state: OnboardingV2State = {
  ...createInitialOnboardingV2State(at(0)), cohort: 'new_user_v2', stage: 'tutorial_challenge', tutorialFixture: fixture,
};

state = beginOnboardingSharingRehearsal(state, at(1)).state;
assert.equal(state.stage, 'tutorial_ready');
assert.equal(advanceOnboardingSharingRehearsal(state, 'more', at(2)).changed, false, 'out-of-order tap cannot advance');
state = advanceOnboardingSharingRehearsal(state, 'share', at(3)).state;
assert.equal(state.stage, 'tutorial_share_tapped');
const resumed = decodeOnboardingV2State(encodeOnboardingV2State(state), at(4));
assert.equal(resumed.stage, 'tutorial_share_tapped', 'restart resumes the exact lesson substep');
state = advanceOnboardingSharingRehearsal(resumed, 'more', at(5)).state;
assert.equal(state.stage, 'tutorial_more_tapped');
const submitted = beginOnboardingInAppTutorialResolution(state, at(6));
assert.equal(submitted.state.stage, 'tutorial_processing');
assert.equal(submitted.events.some((event) => event.name === 'onboarding_sharing_rehearsal_completed'), true);
assert.equal(submitted.events.some((event) => event.name === 'real_share_completed'), false, 'rehearsal never impersonates a real external share');

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const rehearsal = read('components/onboarding/v2/ImmersiveGuidedSave.tsx');
assert.match(rehearsal, /PRACTICE INSIDE NEARR/);
assert.match(rehearsal, /platformKey === 'instagram' \? 'send'/, 'Instagram uses its send affordance');
assert.match(rehearsal, /Share to…/);
assert.match(rehearsal, /NearrAppIcon/);
assert.doesNotMatch(rehearsal, /setTimeout|setInterval/, 'no timer can finish the lesson');
assert.doesNotMatch(rehearsal, /FavoritesSheet|Add Nearr to Favorites/, 'lesson does not invent Favorites editing');
assert.match(read('lib/onboardingTutorialSourceAsset.ts'), /C9Z963muLHI[\s\S]*dorset-quarry-source-frame\.jpg/);

const map = read('app/(tabs)/map.tsx');
assert.match(map, /setSheetMode\('saved'\)/);
assert.match(map, /onboardingV2State\?\.stage === 'place_tour'[\s\S]{0,220}recordOnboardingV2PlaceTourOpened\(item\.id\)/);
assert.match(read('components/AutoSaveUndoToast.tsx'), /guidedSaveOwnsConfirmation/);

console.log('PASS hands-on rehearsal order, durable resume, truthful analytics, exact-source creative, and saved-card retrieval');
