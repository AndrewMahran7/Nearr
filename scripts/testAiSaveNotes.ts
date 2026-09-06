import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  evaluateAiPlaceNote,
  preserveUserNote,
} from '../lib/aiPlaceNote';
import { generateAiSaveNoteWithRetry } from '../services/media-worker/src/pipeline/aiSaveNoteGeneration';
import {
  AI_NOTE_PROMPT_VERSION,
  AI_SAVE_NOTE_REPAIR_PROMPT,
  AI_SAVE_NOTE_SYSTEM_PROMPT,
} from '../services/media-worker/src/prompts/aiNotePrompt';
import type { AnalyzeOutput } from '../services/media-worker/src/providers/model';

type EvidenceSource = 'caption' | 'speech' | 'visible_text' | 'frame';
const repoRoot = process.cwd();
const pass = (note: string, evidence: string, source: EvidenceSource = 'frame') =>
  evaluateAiPlaceNote({ placeName: 'Saved Place', proposedNote: note, evidence: [{ source, value: evidence }] }).note;

const cases = [
  ['restaurant gets note', () => assert.ok(pass('Those crispy pepperoni cups and blistered crust look worth trying.', 'crispy pepperoni cups and blistered crust'))],
  ['cliff gets note', () => assert.ok(pass('The cliff jump over bright blue water looks insane.', 'cliff jump over bright blue water'))],
  ['waterfall gets note', () => assert.ok(pass('The turquoise swimming hole under the waterfall looks worth the trek.', 'turquoise swimming hole under a waterfall'))],
  ['hike gets note', () => assert.ok(pass('Those canyon stairs make this hike hard to forget.', 'hikers climbing canyon stairs'))],
  ['landmark gets note', () => assert.ok(pass('The sweeping view from the top looks worth seeing in person.', 'sweeping view from the top'))],
  ['hotel gets note', () => assert.ok(pass('That ocean-view pool would be an unreal place to stay.', 'ocean-view pool beside the hotel'))],
  ['caption-only case is grounded', () => assert.ok(pass('The strawberry cream latte is worth remembering.', 'strawberry cream latte', 'caption'))],
  ['visual-only case is accepted', () => assert.ok(pass('The hidden cove and clear water look perfect for a beach day.', 'Visual frames supplied to note model (6)'))],
  ['existing user note preserved', () => assert.deepEqual(preserveUserNote('My exact note', 'AI reason'), { notes: 'My exact note', aiNote: 'AI reason' })],
  ['existing AI note is not a user note', () => assert.deepEqual(preserveUserNote(null, 'AI reason'), { notes: null, aiNote: 'AI reason' })],
  ['no evidence may omit', () => assert.equal(evaluateAiPlaceNote({ placeName: 'X', proposedNote: 'A concrete reason to return.', evidence: [] }).status, 'insufficient_evidence')],
  ['quote wrapping removed safely', () => assert.equal(pass('“Those crispy pepperoni cups look worth trying.”', 'crispy pepperoni cups'), 'Those crispy pepperoni cups look worth trying.')],
  ['no JSON accepted', () => assert.equal(pass('{"note":"Crispy pepperoni cups."}', 'crispy pepperoni cups'), null)],
  ['no assistant/meta language', () => assert.equal(pass('As an AI, I recommend the crispy pepperoni.', 'crispy pepperoni'), null)],
  ['no unsupported proper nouns', () => assert.equal(pass('The Eiffel Tower view looks worth the climb.', 'waterfall over granite'), null)],
  ['no legacy looked-unreal pattern', () => assert.equal(pass('That crispy pepperoni looked unreal.', 'crispy pepperoni'), null)],
  ['reasonable length', () => assert.equal(pass(`Pepperoni ${'crust '.repeat(30)}`, 'pepperoni crust'), null)],
  ['natural sentence', () => assert.equal(pass('The blistered crust alone makes this worth remembering.', 'blistered crust'), 'The blistered crust alone makes this worth remembering.')],
  ['prompt asks why someone would save content', () => assert.match(AI_SAVE_NOTE_SYSTEM_PROMPT, /Why would someone save this video\?/)],
  ['output stored essentially verbatim', () => assert.equal(pass('  Those crispy edges are reason enough to stop here.  ', 'crispy edges'), 'Those crispy edges are reason enough to stop here.')],
] as const;

for (const [name, run] of cases) {
  run();
  console.log(`PASS ${name}`);
}

function output(note: string | null, evidence = 'crispy pepperoni cups'): AnalyzeOutput {
  return {
    provider: 'test', modelName: 'test', promptVersion: AI_NOTE_PROMPT_VERSION,
    evidence: {
      places: [{
        logicalPlaceId: 'saved-place-target', identityEvidenceKind: 'observable', hypothesisRank: 0,
        name: 'Saved Place', category: 'restaurant', categoryConfidence: 1, categoryEvidenceTags: [],
        address: null, city: null, region: null, country: null, coordinates: null, role: 'primary', confidence: 1,
        explicitEvidence: [{ source: 'frame', value: evidence, timestampSeconds: null }], inferredEvidence: [],
        memoryCue: note, memoryCueEvidence: [{ source: 'frame', value: evidence, timestampSeconds: null }],
      }],
      partialPlaces: [], multipleIntentionalPlaces: false, insufficientEvidence: !note, warnings: [],
    },
  };
}

async function retryContracts(): Promise<void> {
  let calls = 0;
  const providerFailure = await generateAiSaveNoteWithRetry(
    async () => { calls += 1; throw new Error('provider'); },
    async () => { calls += 1; throw new Error('provider'); },
  );
  assert.equal(calls, 2, 'provider failure retries exactly once');
  assert.equal(providerFailure.outcome, 'omitted_provider_failure', 'second provider failure may omit');
  console.log('PASS provider failure retries once');
  console.log('PASS second failure may omit');

  calls = 0;
  const repaired = await generateAiSaveNoteWithRetry(
    async () => { calls += 1; return output('{"note":"bad"}'); },
    async () => { calls += 1; return output('Those crispy pepperoni cups look worth trying.'); },
  );
  assert.equal(calls, 2);
  assert.equal(repaired.outcome, 'accepted_after_retry');
  assert.match(AI_SAVE_NOTE_REPAIR_PROMPT, /one sentence and nothing else/i);
  console.log('PASS malformed first response retries');
  console.log('PASS analytics outcome correct');

  const promptSource = readFileSync(join(repoRoot, 'services/media-worker/src/prompts/aiNotePrompt.ts'), 'utf8');
  const validatorSource = readFileSync(join(repoRoot, 'lib/aiPlaceNote.ts'), 'utf8');
  const finalizerSource = readFileSync(join(repoRoot, 'supabase/functions/process-share-jobs/index.ts'), 'utf8');
  const workerSource = readFileSync(join(repoRoot, 'services/media-worker/src/pipeline/runMediaTask.ts'), 'utf8');
  assert.doesNotMatch([promptSource, workerSource].join('\n'), /['"`]That ['"`]\s*\+|\+\s*['"`] looked unreal/i);
  assert.doesNotMatch(validatorSource, /groundedAiPlaceNoteFallback/);
  console.log('PASS no deterministic fallback');
  assert.match(finalizerSource, /aiNoteRetried/);
  assert.match(finalizerSource, /accepted_after_retry/);
  assert.match(finalizerSource, /boundedV16GenerationFinished/);
  assert.match(finalizerSource, /diagnostics\.promptVersion === VIDEO_AI_NOTE_RULE_VERSION/);
  console.log('PASS outcome telemetry is bounded and explicit');
}

void retryContracts().then(() => console.log('PASS 25 AI save-note production contracts'));
