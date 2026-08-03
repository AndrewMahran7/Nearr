// services/media-worker/tests/transcription.test.ts
//
// Deterministic tests for the transcription provider selection + the URL-based
// self-hosted adapter (section 11). No real network for the config/degradation
// paths; the success path stubs globalThis.fetch. Proves the adapter uses the
// EXISTING root .env vars, degrades honestly when unconfigured, and never
// fabricates a transcript.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectTranscriptionProvider,
  selfHostedTranscriptionConfigured,
  TRANSCRIPTION_PLACEHOLDER_VALUES,
} from '../src/providers/transcription.js';
import { isTranscriptionConfigured } from '../src/cli/inspectSupport.js';
import { loadConfig, type WorkerConfig } from '../src/config/env.js';

function cfg(over: Partial<WorkerConfig>): WorkerConfig {
  return { ...loadConfig(), ...over } as WorkerConfig;
}
const signal = new AbortController().signal;

// ---- config detection -----------------------------------------------------
test('selfHostedTranscriptionConfigured: empty url => not configured', () => {
  const r = selfHostedTranscriptionConfigured(cfg({ transcriptionProvider: 'self_hosted', selfHostedTranscriptionUrl: '' }));
  assert.equal(r.configured, false);
  assert.equal(r.reason, 'self_hosted_url_not_configured');
});

test('selfHostedTranscriptionConfigured: placeholder key => not configured', () => {
  const r = selfHostedTranscriptionConfigured(
    cfg({ transcriptionProvider: 'self_hosted', selfHostedTranscriptionUrl: 'https://evidence.example.com', selfHostedTranscriptionApiKey: 'api_key' }),
  );
  assert.equal(r.configured, false);
  assert.equal(r.reason, 'self_hosted_api_key_placeholder');
});

test('selfHostedTranscriptionConfigured: real url + key => configured', () => {
  const r = selfHostedTranscriptionConfigured(
    cfg({ transcriptionProvider: 'self_hosted', selfHostedTranscriptionUrl: 'https://evidence.example.com', selfHostedTranscriptionApiKey: 'real-secret' }),
  );
  assert.equal(r.configured, true);
});

test('placeholder set includes the example env value', () => {
  assert.ok(TRANSCRIPTION_PLACEHOLDER_VALUES.has('api_key'));
});

test('isTranscriptionConfigured: noop/openai/self_hosted', () => {
  assert.equal(isTranscriptionConfigured(cfg({ transcriptionProvider: 'noop' })), false);
  assert.equal(isTranscriptionConfigured(cfg({ transcriptionProvider: 'openai', transcriptionApiKey: '' })), false);
  assert.equal(isTranscriptionConfigured(cfg({ transcriptionProvider: 'openai', transcriptionApiKey: 'sk-x' })), true);
  assert.equal(
    isTranscriptionConfigured(cfg({ transcriptionProvider: 'self_hosted', selfHostedTranscriptionUrl: 'https://e.example.com', selfHostedTranscriptionApiKey: 'real' })),
    true,
  );
  assert.equal(
    isTranscriptionConfigured(cfg({ transcriptionProvider: 'self_hosted', selfHostedTranscriptionUrl: '', selfHostedTranscriptionApiKey: 'real' })),
    false,
  );
});

// ---- provider selection ---------------------------------------------------
test('selectTranscriptionProvider returns the self_hosted provider', () => {
  const p = selectTranscriptionProvider(cfg({ transcriptionProvider: 'self_hosted' }));
  assert.equal(p.name, 'self_hosted');
});

// ---- degradation (honest, no fabrication) ---------------------------------
test('self_hosted transcribe: unconfigured => unavailable (no fabrication)', async () => {
  const p = selectTranscriptionProvider(cfg({ transcriptionProvider: 'self_hosted', selfHostedTranscriptionUrl: '' }));
  const r = await p.transcribe({ audioPath: '/tmp/a.wav', hasAudio: true, signal, sourceUrl: 'https://insta/x' });
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'self_hosted_url_not_configured');
  assert.equal(r.segments.length, 0);
});

test('self_hosted transcribe: configured but no source URL => unavailable', async () => {
  const p = selectTranscriptionProvider(
    cfg({ transcriptionProvider: 'self_hosted', selfHostedTranscriptionUrl: 'https://e.example.com', selfHostedTranscriptionApiKey: 'real' }),
  );
  const r = await p.transcribe({ audioPath: '/tmp/a.wav', hasAudio: true, signal, sourceUrl: null });
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'self_hosted_requires_source_url');
});

// ---- success path (stubbed fetch) -----------------------------------------
test('self_hosted transcribe: maps a real response into segments', async () => {
  const realFetch = globalThis.fetch;
  let calledUrl = '';
  let sentKey = '';
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init: RequestInit) => {
    calledUrl = String(url);
    sentKey = String((init.headers as Record<string, string>)['X-NEARR-EVIDENCE-KEY'] ?? '');
    return new Response(
      JSON.stringify({ transcript: { text: 'full', language: 'en', segments: [{ start: 0, end: 2, text: 'top five pizza' }, { start: 2, end: 4, text: 'Parlor Woodfire' }] } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  try {
    const p = selectTranscriptionProvider(
      cfg({ transcriptionProvider: 'self_hosted', selfHostedTranscriptionUrl: 'https://e.example.com', selfHostedTranscriptionApiKey: 'real-secret' }),
    );
    const r = await p.transcribe({ audioPath: null, hasAudio: true, signal, sourceUrl: 'https://instagram.com/reel/x', platform: 'instagram' });
    assert.equal(r.status, 'success');
    assert.equal(r.segments.length, 2);
    assert.equal(r.segments[1]!.text, 'Parlor Woodfire');
    assert.match(calledUrl, /\/extract\/video-transcript$/);
    assert.equal(sentKey, 'real-secret');
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch;
  }
});
