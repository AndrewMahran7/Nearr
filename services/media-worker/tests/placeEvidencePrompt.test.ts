import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLACE_EVIDENCE_SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildUserContext,
} from '../src/prompts/placeEvidencePrompt.js';

test('post-save hook prompt is lively, concise, grounded, and visual-aware', () => {
  assert.equal(PROMPT_VERSION, 'media-place-evidence-2026-08-19.v9-targeted-note');
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /brewery, winery, dessert/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /waterfall, lake, marina, island/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Use other only when/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /source=frame for an obvious visual feature/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /never an unseen ingredient/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Never use another place's segment/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Missing is better than filler/);
});

// --- memoryCue persona -------------------------------------------------------
//
// These assert that the INSTRUCTION exists, never that a stochastic model
// produced particular words. Each one stands for a product rule that a future
// prompt edit would otherwise be free to delete silently.

test('memoryCue prompt asks for a friend reacting to the post, not a description', () => {
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /voice\s+of a friend who just watched the same post/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /worth remembering/i);
});

test('memoryCue prompt constrains length to a note, not a paragraph', () => {
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /one or two SHORT sentences/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /4-22 words/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /A note, not a\s+paragraph/);
});

test('memoryCue prompt allows slang but forbids forcing it', () => {
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /do NOT reach for slang in every note/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /marketing copy, review-site prose, or travel-brochure/i);
});

test('memoryCue prompt demands variation instead of one template', () => {
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Vary how you open/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Do not start every cue the same way/i);
});

test('memoryCue prompt is evidence-only and names the sunset trap', () => {
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Use ONLY what the supplied evidence supports/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Never invent a rating, price,\s+date, menu item, view, event, special/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /do not mention a sunset/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /do\s+not say it is easy/i);
});

test('memoryCue prompt preserves explicit dates instead of relative phrasing', () => {
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /September 1 through September 14.+Sept 1-14/s);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /this month.+next week.+currently/s);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /goes stale/i);
});

test('memoryCue prompt keeps creator opinion attributed, not asserted', () => {
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /An opinion in the source stays an opinion/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /never restate it as established fact/i);
});

test('memoryCue prompt discourages repeating the venue name the UI already shows', () => {
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /already shows the place's name and category/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Naming the place is fine when the sentence actually needs it/);
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

test('targeted note context treats the final saved place as authoritative', () => {
  const ctx = buildUserContext({
    platform: 'instagram',
    transcriptText: 'The spicy vodka rigatoni is the move',
    ocrText: '',
    targetPlace: {
      name: 'Pasta Sisters',
      category: 'restaurant',
      formattedAddress: '123 Main St',
    },
  });
  assert.match(ctx, /final_place_name: Pasta Sisters/);
  assert.match(ctx, /authoritative/i);
  assert.match(ctx, /Do not identify, replace,\s*\ncorrect, or suggest a different venue/i);
  assert.match(ctx, /exactly one place object/i);
  assert.match(ctx, /Never borrow a sibling place's segment/i);
  assert.match(ctx, /memoryCue=null/i);
});
