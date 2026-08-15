/**
 * scripts/testQueueSavedPlaceFocus.ts
 *
 * The completed-queue-row -> exact-saved-place navigation contract.
 *
 * The requirement is not "navigation reaches the map". It is: tapping a
 * completed queue row SELECTS THE EXACT saved place that row created, every
 * time, including on an already-mounted map tab and including the second time
 * the user taps the same row.
 *
 * These tests drive a faithful simulation of the map's focus effect built from
 * the REAL functions the screen uses — resolveOpenSavedPlaceRoute (the queue's
 * navigation target), savedPlaceFocusKey + decideSavedPlaceFocus (the map's
 * latch and data-race policy), findSavedPlaceForOpen (the map's resolver), and
 * the real module-level consumed-request ledger. A regression in any of them
 * fails here rather than on a physical device.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testQueueSavedPlaceFocus.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  decideSavedPlaceFocus,
  findSavedPlaceForOpen,
  isOpenSavedPlaceRequestHandled,
  markOpenSavedPlaceRequestHandled,
  resetOpenSavedPlaceRequests,
  resolveOpenSavedPlaceRoute,
  savedPlaceFocusKey,
  type MapRouteTarget,
} from '../lib/openSavedPlace';

type SP = { id: string; place: { google_place_id: string | null; name: string } };

const COFFEE: SP = {
  id: 'sp-coffee',
  place: { google_place_id: 'gp-coffee', name: "Tuxedo Cat's Coffee" },
};
const RAMEN: SP = { id: 'sp-ramen', place: { google_place_id: 'gp-ramen', name: 'Ramen Bar' } };

// ---------------------------------------------------------------------------
// A faithful stand-in for the map screen's focus effect. Mirrors
// app/(tabs)/map.tsx statement for statement; the decision itself comes from
// the real `decideSavedPlaceFocus`.
// ---------------------------------------------------------------------------
type Params = {
  savedPlaceId?: string;
  savedPlaceGoogleId?: string;
  placeSource?: string;
  openRequestId?: string;
};

class MapScreen {
  places: SP[];
  loading = false;
  refreshing = false;
  mapReady = true;
  selected: SP | null = null;
  messages: string[] = [];
  refreshCount = 0;
  params: Params = {};
  private focusRefresh: { key: string; settled: boolean } | null = null;
  private handledTargetId: string | null = null;

  constructor(places: SP[]) {
    this.places = places;
  }

  /** Simulates the queue/notification navigating to the map tab. The tab is
   *  already mounted, so ONLY the route params change — nothing remounts. */
  navigate(target: MapRouteTarget): void {
    this.params = target.params as Params;
    this.runFocusEffect();
  }

  /** Simulates the map tab unmounting and mounting again with the SAME route
   *  params still attached (tab reset, sign-out/in, error-boundary recovery). */
  remount(): void {
    this.focusRefresh = null;
    this.handledTargetId = null;
    this.selected = null;
    this.runFocusEffect();
  }

  /** Any unrelated re-render: new location fix, marker update, theme change. */
  rerender(): void {
    this.runFocusEffect();
  }

  closeSelectedPlace(): void {
    this.selected = null;
  }

  /** Completes the one forced refetch the effect is allowed to request. */
  settleRefresh(nextPlaces: SP[]): void {
    this.places = nextPlaces;
    this.refreshing = false;
    if (this.focusRefresh) this.focusRefresh = { key: this.focusRefresh.key, settled: true };
    this.runFocusEffect();
  }

  private runFocusEffect(): void {
    const { savedPlaceId, savedPlaceGoogleId, placeSource, openRequestId } = this.params;
    const requestKey = savedPlaceFocusKey({
      openRequestId,
      savedPlaceId,
      googlePlaceId: savedPlaceGoogleId,
    });
    const target = requestKey
      ? findSavedPlaceForOpen(this.places, { savedPlaceId, googlePlaceId: savedPlaceGoogleId })
      : null;
    const refreshState = this.focusRefresh?.key === requestKey ? this.focusRefresh : null;
    const decision = decideSavedPlaceFocus({
      requestKey,
      handled: openRequestId
        ? isOpenSavedPlaceRequestHandled(openRequestId)
        : this.handledTargetId === requestKey,
      mapReady: this.mapReady,
      found: !!target,
      loading: this.loading || this.refreshing,
      refreshRequested: !!refreshState,
      refreshSettled: !!refreshState?.settled,
    });

    if (decision === 'idle' || decision === 'wait') return;

    const consumeRequest = () => {
      this.handledTargetId = requestKey;
      markOpenSavedPlaceRequestHandled(openRequestId);
    };

    if (decision === 'refresh') {
      if (!requestKey) return;
      this.focusRefresh = { key: requestKey, settled: false };
      this.refreshCount += 1;
      this.refreshing = true; // the real hook flips this synchronously
      return;
    }

    if (decision === 'missing') {
      consumeRequest();
      if (placeSource) this.messages.push('This place is no longer available.');
      return;
    }

    if (!target) return;
    consumeRequest();
    this.selected = target; // the same path a manual marker tap takes
  }
}

/** What the queue does when a completed row is tapped. */
function tapCompletedRow(map: MapScreen, savedPlaceId: string): void {
  map.navigate(resolveOpenSavedPlaceRoute({ savedPlaceId, source: 'share_job_completed' }));
}

/** Read the selection through a call so `assert.equal`'s assertion signature
 *  cannot narrow `map.selected` for the rest of the enclosing block. */
function selectedId(map: MapScreen): string | null {
  return map.selected ? map.selected.id : null;
}

// ---------------------------------------------------------------------------
// 1. Completed row -> the navigation target uses the EXACT saved_places.id
// ---------------------------------------------------------------------------
{
  resetOpenSavedPlaceRequests();
  const route = resolveOpenSavedPlaceRoute({
    savedPlaceId: COFFEE.id,
    source: 'share_job_completed',
  });
  assert.equal(route.pathname, '/(tabs)/map');
  assert.equal(route.params.savedPlaceId, COFFEE.id, 'the exact saved_places.id is passed');
  assert.equal(route.params.placeSource, 'share_job_completed');
  assert.ok(route.params.openRequestId, 'every navigation carries a single-use request id');
  // Never a place name, a google id substitute, or coordinates.
  assert.ok(!JSON.stringify(route.params).includes('Tuxedo'), 'no name matching');

  // Two navigations to the SAME place must be distinguishable requests —
  // otherwise the map cannot tell a repeat tap from a re-render.
  const again = resolveOpenSavedPlaceRoute({
    savedPlaceId: COFFEE.id,
    source: 'share_job_completed',
  });
  assert.notEqual(again.params.openRequestId, route.params.openRequestId);
  assert.equal(again.params.savedPlaceId, COFFEE.id, 'the place id is stable across requests');
}

// ---------------------------------------------------------------------------
// 2. Happy path on an ALREADY-MOUNTED map: the exact place is selected
// ---------------------------------------------------------------------------
{
  resetOpenSavedPlaceRequests();
  const map = new MapScreen([COFFEE, RAMEN]);
  tapCompletedRow(map, COFFEE.id);
  assert.equal(selectedId(map), COFFEE.id, 'the exact saved place opens');
  assert.equal(map.refreshCount, 0, 'no refetch needed when the place is already loaded');
  assert.deepEqual(map.messages, []);
}

// ---------------------------------------------------------------------------
// 3. Target arrives BEFORE the data: retained, then resolved exactly
// ---------------------------------------------------------------------------
{
  resetOpenSavedPlaceRequests();
  const map = new MapScreen([]);
  map.loading = true; // initial fetch in flight
  tapCompletedRow(map, COFFEE.id);
  assert.equal(selectedId(map), null, 'nothing is selected while the list is loading');
  assert.deepEqual(map.messages, [], 'the request is NOT dropped or reported missing');

  // Data lands.
  map.loading = false;
  map.places = [COFFEE, RAMEN];
  map.rerender();
  assert.equal(selectedId(map), COFFEE.id, 'the retained target resolves to the exact save');
  assert.equal(map.refreshCount, 0);
}

// ---------------------------------------------------------------------------
// 3b. Stale cache on a long-lived map tab: ONE forced refetch, then exact focus
//     (the freshly auto-saved place is not in the map's cached list yet)
// ---------------------------------------------------------------------------
{
  resetOpenSavedPlaceRequests();
  const map = new MapScreen([RAMEN]); // cache predates the new save
  map.loading = false;
  tapCompletedRow(map, COFFEE.id);
  assert.equal(map.refreshCount, 1, 'exactly one authoritative refetch is requested');
  assert.equal(selectedId(map), null);
  assert.deepEqual(map.messages, [], 'never declares it missing while the refetch is in flight');

  map.settleRefresh([COFFEE, RAMEN]);
  assert.equal(selectedId(map), COFFEE.id, 'the exact save opens after the refetch');
  assert.equal(map.refreshCount, 1, 'no refetch loop');
}

// ---------------------------------------------------------------------------
// 4. Already-mounted map: target A consumed, then target B selects B
// ---------------------------------------------------------------------------
{
  resetOpenSavedPlaceRequests();
  const map = new MapScreen([COFFEE, RAMEN]);
  tapCompletedRow(map, COFFEE.id);
  assert.equal(selectedId(map), COFFEE.id);

  map.closeSelectedPlace();
  tapCompletedRow(map, RAMEN.id);
  assert.equal(selectedId(map), RAMEN.id, 'a later target selects the later place');
}

// ---------------------------------------------------------------------------
// 5. THE ROOT CAUSE: the SAME completed row tapped twice must work twice
// ---------------------------------------------------------------------------
{
  resetOpenSavedPlaceRequests();
  const map = new MapScreen([COFFEE, RAMEN]);
  tapCompletedRow(map, COFFEE.id);
  assert.equal(selectedId(map), COFFEE.id, 'first tap opens the place');

  map.closeSelectedPlace();
  tapCompletedRow(map, COFFEE.id);
  assert.equal(selectedId(map), COFFEE.id, 'the SAME place opens again on a second tap');

  // A -> B -> A, the physical acceptance sequence.
  map.closeSelectedPlace();
  tapCompletedRow(map, RAMEN.id);
  assert.equal(selectedId(map), RAMEN.id);
  map.closeSelectedPlace();
  tapCompletedRow(map, COFFEE.id);
  assert.equal(selectedId(map), COFFEE.id, 'returning to the first place still works');
}

// ---------------------------------------------------------------------------
// 6. Stale intent: a consumed request never re-opens the place
// ---------------------------------------------------------------------------
{
  resetOpenSavedPlaceRequests();
  const map = new MapScreen([COFFEE, RAMEN]);
  tapCompletedRow(map, COFFEE.id);
  assert.equal(selectedId(map), COFFEE.id);

  map.closeSelectedPlace();
  // Unrelated re-renders: location fix, marker update, theme change, ...
  map.rerender();
  map.rerender();
  map.rerender();
  assert.equal(selectedId(map), null, 'the closed place does not reopen on re-render');

  // Even a full remount with the SAME stale params still attached to the route
  // must not resurrect it — the ledger outlives the screen.
  map.remount();
  assert.equal(selectedId(map), null, 'a stale param cannot reopen the place after a remount');
}

// ---------------------------------------------------------------------------
// 7. Deleted / missing save: no crash, no wrong place, no name matching
// ---------------------------------------------------------------------------
{
  resetOpenSavedPlaceRequests();
  const map = new MapScreen([RAMEN]);
  tapCompletedRow(map, 'sp-deleted');
  assert.equal(map.refreshCount, 1, 'one refetch before giving up');
  map.settleRefresh([RAMEN]); // still gone
  assert.equal(selectedId(map), null, 'never falls back to some other place');
  assert.deepEqual(map.messages, ['This place is no longer available.']);

  // Bounded: further renders neither refetch nor re-message.
  map.rerender();
  map.rerender();
  assert.equal(map.refreshCount, 1, 'no refetch loop for a genuinely absent place');
  assert.equal(selectedId(map), null);

  // The map is still fully usable afterwards.
  tapCompletedRow(map, RAMEN.id);
  assert.equal(selectedId(map), RAMEN.id, 'a valid target still works after a missing one');
}

// ---------------------------------------------------------------------------
// 8. decideSavedPlaceFocus policy, directly
// ---------------------------------------------------------------------------
{
  const base = {
    requestKey: 'req-1',
    handled: false,
    mapReady: true,
    found: false,
    loading: false,
    refreshRequested: false,
    refreshSettled: false,
  };
  assert.equal(decideSavedPlaceFocus({ ...base, requestKey: null }), 'idle', 'no target');
  assert.equal(decideSavedPlaceFocus({ ...base, handled: true }), 'idle', 'already consumed');
  assert.equal(decideSavedPlaceFocus({ ...base, mapReady: false }), 'wait', 'map not ready');
  assert.equal(decideSavedPlaceFocus({ ...base, found: true }), 'focus');
  assert.equal(decideSavedPlaceFocus({ ...base, loading: true }), 'wait', 'data in flight');
  assert.equal(decideSavedPlaceFocus(base), 'refresh', 'absent + settled -> one refetch');
  assert.equal(
    decideSavedPlaceFocus({ ...base, refreshRequested: true }),
    'wait',
    'the requested refetch has not settled yet',
  );
  assert.equal(
    decideSavedPlaceFocus({ ...base, refreshRequested: true, refreshSettled: true }),
    'missing',
  );
  // A place that shows up mid-refetch is focused, never reported missing.
  assert.equal(
    decideSavedPlaceFocus({ ...base, found: true, refreshRequested: true, refreshSettled: true }),
    'focus',
  );
  // `handled` wins over everything, so consumption is truly terminal.
  assert.equal(decideSavedPlaceFocus({ ...base, handled: true, found: true }), 'idle');
}

// ---------------------------------------------------------------------------
// 9. savedPlaceFocusKey: request id first, identifier only as the legacy path
// ---------------------------------------------------------------------------
{
  assert.equal(
    savedPlaceFocusKey({ openRequestId: 'open-1', savedPlaceId: 'sp1', googlePlaceId: 'gp1' }),
    'open-1',
    'the intent is the key when one exists',
  );
  assert.equal(savedPlaceFocusKey({ savedPlaceId: 'sp1', googlePlaceId: 'gp1' }), 'sp1');
  assert.equal(savedPlaceFocusKey({ googlePlaceId: 'gp1' }), 'gp1');
  assert.equal(savedPlaceFocusKey({}), null);
  assert.equal(savedPlaceFocusKey({ openRequestId: '  ', savedPlaceId: 'sp1' }), 'sp1');
}

// ---------------------------------------------------------------------------
// 10. Ledger hygiene
// ---------------------------------------------------------------------------
{
  resetOpenSavedPlaceRequests();
  assert.equal(isOpenSavedPlaceRequestHandled('open-x'), false);
  markOpenSavedPlaceRequestHandled('open-x');
  assert.equal(isOpenSavedPlaceRequestHandled('open-x'), true);
  // Never throws on junk, and junk is never "handled".
  for (const junk of [null, undefined, '', '   ']) {
    markOpenSavedPlaceRequestHandled(junk);
    assert.equal(isOpenSavedPlaceRequestHandled(junk), false);
  }
  // Bounded: a long session cannot grow the ledger without limit, and the most
  // recent requests are the ones that survive.
  for (let i = 0; i < 200; i += 1) markOpenSavedPlaceRequestHandled(`open-bulk-${i}`);
  assert.equal(isOpenSavedPlaceRequestHandled('open-bulk-199'), true, 'recent requests are kept');
  assert.equal(isOpenSavedPlaceRequestHandled('open-bulk-0'), false, 'oldest are evicted');
}

// ---------------------------------------------------------------------------
// 11. Screen wiring — the map and the queue must actually use this contract
// ---------------------------------------------------------------------------
{
  const map = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
  assert.match(map, /openRequestId\?: string \| string\[\]/, 'the map reads the request id param');
  assert.match(map, /decideSavedPlaceFocus\(\{/, 'the map uses the shared decision');
  assert.match(map, /markOpenSavedPlaceRequestHandled\(openRequestId\)/, 'requests are consumed');
  assert.doesNotMatch(map, /setTimeout\([\s\S]{0,80}selectPlace/, 'no timing hacks');
  // The focus path must reuse the marker-selection path, not a bespoke UI.
  assert.match(map, /selectPlace\(target\)/, 'reuses the marker-selection path');
  // The map must not give up the moment the list lacks the id.
  assert.doesNotMatch(
    map,
    /if \(validPlaces\.length === 0\) return; \/\/ wait for data to arrive/,
    'the drop-on-empty-list early return is gone',
  );

  const queue = readFileSync(join(process.cwd(), 'app/share-jobs/index.tsx'), 'utf8');
  assert.match(
    queue,
    /upsertSavedPlaceIntoCache\(item\.savedPlace\)[\s\S]{0,200}leaveQueueForMap\(\{ savedPlaceId: item\.savedPlaceId/,
    'the queue seeds the exact row it already holds, then navigates by its id',
  );
  assert.doesNotMatch(queue, /savedPlace\.place\.name[^\n]*navigat/i, 'never navigates by name');
}

console.log('PASS completed queue row -> exact saved place opens on the map');
