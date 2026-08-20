#!/usr/bin/env node

/**
 * Reproducible local Vayrin visual-geolocation harness.
 *
 * Accepts a local video or an extracted-frame directory, compares compact
 * frame strategies and evidence conditions, and writes a secret-free JSON
 * result containing hypotheses, latency, usage, and estimated token cost.
 */

import path from 'node:path';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { deduplicateFrames } from '../pipeline/deduplicateFrames.js';
import type { SelectedFrame } from '../types/media.js';
import { execBinary } from '../util/exec.js';
import { averageHashFromGray8x8 } from '../util/hash.js';
import { loadEnvFiles, parseEnvContent } from '../config/loadEnvFiles.js';
import {
  DEFAULT_VAYRIN_MODEL,
  describeKeySource,
  estimateVayrinCostUsd,
  resolveVayrinApiKey,
  runVisualGeolocation,
  type VayrinPricing,
} from '../vayrin/visualGeolocationClient.js';
import {
  selectFramesForVayrin,
  type FrameStrategy,
} from '../vayrin/frameSelection.js';
import {
  VAYRIN_PROMPT_VERSION,
  type VayrinTextContext,
} from '../vayrin/visualGeolocationPrompt.js';

type Condition = 'visual_only' | 'visual_metadata' | 'fused';
type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type CliArgs = {
  video?: string;
  framesDir?: string;
  caption?: string;
  transcript?: string;
  metadata?: string;
  visibleText?: string;
  otherText?: string;
  platform?: string;
  groundTruth?: string;
  caseId?: string;
  output?: string;
  envFile?: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  strategies: FrameStrategy[];
  budgets: number[];
  conditions: Condition[];
  candidateFrames: number;
  ffmpegPath: string;
  ffprobePath: string;
  dryRun: boolean;
};

const STRATEGIES = new Set<FrameStrategy>(['uniform', 'pipeline', 'diverse', 'all']);
const CONDITIONS = new Set<Condition>(['visual_only', 'visual_metadata', 'fused']);
const REASONING = new Set<ReasoningEffort>(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function usage(): string {
  return `
Vayrin visual-geolocation harness

Usage:
  npm run vayrin:geo -- --video <clip.mp4> [options]
  npm run vayrin:geo -- --frames <directory> [options]

Options:
  --caption <text> | --caption-file <path>
  --transcript <text> | --transcript-file <path>
  --metadata <text> | --metadata-file <path>
  --visible-text <text> | --visible-text-file <path>
  --other-text <text> | --other-text-file <path>
  --strategies diverse,uniform,pipeline,all   (default: diverse)
  --budgets 6,8,12                           (default: 8)
  --conditions visual_only,visual_metadata,fused
  --candidate-frames 24                      (video extraction pool)
  --model gpt-5.6-sol
  --reasoning none|low|medium|high|xhigh|max
  --case-id <label> --ground-truth <manually verified answer>
  --output <result.json>
  --env-file <path>                          (loaded without logging values)
  --dry-run                                  (select frames, no API calls)
`.trim();
}

function take(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseList<T extends string>(raw: string, allowed: Set<T>, flag: string): T[] {
  const values = raw.split(',').map((v) => v.trim()).filter(Boolean) as T[];
  if (values.length === 0 || values.some((v) => !allowed.has(v))) {
    throw new Error(`${flag} contains an unsupported value`);
  }
  return [...new Set(values)];
}

async function readTextOption(argv: string[], index: number, flag: string): Promise<string> {
  const value = take(argv, index, flag);
  return flag.endsWith('-file') ? (await readFile(path.resolve(value), 'utf8')).trim() : value.trim();
}

async function parseArgs(argv: string[]): Promise<CliArgs> {
  const args: CliArgs = {
    model: DEFAULT_VAYRIN_MODEL,
    strategies: ['diverse'],
    budgets: [8],
    conditions: ['visual_only', 'visual_metadata', 'fused'],
    candidateFrames: 24,
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (flag === '--help' || flag === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (flag === '--dry-run') { args.dryRun = true; continue; }
    if (flag === '--video') { args.video = path.resolve(take(argv, i, flag)); i += 1; continue; }
    if (flag === '--frames') { args.framesDir = path.resolve(take(argv, i, flag)); i += 1; continue; }
    if (flag === '--output') { args.output = path.resolve(take(argv, i, flag)); i += 1; continue; }
    if (flag === '--env-file') { args.envFile = path.resolve(take(argv, i, flag)); i += 1; continue; }
    if (flag === '--model') { args.model = take(argv, i, flag).trim(); i += 1; continue; }
    if (flag === '--platform') { args.platform = take(argv, i, flag).trim(); i += 1; continue; }
    if (flag === '--case-id') { args.caseId = take(argv, i, flag).trim(); i += 1; continue; }
    if (flag === '--ground-truth') { args.groundTruth = take(argv, i, flag).trim(); i += 1; continue; }
    if (flag === '--ffmpeg') { args.ffmpegPath = take(argv, i, flag); i += 1; continue; }
    if (flag === '--ffprobe') { args.ffprobePath = take(argv, i, flag); i += 1; continue; }
    if (flag === '--strategies') {
      args.strategies = parseList(take(argv, i, flag), STRATEGIES, flag); i += 1; continue;
    }
    if (flag === '--conditions') {
      args.conditions = parseList(take(argv, i, flag), CONDITIONS, flag); i += 1; continue;
    }
    if (flag === '--budgets') {
      const values = take(argv, i, flag).split(',').map(Number);
      if (values.length === 0 || values.some((v) => !Number.isInteger(v) || v < 1 || v > 24)) {
        throw new Error('--budgets must be comma-separated integers from 1 to 24');
      }
      args.budgets = [...new Set(values)]; i += 1; continue;
    }
    if (flag === '--candidate-frames') {
      const value = Number(take(argv, i, flag));
      if (!Number.isInteger(value) || value < 1 || value > 64) {
        throw new Error('--candidate-frames must be an integer from 1 to 64');
      }
      args.candidateFrames = value; i += 1; continue;
    }
    if (flag === '--reasoning') {
      const value = take(argv, i, flag) as ReasoningEffort;
      if (!REASONING.has(value)) throw new Error('--reasoning has an unsupported value');
      args.reasoningEffort = value; i += 1; continue;
    }

    const textFlags: Record<string, keyof CliArgs> = {
      '--caption': 'caption', '--caption-file': 'caption',
      '--transcript': 'transcript', '--transcript-file': 'transcript',
      '--metadata': 'metadata', '--metadata-file': 'metadata',
      '--visible-text': 'visibleText', '--visible-text-file': 'visibleText',
      '--other-text': 'otherText', '--other-text-file': 'otherText',
    };
    const target = textFlags[flag];
    if (target) {
      (args as unknown as Record<string, unknown>)[target] = await readTextOption(argv, i, flag);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${flag}`);
  }

  if (!!args.video === !!args.framesDir) throw new Error('Provide exactly one of --video or --frames');
  if (args.video && !existsSync(args.video)) throw new Error(`Video does not exist: ${args.video}`);
  if (args.framesDir && !existsSync(args.framesDir)) throw new Error(`Frame directory does not exist: ${args.framesDir}`);
  args.candidateFrames = Math.max(args.candidateFrames, ...args.budgets);
  return args;
}

function loadExplicitEnvFile(file: string | undefined): void {
  if (!file) return;
  const parsed = parseEnvContent(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }
}

async function frameHash(file: string, gray: string, ffmpegPath: string): Promise<string> {
  const result = await execBinary(
    ffmpegPath,
    ['-y', '-i', file, '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', gray],
    { timeoutMs: 15_000 },
  );
  if (result.code !== 0) return '0000000000000000';
  const bytes = await readFile(gray).catch(() => Buffer.alloc(0));
  return bytes.length === 64 ? averageHashFromGray8x8(new Uint8Array(bytes)) : '0000000000000000';
}

function timestampFromName(name: string, fallback: number): number {
  const explicit = /(?:^|[-_])(?:t|time|timestamp)[-_]?(\d+(?:\.\d+)?)/i.exec(name);
  if (explicit?.[1]) return Number(explicit[1]);
  return fallback;
}

async function framesFromDirectory(
  directory: string,
  scratch: string,
  ffmpegPath: string,
): Promise<SelectedFrame[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const frames: SelectedFrame[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const file = path.join(directory, entry.name);
    frames.push({
      path: file,
      timestampSeconds: timestampFromName(entry.name, i),
      width: 0,
      height: 0,
      aHash: await frameHash(file, path.join(scratch, `dir-${i}.gray`), ffmpegPath),
      reason: i === 0 ? 'first' : i === entries.length - 1 ? 'last' : 'interval',
    });
  }
  return frames;
}

async function videoDuration(video: string, ffprobePath: string): Promise<number> {
  const result = await execBinary(
    ffprobePath,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video],
    { timeoutMs: 20_000 },
  );
  const duration = Number(result.stdout.trim());
  if (result.code !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Unable to read video duration with ffprobe');
  }
  return duration;
}

async function framesFromVideo(
  video: string,
  scratch: string,
  count: number,
  ffmpegPath: string,
  ffprobePath: string,
): Promise<SelectedFrame[]> {
  const duration = await videoDuration(video, ffprobePath);
  const last = Math.max(0, duration - 0.1);
  const timestamps = count === 1
    ? [0]
    : Array.from({ length: count }, (_, i) => Number(((i * last) / (count - 1)).toFixed(3)));
  const frames: SelectedFrame[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const timestampSeconds = timestamps[i]!;
    const file = path.join(scratch, `frame-${String(i).padStart(3, '0')}.jpg`);
    const shot = await execBinary(
      ffmpegPath,
      ['-y', '-ss', String(timestampSeconds), '-i', video, '-frames:v', '1', '-vf', "scale='min(768,iw)':-2", '-q:v', '3', file],
      { timeoutMs: 20_000 },
    );
    if (shot.code !== 0) continue;
    frames.push({
      path: file,
      timestampSeconds,
      width: 768,
      height: 0,
      aHash: await frameHash(file, path.join(scratch, `frame-${i}.gray`), ffmpegPath),
      reason: i === 0 ? 'first' : i === timestamps.length - 1 ? 'last' : 'interval',
    });
  }
  return deduplicateFrames(frames);
}

function contextFor(args: CliArgs, condition: Condition): VayrinTextContext {
  if (condition === 'visual_only') return {};
  if (condition === 'visual_metadata') return { locationMetadata: args.metadata ?? null };
  return {
    platform: args.platform ?? null,
    caption: args.caption ?? null,
    transcript: args.transcript ?? null,
    locationMetadata: args.metadata ?? null,
    visibleText: args.visibleText ?? null,
    visibleTextExtracted: args.visibleText !== undefined,
    otherText: args.otherText ?? null,
  };
}

function pricingFromEnv(): VayrinPricing {
  const number = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    inputPerMillion: number('VAYRIN_PRICE_INPUT_PER_MILLION', 5),
    cachedInputPerMillion: number('VAYRIN_PRICE_CACHED_INPUT_PER_MILLION', 0.5),
    outputPerMillion: number('VAYRIN_PRICE_OUTPUT_PER_MILLION', 30),
  };
}

function hasFusedText(args: CliArgs): boolean {
  return !!(args.caption || args.transcript || args.metadata || args.visibleText || args.otherText);
}

async function main(): Promise<void> {
  const args = await parseArgs(process.argv.slice(2));
  loadEnvFiles();
  loadExplicitEnvFile(args.envFile);
  const key = resolveVayrinApiKey();
  if (!args.dryRun && !key.ok) {
    throw new Error(`No Vayrin API key found; checked ${key.checked.join(', ')}`);
  }

  const scratch = await mkdtemp(path.join(tmpdir(), 'nearr-vayrin-'));
  try {
    const frames = args.video
      ? await framesFromVideo(
          args.video,
          scratch,
          args.candidateFrames,
          args.ffmpegPath,
          args.ffprobePath,
        )
      : await framesFromDirectory(args.framesDir!, scratch, args.ffmpegPath);
    if (frames.length === 0) throw new Error('No usable frames were found');

    const pricing = pricingFromEnv();
    const runs: unknown[] = [];
    for (const strategy of args.strategies) {
      for (const budget of args.budgets) {
        const selection = selectFramesForVayrin(frames, strategy, budget);
        for (const condition of args.conditions) {
          if (condition === 'visual_metadata' && !args.metadata) {
            runs.push({ strategy, budget, condition, skipped: true, reason: 'metadata_not_supplied' });
            continue;
          }
          if (condition === 'fused' && !hasFusedText(args)) {
            runs.push({ strategy, budget, condition, skipped: true, reason: 'text_evidence_not_supplied' });
            continue;
          }

          const selectionSummary = {
            strategy,
            budget,
            consideredFrameCount: selection.consideredCount,
            selectedFrameCount: selection.frames.length,
            selectedTimestampsSeconds: selection.frames.map((frame) => frame.timestampSeconds),
            meanPairwiseDistance: selection.meanPairwiseDistance,
          };
          if (args.dryRun) {
            runs.push({ ...selectionSummary, condition, dryRun: true });
            continue;
          }

          const result = await runVisualGeolocation({
            frames: selection.frames.map((frame) => ({
              path: frame.path,
              timestampSeconds: frame.timestampSeconds,
            })),
            context: contextFor(args, condition),
            model: args.model,
            reasoningEffort: args.reasoningEffort,
          });
          runs.push(result.ok
            ? {
                ...selectionSummary,
                condition,
                ok: true,
                latencyMs: result.latencyMs,
                usage: result.usage,
                estimatedCostUsd: estimateVayrinCostUsd(result.usage, pricing),
                payload: result.payload,
              }
            : {
                ...selectionSummary,
                condition,
                ok: false,
                latencyMs: result.latencyMs,
                failureKind: result.kind,
                failureCode: result.code,
              });
        }
      }
    }

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      caseId: args.caseId ?? null,
      groundTruth: args.groundTruth ?? null,
      evaluationStatus: args.groundTruth ? 'PENDING_MANUAL_CLASSIFICATION' : 'UNKNOWN',
      input: {
        kind: args.video ? 'video' : 'frame_directory',
        source: args.video ?? args.framesDir,
        extractedFrameCount: frames.length,
      },
      model: args.model,
      promptVersion: VAYRIN_PROMPT_VERSION,
      reasoningEffort: args.reasoningEffort ?? 'model_default',
      credential: describeKeySource(key),
      pricingUsdPerMillionTokens: pricing,
      runs,
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output) {
      await mkdir(path.dirname(args.output), { recursive: true });
      await writeFile(args.output, json, 'utf8');
    }
    process.stdout.write(json);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[vayrin] ${error instanceof Error ? error.message : 'unknown_error'}`);
  process.exitCode = 1;
});
