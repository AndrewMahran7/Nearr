import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickProgressiveUrl,
  pickProgressiveHeaders,
  classifyYtError,
  boundedMetadata,
  requireHttpsHost,
} from '../src/resolvers/ytDlpShared.js';
import { isMediaError } from '../src/types/media.js';

test('pickProgressiveUrl: chooses the highest-height https audio+video format', () => {
  const url = pickProgressiveUrl({
    formats: [
      { url: 'https://cdn.example.com/720.mp4', protocol: 'https', vcodec: 'h264', acodec: 'aac', height: 720 },
      { url: 'https://cdn.example.com/1080.mp4', protocol: 'https', vcodec: 'h264', acodec: 'aac', height: 1080 },
    ],
  });
  assert.equal(url, 'https://cdn.example.com/1080.mp4');
});

test('pickProgressiveUrl: ignores video-only or audio-only formats', () => {
  const url = pickProgressiveUrl({
    formats: [
      { url: 'https://cdn.example.com/video-only.mp4', protocol: 'https', vcodec: 'h264', acodec: 'none', height: 1080 },
      { url: 'https://cdn.example.com/audio-only.m4a', protocol: 'https', vcodec: 'none', acodec: 'aac' },
    ],
  });
  assert.equal(url, null);
});

test('pickProgressiveUrl: rejects a "vtt"/https-looking format that is really an HLS manifest', () => {
  // Verified live against YouTube: a format entry can be labeled https with a
  // muxed vcodec/acodec yet actually be an m3u8_native HLS pointer.
  const url = pickProgressiveUrl({
    formats: [
      {
        url: 'https://manifest.googlevideo.com/api/manifest/hls_variant/index.m3u8',
        protocol: 'm3u8_native',
        vcodec: 'avc1',
        acodec: 'mp4a',
        height: 720,
      },
    ],
  });
  assert.equal(url, null, 'm3u8_native must never be treated as a directly fetchable progressive URL');
});

test('pickProgressiveUrl: falls back to a single-format extractor\'s top-level url (verified live: Snapchat Spotlight)', () => {
  const url = pickProgressiveUrl({ url: 'https://bolt-gcdn.sc-cdn.net/y/abc123.mp4', ext: 'mp4' });
  assert.equal(url, 'https://bolt-gcdn.sc-cdn.net/y/abc123.mp4');
});

test('pickProgressiveUrl: single-format fallback requires https + a real video container ext', () => {
  assert.equal(pickProgressiveUrl({ url: 'http://insecure.example.com/a.mp4', ext: 'mp4' }), null);
  assert.equal(pickProgressiveUrl({ url: 'https://example.com/playlist.m3u8', ext: 'm3u8' }), null);
});

test('pickProgressiveUrl: no formats and no top-level url => null', () => {
  assert.equal(pickProgressiveUrl({}), null);
});

test('pickProgressiveHeaders: only referer is forwarded, never user-agent or other headers (verified live: TikTok CDN 403s without Referer)', () => {
  const url = 'https://v16-webapp-prime.us.tiktok.com/abc.mp4';
  const info = {
    formats: [
      {
        url,
        protocol: 'https',
        vcodec: 'h264',
        acodec: 'aac',
        height: 720,
        http_headers: { Referer: 'https://www.tiktok.com/', 'User-Agent': 'some-browser-ua', Cookie: 'session=x' },
      },
    ],
  };
  assert.deepEqual(pickProgressiveHeaders(info, url), { referer: 'https://www.tiktok.com/' });
});

test('pickProgressiveHeaders: falls back to top-level http_headers for single-format extractors', () => {
  const url = 'https://bolt-gcdn.sc-cdn.net/y/abc123.mp4';
  const info = { url, ext: 'mp4', http_headers: { Referer: 'https://www.snapchat.com/' } };
  assert.deepEqual(pickProgressiveHeaders(info, url), { referer: 'https://www.snapchat.com/' });
});

test('pickProgressiveHeaders: no matching headers => undefined', () => {
  assert.equal(pickProgressiveHeaders({}, 'https://cdn.example.com/v.mp4'), undefined);
  assert.equal(
    pickProgressiveHeaders({ formats: [{ url: 'https://cdn.example.com/v.mp4' }] }, 'https://cdn.example.com/v.mp4'),
    undefined,
  );
});

test('classifyYtError: maps common yt-dlp stderr vocabulary to structured codes', () => {
  assert.equal(classifyYtError('ERROR: Login required to view this video').code, 'authentication_required');
  assert.equal(classifyYtError('ERROR: This video is private').code, 'private_or_unavailable');
  assert.equal(classifyYtError('ERROR: HTTP Error 429: Too Many Requests').code, 'download_failed');
  assert.equal(classifyYtError('ERROR: Unable to extract video data').code, 'provider_changed');
  assert.equal(classifyYtError('some totally unrecognized message').code, 'provider_changed');
});

test('boundedMetadata: trims/collapses whitespace and caps length', () => {
  assert.equal(boundedMetadata('  hello   world  ', 500), 'hello world');
  assert.equal(boundedMetadata('x'.repeat(10), 5), 'xxxxx');
  assert.equal(boundedMetadata(null, 500), null);
  assert.equal(boundedMetadata(42, 500), null);
});

test('requireHttpsHost: accepts only https + an allowed host, before any yt-dlp spawn', () => {
  const allow = (h: string) => h === 'example.com';
  assert.equal(requireHttpsHost('https://example.com/x', allow), 'https://example.com/x');
  assert.throws(() => requireHttpsHost('http://example.com/x', allow), (e: unknown) => isMediaError(e) && e.code === 'unsupported_url');
  assert.throws(() => requireHttpsHost('https://evil.com/x', allow), (e: unknown) => isMediaError(e) && e.code === 'unsupported_url');
  assert.throws(() => requireHttpsHost('not a url', allow), (e: unknown) => isMediaError(e) && e.code === 'unsupported_url');
});
