import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLACE_EVIDENCE_SYSTEM_PROMPT,
  PROMPT_VERSION,
} from '../src/prompts/placeEvidencePrompt.js';

test('post-save hook prompt is lively, concise, grounded, and visual-aware', () => {
  assert.equal(PROMPT_VERSION, 'media-place-evidence-2026-08-13.v5-post-save-hook');
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /fun, excited friend/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /5-22 words/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /two very short\s+sentences/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /source=frame for an obvious visual feature/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /never an unseen ingredient/i);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Never use another place's segment/);
  assert.match(PLACE_EVIDENCE_SYSTEM_PROMPT, /Missing is better than filler/);
});
