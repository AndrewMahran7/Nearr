import assert from 'node:assert/strict';

import {
  QUEUE_EMPTY_COPY,
  QUEUE_SWIPE_THRESHOLD,
  applyClearCompleted,
  buildQueueSections,
  canClearCompleted,
  clearCompletedLabel,
  clearableRowIds,
  filterDismissedQueueRows,
  normalizeActiveQueueRows,
  activeQueueCount,
  isInboxEmpty,
  queueAccessibilityActions,
  queueSwipeAvailability,
  swipeActionFor,
  type QueueRow,
} from '../lib/queueInbox';

const processing: QueueRow = { id: 'p1', status: 'processing_metadata' };
const queued: QueueRow = { id: 'p2', status: 'queued' };
const needsHelp: QueueRow = {
  id: 'n1',
  status: 'needs_help',
  hasResolvedCandidate: true,
  candidateIsPersistable: true,
  candidateCount: 1,
  decision: 'candidate_confirmation',
};
const needsSearch: QueueRow = {
  id: 'n2',
  status: 'needs_help',
  hasResolvedCandidate: false,
  candidateCount: 0,
};
const ambiguous: QueueRow = {
  id: 'n4',
  status: 'needs_help',
  hasResolvedCandidate: true,
  candidateIsPersistable: true,
  candidateCount: 2,
  decision: 'multi_candidate_confirmation',
};
const manualFallback: QueueRow = {
  id: 'n5',
  status: 'needs_help',
  hasResolvedCandidate: true,
  candidateIsPersistable: true,
  candidateCount: 1,
  decision: 'manual_fallback',
};
const failed: QueueRow = { id: 'f1', status: 'failed' };
const completed: QueueRow = { id: 'c1', status: 'completed', savedPlaceId: 'sp1' };
const cancelled: QueueRow = { id: 'x1', status: 'cancelled' };

const all = [processing, queued, needsHelp, needsSearch, failed, completed, cancelled];

// ---- sections --------------------------------------------------------------
const sections = buildQueueSections(all);
assert.deepEqual(sections.map((s) => s.key), ['working', 'needs_you', 'recently_completed']);
assert.deepEqual(sections[0]!.rows.map((r) => r.id), ['p1', 'p2']);
assert.deepEqual(sections[1]!.rows.map((r) => r.id), ['n1', 'n2', 'f1']);
assert.deepEqual(sections[2]!.rows.map((r) => r.id), ['c1']);
assert.equal(sections[0]!.title, 'Working');
assert.equal(sections[1]!.title, 'Needs you');
assert.equal(sections[2]!.title, 'Recently completed');
assert.ok(!JSON.stringify(sections).includes('x1'), 'cancelled rows are not listed');
assert.deepEqual(buildQueueSections([]), [], 'no empty sections are emitted');

// ---- clear completed preserves unresolved ----------------------------------
assert.deepEqual(clearableRowIds(all), ['c1'], 'only completed rows are clearable');
assert.equal(canClearCompleted(all), true);
assert.equal(canClearCompleted([processing, needsHelp, failed]), false, 'action hides when nothing is eligible');
assert.equal(canClearCompleted([]), false);
assert.equal(clearCompletedLabel(1), 'Clear 1 completed');
assert.equal(clearCompletedLabel(4), 'Clear 4 completed');

const afterClear = applyClearCompleted(all, clearableRowIds(all));
assert.deepEqual(
  afterClear.map((r) => r.id),
  ['p1', 'p2', 'n1', 'n2', 'f1', 'x1'],
  'unresolved and active rows survive clearing',
);

// ---- active work cannot be cleared -----------------------------------------
const forcedClear = applyClearCompleted(all, ['p1', 'p2', 'n1', 'n2', 'f1', 'c1']);
assert.ok(forcedClear.some((r) => r.id === 'p1'), 'processing row cannot be cleared even if named');
assert.ok(forcedClear.some((r) => r.id === 'n1'), 'needs_help row cannot be cleared even if named');
assert.ok(forcedClear.some((r) => r.id === 'f1'), 'failed row cannot be cleared even if named');
assert.ok(!forcedClear.some((r) => r.id === 'c1'), 'the completed row is cleared');

// Idempotent: re-applying yields the same list.
assert.deepEqual(
  applyClearCompleted(afterClear, clearableRowIds(afterClear)).map((r) => r.id),
  afterClear.map((r) => r.id),
);
assert.deepEqual(applyClearCompleted(all, []).map((r) => r.id), all.map((r) => r.id));

// ---- swipe save ------------------------------------------------------------
assert.deepEqual(queueSwipeAvailability(needsHelp), {
  save: true,
  dismiss: true,
  saveBlockedReason: null,
});

// Processing rows cannot be saved prematurely.
assert.equal(queueSwipeAvailability(processing).save, false);
assert.equal(queueSwipeAvailability(processing).saveBlockedReason, 'processing');
assert.equal(queueSwipeAvailability(queued).save, false);

// Unresolved rows without a candidate cannot be saved.
assert.equal(queueSwipeAvailability(needsSearch).save, false);
assert.equal(queueSwipeAvailability(needsSearch).saveBlockedReason, 'no_candidate');
assert.equal(queueSwipeAvailability(ambiguous).save, false);
assert.equal(queueSwipeAvailability(ambiguous).saveBlockedReason, 'ambiguous');
assert.equal(queueSwipeAvailability(manualFallback).save, false);
assert.equal(queueSwipeAvailability(manualFallback).saveBlockedReason, 'manual_fallback');
assert.equal(queueSwipeAvailability(failed).save, false);
assert.equal(queueSwipeAvailability(failed).saveBlockedReason, 'failed');

// ---- no duplicate save -----------------------------------------------------
assert.equal(queueSwipeAvailability(completed).save, false, 'already-saved rows cannot save again');
assert.equal(queueSwipeAvailability(completed).saveBlockedReason, 'already_saved');
const alreadySaved: QueueRow = { ...needsHelp, id: 'n3', savedPlaceId: 'sp9' };
assert.equal(queueSwipeAvailability(alreadySaved).save, false, 'a saved candidate never re-saves');

// ---- swipe delete ----------------------------------------------------------
for (const row of all) {
  assert.equal(queueSwipeAvailability(row).dismiss, true, 'every row can leave the queue');
}
assert.equal(swipeActionFor(-QUEUE_SWIPE_THRESHOLD, queueSwipeAvailability(needsHelp)), 'dismiss');
assert.equal(swipeActionFor(QUEUE_SWIPE_THRESHOLD, queueSwipeAvailability(needsHelp)), 'save');
assert.equal(swipeActionFor(0, queueSwipeAvailability(needsHelp)), null, 'a tap is not a swipe');
assert.equal(swipeActionFor(30, queueSwipeAvailability(needsHelp)), null, 'a short drag does not commit');
assert.equal(
  swipeActionFor(QUEUE_SWIPE_THRESHOLD, queueSwipeAvailability(processing)),
  null,
  'swiping right on a processing row does nothing',
);
assert.equal(
  swipeActionFor(QUEUE_SWIPE_THRESHOLD, queueSwipeAvailability(needsSearch)),
  null,
  'swiping right without a candidate does nothing',
);

// ---- inaccessible swipe action has an alternative --------------------------
assert.deepEqual(
  queueAccessibilityActions(needsHelp).map((a) => a.name),
  ['save', 'dismiss'],
  'both swipes are exposed as accessibility actions',
);
assert.deepEqual(queueAccessibilityActions(processing).map((a) => a.name), ['dismiss']);
assert.deepEqual(queueAccessibilityActions(needsSearch).map((a) => a.name), ['dismiss']);
assert.deepEqual(queueAccessibilityActions(completed).map((a) => a.name), ['dismiss']);
for (const row of all) {
  const actions = queueAccessibilityActions(row);
  const availability = queueSwipeAvailability(row);
  assert.equal(
    actions.some((a) => a.name === 'save'),
    availability.save,
    'accessibility actions mirror swipe availability exactly',
  );
  assert.equal(actions.some((a) => a.name === 'dismiss'), availability.dismiss);
  for (const action of actions) assert.ok(action.label.length > 0, 'every action is labelled');
}

// ---- empty state -----------------------------------------------------------
assert.equal(isInboxEmpty([]), true);
assert.equal(isInboxEmpty([cancelled]), true, 'only-cancelled is a genuine empty state');
assert.equal(isInboxEmpty(all), false);
assert.equal(isInboxEmpty(applyClearCompleted([completed], ['c1'])), true, 'clearing can reach empty');
assert.equal(QUEUE_EMPTY_COPY.title, 'Nothing waiting');
assert.match(QUEUE_EMPTY_COPY.body, /share will show up here/i);

// ---- persisted dismissal filtering ----------------------------------------
assert.deepEqual(
  filterDismissedQueueRows([processing, needsHelp, completed], new Set(['p1', 'c1'])).map((row) => row.id),
  ['n1'],
  'a dismissed active or completed id cannot be resurrected by a fresh payload',
);

// ---- exact physical badge/sheet parity regression -------------------------
const historical = Array.from({ length: 40 }, (_, index): QueueRow => ({
  id: `historical-${index + 1}`,
  status: 'needs_help',
}));
const currentSantaFe: QueueRow = {
  ...needsHelp,
  id: 'santa-fe-current',
};
const dismissedHistorical = new Set(historical.map((row) => row.id));
const screenshotRows = normalizeActiveQueueRows(
  [...historical, currentSantaFe, currentSantaFe],
  dismissedHistorical,
);
assert.deepEqual(screenshotRows.map((row) => row.id), ['santa-fe-current']);
assert.equal(activeQueueCount([...historical, currentSantaFe], dismissedHistorical), 1);
assert.equal(buildQueueSections(screenshotRows).flatMap((section) => section.rows).length, 1);

const afterSantaFeSaved = normalizeActiveQueueRows(
  [...historical, { ...currentSantaFe, status: 'completed', savedPlaceId: 'saved-santa-fe' }],
  dismissedHistorical,
);
assert.equal(activeQueueCount(afterSantaFeSaved), 0, 'saved transition removes the badge immediately');
assert.deepEqual(afterSantaFeSaved, [], 'saved transition removes the Needs-you row');

console.log('PASS queue inbox sections, clear completed, swipe policy, accessibility, empty state');
