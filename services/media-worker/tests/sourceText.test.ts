import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MODEL_DESCRIPTION_CONTEXT_MAX,
  SOURCE_DESCRIPTION_RETENTION_MAX,
  normalizeSourceDescription,
  sourceDescriptionForModel,
} from '../src/util/sourceText.js';

test('source description retains useful text and multiline roundup structure', () => {
  const caption = [
    '5 places in LA',
    'context '.repeat(300),
    '1. Restaurant A — West Hollywood',
    '2. Restaurant B — Santa Monica',
    '3. Restaurant C — Koreatown',
    '4. Restaurant D — Silver Lake',
    '5. Restaurant E — Venice',
  ].join('\n');
  const retained = normalizeSourceDescription(caption);
  assert.equal(retained, caption);
  assert.match(retained!, /5\. Restaurant E — Venice/);
});

test('source retention is bounded once and idempotent', () => {
  const bounded = normalizeSourceDescription('x'.repeat(SOURCE_DESCRIPTION_RETENTION_MAX + 2_000));
  assert.equal(bounded?.length, SOURCE_DESCRIPTION_RETENTION_MAX);
  assert.equal(normalizeSourceDescription(bounded), bounded);
});

test('model context is derived without mutating retained source', () => {
  const retained = normalizeSourceDescription(
    `${'a'.repeat(MODEL_DESCRIPTION_CONTEXT_MAX)}${'later-place-clue '.repeat(500)}`,
  )!;
  const modelContext = sourceDescriptionForModel(retained)!;
  assert.equal(modelContext.length, MODEL_DESCRIPTION_CONTEXT_MAX);
  assert.equal(retained.length, SOURCE_DESCRIPTION_RETENTION_MAX);
  assert.notEqual(modelContext, retained);
  assert.match(retained, /later-place-clue/);
});
