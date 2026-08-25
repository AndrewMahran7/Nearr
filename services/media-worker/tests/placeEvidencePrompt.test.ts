import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLACE_EVIDENCE_SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildUserContext,
} from '../src/prompts/placeEvidencePrompt.js';

test('recognition prompt remains place-focused and never generates notes', () => {
  assert.equal(PROMPT_VERSION, 'media-place-evidence-2026-08-24.v12-recognition-only');
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /brewery, winery, dessert/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /source=frame for an obvious visual feature/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Always return memoryCue=null/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /never for unsaved candidates/i);
  assert.doesNotMatch(PLACE_EVIDENCE_SYSTEM_PROMPT, /friend who just watched/i);
});

test('delegated OCR does not falsely claim there is no visible text', () => {
  const ctx = buildUserContext({ platform: 'instagram', transcriptText: '', ocrText: '', ocrExtracted: false });
  assert.doesNotMatch(ctx, /visible_text:\s*\n\(none\)/);
  assert.match(ctx, /read any visible text directly from the supplied frames/i);
  assert.match(ctx, /transcript:\s*\n\(none\)/);
});

test('a real empty OCR pass remains explicit', () => {
  const ctx = buildUserContext({ platform: 'instagram', transcriptText: '', ocrText: '', ocrExtracted: true });
  assert.match(ctx, /none detected by OCR/i);
});
