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
    mediaFinalizeSecret: 'finalize-secret',
    transcriptionProvider: 'openai',
    transcriptionApiKey: 'openai-key',
    analysisProvider: 'openai',
    openaiRecognition: {enabled:true,allowedRoute:'openai_only',apiKey:'offline-test-key',model:'offline-test-model',timeoutMs:60000,maxOutputTokens:4000,
      inputPricePerMillion:null,cachedInputPricePerMillion:null,outputPricePerMillion:null,pricingReference:''},
    geminiApiKey: 'gemini-key',
    ...over,
  };
}

test('explicitly qualified OpenAI configuration is provider-ready', () => {
  assert.deepEqual(validateConfig(config()), { ok: true });
});

test('noop and heuristic providers cannot report ready', () => {
  const result = validateConfig(config({
    transcriptionProvider: 'noop',
    transcriptionApiKey: '',
    analysisProvider: 'heuristic',
    openaiRecognition: undefined,
  }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.missing.includes('MEDIA_TRANSCRIPTION_PROVIDER=openai'));
    assert.ok(result.missing.includes('MEDIA_TRANSCRIPTION_API_KEY'));
    assert.ok(result.missing.includes('MEDIA_ANALYSIS_PROVIDER=openai'));
    assert.ok(result.missing.includes('MEDIA_OPENAI_RECOGNITION_API_KEY'));
  }
});

test('legacy Gemini configuration stays unavailable even with a key', () => {
  assert.equal(validateConfig(config({analysisProvider:'gemini'})).ok,false);
});
