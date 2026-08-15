import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FacebookMediaResolver } from '../src/resolvers/FacebookMediaResolver.js';
import { isMediaError } from '../src/types/media.js';
import type { WorkerConfig } from '../src/config/env.js';

function resolver(enabled = true) {
  return new FacebookMediaResolver({ facebookResolverEnabled: enabled } as unknown as WorkerConfig);
}

test('supports(): facebook host family (incl. fb.watch) + flag only', () => {
  const r = resolver(true);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://www.facebook.com/reel/123456/') }), true);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://www.facebook.com/SomePage/videos/123456/') }), true);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://fb.watch/abcDEF/') }), true);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://m.facebook.com/reel/123456/') }), true);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://www.facebook.com/reel/123456/') }), false);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://evil.com/reel/123456/') }), false);
});

test('supports(): flag OFF => never supports', () => {
  const r = resolver(false);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://www.facebook.com/reel/123456/') }), false);
});

test('resolve(): rejects non-HTTPS source before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'http://www.facebook.com/reel/123456/', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});

test('resolve(): rejects a non-Facebook host before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'https://evil.com/reel/123456/', workDir: '/tmp/none', signal: new AbortController().signal }),
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
