// Opt-in LIVE test — exercises the running worker's /health, /ready and
// /v1/process-media-tasks endpoints against a deployed instance.
// Skipped unless MEDIA_LIVE_TESTS=1. Set MEDIA_WORKER_BASE_URL + WORKER secret.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const ENABLED = process.env.MEDIA_LIVE_TESTS === '1';
const BASE = (process.env.MEDIA_WORKER_BASE_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const SECRET = process.env.SHARE_MEDIA_WORKER_SECRET || '';

test('LIVE: /health responds ok', { skip: !ENABLED }, async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.ok, true);
  const body = (await res.json()) as { status?: string };
  assert.equal(body.status, 'ok');
});

test('LIVE: /ready reports checks (no secrets)', { skip: !ENABLED }, async () => {
  const res = await fetch(`${BASE}/ready`);
  const body = (await res.json()) as { checks?: Record<string, boolean> };
  assert.ok(body.checks, 'ready must return a checks object');
  // eslint-disable-next-line no-console
  console.log('LIVE ready checks', body.checks);
});

test('LIVE: /v1/process-media-tasks rejects a bad secret', { skip: !ENABLED }, async () => {
  const res = await fetch(`${BASE}/v1/process-media-tasks`, {
    method: 'POST',
    headers: { authorization: 'Bearer definitely-wrong', 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 401);
});

test('LIVE: /v1/process-media-tasks accepts the worker secret', { skip: !ENABLED || !SECRET }, async () => {
  const res = await fetch(`${BASE}/v1/process-media-tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ trigger: 'test', limit: 1 }),
  });
  assert.ok(res.status === 200 || res.status === 503, `unexpected status ${res.status}`);
});
