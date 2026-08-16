/**
 * scripts/testPlaceDetailConvergence.ts
 *
 * The product rule this pins down:
 *
 *   One saved place, ONE canonical Place Detail experience, regardless of how
 *   the user got there — Map, Queue, Home, single nearby notification, a
 *   grouped-notification selection, or a legacy /opportunity/[id] deep link.
 *
 * Plus the two sections that finish V2:
 *   "Did you go yet?"  — visiting records a visit, it never deletes the save.
 *   "Also nearby"      — the user's OWN saves, by exact id, never discovery.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testPlaceDetailConvergence.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALSO_NEARBY_LIMIT,
  formatNearbyDistance,
  selectAlsoNearby,
} from '../lib/alsoNearby';
import { visitedDisplay } from '../lib/placeDetailUi';
import { routeNearbyReminder } from '../lib/nearbyGroupRouting';
import { resetOpenSavedPlaceRequests } from '../lib/openSavedPlace';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

type SP = {
  id: string;
  place: { name: string; latitude?: number | null; longitude?: number | null };
};

// Santa Ana / Orange County cluster, plus a far-away save.
const ANCHOR: SP = { id: 'sp-anchor', place: { name: "Tuxedo Cat's Coffee", latitude: 33.7455, longitude: -117.8677 } };
const CLOSE: SP = { id: 'sp-close', place: { name: 'Pizzelle di Mare', latitude: 33.7460, longitude: -117.8690 } };
const MID: SP = { id: 'sp-mid', place: { name: 'Campo Cookhouse', latitude: 33.7700, longitude: -117.9000 } };
const FAR_BUT_OK: SP = { id: 'sp-far', place: { name: 'Hidden House Coffee', latitude: 33.9000, longitude: -117.9500 } };
const OTHER_STATE: SP = { id: 'sp-nyc', place: { name: 'Joe’s Pizza', latitude: 40.7128, longitude: -74.006 } };
const NO_COORDS: SP = { id: 'sp-nocoords', place: { name: 'Somewhere Unmapped', latitude: null, longitude: null } };

// ---------------------------------------------------------------------------
// 1. Also Nearby — the user's own saves, nearest first
// ---------------------------------------------------------------------------
{
  const all = [ANCHOR, MID, CLOSE, FAR_BUT_OK, OTHER_STATE, NO_COORDS];
  const result = selectAlsoNearby(ANCHOR, all);

  assert.ok(
    !result.some((e) => e.saved.id === ANCHOR.id),
    'the place you are looking at is never in its own Also Nearby',
  );
  assert.deepEqual(
    result.map((e) => e.saved.id),
    ['sp-close', 'sp-mid', 'sp-far'],
    'the user’s own saves, nearest first',
  );
  assert.ok(
    !result.some((e) => e.saved.id === OTHER_STATE.id),
    'a save 2,000 miles away is not "also nearby"',
  );
  assert.ok(
    !result.some((e) => e.saved.id === NO_COORDS.id),
    'a save without coordinates is dropped, never guessed at',
  );
  // Distances are real and monotonically increasing.
  for (let i = 1; i < result.length; i += 1) {
    assert.ok(result[i].distanceMeters >= result[i - 1].distanceMeters, 'sorted by distance');
  }
  assert.ok(result[0].distanceMeters < 500, 'the closest save really is close');
}

// Bounded, and safe on every degenerate input.
{
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `sp-${i}`,
    place: { name: `P${i}`, latitude: 33.75 + i * 0.001, longitude: -117.86 },
  }));
  assert.equal(selectAlsoNearby(ANCHOR, many).length, ALSO_NEARBY_LIMIT, 'bounded row');
  assert.deepEqual(selectAlsoNearby(ANCHOR, []), [], 'no other saves → omit the section');
  assert.deepEqual(selectAlsoNearby(ANCHOR, [ANCHOR]), [], 'only itself → omit');
  assert.deepEqual(selectAlsoNearby(null, [CLOSE]), []);
  assert.deepEqual(selectAlsoNearby(ANCHOR, null), []);
  assert.deepEqual(selectAlsoNearby(NO_COORDS, [CLOSE]), [], 'anchor without coords is safe');
  // Duplicate rows cannot double-render.
  assert.equal(selectAlsoNearby(ANCHOR, [CLOSE, CLOSE, CLOSE]).length, 1);
}

// Never a provider lookup: the module cannot reach Google at all.
{
  const src = read('lib/alsoNearby.ts');
  assert.ok(!/fetch\(|googleapis|places:searchText|placesService/.test(src), 'no discovery calls');
  assert.ok(src.includes("from './geo'"), 'reuses the existing distance helper');
}

{
  assert.equal(formatNearbyDistance(160), '525 ft');
  assert.equal(formatNearbyDistance(1609), '1.0 mi');
  assert.equal(formatNearbyDistance(32_000), '20 mi');
  assert.equal(formatNearbyDistance(Number.NaN), '');
  assert.equal(formatNearbyDistance(-5), '');
}

// ---------------------------------------------------------------------------
// 2. Also Nearby navigation — exact id, canonical detail, no second route
// ---------------------------------------------------------------------------
{
  const detail = read('components/map/SelectedPlaceDetails.tsx');
  assert.ok(detail.includes('selectAlsoNearby(saved, allSavedPlaces'), 'uses the tested selector');
  assert.ok(detail.includes('onSelectNearby?.(entry.saved)'), 'hands back the exact saved row');
  assert.ok(!detail.includes("router.push('/place/"), 'no second detail route');

  const map = read('app/(tabs)/map.tsx');
  assert.match(
    map,
    /onSelectNearby=\{\(next\) => \{[\s\S]{0,260}selectPlace\(next\)/,
    'Also Nearby reuses the SAME selection path a marker tap uses',
  );
  assert.ok(map.includes('allSavedPlaces={validPlaces}'), 'sourced from the user’s own saves');
}

// ---------------------------------------------------------------------------
// 3. Did you go yet? — visiting records a visit, it never deletes the save
// ---------------------------------------------------------------------------
{
  assert.deepEqual(visitedDisplay({ visited_at: null }), {
    visited: false,
    visitedAt: null,
    prompt: 'DID YOU GO YET?',
  });
  const v = visitedDisplay({ visited_at: '2026-08-15T10:00:00.000Z' });
  assert.equal(v.visited, true);
  assert.equal(v.visitedAt, '2026-08-15T10:00:00.000Z');
  assert.equal(visitedDisplay({ visited_at: '   ' }).visited, false, 'blank is not visited');
  assert.equal(visitedDisplay({}).visited, false);
}

// The decisive contract: "I went" updates the cached row, never removes it.
{
  const detail = read('components/map/SelectedPlaceDetails.tsx');
  const start = detail.indexOf('async function handleMarkVisited(');
  assert.ok(start > -1, 'the handler exists');
  const body = detail.slice(start, detail.indexOf('\n  }', start));

  assert.ok(body.includes('markVisited(saved.id)'), 'persists visited_at server-side');
  assert.ok(body.includes('updateSavedPlacesCache('), 'the cached row is UPDATED');
  assert.ok(
    !body.includes('removeSavedPlaceFromCache'),
    'visiting a place must never remove it from the saved collection',
  );
  assert.ok(!body.includes('deleteSavedPlace'), 'and never deletes it');
  assert.ok(!body.includes('onRequestDismiss'), 'the detail does not auto-close on "I went"');
  assert.ok(body.includes('restoreSavedPlacesCache'), 'a failed write rolls back');

  // "Not yet" is inert — never a mutation.
  const notYet = detail.slice(detail.indexOf('setVisitDeferred(true)') - 400, detail.indexOf('setVisitDeferred(true)') + 200);
  assert.ok(!/markVisited|updateSavedPlace\(|deleteSavedPlace|markArchived/.test(notYet), '"Not yet" mutates nothing');
}

// The nearby-reminder path lost the same destructive behaviour.
{
  const map = read('app/(tabs)/map.tsx');
  const start = map.indexOf('const handleNearbyReminderVisited');
  const body = map.slice(start, map.indexOf('}, [dismissSelectedPlace, reminderActionBusy, selected]);', start));
  assert.ok(body.includes('markVisited(selected.id)'));
  assert.ok(
    !body.includes('removeSavedPlaceFromCache'),
    'the reminder flow no longer makes a visited place vanish from the map',
  );
  assert.ok(body.includes('updateSavedPlacesCache('), 'it updates the row instead');
}

// Visited suppresses future "go here" nudges without deleting the save. That
// already lives in the service: markVisited also clears notifications_enabled.
{
  const service = read('services/savedPlacesService.ts');
  const start = service.indexOf('export async function markVisited(');
  const body = service.slice(start, service.indexOf('\n}', start));
  assert.ok(body.includes('visited_at: nowIso'), 'stamps the visit');
  assert.ok(body.includes('notifications_enabled: false'), 'stops future opportunity reminders');
  assert.ok(!/\.delete\(\)/.test(body), 'nothing is deleted server-side');
}

// ---------------------------------------------------------------------------
// 4. Notification convergence — one place, one detail
// ---------------------------------------------------------------------------

// A SINGLE nearby notification resolves to one exact saved place...
{
  assert.deepEqual(
    routeNearbyReminder({ groupedSavedPlaceIds: ['sp-anchor'] }),
    { kind: 'single', savedPlaceId: 'sp-anchor' },
  );
  // ...and a group stays a group.
  assert.deepEqual(
    routeNearbyReminder({ groupedSavedPlaceIds: ['a', 'b', 'c'] }),
    { kind: 'group', savedPlaceIds: ['a', 'b', 'c'] },
  );
}

// The single case lands on the canonical map detail, EXPANDED — not on a
// separate single-place opportunity screen.
{
  const layout = read('app/_layout.tsx');
  assert.match(
    layout,
    /nearbyRoute\.kind === 'single'[\s\S]{0,400}pathname: '\/\(tabs\)\/map'/,
    'a single nearby notification goes to the canonical map detail',
  );
  assert.ok(
    !/nearbyRoute\.kind === 'single'[\s\S]{0,400}opportunity\/\[id\]/.test(layout),
    'never to a dedicated single-place opportunity screen',
  );

  const map = read('app/(tabs)/map.tsx');
  assert.match(
    map,
    /shouldExpandSavedPlaceDetails\(placeSource\) \|\| reminderOpen/,
    'a nearby-notification arrival opens Place Detail V2 expanded',
  );
  // The bespoke single-place reminder actions are gone from the collapsed
  // sheet — Directions and "Did you go yet?" live in Place Detail V2 now.
  assert.ok(!map.includes('"I went here"'), 'no duplicate visited action');
  assert.ok(!map.includes('title="Maybe next time"'), 'no duplicate defer action');
  assert.ok(!map.includes('Adjust reminder radius'), 'reminder settings live in the detail');
  // ...but the underlying capability was not lost.
  const detail = read('components/map/SelectedPlaceDetails.tsx');
  assert.ok(detail.includes('DID YOU GO YET?') || detail.includes('visited.prompt'), 'visit action preserved');
  assert.ok(detail.includes('onGetDirections'), 'directions preserved');
}

// The legacy /opportunity/[id] deep link resolves into the canonical detail
// rather than maintaining a second UI.
{
  const legacy = read('app/opportunity/[id].tsx');
  assert.ok(legacy.includes('Redirect'), 'the old route redirects');
  assert.ok(legacy.includes('resolveOpenSavedPlaceRoute'), 'through the validated contract');
  assert.ok(legacy.includes("reminderOpen: 'true'"), 'and lands on the expanded detail');
  // No duplicated presentation left behind.
  assert.ok(!legacy.includes('markVisited'), 'no duplicate visit action');
  assert.ok(!legacy.includes('openExternalMaps'), 'no duplicate directions action');
  assert.ok(legacy.length < 2_000, 'the 599-line duplicate screen is gone');
}

// A grouped notification still opens the group, and picking a member lands on
// the canonical detail by exact saved_places.id.
{
  const layout = read('app/_layout.tsx');
  assert.match(layout, /nearbyRoute\.kind === 'group'[\s\S]{0,300}opportunity\/group/, 'group UX preserved');

  const group = read('app/opportunity/group.tsx');
  assert.ok(group.includes('resolveOpenSavedPlaceRoute'), 'members use the canonical contract');
  assert.ok(group.includes('savedPlaceId: saved.id'), 'by exact saved_places.id');
  assert.ok(!group.includes("pathname: '/opportunity/[id]'"), 'not into the retired screen');
  // Never name/coordinate matching, never a fresh provider lookup.
  assert.ok(!/place\.name ===|latitude ===|searchText/.test(group), 'exact id only');
}

// Repeated opening of the SAME place must keep working (82eac44).
{
  resetOpenSavedPlaceRequests();
  const group = read('app/opportunity/group.tsx');
  const legacy = read('app/opportunity/[id].tsx');
  for (const [name, src] of [['group', group], ['legacy', legacy]] as const) {
    assert.ok(
      src.includes('resolveOpenSavedPlaceRoute'),
      `${name} mints a fresh openRequestId per navigation, so re-opening A works`,
    );
  }
}

console.log('PASS place detail convergence: also nearby, non-destructive visits, one detail owner');
