import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadConfig } from '../config/env.js';
import { parseEnvContent } from '../config/loadEnvFiles.js';
import { deduplicateFrames } from '../pipeline/deduplicateFrames.js';
import { extractFrames } from '../pipeline/extractFrames.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { heuristicEvidence, selectModelProvider, type AnalyzeInput } from '../providers/model.js';

type Args = {
  video: string;
  output: string;
  envFile?: string;
  caption?: string;
  transcript?: string;
  metadata?: string;
  caseId?: string;
};

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value) throw new Error(`Invalid argument near ${flag ?? '(end)'}`);
    values.set(flag, value);
  }
  const video = values.get('--video');
  const output = values.get('--output');
  if (!video || !output) throw new Error('Usage: --video <path> --output <json> [--caption ... --transcript ... --metadata ... --env-file ...]');
  return {
    video: path.resolve(video), output: path.resolve(output),
    envFile: values.get('--env-file'), caption: values.get('--caption'),
    transcript: values.get('--transcript'), metadata: values.get('--metadata'),
    caseId: values.get('--case-id'),
  };
}

function loadExplicitEnv(file: string | undefined): void {
  if (!file) return;
  for (const [key, value] of Object.entries(parseEnvContent(readFileSync(path.resolve(file), 'utf8')))) {
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadExplicitEnv(args.envFile);
  process.env.MEDIA_ANALYSIS_PROVIDER = 'gemini';
  process.env.VAYRIN_VISUAL_GEOLOCATION_ENABLED = 'false';
  const cfg = loadConfig();
  if (!cfg.geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');

  const scratch = await mkdtemp(path.join(tmpdir(), 'nearr-vayrin-baseline-'));
  const controller = new AbortController();
  try {
    const probe = await inspectMedia(cfg, args.video, controller.signal);
    const frames = deduplicateFrames(await extractFrames(cfg, probe, args.video, scratch, controller.signal));
    const input: AnalyzeInput = {
      platform: 'local_fixture', canonicalUrl: 'local-fixture://shipping-gate', frames,
      transcript: args.transcript ? [{ startSeconds: 0, endSeconds: probe.durationSeconds, text: args.transcript }] : [],
      ocr: [], ocrExtracted: false, metadataTitle: args.caption ?? null,
      metadataDescription: null, metadataLocation: args.metadata ?? null,
      signal: controller.signal,
    };
    const cheapStarted = Date.now();
    const cheap = heuristicEvidence(input);
    const cheapLatencyMs = Date.now() - cheapStarted;
    const geminiStarted = Date.now();
    const gemini = await selectModelProvider(cfg).analyze(input);
    const geminiLatencyMs = Date.now() - geminiStarted;
    const report = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), caseId: args.caseId ?? null,
      input: { frameCount: frames.length, durationSeconds: probe.durationSeconds },
      cheap: { latencyMs: cheapLatencyMs, evidence: cheap },
      gemini: {
        provider: gemini.provider, promptVersion: gemini.promptVersion,
        latencyMs: geminiLatencyMs, evidence: gemini.evidence,
        parseDiagnostics: gemini.parseDiagnostics ?? null,
      },
    };
    await mkdir(path.dirname(args.output), { recursive: true });
    await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ caseId: report.caseId, frames: frames.length, cheapPlaces: cheap.places.length, geminiPlaces: gemini.evidence.places.length, geminiLatencyMs })}\n`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[vayrin-baseline] ${error instanceof Error ? error.message : 'unknown_error'}`);
  process.exitCode = 1;
});
