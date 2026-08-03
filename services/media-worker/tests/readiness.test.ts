import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, validateConfig, type WorkerConfig } from '../src/config/env.js';

function config(over: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    ...loadConfig(),
    workerSecret: 'worker-secret',
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'service-role',
    finalizeUrl: 'https://example.supabase.co/functions/v1/process-share-jobs',
    transcriptionProvider: 'openai',
    transcriptionApiKey: 'openai-key',
    analysisProvider: 'gemini',
    geminiApiKey: 'gemini-key',
    ...over,
  };
}

test('production provider configuration is ready', () => {
  assert.deepEqual(validateConfig(config()), { ok: true });
});

test('noop and heuristic providers cannot report ready', () => {
  const result = validateConfig(config({
    transcriptionProvider: 'noop',
    transcriptionApiKey: '',
    analysisProvider: 'heuristic',
    geminiApiKey: '',
  }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.missing.includes('MEDIA_TRANSCRIPTION_PROVIDER=openai'));
    assert.ok(result.missing.includes('MEDIA_TRANSCRIPTION_API_KEY'));
    assert.ok(result.missing.includes('MEDIA_ANALYSIS_PROVIDER=gemini'));
    assert.ok(result.missing.includes('GEMINI_API_KEY'));
  }
});