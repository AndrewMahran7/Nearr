import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  carouselIndexForSelection,
  carouselIndexFromOffset,
  carouselRenderWindow,
  PLACE_BROWSE_MAX_RENDER_BATCH,
} from '../lib/placeBrowseCarousel';
import { planFindRightPlace, type FindRightPlaceCandidate } from '../lib/findRightPlace';
import { sourcePlaceGroupForAnchor } from '../lib/sourcePlaceGroup';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const map = read('app/(tabs)/map.tsx');
const switcher = read('components/map/SourceGroupSwitcher.tsx');
const carousel = read('components/PlaceBrowseCarousel.tsx');
const details = read('components/map/SelectedPlaceDetails.tsx');
const review = read('app/share-jobs/[jobId].tsx');
const reviewPolicy = read('lib/vayrinMultiPlaceReview.ts');
const saveBoundary = read('services/shareJobCandidateSave.ts');
const sourceBoundary = read('services/savedPlaceSourcesService.ts');
const correction = read('lib/wrongPlaceCorrection.ts');

let cases = 0;
function check(name: string, run: () => void) {
  run();
  cases += 1;
  console.log(`PASS ${cases}. ${name}`);
}

const candidate = (overrides: Partial<FindRightPlaceCandidate> = {}): FindRightPlaceCandidate => ({
  googlePlaceId: 'provider:pizza-wagon',
  name: 'Pizza Wagon of Brooklyn',
  formattedAddress: '8610 5th Ave, Brooklyn, NY',
  latitude: 40.62,
  longitude: -74.03,
  rawTypes: ['restaurant', 'food', 'establishment'],
  businessStatus: 'OPERATIONAL',
  ...overrides,
});

check('View all opens the explicit full group inside the selected sheet', () => {
  assert.match(map, /function viewAllSourceGroup[\s\S]*setPreviewExpanded\(true\)[\s\S]*setSourceGroupExpanded\(true\)/);
  assert.match(switcher, /testID=\{expanded \? 'source-group-full-view'/);
});
check('View all preserves the selected member', () => {
  assert.match(map, /const target = selected \?\?/);
  assert.match(switcher, /selectedId=\{selectedId\}/);
});
check('the full group does not create a duplicate modal or sheet', () => {
  assert.doesNotMatch(switcher, /\bModal\b|BottomSheet|<ScrollView/);
});
check('back and collapse close the full group cleanly', () => {
  assert.match(map, /BackHandler\.addEventListener\('hardwareBackPress'[\s\S]*setSourceGroupExpanded\(false\)/);
  assert.match(switcher, /onPress=\{expanded \? onCollapse : onViewAll\}/);
});

check('two-place swipe resolves the second card', () => assert.equal(carouselIndexFromOffset(246, 246, 2), 1));
check('three-place swipe resolves the third card', () => assert.equal(carouselIndexFromOffset(492, 246, 3), 2));
check('card taps select directly', () => assert.match(carousel, /onSelect\(item, 'tap'\)/));
check('programmatic selection synchronizes scroll position', () => {
  assert.equal(carouselIndexForSelection([{ id: 'a' }, { id: 'b' }], 'b'), 1);
  assert.match(carousel, /scrollToIndex\(\{ index: selectedIndex/);
});
check('group selection updates the canonical map selection', () => assert.match(map, /function selectMapGroupPlace[\s\S]*selectPlace\(item\)/));
check('tap selection emits the bounded card-selection event', () => assert.match(map, /source_group_card_selected/));
check('eight-plus-place rendering stays bounded', () => {
  assert.deepEqual(carouselRenderWindow(12, 6), { first: 4, last: 8, count: 5 });
  assert.equal(PLACE_BROWSE_MAX_RENDER_BATCH, 5);
  assert.match(carousel, /removeClippedSubviews/);
});

check('From this video exposes See all', () => assert.match(details, /actionLabel=\{onViewSourceGroup \? 'See all'/));
check('From this video count includes the current place', () => assert.match(details, /sameSourceEntries\.length \+ 1/));
check('From this video keeps horizontal preview cards', () => assert.match(details, /<PlaceCardRow[\s\S]*entries=\{sameSourceEntries\}/));
check('removed group members disappear from durable membership', () => {
  const anchor = { id: 'a', place_id: 'pa', sources: [{ identity_key: 'source:1', is_primary: true }] };
  const removed = { id: 'b', place_id: 'pb', sources: [] };
  assert.deepEqual(sourcePlaceGroupForAnchor(anchor, [anchor, removed])?.places.map((place) => place.id), ['a']);
});
check('promoted/canonical duplicate appears once', () => {
  const anchor = { id: 'a', place_id: 'pa', sources: [{ identity_key: 'source:1', is_primary: true }] };
  const duplicate = { id: 'b', place_id: 'pa', sources: [{ identity_key: 'source:1' }] };
  assert.deepEqual(sourcePlaceGroupForAnchor(anchor, [anchor, duplicate])?.places.map((place) => place.id), ['a']);
});

check('single defensible provider result auto-resolves', () => {
  assert.equal(planFindRightPlace({ query: 'Pizza Wagon of Brooklyn', candidates: [candidate()] }).action, 'auto_resolve');
});
check('existing save automatically attaches the source', () => {
  assert.match(review, /existing_place_source_attached/);
  assert.match(saveBoundary, /Already saved[\s\S]*ENRICHED save/);
});
check('single match does not require Save 1 place', () => {
  assert.match(review, /resolutionPlan\.action === 'auto_resolve'[\s\S]*await handleSaveManual\(resolutionPlan\.candidate, true\)[\s\S]*return/);
});
check('multiple defensible results stay a bounded choice', () => {
  const plan = planFindRightPlace({
    query: 'Pizza Wagon of Brooklyn',
    candidates: [candidate(), candidate({ googlePlaceId: 'provider:two', formattedAddress: '2nd Ave, Brooklyn, NY' })],
  });
  assert.equal(plan.action, 'choose');
  assert.equal(plan.defensible.length, 2);
});
check('zero defensible results do not fabricate a save', () => {
  assert.equal(planFindRightPlace({ query: 'Pizza Wagon', candidates: [] }).action, 'no_match');
});
check('semantic contradictions block automatic persistence', () => {
  assert.equal(planFindRightPlace({ query: 'Pizza Wagon', candidates: [candidate({ reasons: ['semantic_contradiction'] })] }).action, 'no_match');
});
check('an exact child is not broadened into its provider parent', () => {
  assert.equal(planFindRightPlace({
    query: 'Yosemite Falls',
    expectedName: 'Yosemite Falls',
    candidates: [candidate({
      googlePlaceId: 'provider:yosemite-parent',
      name: 'Yosemite National Park',
      formattedAddress: 'Yosemite National Park, CA',
      rawTypes: ['park', 'tourist_attraction'],
    })],
  }).action, 'no_match');
});

check('normal product source contains no Needs search copy', () => assert.doesNotMatch(`${review}\n${reviewPolicy}`, /Needs search/i));
check('normal product source contains no Search needed copy', () => assert.doesNotMatch(`${review}\n${reviewPolicy}`, /Search needed/i));
check('Find the right place is the correction affordance', () => assert.match(review, />Find the right place</));

check('auto-attach refreshes source-group membership through the saved cache', () => {
  assert.match(saveBoundary, /dependencies\.cache\(result\.saved\)/);
  assert.match(map, /sourcePlaceGroupForAnchor\(selected, places/);
});
check('gallery remains source-relationship backed', () => {
  assert.match(sourceBoundary, /attach_saved_place_source/);
  assert.match(details, /loadPlaceVideos\(\{ placeId: saved\.place\.id/);
});
check('wrong-place correction preserves the user note', () => assert.match(correction, /userNote: context\.userNote/));
check('wrong-place correction preserves the AI note', () => assert.match(correction, /aiNote: context\.aiNote \?\? null/));
check('shared source context stays on the canonical save boundary', () => assert.match(saveBoundary, /sourceUrl: args\.sourceUrl/));
check('canonical save result prevents duplicate saved places', () => assert.match(saveBoundary, /result\.status === 'saved'[\s\S]*duplicate: false[\s\S]*duplicate: true/));
check('source attachment remains RPC-deduped', () => assert.match(sourceBoundary, /row\?\.deduped === true \? 'deduped'/));

assert.equal(cases, 33);
console.log(`PASS multi-place browse v2 contract (${cases} cases)`);
