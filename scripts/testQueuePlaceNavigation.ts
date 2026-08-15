/**
 * scripts/testQueuePlaceNavigation.ts
 *
 * Queue -> place navigation and the completed-row removal affordance.
 *
 * Two invariants: following a queue row to the map is ONE navigation action
 * (the queue tears down, the selection survives), and the completed-row action
 * — which deletes the saved place, not a history row — is gated by the same
 * confirmation the map's place detail uses.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { routeShareJobCard, shouldDismissQueueForRoute } from '../lib/shareJobRouting';
import {
  savedPlaceRemovalA11yLabel,
  savedPlaceRemovalCopy,
} from '../lib/savedPlaceRemoval';

// --- 1-3. A saved place from the queue dismisses the queue ------------------
{
  const completed = { id: 'job-1', status: 'completed', saved_place_id: 'saved-1' };
  const route = routeShareJobCard(completed);
  assert.deepEqual(route, { kind: 'saved_place', savedPlaceId: 'saved-1' });
  assert.equal(shouldDismissQueueForRoute(route), true, 'the queue closes behind the place');
  // A completed job with no saved place still lands on the map, so it also
  // dismisses rather than leaving the queue over a bare map.
  assert.equal(shouldDismissQueueForRoute({ kind: 'map' }), true);
  assert.equal(shouldDismissQueueForRoute({ kind: 'saved_group', savedPlaceIds: ['a', 'b'] }), true);
}

// --- 5. Needs-help items keep the job-detail flow ---------------------------
{
  for (const status of ['needs_help', 'failed']) {
    const route = routeShareJobCard({ id: 'job-2', status });
    assert.deepEqual(route, { kind: 'queue_item', jobId: 'job-2' });
    assert.equal(
      shouldDismissQueueForRoute(route),
      false,
      'job detail pushes so Back returns to the queue',
    );
  }
  // Processing jobs also open the job detail, never a map destination.
  for (const status of ['queued', 'processing_metadata']) {
    assert.equal(shouldDismissQueueForRoute(routeShareJobCard({ id: 'j', status })), false, status);
  }
  // Terminal/unknown rows are a no-op and must not tear the queue down.
  assert.equal(shouldDismissQueueForRoute({ kind: 'queue_root' }), false);
  assert.equal(shouldDismissQueueForRoute(null), false);
  assert.equal(shouldDismissQueueForRoute(undefined), false);
}

// --- 8/10/12. Removal copy states what actually happens ---------------------
{
  const copy = savedPlaceRemovalCopy("Keno's Restaurant");
  assert.equal(copy.title, 'Remove place?');
  assert.match(copy.message, /Keno's Restaurant will be removed from your saved places\./);
  assert.equal(copy.confirmLabel, 'Remove');
  assert.equal(copy.cancelLabel, 'Cancel');
  // The queue action undoes an automatic SAVE, so it must never be worded as
  // if it only clears a history row.
  assert.doesNotMatch(copy.message, /queue|history/i, 'copy must not understate the consequence');
  // Missing names degrade to a sentence that still names the consequence.
  for (const name of [null, undefined, '', '   ']) {
    const fallback = savedPlaceRemovalCopy(name);
    assert.match(fallback.message, /removed from your saved places/);
    assert.doesNotMatch(fallback.message, /undefined|null/);
  }
}

// --- Accessibility: no icon-only ambiguity ----------------------------------
{
  assert.equal(
    savedPlaceRemovalA11yLabel("Keno's Restaurant"),
    "Remove Keno's Restaurant from your saved places",
  );
  assert.match(savedPlaceRemovalA11yLabel(null), /Remove this place/);
  assert.doesNotMatch(savedPlaceRemovalA11yLabel('X'), /undo/i, 'never described as undo');
}

// --- Queue wiring -----------------------------------------------------------
const queue = readFileSync(join(process.cwd(), 'app/share-jobs/index.tsx'), 'utf8');

// 2/3/4. The queue tears itself down BEFORE replacing, so the place is never
// left underneath it and Back cannot return to a dismissed queue.
assert.match(queue, /function leaveQueueForMap\(/);
assert.match(
  queue,
  /router\.dismissAll\(\)[\s\S]{0,200}router\.replace\(resolveOpenSavedPlaceRoute\(target\)\)/,
  'dismiss the modal stack, then replace',
);
assert.doesNotMatch(
  queue,
  /router\.push\(\{ pathname: '\/\(tabs\)\/map', params: \{ savedPlaceId/,
  'no bare push can leave the queue sitting over the place',
);
assert.doesNotMatch(queue, /setTimeout\([\s\S]{0,60}dismissAll/, 'no timing hacks');

// 5. Job detail still pushes.
assert.match(
  queue,
  /case 'queue_item':[\s\S]{0,200}router\.push\(\{ pathname: '\/share-jobs\/\[jobId\]'/,
);

// 6/7. Completed row: primary tap opens the place, remove is a separate target.
assert.match(
  queue,
  /accessibilityLabel=\{`Open \$\{item\.savedPlace\.place\.name\}`\}/,
  'row tap opens the place',
);
assert.match(queue, /onPress=\{\(\) => confirmRemoveRecent\(item\)\}/, 'remove is its own control');
assert.match(queue, /accessibilityLabel=\{savedPlaceRemovalA11yLabel\(/);

// 4 (affordance). A refresh/undo arrow read as "retry"; the action deletes.
assert.match(queue, /name="trash-2"/, 'removal uses an unmistakable affordance');
assert.doesNotMatch(queue, /name="rotate-ccw"/, 'the retry-looking icon is gone');

// 8/9. Confirmation gates the mutation — nothing is removed before the result.
assert.match(
  queue,
  /function confirmRemoveRecent\(item: RecentAutoSave\) \{[\s\S]{0,420}Alert\.alert\([\s\S]{0,320}style: 'destructive',[\s\S]{0,120}onPress: \(\) => void undoRecent\(item\)/,
  'the destructive mutation only runs from the confirm button',
);
assert.ok(
  queue.indexOf('function confirmRemoveRecent') < queue.indexOf('async function undoRecent'),
  'confirmation wraps the mutation',
);

// 11/13. Removal touches the saved place + queue refresh only — it never
// clears the user's map selection.
{
  const start = queue.indexOf('async function undoRecent');
  const body = queue.slice(start, queue.indexOf('\n  }', start));
  assert.ok(body.includes('undoAutoSavedPlace('), 'performs the real mutation');
  assert.ok(body.includes('restoreSavedPlacesCache'), 'rolls back a failed mutation');
  assert.ok(!body.includes('setSelected'), 'never clears the selected place');
}

// The map detail and the queue share ONE removal copy helper.
const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
assert.match(detail, /savedPlaceRemovalCopy\(saved\.place\.name\)/, 'detail reuses the shared copy');
assert.doesNotMatch(
  detail,
  /Alert\.alert\(\s*\n?\s*'Remove place\?'/,
  'the copy is not duplicated inline',
);

console.log('PASS queue place navigation, queue dismissal, and confirmed removal affordance');
