import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeMediaResolver } from '../src/resolvers/YouTubeMediaResolver.js';
import { isMediaError } from '../src/types/media.js';
import type { WorkerConfig } from '../src/config/env.js';

function resolver(enabled = true) {
  return new YouTubeMediaResolver({ youtubeResolverEnabled: enabled } as unknown as WorkerConfig);
}

test('supports(): youtube host family (watch/shorts/youtu.be) + flag only', () => {
  const r = resolver(true);
  assert.equal(r.supports({ platform: 'youtube', url: new URL('https://www.youtube.com/watch?v=abc') }), true);
  assert.equal(r.supports({ platform: 'youtube', url: new URL('https://www.youtube.com/shorts/abc') }), true);
  assert.equal(r.supports({ platform: 'youtube', url: new URL('https://youtu.be/abc') }), true);
  assert.equal(r.supports({ platform: 'youtube', url: new URL('https://m.youtube.com/watch?v=abc') }), true);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://www.youtube.com/watch?v=abc') }), false);
  assert.equal(r.supports({ platform: 'youtube', url: new URL('https://evil.com/watch?v=abc') }), false);
});

test('supports(): flag OFF => never supports', () => {
  const r = resolver(false);
  assert.equal(r.supports({ platform: 'youtube', url: new URL('https://www.youtube.com/watch?v=abc') }), false);
});

test('resolve(): rejects non-HTTPS source before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'http://www.youtube.com/watch?v=abc', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});

test('resolve(): rejects a non-YouTube host before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'https://evil.com/watch?v=abc', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});

test('resolve(): rejects a malformed URL before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'not a url', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});
