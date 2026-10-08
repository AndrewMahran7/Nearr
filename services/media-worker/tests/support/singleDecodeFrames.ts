// Evaluation only: one video decode with a trim branch for each baseline time.
// It may select different decoded frames around non-zero timestamps / VFR.
// Never enable at runtime unless exact evidence parity is independently proven.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { WorkerConfig } from '../../src/config/env.js';
import type { MediaProbe, SelectedFrame } from '../../src/types/media.js';
import { selectFrameTimestamps, hashExtractedFrames } from '../../src/pipeline/extractFrames.js';
import { execBinary } from '../../src/util/exec.js';

export async function singleDecodeFrames(cfg: WorkerConfig, probe: MediaProbe, input: string,
  work: string, signal: AbortSignal): Promise<SelectedFrame[]> {
  const plan = selectFrameTimestamps(probe.durationSeconds, cfg.frameIntervalSeconds, cfg.maxSelectedFrames);
  if (!plan.length || signal.aborted) return [];
  const filters = [`[0:v]split=${plan.length}${plan.map((_, i) => `[s${i}]`).join('')}`,
    ...plan.map((step, i) => `[s${i}]trim=start=${step.timestampSeconds},setpts=PTS-STARTPTS,scale='min(768,iw)':-2[o${i}]`)];
  const args = ['-y', '-i', input, '-filter_complex', filters.join(';')];
  const paths = plan.map((_, i) => path.join(work, `frame-${String(i).padStart(3, '0')}.jpg`));
  paths.forEach((file, i) => args.push('-map', `[o${i}]`, '-frames:v', '1', '-q:v', '3', file));
  const result = await execBinary(cfg.ffmpegPath, args, { timeoutMs: 120_000, signal });
  if (result.code !== 0) throw new Error(`single_decode_failed:${result.stderr.slice(-500)}`);
  const frames: SelectedFrame[] = [];
  for (const [i, step] of plan.entries()) {
    const file = paths[i]!;
    try {
      if (!(await readFile(file)).length) continue;
      const width = Math.min(768, probe.width ?? 768);
      frames.push({ path: file, ...step, width,
        height: probe.height && probe.width ? Math.round(probe.height * width / probe.width) : 0, aHash: '' });
    } catch { /* Same missing-image rule as baseline. */ }
  }
  return hashExtractedFrames(cfg, frames, work, signal);
}
