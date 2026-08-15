import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TikTokMediaResolver } from '../src/resolvers/TikTokMediaResolver.js';
import { isMediaError } from '../src/types/media.js';
import type { WorkerConfig } from '../src/config/env.js';

function resolver(enabled = true) {
  return new TikTokMediaResolver({ tiktokResolverEnabled: enabled } as unknown as WorkerConfig);
}

test('supports(): tiktok host family + flag only', () => {
  const r = resolver(true);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://www.tiktok.com/@user/video/123') }), true);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://tiktok.com/@user/video/123') }), true);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://vm.tiktok.com/ZMabc/') }), true);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://vt.tiktok.com/ZMabc/') }), true);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://www.tiktok.com/@user/video/123') }), false);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://evil.com/@user/video/123') }), false);
});

test('supports(): flag OFF => never supports', () => {
  const r = resolver(false);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://www.tiktok.com/@user/video/123') }), false);
});

test('resolve(): rejects non-HTTPS source before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'http://www.tiktok.com/@user/video/123', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});

test('resolve(): rejects a non-TikTok host before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'https://evil.com/@user/video/123', workDir: '/tmp/none', signal: new AbortController().signal }),
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
