/**
 * scripts/testSavedPlacePinState.ts
 *
 * Visited is history. Dimmed is current inactivity.
 *
 * The bug: the marker's opacity was `archived_at || visited_at ? 0.45 : 1`,
 * which reads only history. Once a place was marked visited its pin dimmed
 * permanently — re-enabling its nearby reminder could never brighten it, and
 * the only way the old expression allowed a bright pin again was to erase the
 * visit. These tests pin the derived rule AND the fact that nothing in the
 * reactivation path writes to `visited_at`.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testSavedPlacePinState.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PIN_OPACITY_ACTIVE,
  PIN_OPACITY_INACTIVE,
  PIN_OPACITY_OUT_OF_FOCUS,
  savedPlacePinOpacity,
  savedPlacePinState,
} from '../lib/savedPlacePinState';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const VISITED_AT = '2026-08-15T18:00:00.000Z';

// ---------------------------------------------------------------------------
// A. New / unvisited, reminder active → bright
// ---------------------------------------------------------------------------
{
  const row = { visited_at: null, archived_at: null, notifications_enabled: true };
  assert.equal(savedPlacePinState(row), 'active');
  assert.equal(savedPlacePinOpacity(row), PIN_OPACITY_ACTIVE);
}

// ---------------------------------------------------------------------------
// B. Visited, reminder inactive → dim
// ---------------------------------------------------------------------------
{
  const row = { visited_at: VISITED_AT, archived_at: null, notifications_enabled: false };
  assert.equal(savedPlacePinState(row), 'inactive');
  assert.equal(savedPlacePinOpacity(row), PIN_OPACITY_INACTIVE);
}

// ---------------------------------------------------------------------------
// C. Visited, reminder turned back ON → bright again
// ---------------------------------------------------------------------------
{
  const row = { visited_at: VISITED_AT, archived_at: null, notifications_enabled: true };
  assert.equal(savedPlacePinState(row), 'active', 'the whole point of the fix');
  assert.equal(savedPlacePinOpacity(row), PIN_OPACITY_ACTIVE);
}

// ---------------------------------------------------------------------------
// D. History survives reactivation
// ---------------------------------------------------------------------------
{
  // The full lifecycle, as one object mutated only the way the app mutates it.
  const row = { visited_at: null as string | null, archived_at: null, notifications_enabled: true };
  assert.equal(savedPlacePinState(row), 'active', 'saved → bright');

  // markVisited: stamps the visit and pauses reminders.
  row.visited_at = VISITED_AT;
  row.notifications_enabled = false;
  assert.equal(savedPlacePinState(row), 'inactive', 'visited → dim');

  // The user re-enables the reminder. Nothing else changes.
  row.notifications_enabled = true;
  assert.equal(savedPlacePinState(row), 'active', 'reactivated → bright');
  assert.equal(row.visited_at, VISITED_AT, 'and Nearr still knows they went');

  // E. Off again → dim again, still remembering.
  row.notifications_enabled = false;
  assert.equal(savedPlacePinState(row), 'inactive', 'quiet again → dim again');
  assert.equal(row.visited_at, VISITED_AT);
}

// ---------------------------------------------------------------------------
// The negative case: reminders off is NOT the same fact as visited
// ---------------------------------------------------------------------------
{
  const unvisitedQuiet = { visited_at: null, archived_at: null, notifications_enabled: false };
  assert.equal(
    savedPlacePinState(unvisitedQuiet),
    'active',
    'a place you have never been to is not "done" just because it is quiet',
  );
  assert.equal(savedPlacePinOpacity(unvisitedQuiet), PIN_OPACITY_ACTIVE);
}

// Archived behaves like visited: history that the reminder can re-arm.
{
  assert.equal(
    savedPlacePinState({ archived_at: VISITED_AT, notifications_enabled: false }),
    'inactive',
  );
  assert.equal(
    savedPlacePinState({ archived_at: VISITED_AT, notifications_enabled: true }),
    'active',
  );
}

// Degenerate input never throws and never invents a state.
{
  assert.equal(savedPlacePinState(null), 'active');
  assert.equal(savedPlacePinState(undefined), 'active');
  assert.equal(savedPlacePinState({}), 'active');
  assert.equal(
    savedPlacePinState({ visited_at: '   ', notifications_enabled: false }),
    'active',
    'whitespace is not a visit',
  );
}

// Map-group focus dimming is a different concern and always wins.
{
  const live = { visited_at: null, archived_at: null, notifications_enabled: true };
  assert.equal(savedPlacePinOpacity(live, true), PIN_OPACITY_OUT_OF_FOCUS);
  assert.ok(PIN_OPACITY_OUT_OF_FOCUS < PIN_OPACITY_INACTIVE, 'and is the faintest state');
}

// ---------------------------------------------------------------------------
// Wiring: the marker uses the derived rule AND re-renders when it changes
// ---------------------------------------------------------------------------
{
  const marker = read('components/map/NearrMapMarker.tsx');

  assert.ok(marker.includes('savedPlacePinOpacity(place, dimmed)'), 'the marker uses the tested rule');
  assert.ok(
    !/opacity=\{dimmed \? 0\.22 : place\.archived_at \|\| place\.visited_at/.test(marker),
    'the history-only expression is gone',
  );

  // The memo comparator is the second half of the bug: a correct opacity that
  // never re-evaluates is invisible.
  const start = marker.indexOf('export const NearrMapMarker = memo');
  const comparator = marker.slice(start, marker.indexOf(');', start));
  assert.ok(
    comparator.includes('prev.place.notifications_enabled === next.place.notifications_enabled'),
    'a reminder toggle must invalidate the memoized marker',
  );
  for (const field of ['visited_at', 'archived_at']) {
    assert.ok(comparator.includes(field), `${field} is still compared`);
  }
}

// The reminder path must not touch visit history, and marking visited must not
// delete the row — the two mutations stay in their own lanes.
{
  const detail = read('components/map/SelectedPlaceDetails.tsx');
  const start = detail.indexOf('async function handleSave(');
  const body = detail.slice(start, detail.indexOf('\n  }', start));
  assert.ok(body.includes('notifications_enabled: notifyOn'), 'the toggle writes the reminder');
  assert.ok(
    !/visited_at|archived_at|markVisited/.test(body),
    'and never clears visit history to brighten a pin',
  );

  const service = read('services/savedPlacesService.ts');
  const visitStart = service.indexOf('export async function markVisited(');
  const visitBody = service.slice(visitStart, service.indexOf('\n}', visitStart));
  assert.ok(visitBody.includes('visited_at: nowIso'), 'markVisited still stamps the visit');
  assert.ok(!/\.delete\(\)/.test(visitBody), 'and deletes nothing');
}

// Nothing in the pin module can imply a write.
{
  const src = read('lib/savedPlacePinState.ts');
  assert.ok(!/^import /m.test(src), 'pure: no imports');
  assert.ok(
    !/supabase|updateSavedPlace|markVisited|fetch\(/.test(src.slice(src.lastIndexOf('*/'))),
    'it reads state, it never mutates it',
  );
}

console.log('PASS saved-place pin state: dim means inactive, visited stays history');
