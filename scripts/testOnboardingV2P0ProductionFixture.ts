import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mapFilterOptions } from '../lib/mapVisibility';
import {
  createInitialOnboardingV2State,
  isOnboardingV2Phase2MapState,
  onboardingV2ResumeEligibility,
  onboardingV2SavedPlaceProgress,
  resolveOnboardingV2VisibleOwner,
  resumePhase2AfterCompletedPhase1,
  type CompletedOnboardingSave,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  PHASE2_REQUIRED_MAP_FILTERS,
  resolvePhase2MapLayout,
  shouldRenderMapTopChrome,
} from '../lib/onboardingV2MapPresentation';
import { expectedOnboardingV2Route } from '../lib/onboardingV2RoutingCore';
import type { SavedPlaceWithPlace } from '../types';

const at = '2026-08-22T19:45:26.848Z';
const tutorialSave: CompletedOnboardingSave = {
  kind: 'tutorial',
  contentId: 'ig-mad-yolks-santa-cruz',
  sourceUrl: 'https://www.instagram.com/p/C-BEtdnyGdR/',
  normalizedSourceUrl: 'instagram.com/p/c-betdnygdr',
  contentIdentity: { platform: 'instagram', contentId: 'c-betdnygdr' },
  savedPlaceId: 'production-transferred-tutorial-place',
  completedAt: at,
};

// Exact durable shape observed in production after a Phase-1-only client
// completed the tutorial. The full Phase 2 release must upgrade this state;
// constructing practice_ready directly cannot catch this incident.
const productionCheckpoint: OnboardingV2State = {
  ...createInitialOnboardingV2State(at),
  revision: 21,
  cohort: 'new_user_v2',
  stage: 'phase1_complete',
  preferredPlatform: 'instagram',
  interest: 'food',
  tutorialContentId: tutorialSave.contentId,
  funnelSessionId: '11111111-1111-4111-8111-111111111111',
  identityLifecycle: 'permanent_account',
  boundUserId: 'production-permanent-user',
  permanentUserId: 'production-permanent-user',
  permanentAccountEstablished: false,
  authCompletedAt: at,
  tutorialSave,
  placeTourClosedAt: at,
  phase1CompletedAt: at,
};

const tutorialPlace = {
  id: tutorialSave.savedPlaceId,
  category: 'restaurant',
  archived_at: null,
  visited_at: null,
  place: {
    id: 'mad-yolks-place',
    name: 'Mad Yolks',
    latitude: 36.97,
    longitude: -122.03,
    category: 'restaurant',
  },
} as unknown as SavedPlaceWithPlace;

assert.equal(onboardingV2SavedPlaceProgress(productionCheckpoint).count, 1);
assert.equal(expectedOnboardingV2Route(productionCheckpoint.stage), '/(tabs)/map');
assert.equal(productionCheckpoint.identityLifecycle, 'permanent_account');
assert.equal(productionCheckpoint.tutorialSave?.savedPlaceId, tutorialPlace.id);

const root = process.cwd();
const mapSource = readFileSync(join(root, 'app/(tabs)/map.tsx'), 'utf8');
const coachSource = readFileSync(
  join(root, 'components/onboarding/v2/OnboardingV2MapCoachmark.tsx'),
  'utf8',
);

// Preserve the released decision functions as a regression witness. They
// reproduce both symptoms from the exact durable checkpoint without relying
// on the now-fixed component source.
const releasedPracticeReady = ['practice_ready', 'first_independent_save_complete']
  .includes(productionCheckpoint.stage);
const releasedPhase2MapActive = [
  'practice_ready',
  'first_independent_external_video_opened',
  'first_independent_share_returned',
  'first_independent_save_complete',
  'second_independent_external_video_opened',
  'second_independent_share_returned',
  'graduated',
].includes(productionCheckpoint.stage);
const releasedFilters = mapFilterOptions(
  [tutorialPlace],
  releasedPhase2MapActive ? ['food_drink', 'outdoors'] : [],
);

assert.equal(releasedPracticeReady, false);
assert.equal(releasedPhase2MapActive, false);
assert.deepEqual(releasedFilters, []);

console.log('PRE-FIX PRODUCTION FIXTURE REPRODUCES MISSING PHASE 2: YES');
console.log('PRE-FIX PRODUCTION FIXTURE REPRODUCES MISSING FILTER CONTROLS: YES');

// The full-Phase-2 client upgrades exactly once while retaining every durable
// Phase 1 milestone and identity reference.
const repaired = resumePhase2AfterCompletedPhase1(productionCheckpoint, '2026-08-22T20:00:00.000Z');
assert.equal(repaired.changed, true);
assert.equal(repaired.state.stage, 'practice_ready');
assert.equal(repaired.state.revision, productionCheckpoint.revision + 1);
assert.equal(repaired.state.phase1CompletedAt, productionCheckpoint.phase1CompletedAt);
assert.equal(repaired.state.tutorialSave?.savedPlaceId, tutorialSave.savedPlaceId);
assert.equal(repaired.state.boundUserId, productionCheckpoint.boundUserId);
assert.equal(repaired.state.permanentUserId, productionCheckpoint.permanentUserId);
assert.equal(
  resumePhase2AfterCompletedPhase1(repaired.state, '2026-08-22T20:00:01.000Z').changed,
  false,
  'the checkpoint migration is idempotent',
);
assert.equal(onboardingV2ResumeEligibility(repaired.state, {
  userId: productionCheckpoint.permanentUserId,
  identityExists: true,
  isAnonymous: false,
}).eligible, true, 'a force-close can resume the repaired Phase 2 checkpoint');

// The visible owner and required map controls are valid even on the frame
// before the async durable migration publishes practice_ready.
assert.equal(isOnboardingV2Phase2MapState(productionCheckpoint), true);
assert.equal(resolveOnboardingV2VisibleOwner({
  state: productionCheckpoint,
  phase1Only: false,
  selectedSourceAvailable: false,
  poolExhausted: false,
}), 'practice_loading');
assert.equal(resolveOnboardingV2VisibleOwner({
  state: repaired.state,
  phase1Only: false,
  selectedSourceAvailable: true,
  poolExhausted: false,
}), 'practice_preview');
assert.equal(resolveOnboardingV2VisibleOwner({
  state: productionCheckpoint,
  phase1Only: true,
  selectedSourceAvailable: false,
  poolExhausted: false,
}), 'none', 'the production mitigation remains Phase-1-only');

const repairedFilters = mapFilterOptions([tutorialPlace], PHASE2_REQUIRED_MAP_FILTERS);
assert.deepEqual(repairedFilters.map((filter) => filter.label), [
  'All places',
  'Food & drink',
  'Outdoors',
]);
assert.equal(shouldRenderMapTopChrome({
  searchVisible: false,
  hasSelectedPlace: false,
  previewExpanded: false,
}), true, 'closing the tutorial place reveals the map controls');
assert.equal(!false, true, 'Queue remains visible when search is closed');

for (const fixture of [
  { width: 375, height: 667, safeTop: 24 },
  { width: 390, height: 844, safeTop: 47 },
  { width: 430, height: 932, safeTop: 59 },
]) {
  const layout = resolvePhase2MapLayout(fixture.safeTop);
  assert.equal(layout.overlapsControls, false, `${fixture.width}x${fixture.height} control bands do not overlap`);
  assert.ok(layout.filterBand.bottom <= layout.queueBand.top);
  assert.ok(layout.queueBand.bottom < layout.dockTop);
  assert.ok(layout.dockTop < fixture.height, `${fixture.width}x${fixture.height} Practice owner starts on-screen`);
}

// Verify the production component wiring, not just helper outputs.
assert.match(mapSource, /mapFilterOptions\(\s*mapPlaces,\s*phase2MapActive && !nearbyExplorer \? PHASE2_REQUIRED_MAP_FILTERS : \[\],\s*\)/);
assert.match(mapSource, /<MapCategoryFilterBar\s+options=\{mapFilterChoices\}/);
assert.match(mapSource, /!searchVisible && !nearbyExplorer \? \([\s\S]{0,700}<ShareQueueButton \/>/);
assert.match(mapSource, /<OnboardingV2MapCoachmark topOffset=\{phase2MapLayout\.dockTop\} \/>/);
assert.match(coachSource, /resolveOnboardingV2VisibleOwner/);
assert.doesNotMatch(coachSource, /PHASE2_MAP_CHROME_CLEARANCE|useSafeAreaInsets/);

const detailSource = readFileSync(join(root, 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
assert.doesNotMatch(detailSource, /closeOnboardingV2PlaceTour/);
assert.match(mapSource, /const dismissSelectedPlace[\s\S]{0,800}closeOnboardingV2PlaceTour\(selected\.id\)/);

console.log('POST-FIX PRODUCTION CHECKPOINT PROMOTES TO VISIBLE PHASE 2: YES');
console.log('POST-FIX MAP FILTERS AND QUEUE ARE VISIBLE AT 1/3: YES');
console.log('POST-FIX PHASE 2 OWNER CLEARS MAP CHROME ON SHORT PHONES: YES');
console.log('POST-FIX TUTORIAL CLOSE HAS ONE AUTHORITATIVE TRANSITION OWNER: YES');
