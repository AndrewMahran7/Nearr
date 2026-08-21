import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InstagramMediaResolver,
  pickProgressiveUrl,
} from '../src/resolvers/InstagramMediaResolver.js';
import { isMediaError } from '../src/types/media.js';
import type { WorkerConfig } from '../src/config/env.js';
import {
  isInstagramContentUrl,
  selectInstagramContentUrl,
} from '../src/resolvers/instagramUrl.js';

function resolver(enabled = true) {
  return new InstagramMediaResolver({ instagramResolverEnabled: enabled } as unknown as WorkerConfig);
}

test('supports(): public Instagram content URL + flag only', () => {
  const r = resolver(true);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://www.instagram.com/reel/abc/') }), true);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://instagram.com/p/abc/') }), true);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://instagram.com/reels/abc/') }), true);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://instagram.com/tv/abc/') }), true);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://instagram.com/creator.name/reel/abc/') }), true);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://instagram.com/accounts/login/') }), false);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://www.tiktok.com/@x/video/1') }), false);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://evil.com/p/abc/') }), false);
});

test('Instagram content identity rejects same-host non-content paths', () => {
  for (const path of ['/', '/accounts/login/', '/accounts/edit/', '/login/', '/explore/', '/direct/', '/stories/user/1/']) {
    assert.equal(isInstagramContentUrl(`https://www.instagram.com${path}`), false, path);
  }
  assert.equal(isInstagramContentUrl('https://user@www.instagram.com/reel/x/'), false);
  assert.equal(isInstagramContentUrl('https://www.instagram.com:444/reel/x/'), false);
});

test('poisoned canonical falls back to the valid source Reel', () => {
  const source = 'https://www.instagram.com/reel/EXAMPLE/';
  const poisoned = 'https://www.instagram.com/accounts/login/?next=%2Freel%2FEXAMPLE%2F';
  assert.equal(selectInstagramContentUrl(source, poisoned), source);
});

test('valid canonical content identity still wins', () => {
  assert.equal(
    selectInstagramContentUrl(
      'https://www.instagram.com/creator.name/reel/EXAMPLE/?igsh=tracking',
      'https://www.instagram.com/reel/EXAMPLE/',
    ),
    'https://www.instagram.com/reel/EXAMPLE/',
  );
});

test('both invalid Instagram inputs fail closed', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({
      jobId: 'j',
      sourceUrl: 'https://www.instagram.com/explore/',
      canonicalUrl: 'https://www.instagram.com/accounts/login/',
      workDir: '/tmp/none',
      signal: new AbortController().signal,
    }),
    (e) => isMediaError(e) && e.code === 'unsupported_url' && e.detail === 'invalid_instagram_content_url',
  );
});

test('supports(): flag OFF => never supports', () => {
  const r = resolver(false);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://www.instagram.com/reel/abc/') }), false);
});

test('pickProgressiveUrl ignores an unverified top-level video URL', () => {
  assert.equal(
    pickProgressiveUrl({
      url: 'https://cdninstagram.com/video-only.mp4',
      formats: [
        {
          url: 'https://cdninstagram.com/video-only.mp4',
          protocol: 'https',
          vcodec: 'h264',
          acodec: 'none',
          height: 1080,
        },
      ],
    }),
    null,
  );
});

test('pickProgressiveUrl chooses the highest audio+video HTTPS format', () => {
  assert.equal(
    pickProgressiveUrl({
      formats: [
        {
          url: 'https://cdninstagram.com/progressive-720.mp4',
          protocol: 'https',
          vcodec: 'h264',
          acodec: 'aac',
          height: 720,
        },
        {
          url: 'https://cdninstagram.com/progressive-1080.mp4',
          protocol: 'https',
          vcodec: 'h264',
          acodec: 'aac',
          height: 1080,
        },
      ],
    }),
    'https://cdninstagram.com/progressive-1080.mp4',
  );
});

test('resolve(): rejects non-HTTPS source before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'http://www.instagram.com/reel/abc/', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});

test('resolve(): rejects non-Instagram host before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'https://evil.com/reel/abc/', workDir: '/tmp/none', signal: new AbortController().signal }),
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
