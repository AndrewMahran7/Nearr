import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyAiNoteStructure,
  classifyLegacyBadAiNote,
  evaluateAiNoteCorpus,
  evaluateAiPlaceNote,
  planLegacyAiNoteReenrichment,
  preserveUserNote,
} from '../lib/aiPlaceNote';

const pizzaEvidence = [{
  source: 'speech' as const,
  value: 'The pepperoni is spicy and savory, with crisp edges. The crust is really crunchy.',
}];

const founderNote = 'That The pepperoni had pepperoni slices that were actually flavorful and had their own character looked unreal.';
assert.equal(evaluateAiPlaceNote({
  placeName: 'Brooklyn City Pizzeria & Market',
  proposedNote: founderNote,
  evidence: pizzaEvidence,
}).reason, 'malformed_construction', 'the exact founder example must fail');

assert.equal(evaluateAiPlaceNote({
  placeName: 'Pizza Counter',
  proposedNote: 'Pepperoni had pepperoni slices with crisp edges.',
  evidence: pizzaEvidence,
}).reason, 'duplicated_subject');

for (const canned of [
  'That crisp pepperoni looked unreal.',
  'The pepperoni looks amazing.',
  'The crunchy crust looks incredible.',
]) {
  assert.equal(evaluateAiPlaceNote({ placeName: 'Pizza Counter', proposedNote: canned, evidence: pizzaEvidence }).reason, 'generic_visual_filler');
}

const freshFounderNote = "I'd order the pepperoni.";
assert.equal(evaluateAiPlaceNote({
  placeName: 'Brooklyn City Pizzeria & Market',
  proposedNote: freshFounderNote,
  evidence: pizzaEvidence,
}).note, freshFounderNote, 'a fresh grounded personal pizza reaction passes');

const allowed = [
  ['Ridiculously crunchy crust.', 'FRAGMENT'],
  ['Would I finish that pepperoni?', 'QUESTION'],
  ["I'd order the pepperoni.", 'FIRST_PERSON'],
  ['Order the pepperoni.', 'ACTION_INTENT'],
  ['Tasting the pepperoni.', 'VERB_LED'],
] as const;
for (const [note, family] of allowed) {
  assert.equal(evaluateAiPlaceNote({ placeName: 'Pizza Counter', proposedNote: note, evidence: pizzaEvidence }).note, note);
  assert.equal(classifyAiNoteStructure(note), family);
}

assert.deepEqual(evaluateAiPlaceNote({
  placeName: 'Pizza Counter', proposedNote: null, evidence: pizzaEvidence,
}), { note: null, status: 'not_requested', reason: null }, 'omission is valid');

assert.equal(evaluateAiPlaceNote({
  placeName: 'Pizza Counter', proposedNote: 'I want the lobster roll.', evidence: pizzaEvidence,
}).reason, 'ungrounded_claim', 'unsupported concrete claims are rejected');

assert.equal(evaluateAiPlaceNote({
  placeName: 'Pizza Counter', proposedNote: 'This video shows crunchy pepperoni.', evidence: pizzaEvidence,
}).reason, 'summary_like');
assert.equal(evaluateAiPlaceNote({
  placeName: 'Pizza Counter', proposedNote: 'A hidden gem for crunchy pepperoni.', evidence: pizzaEvidence,
}).reason, 'marketing_like');

const repetitiveCorpus = evaluateAiNoteCorpus([
  ...Array.from({ length: 8 }, (_, index) => `That crust is crisp number ${index}.`),
  'I want the pepperoni.', 'Order the pizza.', 'Crunchy crust.', 'Could I finish it?',
]);
assert.equal(repetitiveCorpus.passed, false);
assert.ok(repetitiveCorpus.demonstrativeDescriptiveRate > 0.15);
assert.ok(repetitiveCorpus.failures.some((failure) => failure.includes('three-word opener')));

assert.equal(classifyLegacyBadAiNote('That crisp pepperoni looked unreal.'), 'historical_looked_unreal_fallback');
assert.equal(classifyLegacyBadAiNote('That The pepperoni looked good.'), 'malformed_demonstrative_article');
assert.equal(classifyLegacyBadAiNote('The water looks amazing!'), 'legacy_generic_visual_filler');
assert.equal(classifyLegacyBadAiNote("I'd order the pepperoni."), null);

const firstPlan = planLegacyAiNoteReenrichment({
  aiNote: 'That crisp pepperoni looked unreal.',
  sourceType: 'instagram',
  sourceUrl: 'https://www.instagram.com/reel/example/',
});
assert.equal(firstPlan.action, 'clear_ai_note_and_rearm');
assert.deepEqual(planLegacyAiNoteReenrichment({
  aiNote: null,
  sourceType: 'instagram',
  sourceUrl: 'https://www.instagram.com/reel/example/',
}), { action: 'preserve', reason: 'not_legacy_pattern' }, 'a second cleanup pass is a no-op');
assert.equal(planLegacyAiNoteReenrichment({
  aiNote: 'That crisp pepperoni looked unreal.',
  sourceType: 'manual',
  sourceUrl: null,
}).action, 'preserve');

assert.deepEqual(preserveUserNote('My exact user note', freshFounderNote), {
  notes: 'My exact user note', aiNote: freshFounderNote,
}, 'AI-note validation never mutates the user note');

const finalizer = readFileSync('supabase/functions/process-share-jobs/index.ts', 'utf8');
const trigger = readFileSync('supabase/migrations/20260821000001_video_ai_note_guarantee.sql', 'utf8');
assert.match(finalizer, /MAX_AI_NOTE_GENERATION_RETRY_CYCLES = 1/);
assert.match(finalizer, /omitted_after_generation_failure/);
assert.match(finalizer, /\.update\(\{ ai_note: noteResult\.note \}\)/);
assert.doesNotMatch(finalizer.slice(finalizer.indexOf('async function finalizeVideoAiNoteTask'), finalizer.indexOf('async function finalizePostSaveEnrichment')), /\.update\(\{[^}]*\bnotes\s*:/s);
assert.match(trigger, /old\.ai_note[\s\S]{0,120}new\.ai_note/);
assert.match(trigger, /on conflict \(saved_place_id\) where task_kind = 'ai_note_enrichment'/i);
assert.match(trigger, /then 'queued'/i, 'clearing a legacy note re-arms the normal task idempotently');

console.log(`PASS AI-note authenticity contracts; fresh founder note: ${freshFounderNote}`);
