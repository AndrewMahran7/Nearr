import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  filterPlacesForMap,
  mapFilterOptions,
} from '../lib/mapVisibility';
import {
  createInitialOnboardingV2State,
  encodeOnboardingV2State,
  isOnboardingV2Phase2MapState,
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

const at = '2026-08-22T12:00:00.000Z';

function completedSave(
  kind: CompletedOnboardingSave['kind'],
  contentId: string,
  savedPlaceId: string,
): CompletedOnboardingSave {
  const sourceUrl = `https://www.instagram.com/p/${contentId}/`;
  return {
    kind,
    contentId,
    sourceUrl,
    normalizedSourceUrl: `instagram.com/p/${contentId}`,
    contentIdentity: { platform: 'instagram', contentId },
    savedPlaceId,
    completedAt: at,
  };
}

const tutorialSave = completedSave('tutorial', 'mad-yolks', 'saved-food');
const oneOfThree: OnboardingV2State = {
  ...createInitialOnboardingV2State(at),
  cohort: 'new_user_v2',
  stage: 'practice_ready',
  preferredPlatform: 'instagram',
  interest: 'food',
  tutorialContentId: tutorialSave.contentId,
  funnelSessionId: '11111111-1111-4111-8111-111111111111',
  identityLifecycle: 'permanent_account',
  boundUserId: 'permanent-user',
  permanentUserId: 'permanent-user',
  tutorialSave,
};
const twoOfThree: OnboardingV2State = {
  ...oneOfThree,
  stage: 'first_independent_save_complete',
  independentSaves: [completedSave('independent_1', 'coastal-trail', 'saved-outdoors')],
};

function place(id: string, category: string): SavedPlaceWithPlace {
  return {
    id,
    category,
    archived_at: null,
    visited_at: null,
    place: {
      id: `place-${id}`,
      name: id,
      latitude: 36.97,
      longitude: -122.03,
      category,
    },
  } as unknown as SavedPlaceWithPlace;
}

const food = place('saved-food', 'restaurant');
const outdoors = place('saved-outdoors', 'beach');

function provePhase2Filters(
  state: OnboardingV2State,
  places: SavedPlaceWithPlace[],
  expectedProgress: 1 | 2,
) {
  assert.equal(onboardingV2SavedPlaceProgress(state).count, expectedProgress);
  assert.equal(expectedOnboardingV2Route(state.stage), '/(tabs)/map');
  const options = mapFilterOptions(places, PHASE2_REQUIRED_MAP_FILTERS);
  assert.deepEqual(
    options.slice(0, 3).map((option) => option.label),
    ['All places', 'Food & drink', 'Outdoors'],
  );

  const stateBeforeFiltering = encodeOnboardingV2State(state);
  const visible = filterPlacesForMap(places, 'food_drink');
  assert.deepEqual(visible.map((saved) => saved.id), ['saved-food']);
  assert.equal(encodeOnboardingV2State(state), stateBeforeFiltering, 'filtering never mutates Practice progress');
  assert.equal(expectedOnboardingV2Route(state.stage), '/(tabs)/map', 'filtering never navigates out of the map');
  assert.ok(['practice_ready', 'first_independent_save_complete'].includes(state.stage), 'Practice remains active');
}

provePhase2Filters(oneOfThree, [food], 1);
provePhase2Filters(twoOfThree, [food, outdoors], 2);

// Default production semantics are unchanged outside Phase 2: a single-group
// collection still suppresses no-op category chips.
assert.deepEqual(mapFilterOptions([food]), []);
assert.deepEqual(
  mapFilterOptions([food, outdoors]).map((option) => option.label),
  ['All places', 'Food & drink', 'Outdoors'],
);

const root = process.cwd();
const map = readFileSync(join(root, 'app/(tabs)/map.tsx'), 'utf8');
const coach = readFileSync(
  join(root, 'components/onboarding/v2/OnboardingV2MapCoachmark.tsx'),
  'utf8',
);

assert.match(map, /<MapTopSearchBar/);
assert.match(map, /<MapCategoryFilterBar/);
assert.match(map, /<ShareQueueButton \/>/);
assert.match(map, /<MapBottomSheet/);
assert.match(
  map,
  /mapFilterOptions\(\s*validPlaces,\s*phase2MapActive \? PHASE2_REQUIRED_MAP_FILTERS : \[\],\s*\)/,
);
assert.match(
  map,
  /const handleSelectMapCategory[\s\S]{0,700}setMapCategoryFilter\(next\)[\s\S]{0,700}trackEvent\('map_filter_changed'/,
  'filter selection remains presentation-only',
);
assert.doesNotMatch(
  map,
  /const handleSelectMapCategory[\s\S]{0,700}(closeOnboarding|router\.|replace\(|dismiss)/,
  'filter selection does not dismiss or navigate onboarding',
);
assert.match(coach, /resolveOnboardingV2VisibleOwner/);
assert.match(coach, /style=\{\[styles\.dock, \{ top: topOffset \}\]\}/);
assert.doesNotMatch(coach, /useSafeAreaInsets|PHASE2_MAP_CHROME_CLEARANCE/);

const phase1Checkpoint: OnboardingV2State = {
  ...oneOfThree,
  stage: 'phase1_complete',
  phase1CompletedAt: at,
};
assert.equal(isOnboardingV2Phase2MapState(phase1Checkpoint), true);
assert.equal(resolveOnboardingV2VisibleOwner({
  state: phase1Checkpoint,
  phase1Only: false,
  selectedSourceAvailable: false,
  poolExhausted: false,
}), 'practice_loading');
assert.equal(resumePhase2AfterCompletedPhase1(phase1Checkpoint, at).state.stage, 'practice_ready');
assert.equal(resolveOnboardingV2VisibleOwner({
  state: {
    ...twoOfThree,
    stage: 'graduated',
    behavioralCompletedAt: at,
    graduationAcknowledgedAt: at,
  },
  phase1Only: false,
  selectedSourceAvailable: false,
  poolExhausted: false,
}), 'none', 'completed users never regain a Practice owner');
assert.equal(shouldRenderMapTopChrome({
  searchVisible: false,
  hasSelectedPlace: false,
  previewExpanded: false,
}), true);
for (const safeTop of [24, 47, 59]) {
  const layout = resolvePhase2MapLayout(safeTop);
  assert.equal(layout.overlapsControls, false);
  assert.ok(layout.queueBand.bottom < layout.dockTop);
}

console.log('PASS Phase 2 1/3 keeps All places, Food & drink, Outdoors, and Queue visible');
console.log('PASS Phase 2 2/3 keeps canonical production filters visible');
console.log('PASS filtering changes markers without changing Practice progress, UI ownership, or route');
console.log('PASS normal non-onboarding map filter semantics remain unchanged');
