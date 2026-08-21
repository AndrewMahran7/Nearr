import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WorkerConfig } from '../src/config/env.js';
import { verifyPlaceEvidence } from '../src/pipeline/verifyPlaceEvidence.js';

test('AI-note finalization sends the claimed target snapshot and exposes a rejected write', async () => {
  let requestBody: Record<string, unknown> = {};
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      route: 'ai_note_enrichment',
      enriched: false,
      reason: 'stale_target',
      disposition: 'retry_after_outage',
    }), { status: 200 });
  }) as typeof fetch;

  const result = await verifyPlaceEvidence({
    finalizeUrl: 'https://example.supabase.co/functions/v1/process-share-jobs',
    mediaFinalizeSecret: 'test-secret',
  } as WorkerConfig, {
    taskId: 'task-id',
    targetPlaceId: 'place-id',
    targetSourceUrl: 'https://www.instagram.com/reel/test-id/',
    outcome: 'evidence',
    analysisAttempted: true,
    evidence: {
      warnings: [],
      places: [],
      multipleIntentionalPlaces: false,
      insufficientEvidence: true,
    },
    signal: new AbortController().signal,
  }, fetchImpl);

  assert.equal(requestBody.targetPlaceId, 'place-id');
  assert.equal(requestBody.targetSourceUrl, 'https://www.instagram.com/reel/test-id/');
  assert.deepEqual(result, {
    ok: true,
    status: 200,
    route: 'ai_note_enrichment',
    enriched: false,
    reason: 'stale_target',
    disposition: 'retry_after_outage',
    retryAfterSeconds: undefined,
  });
});

test('finalizer telemetry is bounded before structured logging', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({
    route: 'r'.repeat(500),
    reason: 'x'.repeat(500),
    disposition: 'd'.repeat(500),
  }), { status: 200 })) as typeof fetch;

  const result = await verifyPlaceEvidence({
    finalizeUrl: 'https://example.supabase.co/functions/v1/process-share-jobs',
    mediaFinalizeSecret: 'test-secret',
  } as WorkerConfig, {
    taskId: 'task-id',
    outcome: 'failed',
    analysisAttempted: false,
    signal: new AbortController().signal,
  }, fetchImpl);

  assert.equal(result.route?.length, 120);
  assert.equal(result.reason?.length, 200);
  assert.equal(result.disposition?.length, 120);
});
