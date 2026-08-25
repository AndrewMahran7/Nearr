import assert from 'node:assert/strict';

import {
  evaluateAiPlaceNote,
  evaluateDeliverableAiPlaceNote,
  generateAiPlaceNote,
  persistAiNoteSupplementally,
  preserveUserNote,
} from '../lib/aiPlaceNote';

const burgerEvidence = [{
  source: 'frame' as const,
  value: 'double smashburger with crisp browned edges',
  timestampSeconds: 4,
}];

assert.equal(generateAiPlaceNote({
  placeName: 'Burger Counter',
  proposedNote: 'That smashburger is an absolute mess',
  evidence: burgerEvidence,
}), 'That smashburger is an absolute mess');

assert.equal(generateAiPlaceNote({
  placeName: 'Burger Counter',
  proposedNote: 'I want those lobster rolls',
  evidence: burgerEvidence,
}), null, 'an unsupported subject cannot become a note');

assert.equal(evaluateAiPlaceNote({
  placeName: 'Cliff Cove',
  proposedNote: "I don't know if I'd make that jump",
  evidence: [{ source: 'frame', value: 'person jumping from a high cliff ledge' }],
}).status, 'generated', 'first-person uncertainty is allowed');

assert.equal(evaluateAiPlaceNote({
  placeName: 'Trail',
  proposedNote: 'That climb looks brutal',
  evidence: [{ source: 'frame', value: 'hikers climbing a long exposed staircase' }],
}).status, 'generated', 'non-positive reactions are allowed');

assert.equal(evaluateAiPlaceNote({
  placeName: 'Any',
  proposedNote: 'Three words only',
  evidence: [],
}).status, 'insufficient_evidence');

assert.equal(evaluateDeliverableAiPlaceNote({
  placeName: 'Burger Counter',
  proposedNote: 'I want those lobster rolls',
  evidence: burgerEvidence,
}).groundedFallbackUsed, false, 'rejection never manufactures filler');

assert.deepEqual(preserveUserNote(' my note ', ' model note '), {
  notes: 'my note', aiNote: 'model note',
});

async function main(): Promise<void> {
  let stored = '';
  assert.equal(await persistAiNoteSupplementally(' cue ', async (note) => { stored = note; }), 'stored');
  assert.equal(stored, 'cue');
  assert.equal(await persistAiNoteSupplementally(null, async () => { throw new Error('not called'); }), 'skipped');
  assert.equal(await persistAiNoteSupplementally('cue', async () => { throw new Error('db'); }), 'failed');
  console.log('PASS AI place-note voice, grounding, omission, and persistence contracts');
}

void main();
