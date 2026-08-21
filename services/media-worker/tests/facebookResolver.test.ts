import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FacebookMediaResolver,
  assertFacebookPostIdentityMatches,
  facebookSourceIdentityFromInfo,
} from '../src/resolvers/FacebookMediaResolver.js';
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

test('public extractor identity canonicalizes every numeric Facebook video id', () => {
  const identity = facebookSourceIdentityFromInfo(
    {
      id: '10153231379946729',
      uploader: 'Facebook',
      uploader_id: '100064860875397',
    },
    'https://fb.watch/opaqueToken/',
  );
  assert.deepEqual(identity, {
    canonicalUrl: 'https://www.facebook.com/reel/10153231379946729/',
    sourceId: '10153231379946729',
    creatorName: 'Facebook',
    creatorId: '100064860875397',
  });
});

test('numeric extractor identity mismatch stops before Facebook download', () => {
  assert.doesNotThrow(() => assertFacebookPostIdentityMatches(
    'https://www.facebook.com/watch/?v=11111',
    '11111',
    'https://www.facebook.com/reel/11111/',
  ));
  assert.throws(
    () => assertFacebookPostIdentityMatches(
      'https://www.facebook.com/reel/11111/',
      '22222',
      'https://www.facebook.com/reel/22222/',
    ),
    (e) => isMediaError(e) && e.code === 'identity_mismatch' && !e.retryable,
  );
});

test('non-numeric extractor ids preserve the exact fallback URL', () => {
  const identity = facebookSourceIdentityFromInfo(
    { id: 'pfbid0abcDEF', uploader: 'Example Page' },
    'https://www.facebook.com/example/posts/pfbid0abcDEF/',
  );
  assert.equal(identity.canonicalUrl, 'https://www.facebook.com/example/posts/pfbid0abcDEF/');
  assert.equal(identity.sourceId, 'pfbid0abcDEF');
  assert.equal(identity.creatorName, 'Example Page');
});

test('resolve(): rejects a malformed URL before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'not a url', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});
