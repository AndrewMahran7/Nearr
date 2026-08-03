import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBackoffSeconds, computeRetryDelaySeconds, parseRetryAfterSeconds } from '../src/util/backoff.js';

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

test('retry delay adds deterministic bounded jitter', () => {
  assert.equal(computeRetryDelaySeconds(1, 30, 900, undefined, () => 0), 30);
  assert.equal(computeRetryDelaySeconds(1, 30, 900, undefined, () => 1), 36);
  assert.equal(computeRetryDelaySeconds(6, 30, 900, undefined, () => 1), 900);
});

test('retry delay respects Retry-After within the configured cap', () => {
  assert.equal(computeRetryDelaySeconds(1, 30, 900, 120, () => 0), 120);
  assert.equal(computeRetryDelaySeconds(1, 30, 900, 5_000, () => 0), 900);
});

test('Retry-After parses seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterSeconds('42'), 42);
  assert.equal(parseRetryAfterSeconds('Wed, 21 Oct 2015 07:28:10 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT')), 10);
  assert.equal(parseRetryAfterSeconds('invalid'), undefined);
});
