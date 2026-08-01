// services/media-worker/src/pipeline/normalizeMedia.ts
//
// Normalize ONLY when required. Instagram progressive MP4 (H.264/AAC) is
// already usable by ffprobe/ffmpeg and the model paths, so we avoid transcoding
// (no re-encode, no upscale) and simply pass the original through. A transcode
// branch is provided for genuinely incompatible containers/codecs.

import path from 'node:path';
import type { WorkerConfig } from '../config/env.js';
import type { MediaProbe } from '../types/media.js';
import { execBinary } from '../util/exec.js';
import { log } from '../util/logger.js';

// Codecs ffmpeg + the downstream steps already handle without a re-encode.
const USABLE_VIDEO_CODECS = new Set(['h264', 'hevc', 'vp9', 'av1', 'mpeg4']);

export async function normalizeMedia(
  cfg: WorkerConfig,
  inPath: string,
  probe: MediaProbe,
  workDir: string,
  signal: AbortSignal,
): Promise<string> {
  const codec = (probe.videoCodec ?? '').toLowerCase();
  if (codec && USABLE_VIDEO_CODECS.has(codec)) {
    return inPath; // already usable — do not transcode, do not upscale
  }

  // Rare: remux/transcode to H.264 MP4 at the SAME resolution (never upscale).
  const outPath = path.join(workDir, 'normalized.mp4');
  const res = await execBinary(
    cfg.ffmpegPath,
    ['-y', '-i', inPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', outPath],
    { timeoutMs: Math.min(cfg.jobTimeoutMs, 180_000), signal },
  );
  if (res.code !== 0) {
    log.warn('normalize_failed_using_original', { codec });
    return inPath;
  }
  return outPath;
}
