import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchPostMetadata } from '../../../supabase/functions/process-share-link/metadata/fetchMetadata.js';

test('Instagram login redirect cannot replace the original content identity', async () => {
  const originalFetch = globalThis.fetch;
  const source = 'https://www.instagram.com/reel/EXAMPLE/';
  const loginRedirect = 'https://www.instagram.com/accounts/login/?next=%2Freel%2FEXAMPLE%2F';
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    url: loginRedirect,
    text: async () => '<meta property="og:title" content="Legitimate Reel metadata">',
  })) as unknown as typeof fetch;

  try {
    const result = await fetchPostMetadata(source, 'instagram');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.resolvedUrl, source);
      assert.equal(result.metadata.title, 'Legitimate Reel metadata');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TikTok redirect canonicalization remains unchanged', async () => {
  const originalFetch = globalThis.fetch;
  const source = 'https://vm.tiktok.com/ZMExample/';
  const canonical = 'https://www.tiktok.com/@creator/video/1234567890';
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    url: canonical,
    text: async () => '<meta property="og:description" content="A sufficiently descriptive TikTok caption">',
  })) as unknown as typeof fetch;

  try {
    const result = await fetchPostMetadata(source, 'tiktok');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.resolvedUrl, canonical);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
