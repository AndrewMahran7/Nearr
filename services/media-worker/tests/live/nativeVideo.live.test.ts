// Opt-in LIVE test — native multimodal (Gemini) analysis of synthetic frames.
// Skipped unless NATIVE_VIDEO_LIVE_TESTS=1 and GEMINI_API_KEY is set. May incur
// API cost. Proves the model path returns SCHEMA-VALID evidence (never asserts a
// specific place — the model is not the authority).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectModelProvider } from '../../src/providers/model.js';
import { loadConfig } from '../../src/config/env.js';
import { extractFrames } from '../../src/pipeline/extractFrames.js';
import { inspectMedia } from '../../src/pipeline/inspectMedia.js';
import { MediaPlaceEvidence } from '../../src/types/evidence.js';
import { generateSyntheticMedia, ffmpegAvailable } from '../support/generateSyntheticMedia.js';

const ENABLED = process.env.NATIVE_VIDEO_LIVE_TESTS === '1';
const HAS_KEY = !!process.env.GEMINI_API_KEY;

test('LIVE: multimodal model returns schema-valid evidence', { skip: !ENABLED || !HAS_KEY }, async () => {
  process.env.MEDIA_ANALYSIS_PROVIDER = 'gemini';
  const cfg = loadConfig();
  if (!(await ffmpegAvailable())) return;

  const work = await mkdtemp(path.join(tmpdir(), 'nearr-native-live-'));
  try {
    const media = await generateSyntheticMedia(work);
    const probe = await inspectMedia(cfg, media.videoWithAudio, new AbortController().signal);
    const frames = await extractFrames(cfg, probe, media.videoWithAudio, work, new AbortController().signal);
    const model = selectModelProvider(cfg);
    const out = await model.analyze({
      platform: 'instagram',
      canonicalUrl: 'https://www.instagram.com/reel/synthetic/',
      transcript: [],
      ocr: [],
      frames,
      signal: new AbortController().signal,
    });
    // The model may legitimately return insufficientEvidence for a test pattern
    // video — we only assert the output is schema-valid + safe.
    const parsed = MediaPlaceEvidence.safeParse(out.evidence);
    assert.equal(parsed.success, true);
    // eslint-disable-next-line no-console
    console.log('LIVE native analysis', { provider: out.provider, insufficient: out.evidence.insufficientEvidence });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
