// services/media-worker/src/pipeline/extractFrames.ts
//
// Frame selection + extraction. We do NOT send every frame. We sample the first
// frame, the last frame, and evenly-spaced interval frames up to a hard cap,
// compute a perceptual average-hash per frame (for dedup), and record metadata
// (timestamp, dimensions, hash, reason). Frame files live in the job temp dir
// and are deleted with it.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import type { MediaProbe, SelectedFrame } from '../types/media.js';
import { execBinary } from '../util/exec.js';
import { averageHashFromGray8x8 } from '../util/hash.js';
import { log } from '../util/logger.js';

export type FramePlan = { timestampSeconds: number; reason: 'first' | 'last' | 'interval' };

/**
 * PURE: choose frame timestamps. First + last always included; the interior is
 * evenly spaced at `interval` seconds, downsampled to fit `maxFrames`.
 */
export function selectFrameTimestamps(
  durationSeconds: number,
  interval: number,
  maxFrames: number,
): FramePlan[] {
  if (durationSeconds <= 0 || maxFrames <= 0) return [];
  const last = Math.max(0, durationSeconds - 0.1);
  if (maxFrames === 1 || last <= 0) return [{ timestampSeconds: 0, reason: 'first' }];

  const raw: number[] = [];
  for (let t = 0; t < last; t += Math.max(interval, 0.1)) raw.push(Number(t.toFixed(3)));
  if ((raw[raw.length - 1] ?? -1) < last - 1e-6) raw.push(Number(last.toFixed(3)));

  let chosen = raw;
  if (raw.length > maxFrames) {
    const picked: number[] = [];
    for (let i = 0; i < maxFrames; i += 1) {
      const idx = Math.round((i * (raw.length - 1)) / (maxFrames - 1));
      const v = raw[idx];
      if (v !== undefined) picked.push(v);
    }
    chosen = Array.from(new Set(picked));
  }

  return chosen.map((t, i) => ({
    timestampSeconds: t,
    reason: i === 0 ? 'first' : i === chosen.length - 1 ? 'last' : 'interval',
  }));
}

function scaledDims(probe: MediaProbe, maxW = 768): { w: number; h: number } {
  const iw = probe.width ?? 0;
  const ih = probe.height ?? 0;
  if (iw <= 0) return { w: maxW, h: 0 };
  const w = Math.min(maxW, iw);
  const h = ih > 0 ? Math.round((ih * w) / iw) : 0;
  return { w, h };
}

export async function extractFrames(
  cfg: WorkerConfig,
  probe: MediaProbe,
  inPath: string,
  workDir: string,
  signal: AbortSignal,
): Promise<SelectedFrame[]> {
  const plan = selectFrameTimestamps(probe.durationSeconds, cfg.frameIntervalSeconds, cfg.maxSelectedFrames);
  const { w, h } = scaledDims(probe);
  const frames: SelectedFrame[] = [];

  for (let i = 0; i < plan.length; i += 1) {
    if (signal.aborted) break;
    const step = plan[i];
    if (!step) continue;
    const jpg = path.join(workDir, `frame-${String(i).padStart(3, '0')}.jpg`);
    const gray = path.join(workDir, `frame-${String(i).padStart(3, '0')}.gray`);

    const shot = await execBinary(
      cfg.ffmpegPath,
      ['-y', '-ss', String(step.timestampSeconds), '-i', inPath, '-frames:v', '1', '-vf', `scale='min(${768},iw)':-2`, '-q:v', '3', jpg],
      { timeoutMs: 20_000, signal },
    );
    if (shot.code !== 0) {
      log.warn('frame_extract_failed', { index: i });
      continue;
    }

    let aHash = '0000000000000000';
    const grayRes = await execBinary(
      cfg.ffmpegPath,
      ['-y', '-i', jpg, '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', gray],
      { timeoutMs: 10_000, signal },
    );
    if (grayRes.code === 0) {
      try {
        const bytes = await readFile(gray);
        aHash = averageHashFromGray8x8(new Uint8Array(bytes));
      } catch {
        /* keep default hash */
      }
    }

    frames.push({
      path: jpg,
      timestampSeconds: step.timestampSeconds,
      width: w,
      height: h,
      aHash,
      reason: step.reason,
    });
  }

  return frames;
}
