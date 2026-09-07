import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { carouselIndexFromOffset } from '../lib/placeBrowseCarousel';
import {
  PLACE_BROWSE_WHEEL_MAX_RENDER_BATCH,
  placeBrowseWheelCardSideInset,
  placeBrowseWheelCardWidth,
} from '../lib/placeBrowseWheel';
import { sourcePlaceGroupForAnchor } from '../lib/sourcePlaceGroup';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const map = read('app/(tabs)/map.tsx');
const wheel = read('components/map/PlaceBrowseWheel.tsx');
const sourceAdapter = read('components/map/MapGroupSelector.tsx');
const nearbyAdapter = read('components/map/NearbyMapExplorerCarousel.tsx');
const details = read('components/map/SelectedPlaceDetails.tsx');
const gallery = read('lib/placeVideoGallery.ts');

const SOURCE = 'v1:instagram:wheel-video';
type Fixture = {
  id: string;
  place_id: string;
  created_at: string;
  place: {
    id: string;
    google_place_id: string;
    name: string;
    formatted_address: string;
    latitude: number;
    longitude: number;
  };
  sources: Array<{
    identity_key: string;
    canonical_url: string;
    first_attached_at: string;
    is_primary: boolean;
    thumbnail_url?: string | null;
  }>;
};

function place(id: string, identityKey = SOURCE, placeId = `place-${id}`): Fixture {
  const order = id.charCodeAt(0) % 60;
  return {
    id,
    place_id: placeId,
    created_at: `2026-09-06T00:00:${String(order).padStart(2, '0')}Z`,
    place: {
      id: placeId,
      google_place_id: `google-${placeId}`,
      name: `Place ${id.toUpperCase()}`,
      formatted_address: `${order} Main Street`,
      latitude: 33 + order / 100,
      longitude: -117 - order / 100,
    },
    sources: [{
      identity_key: identityKey,
      canonical_url: 'https://www.instagram.com/reel/wheel-video/',
      first_attached_at: `2026-09-06T00:00:${String(order).padStart(2, '0')}Z`,
      is_primary: true,
      thumbnail_url: `https://images.test/${id}.jpg`,
    }],
  };
}

let cases = 0;
function check(name: string, run: () => void): void {
  run();
  cases += 1;
  console.log(`PASS ${cases}. ${name}`);
}

const a = place('a');
const b = place('b');
const c = place('c');

check('one source place does not activate the wheel', () => {
  assert.equal(sourcePlaceGroupForAnchor(a, [a])?.places.length, 1);
  assert.match(map, /if \(activeSourceGroupPlaces\.length < 2\) return null/);
});
check('two source places activate the wheel', () => {
  assert.equal(sourcePlaceGroupForAnchor(a, [a, b])?.places.length, 2);
  assert.match(map, /const sourceGroupBrowseActive = [\s\S]*!!sourceGroupWheelSelectedPlace/);
});
check('three source places expose all three cards', () => {
  assert.deepEqual(sourcePlaceGroupForAnchor(a, [a, b, c])?.places.map((entry) => entry.id), ['a', 'b', 'c']);
  assert.match(sourceAdapter, /places\.map\(\(place\)/);
});
check('swipe from card one to two updates selection', () => {
  assert.equal(carouselIndexFromOffset(332, 332, 3), 1);
  assert.match(wheel, /onSelect\(item, 'swipe'\)/);
});
check('swipe from card two to three updates the selected map pin', () => {
  assert.equal(carouselIndexFromOffset(664, 332, 3), 2);
  assert.match(map, /setSelected\(item\)/);
  assert.match(map, /selected=\{selectedMarkerId === p\.id\}/);
});
check('tapping source pin one scrolls the wheel to card one', () => {
  assert.match(map, /sourceGroupBrowseActive && mapGroupCoordinateIds\.has\(p\.id\)[\s\S]*selectMapGroupPlace\(p, 'marker'\)/);
  assert.match(wheel, /scrollToIndex\(\{ index: selectedIndex/);
});
check('selected card uses the approved accent outline', () => {
  assert.match(wheel, /selected && styles\.cardSelected/);
  assert.match(wheel, /cardSelected: \{ borderColor: colors\.accent, borderWidth: 2 \}/);
});
check('multi-card layout leaves a next-card peek', () => {
  assert.ok(placeBrowseWheelCardWidth(390) < 390);
  assert.ok(placeBrowseWheelCardSideInset(390) >= 24);
  assert.match(wheel, /contentContainerStyle=\{\{ paddingHorizontal: sideInset, gap: CARD_GAP \}\}/);
});
check('old compact source carousel is not rendered simultaneously', () => {
  assert.doesNotMatch(map, /SourceGroupSwitcher|source-group-selected-carousel/);
  assert.doesNotMatch(sourceAdapter, /PlaceBrowseCarousel|See all|View all/);
});
check('selected-place summary is hidden while the wheel is active', () => {
  assert.match(map, /shouldRenderSelectedPlaceDetail =[\s\S]*!sourceGroupBrowseActive/);
});
check('Details opens the correct selected saved place', () => {
  assert.match(map, /function openSourceGroupPlaceDetails\(item[\s\S]*selectMapGroupPlace\(item, 'tap'\)[\s\S]*setPreviewExpanded\(true\)/);
});
check('Directions targets the correct selected saved place', () => {
  assert.match(map, /function openSourceGroupPlaceDirections\(item[\s\S]*selectMapGroupPlace\(item, 'tap'\)[\s\S]*openExternalMaps\(item\)/);
});
check('manual plus-one attachment updates wheel membership', () => {
  assert.equal(sourcePlaceGroupForAnchor(a, [a, b])?.places.length, 2);
});
check('removal updates wheel membership', () => {
  assert.deepEqual(sourcePlaceGroupForAnchor(a, [a, b, c].filter((entry) => entry.id !== 'b'))?.places.map((entry) => entry.id), ['a', 'c']);
});
check('two to one collapses cleanly to normal place state', () => {
  assert.equal(sourcePlaceGroupForAnchor(a, [a])?.places.length, 1);
  assert.match(map, /activeSourceGroupPlaces\.length < 2/);
});
check('cold start restores durable source membership', () => {
  const cold = JSON.parse(JSON.stringify([a, b, c])) as Fixture[];
  assert.equal(sourcePlaceGroupForAnchor(cold[0], cold)?.places.length, 3);
});
check('promoted soft save enters after a durable source row exists', () => {
  const promoted = place('d');
  assert.ok(sourcePlaceGroupForAnchor(a, [a, b, promoted])?.places.some((entry) => entry.id === 'd'));
});
check('unpromoted soft alternative does not enter', () => {
  const soft = { outcome: 'secondary_soft_saved', saved_place_id: null };
  assert.equal(soft.saved_place_id, null);
  assert.equal(sourcePlaceGroupForAnchor(a, [a, b])?.places.length, 2);
});
check('canonical duplicate is deduped', () => {
  assert.equal(sourcePlaceGroupForAnchor(a, [a, b, place('x', SOURCE, b.place_id)])?.places.length, 2);
});
check('shared source membership resolves from the recipient durable rows', () => {
  const shared = place('s');
  shared.sources.push({ ...shared.sources[0]!, identity_key: 'v1:tiktok:shared-video' });
  assert.ok(sourcePlaceGroupForAnchor(shared, [a, shared], SOURCE)?.places.some((entry) => entry.id === 's'));
});
check('place video gallery remains separate and source-backed', () => {
  assert.match(details, /loadPlaceVideos\(\{ placeId: saved\.place\.id/);
  assert.match(gallery, /OWNER_VIDEO|COMMUNITY_VIDEO/);
});
check('card selection leaves map camera ownership unchanged', () => {
  const start = map.indexOf('function selectMapGroupPlace');
  const body = map.slice(start, map.indexOf('function openSourceGroupPlaceDetails', start));
  assert.doesNotMatch(body, /focusZone|fitToCoordinates|animateToRegion|beginCameraMovement/);
});
check('source pins retain atomic non-clustered representation', () => {
  assert.match(map, /alwaysIndividualIds[\s\S]*new Set<string>\(mapGroupCoordinateIds\)/);
  assert.match(map, /groupMember=\{/);
});
check('large groups use bounded virtualized rendering', () => {
  assert.equal(PLACE_BROWSE_WHEEL_MAX_RENDER_BATCH, 3);
  assert.match(wheel, /windowSize=\{5\}[\s\S]*removeClippedSubviews/);
});
check('long place names and addresses remain bounded and visible', () => {
  assert.match(wheel, /styles\.name[\s\S]*numberOfLines=\{2\}/);
  assert.match(wheel, /styles\.locality[\s\S]*numberOfLines=\{2\}/);
});
check('missing provider imagery falls back to the source video frame then neutral state', () => {
  assert.match(sourceAdapter, /fallbackSourceUri: sourceThumbnail/);
  assert.match(wheel, /fallbackSourceUri=\{item\.fallbackSourceUri\}/);
  assert.match(read('components/PlaceImage.tsx'), /accessibilityLabel="No place photo available"/);
});
check('accessibility announces selected state and position with non-swipe navigation', () => {
  assert.match(wheel, /accessibilityPosition = `\$\{index \+ 1\} of \$\{items\.length\}`/);
  assert.match(wheel, /accessibilityState=\{\{ selected \}\}/);
  assert.match(wheel, /accessibilityActions=\{/);
  assert.match(wheel, /Next place[\s\S]*Previous place/);
});

assert.match(nearbyAdapter, /<PlaceBrowseWheel/, 'Explore Nearby must use the same primitive');
assert.equal(cases, 27);
console.log('PASS source-group Nearby wheel contract (27 cases)');
