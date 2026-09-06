import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateAiPlaceNote } from '../../../lib/aiPlaceNote.js';
import {
  AI_NOTE_PROMPT_VERSION,
  AI_SAVE_NOTE_REPAIR_PROMPT,
  AI_SAVE_NOTE_SYSTEM_PROMPT,
  buildAiNoteUserContext,
} from '../src/prompts/aiNotePrompt.js';
import { AI_NOTE_VOICE_FIXTURES } from '../src/evaluation/aiNoteVoiceFixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('v16 asks the simple reason-to-save question', () => {
  assert.equal(AI_NOTE_PROMPT_VERSION, 'nearr-ai-save-reason-2026-09-05.v16');
  assert.match(AI_SAVE_NOTE_SYSTEM_PROMPT, /Why would someone save this video\?/);
  assert.match(AI_SAVE_NOTE_SYSTEM_PROMPT, /exactly one short natural sentence/i);
  assert.match(AI_SAVE_NOTE_SYSTEM_PROMPT, /Do not add labels or JSON/i);
  assert.match(AI_SAVE_NOTE_REPAIR_PROMPT, /one sentence and nothing else/i);
  assert.doesNotMatch(AI_SAVE_NOTE_SYSTEM_PROMPT, /voice direction|return null rather than filler/i);
});

test('bounded evidence is data and repair does not receive rejected prose', () => {
  const fixture = AI_NOTE_VOICE_FIXTURES[0]!;
  const context = buildAiNoteUserContext({
    platform: 'fixture',
    targetPlace: { name: fixture.placeName, category: fixture.category },
    transcriptText: '', ocrText: '',
    retainedEvidence: fixture.evidence,
    attempt: 'repair',
  });
  assert.match(context, /<untrusted_saved_post_evidence>/);
  assert.match(context, /Write one short natural reason/);
  assert.doesNotMatch(context, /previous response|rejected note/i);
});

test('50-case evidence corpus remains broad', () => {
  assert.ok(AI_NOTE_VOICE_FIXTURES.length >= 50);
  assert.ok(AI_NOTE_VOICE_FIXTURES.every((fixture) => fixture.evidence.length > 0));
  for (const expected of ['Pizza', 'Coffee', 'Hike', 'Waterfall', 'Cliff jump', 'Harbor hotel']) {
    assert.ok(AI_NOTE_VOICE_FIXTURES.some((fixture) => fixture.label === expected), expected);
  }
});

test('permissive validation keeps grounded natural variety', () => {
  const cases = [
    ['Those crispy pepperoni cups are reason enough to stop here.', 'crispy pepperoni cups and blistered crust'],
    ['Would absolutely come back for the turquoise swimming hole.', 'turquoise swimming hole beneath the falls'],
    ['The cliff jump over bright blue water looks insane.', 'cliff jump over bright blue water'],
    ['Perfect spot to remember for a summer hike.', 'summer hike along the ridge'],
  ] as const;
  for (const [note, evidence] of cases) {
    assert.equal(evaluateAiPlaceNote({ placeName: 'Fixture', proposedNote: note, evidence: [{ source: 'frame', value: evidence }] }).note, note);
  }
});

test('hard failures remain narrow and deterministic fallback stays absent', () => {
  const evidence = [{ source: 'frame' as const, value: 'crispy pepperoni cups and blistered crust' }];
  for (const note of [
    'That crispy pepperoni looked unreal.',
    'That The pepperoni looked unreal.',
    'That So many pepperoni slices looked unreal.',
    '{"note":"Crispy pepperoni cups."}',
    'This video shows crispy pepperoni cups.',
    'As an AI, I would save this for the pizza.',
  ]) assert.equal(evaluateAiPlaceNote({ placeName: 'Pizza Counter', proposedNote: note, evidence }).note, null, note);
  const validator = readFileSync(path.join(repoRoot, 'lib/aiPlaceNote.ts'), 'utf8');
  assert.doesNotMatch(validator, /proposedNote:\s*`[^`]*looked unreal/i);
  assert.doesNotMatch(validator, /groundedAiPlaceNoteFallback/);
});

test('quotes are safely unwrapped and prose otherwise survives', () => {
  const note = 'Those crispy pepperoni cups look worth trying.';
  assert.equal(evaluateAiPlaceNote({
    placeName: 'Pizza Counter', proposedNote: `“${note}”`,
    evidence: [{ source: 'frame', value: 'crispy pepperoni cups' }],
  }).note, note);
});
