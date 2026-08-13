import assert from 'node:assert/strict';

import {
  generateAiPlaceNote,
  persistAiNoteSupplementally,
  preserveUserNote,
  type AiPlaceNoteEvidence,
} from '../lib/aiPlaceNote';

const burritoEvidence: AiPlaceNoteEvidence[] = [{
  source: 'speech',
  timestampSeconds: 14.2,
  value: 'I ordered the birria burrito and an orange soda',
}];

const useful = generateAiPlaceNote({
  placeName: 'Los de Juarez Burritos',
  proposedNote: 'Saved for the birria burrito and orange soda the creator ordered',
  evidence: burritoEvidence,
});
assert.equal(useful, 'Saved for the birria burrito and orange soda the creator ordered.');
assert.ok((useful?.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) <= 18, 'accepted note stays concise');

assert.equal(
  generateAiPlaceNote({
    placeName: 'Lakeview Hotel',
    proposedNote: 'Luxury hotel in Lake Tahoe with great rooms',
    evidence: [],
  }),
  null,
  'generic provider/category metadata alone cannot create a note',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Some Place',
    proposedNote: null,
    evidence: [{ source: 'visible_text', value: 'Some Place, 1101 Lincoln Avenue' }],
  }),
  null,
  'no proposed meaningful reason returns no note',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Los de Juarez Burritos',
    proposedNote: 'Saved for the lobster roll and orange soda the creator ordered',
    evidence: burritoEvidence,
  }),
  null,
  'unsupported details are rejected instead of invented',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Lakeview Hotel',
    proposedNote: 'This place is a great place to visit',
    evidence: [{ source: 'caption', value: 'This place is a great place to visit' }],
  }),
  null,
  'generic filler is rejected even when the source contains it',
);

const pizzaA = generateAiPlaceNote({
  placeName: 'Pizza A',
  proposedNote: 'Try the crispy pepperoni cups and hot honey they showed',
  evidence: [{ source: 'frame', timestampSeconds: 9, value: 'crispy pepperoni cups with hot honey' }],
});
const pizzaB = generateAiPlaceNote({
  placeName: 'Pizza B',
  proposedNote: 'Saved for the vodka slice and fresh basil they showed',
  evidence: [{ source: 'speech', timestampSeconds: 31, value: 'vodka slice topped with fresh basil' }],
});
assert.equal(pizzaA, 'Try the crispy pepperoni cups and hot honey they showed.');
assert.equal(pizzaB, 'Saved for the vodka slice and fresh basil they showed.');
assert.equal(
  generateAiPlaceNote({
    placeName: 'Pizza B',
    proposedNote: 'Try the crispy pepperoni cups and hot honey they showed',
    evidence: [{ source: 'speech', timestampSeconds: 31, value: 'vodka slice topped with fresh basil' }],
  }),
  null,
  'Place A evidence cannot leak into Place B',
);

assert.deepEqual(
  preserveUserNote(' My exact note ', useful),
  { notes: 'My exact note', aiNote: useful },
  'user and AI notes stay separate',
);

async function testSupplementalPersistence() {
  const writes: string[] = [];
  assert.equal(await persistAiNoteSupplementally(useful, async (note) => { writes.push(note); }), 'stored');
  assert.deepEqual(writes, [useful]);
  assert.equal(
    await persistAiNoteSupplementally(useful, async () => { throw new Error('database unavailable'); }),
    'failed',
    'AI-note failure resolves safely instead of failing the already-completed place save',
  );
  assert.equal(await persistAiNoteSupplementally(null, async () => { throw new Error('must not run'); }), 'skipped');
}

void testSupplementalPersistence().then(() => {
  console.log('PASS production-shaped AI notes are useful, grounded, concise, mention-isolated, and supplemental');
});
