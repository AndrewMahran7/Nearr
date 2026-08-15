/** Controlled local FFmpeg concurrency benchmark (no network/providers/DB). */
import { cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { WorkerConfig } from '../../src/config/env.js';
import { deduplicateFrames } from '../../src/pipeline/deduplicateFrames.js';
import { extractAudio } from '../../src/pipeline/extractAudio.js';
import { extractFrames } from '../../src/pipeline/extractFrames.js';
import { inspectMedia } from '../../src/pipeline/inspectMedia.js';
import { binaryAvailable } from '../../src/util/exec.js';
import { ffmpegAvailable, generateSyntheticMedia } from './generateSyntheticMedia.js';

const LEVELS = [1, 2, 4] as const;
const TASKS = 8;

function config(): WorkerConfig {
  return {
    port: 8090, workerSecret: 'benchmark', mediaFallbackEnabled: true,
    instagramResolverEnabled: true, tiktokResolverEnabled: true, youtubeResolverEnabled: true,
    facebookResolverEnabled: true, snapchatResolverEnabled: true, nativeVideoAnalysisEnabled: true,
    supabaseUrl: 'http://localhost', supabaseServiceRoleKey: 'benchmark', finalizeUrl: 'http://localhost/finalize',
    mediaFinalizeSecret: 'benchmark',
    maxConcurrency: 1, claimBatchSize: 1, claimLockSeconds: 600, retryBaseSeconds: 30, retryMaxSeconds: 900,
    maxDurationSeconds: 180, maxDownloadBytes: 150 * 1024 * 1024, downloadTimeoutMs: 60_000,
    jobTimeoutMs: 480_000, maxSelectedFrames: 24, frameIntervalSeconds: 1, redirectLimit: 3,
    allowedMediaHosts: ['example.com'], transcriptionProvider: 'noop', transcriptionApiKey: '',
    transcriptionModel: 'whisper-1', selfHostedTranscriptionUrl: '', selfHostedTranscriptionApiKey: '',
    analysisProvider: 'heuristic', geminiApiKey: '', geminiModel: 'gemini-2.5-flash', ocrProvider: 'noop',
    mediaFetchProviderUrl: '', mediaFetchProviderApiKey: '', mediaFetchProviderAuthHeader: 'authorization',
    mediaFetchProviderUrlParam: 'url', mediaFetchProviderResultPath: 'url', ytDlpPath: 'yt-dlp',
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg', ffprobePath: process.env.FFPROBE_PATH || 'ffprobe', tempDir: '',
  };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return Math.round(lowerValue + (upperValue - lowerValue) * (index - lower));
}

async function bytesUnder(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    total += entry.isDirectory() ? await bytesUnder(file) : (await stat(file)).size;
  }
  return total;
}

async function runLevel(cfg: WorkerConfig, input: string, root: string, concurrency: number) {
  const durations: number[] = [];
  const fingerprints: string[] = [];
  const failures: string[] = [];
  let next = 0;
  let active = 0;
  let peakActive = 0;
  let peakNodeRssBytes = process.memoryUsage().rss;
  const cpuBefore = process.cpuUsage();
  const started = Date.now();
  const sampler = setInterval(() => {
    peakNodeRssBytes = Math.max(peakNodeRssBytes, process.memoryUsage().rss);
  }, 20);

  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= TASKS) return;
      const jobDir = path.join(root, `c${concurrency}-job${index}`);
      await mkdir(jobDir, { recursive: true });
      const localInput = path.join(jobDir, 'input.mp4');
      await cp(input, localInput);
      const taskStarted = Date.now();
      active += 1;
      peakActive = Math.max(peakActive, active);
      try {
        const signal = new AbortController().signal;
        const probe = await inspectMedia(cfg, localInput, signal);
        await extractAudio(cfg, localInput, probe, jobDir, signal);
        const frames = deduplicateFrames(await extractFrames(cfg, probe, localInput, jobDir, signal));
        fingerprints.push(frames.map((frame) => frame.aHash).join(':'));
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      } finally {
        active -= 1;
        durations.push(Date.now() - taskStarted);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  clearInterval(sampler);
  const wallMs = Date.now() - started;
  const cpu = process.cpuUsage(cpuBefore);
  const tempBytes = await bytesUnder(root);
  return {
    concurrency,
    tasks: TASKS,
    failures,
    deterministicOutputs: fingerprints.length === TASKS && new Set(fingerprints).size === 1,
    peakActivePipelines: peakActive,
    wallMs,
    throughputTasksPerMinute: Number(((TASKS * 60_000) / wallMs).toFixed(2)),
    taskLatencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: Math.max(...durations) },
    peakNodeRssBytes,
    nodeCpuMs: Math.round((cpu.user + cpu.system) / 1_000),
    tempBytes,
    limitations: ['Node RSS/CPU excludes ffmpeg child processes', 'no network, external provider, or database load'],
  };
}

async function main(): Promise<void> {
  const cfg = config();
  if (!(await ffmpegAvailable()) || !(await binaryAvailable(cfg.ffprobePath, '-version'))) {
    throw new Error('ffmpeg and ffprobe are required');
  }
  const root = await mkdtemp(path.join(tmpdir(), 'nearr-concurrency-benchmark-'));
  try {
    const fixtureDir = path.join(root, 'fixture');
    const media = await generateSyntheticMedia(fixtureDir);
    const results = [];
    for (const level of LEVELS) {
      const levelRoot = path.join(root, `level-${level}`);
      await mkdir(levelRoot, { recursive: true });
      const result = await runLevel(cfg, media.videoWithAudio, levelRoot, level);
      results.push(result);
      console.log(`[concurrency-benchmark] c=${level} wall=${result.wallMs}ms throughput=${result.throughputTasksPerMinute}/min failures=${result.failures.length}`);
    }
    const output = path.resolve('..', '..', 'artifacts', 'phase2-concurrency-benchmark.json');
    await mkdir(path.dirname(output), { recursive: true });
    const artifact = { schemaVersion: 1, generatedAt: new Date().toISOString(), fixture: 'local synthetic 4s 320x568 H.264/AAC', results };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`[concurrency-benchmark] wrote ${output}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[concurrency-benchmark] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
