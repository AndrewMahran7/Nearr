import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  allEligibleBatchTargets,
  applyBatchSaveOutcomes,
  chooseBatchCandidate,
  clearAllEligibleBatchRows,
  reconcileMultiPlaceBatch,
  rowCandidate,
  selectAllEligibleBatchRows,
  selectedBatchTargets,
  toggleBatchRow,
} from '../lib/multiPlaceBatch';
import { selectionModeForPlaceResult } from '../lib/placeSelection';
import { sourceTimestampLabel, type ShareJobMentionSlot } from '../lib/shareJobResult';

function candidate(id: string, name = id, address = `${id} Main St`) {
  return {
    googlePlaceId: id,
    name,
    formattedAddress: address,
    latitude: 34,
    longitude: -118,
    types: ['restaurant'],
    matchScore: 0.95,
  };
}

function slot(
  id: string,
  candidates: ReturnType<typeof candidate>[],
  outcome: ShareJobMentionSlot['outcome'] = 'verified_single',
  extra: Partial<ShareJobMentionSlot> = {},
): ShareJobMentionSlot {
  return {
    mentionId: id,
    displayName: `Mention ${id}`,
    contextLabel: null,
    primaryVenueName: null,
    hostVenueName: null,
    relationshipType: null,
    outcome,
    candidates,
    ...extra,
  };
}

// A/B — independent places default selected and any subset remains valid.
{
  const two = reconcileMultiPlaceBatch({
    jobId: 'two',
    slots: [slot('a', [candidate('pa')]), slot('b', [candidate('pb')])],
  });
  assert.equal(two.selectionMode, 'multi_independent');
  assert.equal(selectedBatchTargets(two).length, 2, 'two independent resolved places select together');

  const three = reconcileMultiPlaceBatch({
    jobId: 'three',
    slots: [slot('a', [candidate('pa')]), slot('b', [candidate('pb')]), slot('c', [candidate('pc')])],
  });
  const subset = toggleBatchRow(three, 'b');
  assert.deepEqual(selectedBatchTargets(subset).map((target) => target.candidate.googlePlaceId), ['pa', 'pc']);
}

// C — Save all means every eligible resolved independent logical place.
{
  const initial = reconcileMultiPlaceBatch({
    jobId: 'all',
    slots: [slot('a', [candidate('pa')]), slot('b', [candidate('pb')]), slot('c', [candidate('pc')])],
  });
  const cleared = clearAllEligibleBatchRows(initial);
  assert.equal(selectedBatchTargets(cleared).length, 0);
  assert.equal(allEligibleBatchTargets(cleared).length, 3);
  assert.equal(selectedBatchTargets(selectAllEligibleBatchRows(cleared)).length, 3);
}

// D — candidates for one logical scene are mutually exclusive.
{
  const scene = slot('scene-1', [candidate('a'), candidate('b')], 'ambiguous_candidates');
  let batch = reconcileMultiPlaceBatch({ jobId: 'single-scene', slots: [scene] });
  assert.equal(batch.rows['scene-1']!.selectionMode, 'single_identity');
  batch = chooseBatchCandidate(batch, 'scene-1', scene.candidates[0]!);
  batch = chooseBatchCandidate(batch, 'scene-1', scene.candidates[1]!);
  assert.equal(rowCandidate(batch.rows['scene-1']!)?.googlePlaceId, 'b');
  assert.equal(selectedBatchTargets(batch).length, 1, 'one scene never contributes two candidate identities');
  assert.equal(selectionModeForPlaceResult({
    decision: 'multi_candidate_confirmation',
    diagnostics: { nameDrivenMultiPlace: { mode: 'single' } },
  }), 'single_identity');
}

// E — hybrid: independent scene rows, exclusive candidates within each row.
{
  const hybridSlots = [
    slot('scene-1', [candidate('s1a'), candidate('s1b')], 'ambiguous_candidates'),
    slot('scene-2', [candidate('s2')], 'verified_single'),
    slot('scene-3', [candidate('s3a'), candidate('s3b'), candidate('s3c')], 'ambiguous_candidates'),
  ];
  let hybrid = reconcileMultiPlaceBatch({ jobId: 'hybrid', slots: hybridSlots });
  hybrid = chooseBatchCandidate(hybrid, 'scene-1', hybridSlots[0]!.candidates[1]!);
  hybrid = chooseBatchCandidate(hybrid, 'scene-3', hybridSlots[2]!.candidates[2]!);
  assert.deepEqual(
    selectedBatchTargets(hybrid).map((target) => target.candidate.googlePlaceId),
    ['s1b', 's2', 's3c'],
  );
}

// F — unresolved logical places do not block resolved siblings.
{
  const partial = reconcileMultiPlaceBatch({
    jobId: 'partial',
    slots: [
      slot('resolved-1', [candidate('p1')]),
      slot('unresolved', [], 'no_match'),
      slot('resolved-2', [candidate('p2')]),
    ],
  });
  assert.deepEqual(selectedBatchTargets(partial).map((target) => target.candidate.googlePlaceId), ['p1', 'p2']);
}

// G/H — job-saved rows are terminal and repeated provider identities persist once.
{
  const deduped = reconcileMultiPlaceBatch({
    jobId: 'dedupe',
    slots: [
      slot('already', [candidate('saved')], 'verified_single', { saveState: 'already_saved', savedPlaceId: 'row-1' }),
      slot('first', [candidate('same')]),
      slot('repeat', [candidate('same')]),
    ],
  });
  assert.deepEqual(selectedBatchTargets(deduped).map((target) => target.candidate.googlePlaceId), ['same']);
}

// Save all excludes a locally known existing place, while explicit selection
// can still attach this source to that row through the canonical save path.
{
  const existing = reconcileMultiPlaceBatch({
    jobId: 'existing',
    slots: [slot('existing', [candidate('already')]), slot('new', [candidate('new')])],
    savedByGoogleId: { already: 'saved-row' },
  });
  assert.deepEqual(allEligibleBatchTargets(existing).map((target) => target.candidate.googlePlaceId), ['new']);
  const explicit = toggleBatchRow(existing, 'existing');
  assert.deepEqual(selectedBatchTargets(explicit).map((target) => target.candidate.googlePlaceId), ['already', 'new']);
}

// I — same-name branches remain distinct when provider identities/addresses differ.
{
  const branches = reconcileMultiPlaceBatch({
    jobId: 'branches',
    slots: [
      slot('north', [candidate('branch-north', 'Chipotle', '100 North St')]),
      slot('south', [candidate('branch-south', 'Chipotle', '200 South St')]),
    ],
  });
  assert.equal(selectedBatchTargets(branches).length, 2);
}

// J — keyed local selection survives normal server/re-render reconciliation.
{
  const slots = [slot('a', [candidate('pa')]), slot('b', [candidate('pb')])];
  const initial = toggleBatchRow(reconcileMultiPlaceBatch({ jobId: 'rerender', slots }), 'b');
  const rerendered = reconcileMultiPlaceBatch({ jobId: 'rerender', slots: [...slots].reverse(), previous: initial });
  assert.equal(rerendered.rows.b!.selectedForSave, false);
  assert.equal(rerendered.rows.a!.selectedForSave, true);
}

// K — partial persistence keeps successes and leaves the failed row actionable.
{
  const initial = reconcileMultiPlaceBatch({
    jobId: 'failure',
    slots: [slot('a', [candidate('pa')]), slot('b', [candidate('pb')]), slot('c', [candidate('pc')])],
  });
  const next = applyBatchSaveOutcomes(initial, [
    { logicalPlaceId: 'a', candidateId: 'pa', status: 'saved', savedPlaceId: 'saved-a' },
    { logicalPlaceId: 'b', candidateId: 'pb', status: 'failed', savedPlaceId: null },
    { logicalPlaceId: 'c', candidateId: 'pc', status: 'saved', savedPlaceId: 'saved-c' },
  ]);
  assert.equal(next.rows.a!.persistence, 'saved');
  assert.equal(next.rows.c!.persistence, 'saved');
  assert.equal(next.rows.b!.selectedForSave, true);
  assert.ok(next.rows.b!.saveError);
}

// Source grouping survives with readable scene/timestamp context.
assert.equal(sourceTimestampLabel([4, 9]), '0:04–0:09');
assert.equal(sourceTimestampLabel([75]), 'At 1:15');

// L/M — integrated rendering keeps explicit selection semantics under Vayrin UI.
{
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const detail = read('app/share-jobs/[jobId].tsx');
  const multiCard = read('components/MultiPlaceCandidateCard.tsx');
  const legacy = read('app/share.tsx');
  const confirmationCard = read('components/CandidateConfirmationCard.tsx');
  const correction = read('components/map/WrongPlaceSheet.tsx');
  assert.match(multiCard, /accessibilityRole="radio"/);
  assert.match(multiCard, /testID="candidate-selection-control"/, 'the non-gallery card area is the per-mention radio target');
  assert.ok(multiCard.indexOf('</Pressable>') < multiCard.indexOf('<CandidatePhotoCarousel'), 'the gallery does not share the selection responder');
  assert.match(detail, /selectBatchCandidate\(row, candidate\)/);
  assert.match(legacy, /accessibilityRole="checkbox"/);
  assert.match(confirmationCard, /accessibilityRole=\{selectionRole\}/);
  assert.match(correction, /accessibilityRole="radio"/);
  assert.match(detail, /isVayrinProductUiEnabled/);
  assert.match(legacy, /setCandidateSelectedIds/);
  assert.match(legacy, /if \(broad\)/);
  assert.match(legacy, /candidateSaveLabel\(candidateSelectedIds\.size\)/);
}

console.log('PASS multi-select place semantics, persistence, accessibility, and Vayrin integration');
