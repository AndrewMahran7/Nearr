// services/media-worker/tests/transcriptHierarchy.test.ts
//
// Proves the transcript hierarchy added for cross-platform captions support
// (runMediaTask.ts, step 3): when a resolver already supplied a usable
// `captionsTranscript` (e.g. YouTube), the pipeline uses it AS THE transcript
// and never extracts audio or calls the transcription provider; when it did
// not, the existing audio-extraction + transcription-provider path runs
// unchanged. Runs against REAL locally-generated synthetic media + REAL
// ffmpeg (frames/inspect still execute either way) — auto-skips without
// ffmpeg. The finalize HTTP call and Supabase client are mocked (per mission:
// no network/DB dependency for a unit test).

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

// ---------------------------------------------------------------------------
// Minimal fake Supabase client: only `.from(table).update(patch).eq(...)`
// (chainable, any arity) is exercised by runMediaTask's progress/diagnostics
// writes. Every step resolves to `{ data: null, error: null }`.
// ---------------------------------------------------------------------------
function fakeSupabaseClient(): any {
  const resolved = Promise.resolve({ data: null, error: null });
  const chain: any = {
    eq: () => chain,
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  return { from: () => ({ update: () => chain, select: () => chain }) };
}

class CapturingTranscription implements TranscriptionProvider {
  readonly name = 'capturing';
  calls: TranscribeInput[] = [];
  async transcribe(input: TranscribeInput) {
    this.calls.push(input);
    return { provider: this.name, segments: [], language: null, status: 'unavailable' as const };
  }
}

class NoopModel implements ModelProvider {
  readonly name = 'noop-model';
  async analyze(_input: AnalyzeInput): Promise<AnalyzeOutput> {
    return {
      provider: this.name,
      promptVersion: 'test-v1',
      evidence: { places: [], multipleIntentionalPlaces: false, insufficientEvidence: true, warnings: [] },
    };
  }
}

function makeResolver(media: Omit<ResolvedMedia, 'canonicalUrl' | 'localFilePath' | 'sizeBytes'>, sourceVideo: string): MediaResolver {
  return {
    name: 'test-resolver',
    supports: () => true,
    async resolve(input: ResolveInput): Promise<ResolvedMedia> {
      const dest = path.join(input.workDir, 'source.mp4');
      await copyFile(sourceVideo, dest);
      const s = await stat(dest);
      return { ...media, canonicalUrl: input.canonicalUrl ?? input.sourceUrl, localFilePath: dest, sizeBytes: s.size };
    },
  };
}

function fakeTask(id: string): MediaTask {
  return {
    id,
    share_job_id: `job-${id}`,
    user_id: 'user-1',
    source_url: 'https://example.com/video',
    canonical_url: null,
    platform: 'youtube',
    status: 'processing',
    progress_stage: 'queued',
    attempts: 1,
    max_attempts: 3,
  };
}

async function withMockedFetch<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ route: 'test' }), { status: 200 })) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('transcript hierarchy: captions present => transcription provider is NEVER called', async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip('ffmpeg not available');
    return;
  }
  const workDir = await mkdtemp(path.join(tmpdir(), 'nearr-caption-hierarchy-'));
  try {
    const media = await generateSyntheticMedia(workDir);
    const cfg = loadConfig();
    const transcription = new CapturingTranscription();
    const deps: TaskDeps = {
      cfg,
      client: fakeSupabaseClient(),
      resolvers: [
        makeResolver(
          {
            mimeType: 'video/mp4',
            source: 'youtube/yt-dlp-merged',
            warnings: [],
            captionsTranscript: [{ startSeconds: 0, endSeconds: 2, text: 'Real captions from the platform' }],
            captionsSource: 'youtube_captions',
            captionsLanguage: 'en',
          },
          media.videoWithAudio,
        ),
      ],
      transcription,
      model: new NoopModel(),
      ocr: selectOcrProvider(cfg),
    };

    await withMockedFetch(() => runMediaTask(deps, fakeTask('caption-case')));

    assert.equal(transcription.calls.length, 0, 'audio transcription must be skipped when captions are usable');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('transcript hierarchy: no captions => existing audio transcription path still runs', async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip('ffmpeg not available');
    return;
  }
  const workDir = await mkdtemp(path.join(tmpdir(), 'nearr-caption-hierarchy-'));
  try {
    const media = await generateSyntheticMedia(workDir);
    const cfg = loadConfig();
    const transcription = new CapturingTranscription();
    const deps: TaskDeps = {
      cfg,
      client: fakeSupabaseClient(),
      resolvers: [
        makeResolver({ mimeType: 'video/mp4', source: 'instagram/yt-dlp-direct', warnings: [] }, media.videoWithAudio),
      ],
      transcription,
      model: new NoopModel(),
      ocr: selectOcrProvider(cfg),
    };

    await withMockedFetch(() => runMediaTask(deps, fakeTask('no-caption-case')));

    assert.equal(transcription.calls.length, 1, 'transcription provider must run when the resolver supplied no captions');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('transcript hierarchy: empty captionsTranscript array falls through to audio path', async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip('ffmpeg not available');
    return;
  }
  const workDir = await mkdtemp(path.join(tmpdir(), 'nearr-caption-hierarchy-'));
  try {
    const media = await generateSyntheticMedia(workDir);
    const cfg = loadConfig();
    const transcription = new CapturingTranscription();
    const deps: TaskDeps = {
      cfg,
      client: fakeSupabaseClient(),
      resolvers: [
        makeResolver(
          { mimeType: 'video/mp4', source: 'youtube/yt-dlp-merged', warnings: [], captionsTranscript: [] },
          media.videoWithAudio,
        ),
      ],
      transcription,
      model: new NoopModel(),
      ocr: selectOcrProvider(cfg),
    };

    await withMockedFetch(() => runMediaTask(deps, fakeTask('empty-captions-case')));

    assert.equal(transcription.calls.length, 1, 'an empty captions array is not "usable" — must not be fabricated as success');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});
