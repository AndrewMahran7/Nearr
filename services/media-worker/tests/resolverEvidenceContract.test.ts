// services/media-worker/tests/resolverEvidenceContract.test.ts
//
// Resolver INTEGRATION test (not a live-video assertion): proves that
// normalized evidence from every platform — Instagram, TikTok, YouTube,
// Facebook, Snapchat — reaches the EXACT SAME downstream analyze() interface
// (AnalyzeInput), regardless of which resolver produced it. Pins the contract
// shape; does not assert any real video resolves to a specific place.
//
// Runs against real ffmpeg on real locally-generated synthetic media (no
// network, no copyrighted content); auto-skips without ffmpeg. The finalize
// HTTP call and Supabase client are mocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMediaTask, type TaskDeps } from '../src/pipeline/runMediaTask.js';
import type { MediaResolver, ResolveInput } from '../src/resolvers/MediaResolver.js';
import type { ResolvedMedia, MediaTask } from '../src/types/media.js';
import type { TranscriptionProvider, TranscribeInput } from '../src/providers/transcription.js';
import type { ModelProvider, AnalyzeInput, AnalyzeOutput } from '../src/providers/model.js';
import { selectOcrProvider } from '../src/providers/ocr.js';
import { loadConfig } from '../src/config/env.js';
import { generateSyntheticMedia, ffmpegAvailable } from './support/generateSyntheticMedia.js';

function fakeSupabaseClient(): any {
  const resolved = Promise.resolve({ data: null, error: null });
  const chain: any = { eq: () => chain, then: resolved.then.bind(resolved), catch: resolved.catch.bind(resolved) };
  return { from: () => ({ update: () => chain, select: () => chain }) };
}

class NoopTranscription implements TranscriptionProvider {
  readonly name = 'noop';
  async transcribe() {
    return { provider: this.name, segments: [], language: null, status: 'no_audio' as const };
  }
}

class FixtureTranscription implements TranscriptionProvider {
  readonly name = 'fixture-transcription';
  calls: Array<{ hasAudio: boolean }> = [];
  constructor(private readonly text: string | null) {}
  async transcribe(input: TranscribeInput) {
    this.calls.push({ hasAudio: input.hasAudio });
    return {
      provider: this.name,
      segments: this.text && input.hasAudio
        ? [{ startSeconds: 0, endSeconds: 2, text: this.text }]
        : [],
      language: this.text ? 'en' : null,
      status: input.hasAudio ? 'success' as const : 'no_audio' as const,
    };
  }
}

class CapturingModel implements ModelProvider {
  readonly name = 'capturing';
  captured: AnalyzeInput[] = [];
  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    this.captured.push(input);
    return {
      provider: this.name,
      promptVersion: 'test-v1',
      evidence: { places: [], multipleIntentionalPlaces: false, insufficientEvidence: true, warnings: [] },
    };
  }
}

function resolverFor(platform: string, sourceVideo: string, title: string, description: string): MediaResolver {
  return {
    name: `${platform}/test`,
    supports: () => true,
    async resolve(input: ResolveInput): Promise<ResolvedMedia> {
      const dest = path.join(input.workDir, 'source.mp4');
      await copyFile(sourceVideo, dest);
      const s = await stat(dest);
      return {
        canonicalUrl: input.canonicalUrl ?? input.sourceUrl,
        localFilePath: dest,
        mimeType: 'video/mp4',
        sizeBytes: s.size,
        source: `${platform}/yt-dlp`,
        warnings: [],
        metadataTitle: title,
        metadataDescription: description,
      };
    },
  };
}

function fakeTask(id: string, platform: string): MediaTask {
  return {
    id,
    share_job_id: `job-${id}`,
    user_id: 'user-1',
    source_url: `https://example.com/${platform}/post`,
    canonical_url: null,
    platform,
    status: 'processing',
    progress_stage: 'queued',
    attempts: 1,
    max_attempts: 3,
  };
}

async function withMockedFetch<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ route: 'test' }), { status: 200 })) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'facebook', 'snapchat'];

for (const platform of PLATFORMS) {
  test(`resolver evidence contract: ${platform} evidence reaches the same AnalyzeInput shape`, async (t) => {
    if (!(await ffmpegAvailable())) {
      t.skip('ffmpeg not available');
      return;
    }
    const workDir = await mkdtemp(path.join(tmpdir(), `nearr-evidence-contract-${platform}-`));
    try {
      const media = await generateSyntheticMedia(workDir);
      const cfg = loadConfig();
      const model = new CapturingModel();
      const deps: TaskDeps = {
        cfg,
        client: fakeSupabaseClient(),
        resolvers: [resolverFor(platform, media.videoWithAudio, `${platform} test title`, `${platform} test caption text`)],
        transcription: new NoopTranscription(),
        model,
        ocr: selectOcrProvider(cfg),
      };

      await withMockedFetch(() => runMediaTask(deps, fakeTask(`${platform}-case`, platform)));

      assert.equal(model.captured.length, 1, 'model.analyze must be called exactly once');
      const evidence = model.captured[0]!;
      // The CONTRACT: every platform's normalized evidence carries the same
      // shape — platform, canonicalUrl, transcript, ocr, frames, metadata.
      assert.equal(evidence.platform, platform);
      assert.equal(evidence.canonicalUrl, `https://example.com/${platform}/post`);
      assert.equal(evidence.metadataTitle, `${platform} test title`);
      assert.equal(evidence.metadataDescription, `${platform} test caption text`);
      assert.ok(Array.isArray(evidence.transcript));
      assert.ok(Array.isArray(evidence.ocr));
      assert.ok(Array.isArray(evidence.frames) && evidence.frames.length > 0, 'frame evidence must reach analyze() same as every other platform');
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

for (const fixture of [
  { name: 'spoken place clue', withAudio: true, transcript: 'Meet me at Tuxedo Cats Coffee on Heath Road' },
  { name: 'music or no useful speech', withAudio: true, transcript: null },
  { name: 'missing audio stream', withAudio: false, transcript: null },
] as const) {
  test(`TikTok audio/frame parity: ${fixture.name}`, async (t) => {
    if (!(await ffmpegAvailable())) {
      t.skip('ffmpeg not available');
      return;
    }
    const workDir = await mkdtemp(path.join(tmpdir(), 'nearr-tiktok-audio-contract-'));
    try {
      const media = await generateSyntheticMedia(workDir);
      const cfg = loadConfig();
      const model = new CapturingModel();
      const transcription = new FixtureTranscription(fixture.transcript);
      const source = fixture.withAudio ? media.videoWithAudio : media.videoNoAudio;
      await withMockedFetch(() => runMediaTask({
        cfg,
        client: fakeSupabaseClient(),
        resolvers: [resolverFor('tiktok', source, 'TikTok fixture', 'Full #place caption')],
        transcription,
        model,
        ocr: selectOcrProvider(cfg),
      }, fakeTask(`tiktok-${fixture.name.replace(/\W+/g, '-')}`, 'tiktok')));

      assert.equal(transcription.calls.length, 1);
      assert.equal(transcription.calls[0]?.hasAudio, fixture.withAudio);
      assert.equal(model.captured.length, 1);
      assert.equal(model.captured[0]?.transcript[0]?.text ?? null, fixture.transcript);
      assert.ok((model.captured[0]?.frames.length ?? 0) > 0, 'timestamped frames must survive every audio outcome');
      assert.equal(model.captured[0]?.metadataDescription, 'Full #place caption');
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
