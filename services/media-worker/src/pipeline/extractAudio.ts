// services/media-worker/src/pipeline/extractAudio.ts
//
// Extract mono 16 kHz PCM audio for transcription. Skips cleanly when the media
// has no audio stream (transcription then reports 'no_audio', which must NOT
// fail visual analysis).

import path from 'node:path';
import type { WorkerConfig } from '../config/env.js';
import type { MediaProbe } from '../types/media.js';
import { execBinary } from '../util/exec.js';
import { log } from '../util/logger.js';

export async function extractAudio(
  cfg: WorkerConfig,
  inPath: string,
  probe: MediaProbe,
  workDir: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (!probe.hasAudio) return null;
  const outPath = path.join(workDir, 'audio.wav');
  const res = await execBinary(
    cfg.ffmpegPath,
    ['-y', '-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outPath],
    { timeoutMs: Math.min(cfg.jobTimeoutMs, 120_000), signal },
  );
  if (res.code !== 0) {
    // Non-fatal: keep going with visual analysis only.
    log.warn('audio_extract_failed', {});
    return null;
  }
  return outPath;
}
