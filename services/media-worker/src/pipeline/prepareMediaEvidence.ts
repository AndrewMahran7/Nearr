import type { WorkerConfig } from '../config/env.js';
import type { MediaProbe, ProgressStage, ResolvedMedia, SelectedFrame, TranscriptResult } from '../types/media.js';
import type { TranscriptionProvider } from '../providers/transcription.js';
import { extractAudio } from './extractAudio.js';
import { extractFrames } from './extractFrames.js';
import { deduplicateFrames } from './deduplicateFrames.js';

/** All started branches settle before the caller may clean the task directory.
 * A fatal branch cancels its sibling, and parent cancellation reaches both.
 * Expected ASR failure remains a TranscriptResult, not a thrown branch failure.
 */
export async function joinMediaBranches<A, B>(
  parent: AbortSignal,
  parallel: boolean,
  audio: (signal: AbortSignal) => Promise<A>,
  frames: (signal: AbortSignal) => Promise<B>,
): Promise<[A, B]> {
  parent.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener('abort', abort, { once: true });
  // Close the race between the initial check and listener registration.
  if (parent.aborted) abort();
  try {
    if (!parallel) {
      const first = await audio(controller.signal);
      controller.signal.throwIfAborted();
      const second = await frames(controller.signal);
      controller.signal.throwIfAborted();
      return [first, second];
    }
    let failure: unknown;
    let failed = false;
    const guard = async <T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      try { controller.signal.throwIfAborted(); return await run(controller.signal); }
      catch (error) {
        if (!failed) { failure = error; failed = true; }
        controller.abort(error);
        throw error;
      }
    };
    const results = await Promise.allSettled([guard(audio), guard(frames)]);
    if (failed) throw failure;
    controller.signal.throwIfAborted();
    const first = results[0];
    const second = results[1];
    if (first.status !== 'fulfilled' || second.status !== 'fulfilled') throw new Error('media_join_failed');
    return [first.value, second.value];
  } finally { parent.removeEventListener('abort', abort); }
}

type Measure = <T>(stage: string, provider: string, run: () => Promise<T>) => Promise<T>;

export async function prepareMediaEvidence(input: {
  cfg: WorkerConfig; media: ResolvedMedia; probe: MediaProbe; playable: string; workDir: string; platform: string;
  signal: AbortSignal; transcription: TranscriptionProvider;
  progress: (stage: ProgressStage) => Promise<void>; measure: Measure;
}): Promise<{ transcript: TranscriptResult; rawFrames: SelectedFrame[]; frames: SelectedFrame[]; wallMs: number }> {
  const { cfg, media, probe, playable, workDir, signal, transcription, progress, measure } = input;
  const parallel = cfg.parallelMediaPreparation === true;
  const start = performance.now();
  if (parallel) await progress('extracting_frames');
  const [transcript, rawFrames] = await joinMediaBranches(signal, parallel, async (branchSignal) => {
    if (!parallel) await progress('extracting_audio');
    if (media.captionsTranscript?.length) {
      if (!parallel) await progress('transcribing_audio');
      return { provider: media.captionsSource ?? 'platform_captions', segments: media.captionsTranscript,
        language: media.captionsLanguage ?? null, status: 'success' } as TranscriptResult;
    }
    return measure('audio_extraction_and_transcription', cfg.transcriptionProvider, async () => {
      const audioPath = await extractAudio(cfg, playable, probe, workDir, branchSignal);
      branchSignal.throwIfAborted();
      if (!parallel) await progress('transcribing_audio');
      return transcription.transcribe({ audioPath, hasAudio: probe.hasAudio,
        signal: branchSignal, sourceUrl: media.canonicalUrl, platform: input.platform });
    });
  }, async (branchSignal) => {
    if (!parallel) await progress('extracting_frames');
    return measure('frame_extraction', 'ffmpeg', () => extractFrames(cfg, probe, playable, workDir, branchSignal));
  });
  return { transcript, rawFrames, frames: deduplicateFrames(rawFrames), wallMs: performance.now() - start };
}
