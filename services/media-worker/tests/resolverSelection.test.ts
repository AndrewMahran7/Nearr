// services/media-worker/tests/resolverSelection.test.ts
//
// "Downloader contract" test: proves every supported platform reaches the
// SAME normalized MediaResolver interface via selectResolver — the exact
// wiring used by src/index.ts and runMediaTask.ts — and that an unsupported
// platform/host combination reaches none of them (=> `unsupported_platform`,
// never a silent wrong resolver).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectResolver } from '../src/resolvers/MediaResolver.js';
import { InstagramMediaResolver } from '../src/resolvers/InstagramMediaResolver.js';
import { TikTokMediaResolver } from '../src/resolvers/TikTokMediaResolver.js';
import { YouTubeMediaResolver } from '../src/resolvers/YouTubeMediaResolver.js';
import { FacebookMediaResolver } from '../src/resolvers/FacebookMediaResolver.js';
import { SnapchatMediaResolver } from '../src/resolvers/SnapchatMediaResolver.js';
import type { WorkerConfig } from '../src/config/env.js';

const allEnabledCfg = {
  instagramResolverEnabled: true,
  tiktokResolverEnabled: true,
  youtubeResolverEnabled: true,
  facebookResolverEnabled: true,
  snapchatResolverEnabled: true,
} as unknown as WorkerConfig;

function allResolvers(cfg: WorkerConfig) {
  return [
    new InstagramMediaResolver(cfg),
    new TikTokMediaResolver(cfg),
    new YouTubeMediaResolver(cfg),
    new FacebookMediaResolver(cfg),
    new SnapchatMediaResolver(cfg),
  ];
}

const CASES: { platform: string; url: string; expectedResolver: string }[] = [
  { platform: 'instagram', url: 'https://www.instagram.com/reel/abc/', expectedResolver: 'instagram/yt-dlp' },
  { platform: 'tiktok', url: 'https://www.tiktok.com/@user/video/123', expectedResolver: 'tiktok/yt-dlp' },
  { platform: 'tiktok', url: 'https://vm.tiktok.com/ZMabc/', expectedResolver: 'tiktok/yt-dlp' },
  { platform: 'youtube', url: 'https://www.youtube.com/watch?v=abc', expectedResolver: 'youtube/yt-dlp' },
  { platform: 'youtube', url: 'https://www.youtube.com/shorts/abc', expectedResolver: 'youtube/yt-dlp' },
  { platform: 'youtube', url: 'https://youtu.be/abc', expectedResolver: 'youtube/yt-dlp' },
  { platform: 'facebook', url: 'https://www.facebook.com/reel/123/', expectedResolver: 'facebook/yt-dlp' },
  { platform: 'facebook', url: 'https://fb.watch/abc/', expectedResolver: 'facebook/yt-dlp' },
  { platform: 'snapchat', url: 'https://www.snapchat.com/spotlight/W7_abc', expectedResolver: 'snapchat/yt-dlp' },
];

for (const c of CASES) {
  test(`selectResolver: ${c.platform} ${c.url} => ${c.expectedResolver}`, () => {
    const picked = selectResolver(allResolvers(allEnabledCfg), { platform: c.platform, url: new URL(c.url) });
    assert.ok(picked, 'expected a resolver to be selected');
    assert.equal(picked!.name, c.expectedResolver);
  });
}

test('selectResolver: each platform selects a DIFFERENT resolver instance (no cross-platform collision)', () => {
  const resolvers = allResolvers(allEnabledCfg);
  const names = new Set(
    CASES.map((c) => selectResolver(resolvers, { platform: c.platform, url: new URL(c.url) })?.name),
  );
  assert.equal(names.size, 5, 'expected exactly 5 distinct resolvers across the 5 platforms');
});

test('selectResolver: unsupported platform/host reaches no resolver', () => {
  const resolvers = allResolvers(allEnabledCfg);
  assert.equal(selectResolver(resolvers, { platform: 'twitter', url: new URL('https://x.com/user/status/1') }), null);
  assert.equal(selectResolver(resolvers, { platform: 'genericWeb', url: new URL('https://example.com/page') }), null);
  // Snapchat profile/story is a real Snapchat host but NOT a Spotlight path —
  // must not silently fall through to any other resolver.
  assert.equal(selectResolver(resolvers, { platform: 'snapchat', url: new URL('https://www.snapchat.com/add/user') }), null);
});

test('selectResolver: all flags OFF => every platform reaches no resolver (Phase-1-equivalent default)', () => {
  const cfg = {
    instagramResolverEnabled: false,
    tiktokResolverEnabled: false,
    youtubeResolverEnabled: false,
    facebookResolverEnabled: false,
    snapchatResolverEnabled: false,
  } as unknown as WorkerConfig;
  const resolvers = allResolvers(cfg);
  for (const c of CASES) {
    assert.equal(selectResolver(resolvers, { platform: c.platform, url: new URL(c.url) }), null, c.url);
  }
});

test('selectResolver: each platform flag is independent (enabling one does not enable others)', () => {
  const cfg = {
    instagramResolverEnabled: false,
    tiktokResolverEnabled: true,
    youtubeResolverEnabled: false,
    facebookResolverEnabled: false,
    snapchatResolverEnabled: false,
  } as unknown as WorkerConfig;
  const resolvers = allResolvers(cfg);
  assert.ok(selectResolver(resolvers, { platform: 'tiktok', url: new URL('https://www.tiktok.com/@u/video/1') }));
  assert.equal(selectResolver(resolvers, { platform: 'youtube', url: new URL('https://www.youtube.com/watch?v=abc') }), null);
  assert.equal(selectResolver(resolvers, { platform: 'facebook', url: new URL('https://www.facebook.com/reel/1/') }), null);
  assert.equal(selectResolver(resolvers, { platform: 'instagram', url: new URL('https://www.instagram.com/reel/abc/') }), null);
});
