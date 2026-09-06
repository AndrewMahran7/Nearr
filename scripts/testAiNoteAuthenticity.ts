import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyLegacyBadAiNote,
  evaluateAiNoteCorpus,
  evaluateAiPlaceNote,
  preserveUserNote,
} from '../lib/aiPlaceNote';

const evidence = [{ source: 'speech' as const, value: 'spicy pepperoni cups with crisp edges and blistered crust' }];
for (const malformed of [
  'That crisp pepperoni looked unreal.',
  'That The pepperoni looked unreal.',
  'That So many pepperoni slices looked unreal.',
  'That spicy pepperoni cups with crisp edges looked unreal.',
]) {
  assert.equal(evaluateAiPlaceNote({ placeName: 'Pizza Counter', proposedNote: malformed, evidence }).note, null);
}

for (const natural of [
  'Those crispy pepperoni cups are reason enough to stop here.',
  'Would absolutely come back for that blistered crust.',
  'The spicy pepperoni looks worth trying.',
]) {
  assert.equal(evaluateAiPlaceNote({ placeName: 'Pizza Counter', proposedNote: natural, evidence }).note, natural);
}

assert.equal(evaluateAiPlaceNote({
  placeName: 'Pizza Counter', proposedNote: 'The Eiffel Tower view looks unforgettable.', evidence,
}).reason, 'ungrounded_claim');
assert.equal(evaluateAiPlaceNote({
  placeName: 'Pizza Counter', proposedNote: 'This video shows spicy pepperoni.', evidence,
}).reason, 'summary_like');
assert.equal(evaluateAiPlaceNote({
  placeName: 'Pizza Counter', proposedNote: '{"note":"Spicy pepperoni."}', evidence,
}).reason, 'invalid_format');

const corpus = evaluateAiNoteCorpus([
  'Those crispy pepperoni cups are reason enough to stop here.',
  'Would absolutely come back for that blistered crust.',
  'The swimming hole under the waterfall looks worth the hike.',
]);
assert.equal(corpus.phraseCounts['looked unreal'], 0);
assert.equal(corpus.malformedCount, 0);
assert.equal(corpus.summaryLikeCount, 0);

assert.equal(classifyLegacyBadAiNote('That crisp pepperoni looked unreal.'), 'historical_looked_unreal_fallback');
assert.deepEqual(preserveUserNote('My exact user note', 'AI reason'), {
  notes: 'My exact user note', aiNote: 'AI reason',
});

const finalizer = readFileSync('supabase/functions/process-share-jobs/index.ts', 'utf8');
assert.match(finalizer, /nearr-ai-save-reason-2026-09-05\.v16/);
assert.match(finalizer, /omitted_invalid_after_retry/);
assert.match(finalizer, /omitted_provider_failure/);
assert.match(finalizer, /omitted_no_evidence/);
assert.match(finalizer, /\.update\(\{ ai_note: noteResult\.note \}\)/);
assert.doesNotMatch(
  finalizer.slice(finalizer.indexOf('async function finalizeVideoAiNoteTask'), finalizer.indexOf('async function finalizePostSaveEnrichment')),
  /\.update\(\{[^}]*\bnotes\s*:/s,
);

console.log('PASS simple, grounded, high-coverage AI-note authenticity contracts');
