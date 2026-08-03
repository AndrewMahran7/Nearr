// services/media-worker/tests/integration/pipeline.test.ts
//
// Integration test over the FFmpeg pipeline using LOCALLY-GENERATED synthetic
// media (no network, no copyrighted content). Auto-skips when ffmpeg/ffprobe or
// an encoder (libx264) is unavailable, so it is safe in the default suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectMedia } from '../../src/pipeline/inspectMedia.js';
import { extractFrames } from '../../src/pipeline/extractFrames.js';
import { deduplicateFrames } from '../../src/pipeline/deduplicateFrames.js';
import { createJobTemp } from '../../src/util/tempDir.js';
import { binaryAvailable } from '../../src/util/exec.js';
import { isMediaError } from '../../src/types/media.js';
import type { WorkerConfig } from '../../src/config/env.js';
import { generateSyntheticMedia, ffmpegAvailable } from '../support/generateSyntheticMedia.js';

function testCfg(over: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    port: 8090,
    workerSecret: 's',
    mediaFallbackEnabled: true,
    instagramResolverEnabled: true,
    nativeVideoAnalysisEnabled: false,
    supabaseUrl: 'http://localhost',
    supabaseServiceRoleKey: 'k',
    finalizeUrl: 'http://localhost/f',
    maxConcurrency: 1,
    claimBatchSize: 2,
    claimLockSeconds: 600,
    retryBaseSeconds: 30,
    retryMaxSeconds: 900,
    maxDurationSeconds: 180,
    maxDownloadBytes: 150 * 1024 * 1024,
    downloadTimeoutMs: 60_000,
    jobTimeoutMs: 480_000,
    maxSelectedFrames: 24,
    frameIntervalSeconds: 1,
    redirectLimit: 3,
    allowedMediaHosts: ['cdninstagram.com', 'fbcdn.net', 'instagram.com'],
    transcriptionProvider: 'noop',
    transcriptionApiKey: '',
    transcriptionModel: 'whisper-1',
    selfHostedTranscriptionUrl: '',
    selfHostedTranscriptionApiKey: '',
    analysisProvider: 'heuristic',
    geminiApiKey: '',
    geminiModel: 'gemini-1.5-flash',
    ocrProvider: 'noop',
    mediaFetchProviderUrl: '',
    mediaFetchProviderApiKey: '',
    mediaFetchProviderAuthHeader: 'authorization',
    mediaFetchProviderUrlParam: 'url',
    mediaFetchProviderResultPath: 'url',
    ytDlpPath: 'yt-dlp',
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    tempDir: '',
    ...over,
  };
}

test('FFmpeg pipeline over synthetic media', async (t) => {
  const cfg = testCfg();
  const signal = new AbortController().signal;

  if (!(await ffmpegAvailable()) || !(await binaryAvailable(cfg.ffprobePath, '-version'))) {
    t.skip('ffmpeg/ffprobe not available');
    return;
  }

  const work = await mkdtemp(path.join(tmpdir(), 'nearr-media-itest-'));
  let media;
  try {
    media = await generateSyntheticMedia(work);
  } catch {
    await rm(work, { recursive: true, force: true });
    t.skip('cannot encode synthetic media (libx264 unavailable)');
    return;
  }

  try {
    // 1. Video with audio.
    const probeA = await inspectMedia(cfg, media.videoWithAudio, signal);
    assert.equal(probeA.hasVideo, true);
    assert.equal(probeA.hasAudio, true);
    assert.ok(probeA.durationSeconds > 2);

    // 2. Video with NO audio.
    const probeN = await inspectMedia(cfg, media.videoNoAudio, signal);
    assert.equal(probeN.hasVideo, true);
    assert.equal(probeN.hasAudio, false);

    // 3. Corrupt file → invalid media (safe rejection).
    await assert.rejects(() => inspectMedia(cfg, media.corrupt, signal), (e) => isMediaError(e));

    // 4. Duration limit enforced.
    await assert.rejects(
      () => inspectMedia(testCfg({ maxDurationSeconds: 2 }), media.videoWithAudio, signal),
      (e) => isMediaError(e) && e.code === 'duration_too_long',
    );

    // 5. Frames + dedup: a static video collapses to few frames.
    const probeS = await inspectMedia(cfg, media.staticRepeated, signal);
    const frames = await extractFrames(cfg, probeS, media.staticRepeated, work, signal);
    assert.ok(frames.length >= 2, `expected frames, got ${frames.length}`);
    const deduped = deduplicateFrames(frames);
    assert.ok(deduped.length <= frames.length);
    assert.ok(deduped.length <= 3, `static video should dedup hard, got ${deduped.length}`);

    // 6. Cleanup removes the whole temp dir.
    const jt = await createJobTemp('', 'itest-cleanup');
    assert.equal(existsSync(jt.dir), true);
    await jt.cleanup();
    assert.equal(existsSync(jt.dir), false);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
