// Opt-in LIVE test — retrieves a REAL public Instagram reel via yt-dlp.
// Skipped unless INSTAGRAM_LIVE_TESTS=1 and INSTAGRAM_LIVE_URL is set.
// May hit Instagram rate limits. Uses only a public URL; no login/cookies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InstagramMediaResolver } from '../../src/resolvers/InstagramMediaResolver.js';
import { loadConfig } from '../../src/config/env.js';
import { createJobTemp } from '../../src/util/tempDir.js';
import { sanitizeUrlForLog } from '../../src/security/ssrf.js';

const ENABLED = process.env.INSTAGRAM_LIVE_TESTS === '1';
const LIVE_URL = process.env.INSTAGRAM_LIVE_URL || '';

test('LIVE: Instagram resolver retrieves a public reel', { skip: !ENABLED || !LIVE_URL }, async () => {
  process.env.INSTAGRAM_MEDIA_RESOLVER_ENABLED = 'true';
  const cfg = loadConfig();
  const resolver = new InstagramMediaResolver(cfg);
  const jt = await createJobTemp('', 'live-ig');
  try {
    const media = await resolver.resolve({
      jobId: 'live',
      sourceUrl: LIVE_URL,
      workDir: jt.dir,
      signal: new AbortController().signal,
    });
    assert.ok(media.sizeBytes > 0, 'expected non-empty media');
    assert.ok(media.localFilePath.startsWith(jt.dir), 'media must live in the isolated temp dir');
    // eslint-disable-next-line no-console
    console.log('LIVE resolved', {
      source: media.source,
      sizeBytes: media.sizeBytes,
      durationSeconds: media.durationSeconds ?? 'n/a',
      url: sanitizeUrlForLog(media.canonicalUrl),
    });
  } finally {
    await jt.cleanup();
  }
});
