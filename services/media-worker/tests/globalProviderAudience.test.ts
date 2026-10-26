import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/env.js';
import { selectModelProvider } from '../src/providers/model.js';

test('production Gemini selection is blocked before any request, even with a configured key and retained adult content', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('prohibited network request'); };
  try {
    const provider = selectModelProvider({ ...loadConfig(), analysisProvider: 'gemini', geminiApiKey: 'synthetic-key' });
    for (const targetPlace of [null, { name: 'Fixture place', category: 'restaurant' }]) {
      await assert.rejects(provider.analyze({ platform: 'instagram', canonicalUrl: 'https://example.invalid/video', transcript: [], ocr: [], frames: [], targetPlace, signal: new AbortController().signal }), /provider_audience_restricted/);
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});
