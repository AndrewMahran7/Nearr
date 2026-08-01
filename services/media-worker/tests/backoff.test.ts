import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBackoffSeconds } from '../src/util/backoff.js';

test('bounded exponential schedule (base 30, max 900)', () => {
  assert.equal(computeBackoffSeconds(1), 30);
  assert.equal(computeBackoffSeconds(2), 60);
  assert.equal(computeBackoffSeconds(3), 120);
  assert.equal(computeBackoffSeconds(4), 240);
  assert.equal(computeBackoffSeconds(5), 480);
  assert.equal(computeBackoffSeconds(6), 900); // 960 capped to 900
  assert.equal(computeBackoffSeconds(7), 900);
  assert.equal(computeBackoffSeconds(20), 900);
});

test('respects custom base + max', () => {
  assert.equal(computeBackoffSeconds(1, 10, 100), 10);
  assert.equal(computeBackoffSeconds(2, 10, 100), 20);
  assert.equal(computeBackoffSeconds(4, 10, 100), 80);
  assert.equal(computeBackoffSeconds(5, 10, 100), 100); // 160 capped
});

test('never below base, never above cap, integer', () => {
  for (let n = 1; n <= 40; n += 1) {
    const v = computeBackoffSeconds(n);
    assert.ok(v >= 30 && v <= 900, `n=${n} v=${v}`);
    assert.equal(v, Math.floor(v));
  }
});

test('clamps non-positive attempts to first step', () => {
  assert.equal(computeBackoffSeconds(0), 30);
  assert.equal(computeBackoffSeconds(-5), 30);
});
