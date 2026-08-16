import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLACE_EVIDENCE_SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildUserContext,
} from '../src/prompts/placeEvidencePrompt.js';

test('post-save hook prompt is lively, concise, grounded, and visual-aware', () => {
  assert.equal(PROMPT_VERSION, 'media-place-evidence-2026-08-16.v7-visible-text');
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /brewery, winery, dessert/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /waterfall, lake, marina, island/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Use other only when/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /fun, excited friend/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /5-22 words/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /two very short\s+sentences/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /source=frame for an obvious visual feature/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /never an unseen ingredient/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Never use another place's segment/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Missing is better than filler/);
});

// --- visible_text semantics: delegated OCR must not be reported as "(none)" ---
//
// Production defect (frozen 20-share audit, Instagram DcBz1dhSoax): the OCR
// provider is configured `ocr: "model"`, which performs NO separate extraction
// pass and returns []. buildUserContext rendered that empty result as
// `visible_text: (none)` while attaching the frames and instructing the model
// to read storefront signs from them. The model was therefore told, at
// temperature 0, that there is no visible text BEFORE it had looked -- and a
// large, centred, perfectly legible sign ("Clube Sao Conrado de Voo Livre,
// Rio - Brasil") was never reported. "No OCR pass ran" and "an OCR pass ran and
// found nothing" are different states and must not render identically.

test('buildUserContext: delegated OCR does not claim there is no visible text', () => {
  const ctx = buildUserContext({
    platform: 'instagram',
    transcriptText: '',
    ocrText: '',
    ocrExtracted: false,
  });
  assert.doesNotMatch(ctx, /visible_text:\s*\n\(none\)/);
  // It must still point the model at the frames rather than staying silent.
  assert.match(ctx, /visible_text:/);
  assert.match(ctx, /frames/i);
});

test('buildUserContext: a real OCR pass that found nothing still says so', () => {
  const ctx = buildUserContext({
    platform: 'instagram',
    transcriptText: '',
    ocrText: '',
    ocrExtracted: true,
  });
  assert.match(ctx, /visible_text:/);
  assert.match(ctx, /none detected by OCR/i);
});

test('buildUserContext: extracted OCR text is passed through verbatim', () => {
  const ctx = buildUserContext({
    platform: 'instagram',
    transcriptText: '',
    ocrText: '[4.0] CLUBE SAO CONRADO DE VOO LIVRE',
    ocrExtracted: true,
  });
  assert.match(ctx, /CLUBE SAO CONRADO DE VOO LIVRE/);
  assert.doesNotMatch(ctx, /visible_text:\s*\n\(none\)/);
});

test('buildUserContext: omitting ocrExtracted defaults to delegated, never "(none)"', () => {
  // Safety default: today no real OCR engine exists, so an unspecified caller
  // must not accidentally assert an absence of visible text.
  const ctx = buildUserContext({ platform: 'tiktok', transcriptText: '', ocrText: '' });
  assert.doesNotMatch(ctx, /visible_text:\s*\n\(none\)/);
});

test('buildUserContext: transcript still renders (none) when genuinely empty', () => {
  // Transcription DOES run, so an empty transcript is a real observation.
  const ctx = buildUserContext({
    platform: 'instagram',
    transcriptText: '',
    ocrText: '',
    ocrExtracted: false,
  });
  assert.match(ctx, /transcript:\s*\n\(none\)/);
});
