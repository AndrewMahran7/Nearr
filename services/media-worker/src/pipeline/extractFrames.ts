// services/media-worker/src/pipeline/extractFrames.ts
//
// Frame selection + extraction. We do NOT send every frame. We sample the first
// frame, the last frame, and evenly-spaced interval frames up to a hard cap,
// compute a perceptual average-hash per frame (for dedup), and record metadata
// (timestamp, dimensions, hash, reason). Frame files live in the job temp dir
// and are deleted with it.

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import type { MediaProbe, SelectedFrame } from '../types/media.js';
import { execBinary, type ExecOptions } from '../util/exec.js';
import { averageHashFromGray8x8 } from '../util/hash.js';
import { log } from '../util/logger.js';

export type FramePlan = { timestampSeconds: number; reason: 'first' | 'last' | 'interval' };

export type FrameExtractionMetrics = { processCount: number; cpuMs: number; peakChildRssKiB: number };

async function runFrameCommand(cfg: WorkerConfig, args: string[], opts: ExecOptions, metrics?: FrameExtractionMetrics) {
  const result = await execBinary(cfg.ffmpegPath, metrics ? ['-benchmark', ...args] : args, opts);
  if (metrics) {
    metrics.processCount++;
    const cpu = result.stderr.match(/bench: utime=([\d.]+)s stime=([\d.]+)s/);
    if (cpu) metrics.cpuMs += (Number(cpu[1]) + Number(cpu[2])) * 1000;
    const rss = result.stderr.match(/bench: maxrss=(\d+)KiB/);
    if (rss) metrics.peakChildRssKiB = Math.max(metrics.peakChildRssKiB, Number(rss[1]));
  }
  return result;
}

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
  return extractFramesWithStrategy(cfg, probe, inPath, workDir, signal, cfg.frameExtractionStrategy ?? 'legacy');
}

/** Evaluation seam: the legacy arm retains the repaired baseline exactly. */
export async function extractFramesWithStrategy(
  cfg: WorkerConfig,
  probe: MediaProbe,
  inPath: string,
  workDir: string,
  signal: AbortSignal,
  strategy: 'legacy' | 'batched_hash',
  metrics?: FrameExtractionMetrics,
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

    const shot = await runFrameCommand(
      cfg,
      ['-y', '-ss', String(step.timestampSeconds), '-i', inPath, '-frames:v', '1', '-vf', `scale='min(${768},iw)':-2`, '-q:v', '3', jpg],
      { timeoutMs: 20_000, signal }, metrics,
    );
    if (shot.code !== 0) {
      log.warn('frame_extract_failed', { index: i });
      continue;
    }

    // A seek at the nominal final timestamp can exit zero without emitting a
    // decodable image. Do not let one nonexistent frame bias coverage or reach
    // the verifier as if the whole clip had been inspected.
    try {
      const bytes = await readFile(jpg);
      if (bytes.length === 0) {
        log.warn('frame_extract_empty', { index: i });
        continue;
      }
    } catch {
      log.warn('frame_extract_missing', { index: i });
      continue;
    }

    // An unavailable hash is not an observed all-black image. Keep the frame
    // when hashing fails so unrelated scenes cannot disappear through dedup.
    let aHash = '';
    const grayRes = strategy === 'legacy' ? await runFrameCommand(
      cfg,
      ['-y', '-i', jpg, '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', gray],
      { timeoutMs: 10_000, signal }, metrics,
    ) : null;
    if (grayRes?.code === 0) {
      try {
        const bytes = await readFile(gray);
        if (bytes.length === 64) aHash = averageHashFromGray8x8(new Uint8Array(bytes));
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

  if (strategy === 'batched_hash' && frames.length && !signal.aborted) {
    return hashExtractedFrames(cfg, frames, workDir, signal, metrics);
  }
  return frames;
}

/** Decode already-selected JPEGs together. Video seeks, JPEG bytes, timestamps,
 * resize and encoding stay identical; N hash-process startups become one.
 * The concat list uses only worker-owned basenames, never source-controlled paths.
 */
export async function hashExtractedFrames(
  cfg: WorkerConfig,
  frames: SelectedFrame[],
  workDir: string,
  signal: AbortSignal,
  metrics?: FrameExtractionMetrics,
): Promise<SelectedFrame[]> {
  if (!frames.length || signal.aborted) return frames;
  const names = frames.map((frame) => path.basename(frame.path));
  if (names.some((name) => !/^frame-\d+\.jpg$/.test(name))) {
    throw new Error('unsafe_frame_basename');
  }
  const manifest = path.join(workDir, 'hash-frames.ffconcat');
  const output = path.join(workDir, 'hash-frames.gray');
  await writeFile(manifest, `ffconcat version 1.0\n${names.map((name) => `file ${name}\nduration 1`).join('\n')}\n`);
  const result = await runFrameCommand(cfg,
    ['-y', '-f', 'concat', '-safe', '1', '-i', manifest, '-vf', 'scale=8:8,format=gray',
      '-vsync', '0', '-f', 'rawvideo', output],
    { timeoutMs: 10_000, signal }, metrics);
  if (result.code !== 0) {
    log.warn('frame_hash_batch_failed', { count: frames.length });
    return frames;
  }
  try {
    const bytes = await readFile(output);
    // Partial/misaligned output is not evidence. Keep every JPEG without hashes.
    if (bytes.length !== frames.length * 64) {
      log.warn('frame_hash_batch_incomplete', { count: frames.length });
      return frames;
    }
    return frames.map((frame, i) => ({ ...frame,
      aHash: averageHashFromGray8x8(new Uint8Array(bytes.subarray(i * 64, (i + 1) * 64))),
    }));
  } catch {
    return frames;
  }
}
