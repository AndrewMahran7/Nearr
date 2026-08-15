import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapchatMediaResolver } from '../src/resolvers/SnapchatMediaResolver.js';
import { isMediaError } from '../src/types/media.js';
import type { WorkerConfig } from '../src/config/env.js';

function resolver(enabled = true) {
  return new SnapchatMediaResolver({ snapchatResolverEnabled: enabled } as unknown as WorkerConfig);
}

test('supports(): ONLY snapchat.com /spotlight/ paths + flag', () => {
  const r = resolver(true);
  assert.equal(r.supports({ platform: 'snapchat', url: new URL('https://www.snapchat.com/spotlight/W7_abc123') }), true);
  assert.equal(r.supports({ platform: 'snapchat', url: new URL('https://snapchat.com/spotlight/W7_abc123') }), true);
});

test('supports(): non-Spotlight Snapchat forms (stories, profiles, private) are NOT claimed', () => {
  const r = resolver(true);
  // Mission constraint: public Spotlight only — never claim support for
  // stories, profiles, or any other Snapchat surface, since those may be
  // private/friends-only/authenticated and this resolver must never attempt
  // to bypass that.
  assert.equal(r.supports({ platform: 'snapchat', url: new URL('https://www.snapchat.com/add/someuser') }), false);
  assert.equal(r.supports({ platform: 'snapchat', url: new URL('https://story.snapchat.com/s/someuser') }), false);
  assert.equal(r.supports({ platform: 'snapchat', url: new URL('https://www.snapchat.com/') }), false);
});

test('supports(): flag OFF => never supports even for a valid Spotlight URL', () => {
  const r = resolver(false);
  assert.equal(r.supports({ platform: 'snapchat', url: new URL('https://www.snapchat.com/spotlight/W7_abc123') }), false);
});

test('supports(): wrong platform or host rejected', () => {
  const r = resolver(true);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://www.snapchat.com/spotlight/W7_abc123') }), false);
  assert.equal(r.supports({ platform: 'snapchat', url: new URL('https://evil.com/spotlight/W7_abc123') }), false);
});

test('resolve(): rejects non-HTTPS source before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'http://www.snapchat.com/spotlight/W7_abc123', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});

test('resolve(): rejects a non-Spotlight path before yt-dlp (defense in depth)', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'https://www.snapchat.com/add/someuser', workDir: '/tmp/none', signal: new AbortController().signal }),
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
