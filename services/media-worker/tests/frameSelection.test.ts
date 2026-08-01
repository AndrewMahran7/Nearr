import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectFrameTimestamps } from '../src/pipeline/extractFrames.js';
import { deduplicateFrames } from '../src/pipeline/deduplicateFrames.js';
import { averageHashFromGray8x8, hammingDistanceHex } from '../src/util/hash.js';
import type { SelectedFrame } from '../src/types/media.js';

test('selectFrameTimestamps: first + last endpoints, ascending', () => {
  const ts = selectFrameTimestamps(10, 1, 24);
  assert.ok(ts.length >= 2);
  assert.equal(ts[0]!.reason, 'first');
  assert.equal(ts[0]!.timestampSeconds, 0);
  assert.equal(ts[ts.length - 1]!.reason, 'last');
  for (let i = 1; i < ts.length; i += 1) {
    assert.ok(ts[i]!.timestampSeconds >= ts[i - 1]!.timestampSeconds);
  }
});

test('selectFrameTimestamps: respects maxFrames cap', () => {
  const ts = selectFrameTimestamps(600, 1, 10);
  assert.ok(ts.length <= 10, `got ${ts.length}`);
  assert.equal(ts[0]!.reason, 'first');
  assert.equal(ts[ts.length - 1]!.reason, 'last');
});

test('selectFrameTimestamps: very short video yields at least one frame', () => {
  assert.ok(selectFrameTimestamps(0.3, 1, 24).length >= 1);
  assert.equal(selectFrameTimestamps(0, 1, 24).length, 0);
  assert.equal(selectFrameTimestamps(10, 1, 0).length, 0);
});

function frame(aHash: string, reason: SelectedFrame['reason']): SelectedFrame {
  return { path: '', timestampSeconds: 0, width: 8, height: 8, aHash, reason };
}

test('deduplicateFrames drops near-identical interior frames', () => {
  const frames = [
    frame('ffffffffffffffff', 'first'),
    frame('fffffffffffffffe', 'interval'), // 1 bit from first → dropped
    frame('0000000000000000', 'interval'), // very different → kept
    frame('ffffffffffffffff', 'last'),
  ];
  const kept = deduplicateFrames(frames, 6);
  const reasons = kept.map((f) => f.reason);
  assert.ok(reasons.includes('first'));
  assert.ok(reasons.includes('last'));
  assert.ok(kept.some((f) => f.aHash === '0000000000000000'));
  assert.ok(kept.length < frames.length);
});

test('deduplicateFrames always keeps endpoints even if identical', () => {
  const frames = [frame('aaaaaaaaaaaaaaaa', 'first'), frame('aaaaaaaaaaaaaaaa', 'last')];
  assert.equal(deduplicateFrames(frames, 6).length, 2);
});

test('averageHashFromGray8x8 + hamming distance', () => {
  const half = new Uint8Array(64).map((_, i) => (i < 32 ? 0 : 255));
  const a = averageHashFromGray8x8(half);
  const b = averageHashFromGray8x8(half);
  assert.equal(a.length, 16);
  assert.equal(hammingDistanceHex(a, b), 0);

  const allDark = averageHashFromGray8x8(new Uint8Array(64).fill(0));
  const allBright = averageHashFromGray8x8(new Uint8Array(64).fill(255));
  // Uniform frames both hash to all-zero bits (>= mean everywhere) → identical.
  assert.equal(hammingDistanceHex(allDark, allBright), 0);
});
