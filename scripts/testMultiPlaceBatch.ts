import assert from 'node:assert/strict';

import {
  applyBatchSaveOutcomes,
  batchCompletionSavedPlaceIds,
  chooseBatchCandidate,
  closeBatchSearch,
  duplicateSelectionOwner,
  failBatchSearch,
  finishBatchSearch,
  openBatchSearch,
  reconcileMultiPlaceBatch,
  recoverableBatchRowCount,
  rowCandidate,
  selectedBatchTargets,
  setBatchSearchQuery,
  setCandidateSelector,
  startBatchSearch,
  toggleBatchRow,
} from '../lib/multiPlaceBatch';
import { saveSelectedLabel, type ShareJobMentionSlot } from '../lib/shareJobResult';

function candidate(id: string, name = id) {
  return {
    googlePlaceId: id,
    name,
    formattedAddress: `${name}, California, USA`,
    latitude: 34,
    longitude: -118,
    types: ['restaurant'],
    primaryType: 'restaurant',
    matchScore: 0.95,
  };
}

function slots(count: number): ShareJobMentionSlot[] {
  return Array.from({ length: count }, (_, index) => ({
    mentionId: `logical-${index + 1}`,
    displayName: `Place ${index + 1}`,
    contextLabel: 'Los Angeles, CA',
    primaryVenueName: null,
    hostVenueName: null,
    relationshipType: null,
    outcome: index === 1 ? 'ambiguous_candidates' : 'verified_single',
    candidates: index === 1
      ? [candidate(`p${index + 1}a`), candidate(`p${index + 1}b`)]
      : [candidate(`p${index + 1}`)],
  }));
}

for (const count of [0, 1, 2, 5, 8, 10]) {
  const batch = reconcileMultiPlaceBatch({ jobId: `job-${count}`, slots: slots(count) });
  const expected = count <= 1 ? count : count - 1;
  assert.equal(batch.order.length, count, `${count} rows remain usable without a five-row UI cap`);
  assert.equal(selectedBatchTargets(batch).length, expected, `${count} rows calculate confident defaults`);
  assert.equal(saveSelectedLabel(expected), `Save selected (${expected})`);
}

// Stable identities survive reordering; selections stay with their logical row.
{
  const initial = reconcileMultiPlaceBatch({ jobId: 'stable', slots: slots(5) });
  const deselected = toggleBatchRow(initial, 'logical-3');
  const reordered = reconcileMultiPlaceBatch({
    jobId: 'stable',
    slots: [...slots(5)].reverse(),
    previous: deselected,
  });
  assert.deepEqual(reordered.order, ['logical-5', 'logical-4', 'logical-3', 'logical-2', 'logical-1']);
  assert.equal(reordered.rows['logical-3']!.selectedForSave, false, 'reordering never moves selection by index');
  assert.equal(reordered.rows['logical-1']!.selectedForSave, true);
}

// Ambiguous disclosure and candidate selection affect exactly one row and do not persist anything.
{
  const initial = reconcileMultiPlaceBatch({ jobId: 'ambiguous', slots: slots(5) });
  const expanded = setCandidateSelector(initial, 'logical-2', true);
  assert.equal(expanded.rows['logical-2']!.candidateSelectorExpanded, true);
  const chosen = chooseBatchCandidate(expanded, 'logical-2', candidate('p2b'));
  assert.equal(rowCandidate(chosen.rows['logical-2']!)?.googlePlaceId, 'p2b');
  assert.equal(chosen.rows['logical-2']!.selectedForSave, true);
  assert.equal(chosen.rows['logical-1']!.selectedCandidateId, initial.rows['logical-1']!.selectedCandidateId);
  assert.equal(chosen.rows['logical-3']!.selectedCandidateId, initial.rows['logical-3']!.selectedCandidateId);
  assert.equal(chosen.rows['logical-2']!.persistence, 'pending', 'candidate selection is not a save');
}

// Unmatched inline search is row-scoped, auto-search-ready, retryable, and closes without batch loss.
{
  const source = slots(5).map((slot, index) => index === 2
    ? { ...slot, outcome: 'no_match' as const, candidates: [] }
    : slot);
  const initial = reconcileMultiPlaceBatch({ jobId: 'search', slots: source });
  const opened = openBatchSearch(initial, 'logical-3');
  assert.equal(opened.rows['logical-3']!.search.phase, 'idle');
  assert.equal(opened.rows['logical-3']!.search.query, 'Place 3');
  const searching = startBatchSearch(opened, 'logical-3');
  assert.equal(searching.rows['logical-3']!.search.phase, 'searching');
  const failed = failBatchSearch(searching, 'logical-3');
  assert.equal(failed.rows['logical-3']!.search.phase, 'error');
  const edited = setBatchSearchQuery(failed, 'logical-3', 'Recovered Place LA');
  const results = finishBatchSearch(edited, 'logical-3', [candidate('recovered', 'Recovered Place')]);
  assert.equal(results.rows['logical-3']!.search.candidates.length, 1);
  const resolved = chooseBatchCandidate(results, 'logical-3', results.rows['logical-3']!.search.candidates[0]!);
  assert.equal(resolved.rows['logical-3']!.resolution, 'resolved');
  assert.equal(resolved.rows['logical-3']!.persistence, 'pending', 'search result returns to row without saving');
  assert.equal(resolved.order.length, 5, 'other rows remain in the persistent batch');
  assert.equal(closeBatchSearch(resolved, 'logical-3').rows['logical-3']!.search.phase, 'closed');
}

// Already-saved and auto-saved rows retain ids, cannot toggle, and are excluded from N.
{
  const source = slots(3);
  source[2] = { ...source[2]!, saveState: 'auto_saved', savedPlaceId: 'saved-auto' };
  const batch = reconcileMultiPlaceBatch({
    jobId: 'saved',
    slots: source,
    savedByGoogleId: { p1: 'saved-existing' },
  });
  assert.equal(batch.rows['logical-1']!.persistence, 'already_saved');
  assert.equal(batch.rows['logical-1']!.savedPlaceId, 'saved-existing');
  assert.equal(batch.rows['logical-3']!.persistence, 'saved');
  assert.equal(batch.rows['logical-3']!.savedPlaceId, 'saved-auto');
  assert.equal(selectedBatchTargets(batch).length, 0);
  assert.equal(toggleBatchRow(batch, 'logical-1'), batch, 'already-saved rows are not new-save toggles');
}

// Duplicate provider selections count and persist only once.
{
  let batch = reconcileMultiPlaceBatch({ jobId: 'dedupe', slots: slots(2) });
  batch = chooseBatchCandidate(batch, 'logical-2', candidate('p1', 'Same Provider Place'));
  assert.equal(selectedBatchTargets(batch).length, 1);
  assert.equal(duplicateSelectionOwner(batch, 'logical-2'), 'logical-1');
  assert.equal(toggleBatchRow(batch, 'logical-2'), batch, 'duplicate provider row cannot enter the new-save count');
}

// Partial save keeps successes, leaves failure selected/recoverable, and accumulates ids for later navigation.
{
  const initial = reconcileMultiPlaceBatch({ jobId: 'partial', slots: slots(4) });
  const outcomes = [
    { logicalPlaceId: 'logical-1', candidateId: 'p1', status: 'saved' as const, savedPlaceId: 'saved-1' },
    { logicalPlaceId: 'logical-3', candidateId: 'p3', status: 'saved' as const, savedPlaceId: 'saved-3' },
    { logicalPlaceId: 'logical-4', candidateId: 'p4', status: 'failed' as const, savedPlaceId: null },
  ];
  const next = applyBatchSaveOutcomes(initial, outcomes);
  assert.equal(next.rows['logical-1']!.persistence, 'saved');
  assert.equal(next.rows['logical-3']!.persistence, 'saved');
  assert.equal(next.rows['logical-4']!.selectedForSave, true);
  assert.ok(next.rows['logical-4']!.saveError);
  assert.deepEqual(next.feedback, { attempted: 3, saved: 2, alreadySaved: 0, failed: 1 });
  assert.equal(recoverableBatchRowCount(next), 2, 'ambiguous and failed rows remain recoverable');
  assert.deepEqual(batchCompletionSavedPlaceIds(next).createdSavedPlaceIds, ['saved-1', 'saved-3']);
}

// Host relationship remains one logical row.
{
  const host: ShareJobMentionSlot = {
    mentionId: 'hosted', displayName: 'X Eats at Brewery X', contextLabel: 'Anaheim, CA',
    primaryVenueName: 'X Eats', hostVenueName: 'Brewery X', relationshipType: 'located_at',
    outcome: 'verified_single', candidates: [candidate('x-eats', 'X Eats')],
  };
  const batch = reconcileMultiPlaceBatch({ jobId: 'host', slots: [host] });
  assert.deepEqual(batch.order, ['hosted']);
  assert.equal(batch.rows.hosted!.primaryVenueName, 'X Eats');
  assert.equal(batch.rows.hosted!.hostVenueName, 'Brewery X');
}

console.log('PASS stable persistent multi-place batch, inline resolution, dedupe, and partial-save behavior');
