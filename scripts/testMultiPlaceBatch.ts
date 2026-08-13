import assert from 'node:assert/strict';

import {
  mergeMentionSearchResults,
  preselectedCandidateIds,
  saveSelectedLabel,
  selectedUnsavedCandidates,
  type ShareJobMentionSlot,
} from '../lib/shareJobResult';

function candidate(id: string, name = id) {
  return {
    googlePlaceId: id,
    name,
    formattedAddress: `${name}, California, USA`,
    latitude: 34,
    longitude: -118,
    types: ['restaurant'],
    matchScore: 0.95,
  };
}

function slots(count: number): ShareJobMentionSlot[] {
  return Array.from({ length: count }, (_, index) => ({
    mentionId: `m${index + 1}`,
    displayName: `Place ${index + 1}`,
    primaryVenueName: null,
    hostVenueName: null,
    relationshipType: null,
    outcome: index === 1 ? 'ambiguous_candidates' : 'verified_single',
    candidates: index === 1
      ? [candidate(`p${index + 1}a`), candidate(`p${index + 1}b`)]
      : [candidate(`p${index + 1}`)],
  }));
}

for (const count of [1, 2, 5, 8, 10]) {
  const batch = slots(count);
  const selected = preselectedCandidateIds(batch);
  const expectedSelected = count === 1 ? 1 : count - 1;
  assert.equal(selected.size, expectedSelected, `${count} batch rows keep only confident defaults selected`);
  assert.equal(
    selectedUnsavedCandidates(batch, selected, new Set()).length,
    expectedSelected,
    `${count} batch rows can be saved together after ambiguity is resolved`,
  );
}

// Resolved rows are selected by default; already-saved rows are excluded.
{
  const batch = slots(5);
  const selected = preselectedCandidateIds(batch, new Set(['p1']));
  assert.ok(!selected.has('p1'));
  assert.ok(selected.has('p3'));
  assert.equal(selectedUnsavedCandidates(batch, selected, new Set(['p1'])).length, 3);
}

// Resolving one unmatched row preserves every other row and changes only that row.
{
  const batch = slots(5).map((slot, index) =>
    index === 2 ? { ...slot, outcome: 'no_match' as const, candidates: [] } : slot,
  );
  const resolved = mergeMentionSearchResults(batch, 'm3', [candidate('p3-fixed', 'Recovered Place')]);
  assert.equal(resolved.length, 5, 'the batch remains one persistent batch');
  assert.equal(resolved[0]!.mentionId, 'm1');
  assert.equal(resolved[1]!.mentionId, 'm2');
  assert.equal(resolved[2]!.mentionId, 'm3');
  assert.equal(resolved[2]!.candidates[0]!.googlePlaceId, 'p3-fixed');
  assert.equal(resolved[3]!.mentionId, 'm4');
  assert.equal(resolved[4]!.mentionId, 'm5');
}

// A search with no result still preserves the row as unmatched.
{
  const batch = slots(2);
  const resolved = mergeMentionSearchResults(batch, 'm2', []);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[1]!.outcome, 'no_match');
  assert.deepEqual(resolved[1]!.candidates, []);
}

assert.equal(saveSelectedLabel(1), 'Save 1 place');
assert.equal(saveSelectedLabel(5), 'Save 5 places');
assert.equal(saveSelectedLabel(0), 'Save selected places');

console.log('PASS persistent multi-place batch merge, selection, partial save, and counts');
