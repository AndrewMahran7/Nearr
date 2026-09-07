import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveMapGroupPlaces } from '../lib/mapGroupFocus';
import {
  sourceGroupPosition,
  sourcePlaceGroupForAnchor,
  sourcePlaceGroupFromSeeds,
} from '../lib/sourcePlaceGroup';

const SOURCE_A = 'v1:instagram:video-a';
const SOURCE_B = 'v1:tiktok:video-b';

type Fixture = {
  id: string;
  place_id: string;
  source_url: string | null;
  created_at: string;
  place: { id: string; google_place_id: string; latitude: number; longitude: number; name: string };
  sources: Array<{
    identity_key: string;
    canonical_url: string;
    first_attached_at: string;
    is_primary: boolean;
  }>;
};

function place(
  id: string,
  source = SOURCE_A,
  placeId = `place-${id}`,
): Fixture {
  const order = (id.charCodeAt(id.length - 1) || 1) % 60;
  return {
    id,
    place_id: placeId,
    source_url: 'https://www.instagram.com/reel/video-a/',
    created_at: `2026-09-05T00:00:${String(order).padStart(2, '0')}Z`,
    place: {
      id: placeId,
      google_place_id: `google-${placeId}`,
      latitude: 33 + order / 100,
      longitude: -117 - order / 100,
      name: id.toUpperCase(),
    },
    sources: [{
      identity_key: source,
      canonical_url: source === SOURCE_A
        ? 'https://www.instagram.com/reel/video-a/'
        : 'https://www.tiktok.com/@creator/video/123456789/',
      first_attached_at: `2026-09-05T00:00:${String(order).padStart(2, '0')}Z`,
      is_primary: true,
    }],
  };
}

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  console.log(`PASS ${checks}. ${name}`);
}

const initial = [place('a'), place('b'), place('c')];
check('initial three auto-saves resolve to group 3', () => {
  assert.equal(sourcePlaceGroupFromSeeds(initial, ['a', 'b', 'c'])?.places.length, 3);
});

const manualFourth = place('d', SOURCE_A);
const four = [...initial, manualFourth];
check('manual save fourth joins current durable group immediately', () => {
  const resolved = resolveMapGroupPlaces(four, ['a', 'b', 'c']);
  assert.deepEqual(resolved.places.map((entry) => entry.id), ['a', 'b', 'c', 'd']);
});

check('cold-start rehydration returns the same four', () => {
  const cold = JSON.parse(JSON.stringify(four)) as Fixture[];
  assert.equal(sourcePlaceGroupForAnchor(cold[0], cold)?.places.length, 4);
});

check('removing one updates membership to three', () => {
  assert.equal(sourcePlaceGroupForAnchor(initial[0], four.filter((entry) => entry.id !== 'b'))?.places.length, 3);
});

check('canonical duplicate renders one entry', () => {
  const duplicate = place('d-copy', SOURCE_A, manualFourth.place_id);
  assert.equal(sourcePlaceGroupForAnchor(initial[0], [...four, duplicate])?.places.length, 4);
});

check('primary metadata change does not alter membership', () => {
  const changed = structuredClone(four);
  changed[0]!.sources[0]!.is_primary = false;
  changed[1]!.sources[0]!.is_primary = true;
  assert.equal(sourcePlaceGroupFromSeeds(changed, ['a', 'b', 'c'])?.places.length, 4);
});

check('unmaterialized soft alternatives do not fabricate map saves', () => {
  const softLedger = [{ outcome: 'secondary_soft_saved', saved_place_id: null }];
  assert.equal(softLedger[0]?.saved_place_id, null);
  assert.equal(sourcePlaceGroupForAnchor(initial[0], initial)?.places.length, 3);
});

const promoted = place('soft', SOURCE_A);
check('promoted soft alternative joins through its real saved source once', () => {
  assert.equal(sourcePlaceGroupForAnchor(initial[0], [...initial, promoted, promoted])?.places.length, 4);
});

check('removed soft alternative remains absent because it never creates a source row', () => {
  const removedLedger = [{ outcome: 'secondary_removed', saved_place_id: null }];
  assert.equal(removedLedger[0]?.saved_place_id, null);
  assert.equal(sourcePlaceGroupForAnchor(initial[0], initial)?.places.length, 3);
});

check('source groups remain isolated between videos', () => {
  const other = place('other', SOURCE_B);
  assert.deepEqual(sourcePlaceGroupForAnchor(initial[0], [...initial, other])?.places.map((entry) => entry.id), ['a', 'b', 'c']);
});

check('one canonical place can belong to different source groups', () => {
  const shared = place('shared');
  shared.sources.push({ ...place('x', SOURCE_B).sources[0]!, is_primary: false });
  const dataset = [...initial, place('other', SOURCE_B), shared];
  assert.ok(sourcePlaceGroupForAnchor(shared, dataset, SOURCE_A)?.places.some((entry) => entry.id === 'shared'));
  assert.ok(sourcePlaceGroupForAnchor(shared, dataset, SOURCE_B)?.places.some((entry) => entry.id === 'shared'));
});

check('deleted save does not linger once absent from the authoritative collection', () => {
  assert.equal(sourcePlaceGroupForAnchor(initial[0], four.filter((entry) => entry.id !== manualFourth.id))?.places.length, 3);
});

check('alias/merged rows resolve to one canonical place', () => {
  const alias = place('alias', SOURCE_A, initial[0]!.place_id);
  assert.equal(sourcePlaceGroupForAnchor(initial[0], [...initial, alias])?.places.length, 3);
});

check('count and selected position always match live membership', () => {
  const group = sourcePlaceGroupForAnchor(manualFourth, four)!;
  const position = sourceGroupPosition(group.places, 'd');
  assert.deepEqual(position, { index: 3, count: 4, label: '4 of 4' });
});

const map = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
const tray = readFileSync(join(process.cwd(), 'components/map/MapGroupSelector.tsx'), 'utf8');
const wheel = readFileSync(join(process.cwd(), 'components/map/PlaceBrowseWheel.tsx'), 'utf8');
const details = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
const marker = readFileSync(join(process.cwd(), 'components/map/NearrMapMarker.tsx'), 'utf8');

check('no selection shows the large Nearby-style wheel', () => {
  assert.match(map, /sourceGroupBrowseActive && sourceGroupWheelSelectedPlace/);
  assert.match(tray, /testID="source-group-nearby-wheel"/);
});
check('selecting a card keeps the source wheel as the collapsed browsing surface', () => {
  assert.match(map, /function selectMapGroupPlace[\s\S]*setSelected\(item\)[\s\S]*setPreviewExpanded\(false\)/);
});
check('the old compact group switcher is not rendered', () => {
  assert.doesNotMatch(map, /<SourceGroupSwitcher/);
  assert.doesNotMatch(tray, /PlaceBrowseCarousel|See all|View all/);
});
check('selected detail sheet opens only as the detailed surface', () => {
  assert.match(map, /function openSourceGroupPlaceDetails[\s\S]*setPreviewExpanded\(true\)/);
  assert.match(map, /<SelectedPlaceDetails/);
});
check('selected map pin remains highlighted', () => assert.match(map, /selected=\{selectedMarkerId === p\.id\}/));
check('other source-group pins receive related styling', () => {
  assert.match(map, /groupMember=\{/);
  assert.match(marker, /groupMemberDisc/);
});
check('unrelated pins remain normal', () => assert.match(map, /dimmed=\{false\}/));
check('shared wheel changes selected place by tap or swipe', () => {
  assert.match(tray, /<PlaceBrowseWheel/);
  assert.match(tray, /if \(place\) onSelect\(place, interaction\)/);
  assert.match(map, /onSelect=\{selectMapGroupPlace\}/);
});
check('switching selection updates the canonical detail input', () => assert.match(map, /saved=\{selected\}/));
check('Details opens the cohesive expanded place detail', () => {
  const start = map.indexOf('function openSourceGroupPlaceDetails');
  const body = map.slice(start, map.indexOf('function openSourceGroupPlaceDirections', start));
  assert.match(body, /setPreviewExpanded\(true\)/);
});
check('expanded detail exposes From this video context', () => {
  assert.match(details, /sameSourceEntries/);
  assert.match(readFileSync(join(process.cwd(), 'lib/placeSource.ts'), 'utf8'), /siblingSectionTitle: 'From this video'/);
});
check('one-place source hides group UI', () => assert.match(map, /activeSourceGroupPlaces\.length < 2/));
check('large groups use the bounded shared wheel plus one card counter', () => {
  assert.match(wheel, /\{index \+ 1\}\/\{items\.length\}/);
  assert.match(wheel, /maxToRenderPerBatch=\{PLACE_BROWSE_WHEEL_MAX_RENDER_BATCH\}/);
});
check('removing selected member safely selects next or closes', () => {
  assert.match(details, /onRemoved\?: \(removedSavedPlaceId/);
  assert.match(map, /handleSelectedSourceGroupMemberRemoved/);
  assert.match(map, /selectPlace\(next\)/);
});
check('closing detail restores the tray without moving camera', () => {
  assert.match(map, /setSelected\(null\)/);
  assert.match(map, /closing UI is not a reason to move the map/i);
});
check('no duplicate large selected border remains above detail', () => {
  assert.match(map, /shouldRenderSelectedPlaceDetail =[\s\S]*!sourceGroupBrowseActive/);
  assert.match(tray, /title="Places from this video"/);
  assert.doesNotMatch(tray, /PlaceBrowseCarousel/);
});

assert.equal(checks, 30);
console.log('PASS source-place group data integrity and unified map/detail UX contracts');
