import assert from 'node:assert/strict';
import test from 'node:test';

import { selectDurableEvidenceFrames } from '../src/pipeline/persistEvidenceFrames.js';
import type { SelectedFrame } from '../src/types/media.js';

function frame(timestampSeconds: number): SelectedFrame {
  return {
    path: `/tmp/frame-${timestampSeconds}.jpg`,
    timestampSeconds,
    width: 768,
    height: 432,
    aHash: String(timestampSeconds).padStart(16, '0'),
    reason: timestampSeconds === 0 ? 'first' : 'interval',
  };
}

const evidence = (timestamps: number[]) => ({
  places: [{
    name: 'Sunset Cliffs Natural Park', category: 'park' as const, categoryConfidence: 0.8,
    categoryEvidenceTags: [], address: null, city: 'San Diego',
    region: 'California', country: 'United States', coordinates: null, role: 'primary' as const,
    confidence: 0.8,
    explicitEvidence: timestamps.map((timestampSeconds) => ({
      source: 'frame' as const, value: 'Rocky coastline', timestampSeconds,
    })),
    inferredEvidence: [], memoryCue: null, memoryCueEvidence: [],
  }],
  multipleIntentionalPlaces: false,
  insufficientEvidence: false,
  warnings: [],
});

test('retains only frames actually selected by Vayrin, relevant first, capped at five', () => {
  const frames = [0, 4, 9, 14, 20, 30].map(frame);
  const selected = selectDurableEvidenceFrames({
    frames,
    evidence: evidence([9, 14]),
    vayrinSelectedTimestamps: [0, 4, 9, 14, 20, 30],
  });
  assert.equal(selected.length, 5);
  assert.deepEqual(selected.slice(0, 2).map((item) => item.frame.timestampSeconds), [9, 14]);
  assert.ok(selected.every((item) => [0, 4, 9, 14, 20, 30].includes(item.frame.timestampSeconds)));
});

test('falls back to actual model input frames when Vayrin selection diagnostics are absent', () => {
  const frames = [0, 5, 10].map(frame);
  const selected = selectDurableEvidenceFrames({ frames, evidence: evidence([]) });
  assert.deepEqual(selected.map((item) => item.frame.timestampSeconds), [0, 5, 10]);
  assert.ok(selected.every((item) => item.relevance === 'analysis_coverage'));
});
