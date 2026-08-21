import assert from 'node:assert/strict';

import {
  evaluateDeliverableAiPlaceNote,
  evaluateAiPlaceNote,
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

const santaFeVisual = generateAiPlaceNote({
  placeName: 'Santa Fe Importers Seal Beach',
  proposedNote: 'That stacked Italian sandwich looks absolutely ridiculous. Need it.',
  evidence: [{ source: 'frame', timestampSeconds: 8, value: 'stacked Italian sandwich' }],
});
assert.equal(
  santaFeVisual,
  'That stacked Italian sandwich looks absolutely ridiculous. Need it.',
  'visual-only evidence can support a lively two-beat note',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Santa Fe Importers Seal Beach',
    proposedNote: 'That stacked mortadella sandwich looks absolutely ridiculous. Need it.',
    evidence: [{ source: 'frame', timestampSeconds: 8, value: 'stacked Italian sandwich' }],
  }),
  null,
  'an unsupported ingredient is rejected',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Santa Fe Importers Seal Beach',
    proposedNote: 'That Italian deli looks absolutely ridiculous. Need it.',
    evidence: [{ source: 'caption', value: 'Santa Fe Importers Italian Deli' }],
  }),
  null,
  'provider identity/category alone does not become a reason to save',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Juniper Coffee',
    proposedNote: "That strawberry matcha looks dangerously good. I'm going.",
    evidence: [{ source: 'caption', value: 'Come try our strawberry matcha' }],
  }),
  "That strawberry matcha looks dangerously good. I'm going.",
  'caption-only evidence allows contractions and conversational style',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Falls Trail',
    proposedNote: 'That waterfall payoff looks so worth the hike!',
    evidence: [{ source: 'speech', value: 'the waterfall payoff is worth the hike' }],
  }),
  'That waterfall payoff looks so worth the hike!',
  'transcript-only evidence can keep natural punctuation',
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

// ---------------------------------------------------------------------------
// Nearr voice. A reaction note is mostly stance ("sick", "unreal", "for sure")
// wrapped around one grounded detail. The previous revision required EVERY
// content word to appear in the evidence, which rejected the entire voice; the
// cases below are the contract that it stays accepted, and the cases after
// them are the contract that grounding did not loosen with it.
// ---------------------------------------------------------------------------

const beach = generateAiPlaceNote({
  placeName: 'Praia do Sancho',
  proposedNote: 'Sick beach. That water looks unreal',
  evidence: [{ source: 'frame', value: 'wide sandy beach, clear blue water, dramatic cliffs' }],
});
assert.equal(beach, 'Sick beach. That water looks unreal.', 'a two-beat reaction to a visual hook is accepted');

assert.equal(
  generateAiPlaceNote({
    placeName: 'Oeschinensee',
    proposedNote: 'That water with those mountains is ridiculous',
    evidence: [{ source: 'frame', value: 'turquoise water surrounded by mountains' }],
  }),
  'That water with those mountains is ridiculous.',
  'a cue may react to the scene without repeating the venue name',
);

assert.equal(
  generateAiPlaceNote({
    placeName: 'Falls Trail',
    proposedNote: 'That hike looks unreal. Saving this for sure',
    evidence: [{ source: 'speech', value: 'this hike takes about two hours to the falls' }],
  }),
  'That hike looks unreal. Saving this for sure.',
  'saving-intent phrasing is stance, not an unsupported claim',
);

// Creator opinion stays the creator's. Echoing "best pizza in OC" is grounded
// because the caption says it; the note is not asserting it independently.
assert.equal(
  generateAiPlaceNote({
    placeName: 'Angelos Pizza',
    proposedNote: 'Best pizza in OC!!!!! Yeah I need to try this',
    evidence: [{ source: 'caption', value: 'best pizza in OC' }],
  }),
  'Best pizza in OC!!!!! Yeah I need to try this.',
  'creator enthusiasm may be echoed as enthusiasm',
);

// Dates: shortening is allowed, restating is not.
assert.equal(
  generateAiPlaceNote({
    placeName: "Tuxedo Cat's Coffee",
    proposedNote: 'Special drink Sept 1-14. Definitely a limited-time move',
    evidence: [{
      source: 'visible_text',
      value: 'Special drink available September 1 through September 14',
    }],
  }),
  'Special drink Sept 1-14. Definitely a limited-time move.',
  '"Sept" may abbreviate "September" and the days must survive intact',
);
assert.equal(
  generateAiPlaceNote({
    placeName: "Tuxedo Cat's Coffee",
    proposedNote: 'Special drink Sept 2-20. Definitely a limited-time move',
    evidence: [{
      source: 'visible_text',
      value: 'Special drink available September 1 through September 14',
    }],
  }),
  null,
  'a date the evidence never named is an invented date',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Juniper Coffee',
    proposedNote: 'Their limited-time drink is a move worth catching',
    evidence: [{ source: 'caption', value: 'come try our drink' }],
  }),
  null,
  '"limited-time" is licensed by an evidenced date, never asserted alone',
);

// Unsupported atmosphere is still refused, however casual the wording.
assert.equal(
  generateAiPlaceNote({
    placeName: 'Oeschinensee',
    proposedNote: 'That view is ridiculous. Sunset here would go crazy',
    evidence: [{ source: 'frame', value: 'turquoise lake below snowy mountain peaks' }],
  }),
  null,
  'no evidence mentions a sunset, so the cue cannot',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Falls Trail',
    proposedNote: 'Easy hike and the water is warm. Going',
    evidence: [{ source: 'frame', value: 'narrow trail beside a river' }],
  }),
  null,
  'difficulty and water temperature are inventions, not reactions',
);

// A mood with no grounded detail would read identically on every saved place.
assert.equal(
  generateAiPlaceNote({
    placeName: 'Some Cafe',
    proposedNote: 'Yeah this is going on the list',
    evidence: [{ source: 'caption', value: 'you have to try this cafe' }],
  }),
  null,
  'stance alone is not a reason the place was worth saving',
);

// --- bounded status codes ---------------------------------------------------
assert.deepEqual(
  evaluateAiPlaceNote({ placeName: 'Any', proposedNote: null, evidence: burritoEvidence }),
  { note: null, status: 'not_requested', reason: null },
  'the model declining to propose a cue is distinguishable from a refusal',
);

const groundedFallback = evaluateDeliverableAiPlaceNote({
  placeName: 'Any',
  proposedNote: 'Saved for the lobster roll the creator ordered',
  evidence: burritoEvidence,
});
assert.equal(groundedFallback.groundedFallbackUsed, true);
assert.equal(
  groundedFallback.note,
  'That I ordered the birria burrito and an orange soda looked unreal.',
  'an ungrounded model claim is replaced only with exact scoped evidence',
);
assert.equal(
  evaluateAiPlaceNote({
    placeName: 'Any',
    proposedNote: groundedFallback.note,
    evidence: burritoEvidence,
  }).status,
  'generated',
  'the last-mile fallback passes the unchanged grounding validator',
);
assert.deepEqual(
  evaluateDeliverableAiPlaceNote({
    placeName: 'Some Cafe',
    proposedNote: 'Saved for the invented lobster roll',
    evidence: [{ source: 'caption', value: 'This is a great cafe' }],
  }),
  {
    note: null,
    status: 'rejected',
    reason: 'ungrounded_claim',
    groundedFallbackUsed: false,
  },
  'generic evidence cannot be promoted into a fallback note',
);
assert.deepEqual(
  evaluateAiPlaceNote({ placeName: 'Any', proposedNote: 'Saved for the birria burrito', evidence: [] }),
  { note: null, status: 'insufficient_evidence', reason: null },
  'an unscoped cue reports missing evidence rather than a validation failure',
);
assert.deepEqual(
  evaluateAiPlaceNote({
    placeName: 'Any',
    proposedNote: 'Saved for the lobster roll the creator ordered',
    evidence: burritoEvidence,
  }),
  { note: null, status: 'rejected', reason: 'ungrounded_claim' },
  'a refused cue names the rule it broke',
);
assert.equal(
  evaluateAiPlaceNote({
    placeName: 'Lakeview Hotel',
    proposedNote: 'This place is worth checking out',
    evidence: [{ source: 'caption', value: 'This place is worth checking out' }],
  }).reason,
  'banned_opening',
  'the first failing rule is the one reported',
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
