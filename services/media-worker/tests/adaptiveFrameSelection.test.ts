import test from 'node:test';
import assert from 'node:assert/strict';
import { temporalProbeIndices, selectAdaptiveFrames } from '../src/evaluation/adaptiveFrameSelection.js';
const frames = (hashes: string[]) => hashes.map((aHash, i) => ({ path: `neutral/${i}.jpg`, timestampSeconds: i * 3, width: 100, height: 100, aHash, reason: 'interval' as const }));

test('probes span source time including the tail, with bounded work on long videos', () => {
  const times = Array.from({ length: 10000 }, (_, i) => i / 2);
  const indices = temporalProbeIndices(times);
  assert.equal(indices.length, 24); assert.equal(indices[0], 0); assert.equal(indices.at(-1), 9999);
  assert.deepEqual(temporalProbeIndices([0, .01, .02, 50, 100], 3), [0, 3, 4]);
  assert.deepEqual(temporalProbeIndices([]), []);
});

test('simple scenes use six temporal strata while source multi hints retain 24', () => {
  const input = frames(Array(24).fill('0000000000000000'));
  const simple = selectAdaptiveFrames(input, 24, 'A quiet afternoon');
  assert.equal(simple.frames.length, 6);
  assert.equal(simple.frames[0], input[0]); assert.equal(simple.frames.at(-1), input.at(-1));
  assert.equal(new Set(simple.frames).size, 6);
  assert.equal(selectAdaptiveFrames(input, 24, 'Top 5 waterfalls for your itinerary').frames.length, 24);
});

test('scene transitions increase the budget, preserving endpoints and original ordering', () => {
  const input = frames(Array.from({ length: 24 }, (_, i) => i % 2 ? 'ffffffffffffffff' : '0000000000000000'));
  const result = selectAdaptiveFrames(input, 24, '');
  assert.equal(result.frames.length, 24);
  assert.deepEqual(result.frames, input);
  assert.equal(selectAdaptiveFrames(input, 12, '').frames.length, 12);
  assert.equal(selectAdaptiveFrames(input, 1, '').frames.length, 1);
  assert.equal(selectAdaptiveFrames(input.slice(0, 2), 24, '').frames.length, 2);
});
