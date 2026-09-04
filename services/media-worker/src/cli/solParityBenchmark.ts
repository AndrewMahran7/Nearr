import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvFiles } from '../config/loadEnvFiles.js';
import { loadConfig } from '../config/env.js';
import { InstagramMediaResolver } from '../resolvers/InstagramMediaResolver.js';
import { TikTokMediaResolver } from '../resolvers/TikTokMediaResolver.js';
import { YouTubeMediaResolver } from '../resolvers/YouTubeMediaResolver.js';
import { FacebookMediaResolver } from '../resolvers/FacebookMediaResolver.js';
import { SnapchatMediaResolver } from '../resolvers/SnapchatMediaResolver.js';
import type { MediaResolver } from '../resolvers/MediaResolver.js';
import { createJobTemp } from '../util/tempDir.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { normalizeMedia } from '../pipeline/normalizeMedia.js';
import { extractFrames } from '../pipeline/extractFrames.js';
import { deduplicateFrames } from '../pipeline/deduplicateFrames.js';
import { extractAudio } from '../pipeline/extractAudio.js';
import { selectTranscriptionProvider } from '../providers/transcription.js';
import { deduplicateOcrSegments, selectOcrProvider } from '../providers/ocr.js';
import { buildAutomaticFrameSets, loadManualFrameSet } from '../solParity/frames.js';
import { callSolParity } from '../solParity/model.js';
import { persistModelAttempt, readPersistedAttempts, writeJsonAtomic } from '../solParity/persistence.js';
import { canonicalizeDestination } from '../solParity/canonicalize.js';
import { simulateDecision } from '../solParity/decision.js';
import { validateInferenceCase } from '../solParity/corpus.js';
import type { FrameArm, InferenceCase, ModelArm, PersistedModelAttempt, SourceEvidence } from '../solParity/types.js';

type MatrixEntry = { frame: FrameArm; model: ModelArm };
type ParsedArgs = { dryRun: boolean; cases: string[] | null; limit: number | null; matrix: MatrixEntry[]; out: string | null };
function parseMatrix(value: string): MatrixEntry[] {
  return value.split(',').filter(Boolean).map((part) => {
    const [frame, model] = part.toUpperCase().split(':');
    if (!['F1', 'F2', 'F3'].includes(frame ?? '') || !['M1', 'M2', 'M3'].includes(model ?? '')) throw new Error(`invalid_matrix_entry:${part}`);
    return { frame: frame as FrameArm, model: model as ModelArm };
  });
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { dryRun: false, cases: null, limit: null, matrix: parseMatrix('F1:M1,F1:M2,F2:M2'), out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--cases') parsed.cases = (argv[++index] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg === '--limit') parsed.limit = Number(argv[++index]);
    else if (arg === '--matrix') parsed.matrix = parseMatrix(argv[++index] ?? '');
    else if (arg === '--out') parsed.out = argv[++index] ?? null;
    else throw new Error(`unknown_argument:${arg}`);
  }
  return parsed;
}

function resolverFor(platform: InferenceCase['platform'], cfg: ReturnType<typeof loadConfig>): MediaResolver {
  switch (platform) {
    case 'instagram': return new InstagramMediaResolver(cfg);
    case 'tiktok': return new TikTokMediaResolver(cfg);
    case 'youtube': return new YouTubeMediaResolver(cfg);
    case 'facebook': return new FacebookMediaResolver(cfg);
    case 'snapchat': return new SnapchatMediaResolver(cfg);
  }
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized ? normalized.slice(0, max) : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const envLoad = loadEnvFiles();
  const repoRoot = envLoad.repoRoot;
  const corpusPath = path.join(repoRoot, 'artifacts', 'sol-parity', 'inference-corpus.json');
  const groundTruthPath = path.join(repoRoot, 'artifacts', 'sol-parity', 'ground-truth.json');
  const corpusRaw = JSON.parse(await readFile(corpusPath, 'utf8')) as { cases?: unknown[] };
  let cases = (corpusRaw.cases ?? []).map(validateInferenceCase);
  if (args.cases) {
    const wanted = new Set(args.cases.flatMap((item) => item.toLowerCase() === 'priority' ? ['R01','R02','R03','R04','R05','R06','R07','R08','V05'] : [item]));
    cases = cases.filter((item) => wanted.has(item.case_id));
  }
  if (args.limit !== null) cases = cases.slice(0, Math.max(0, Math.floor(args.limit)));

  const manualAvailability = Object.fromEntries(await Promise.all(cases.map(async (item) => [item.case_id, !!(await loadManualFrameSet(path.resolve(repoRoot, item.manual_frames_directory)))])));
  if (args.dryRun) {
    console.log(JSON.stringify({ mode: 'dry_run', real_cases: cases.length, matrix: args.matrix, manual_frame_arm: Object.values(manualAvailability).some(Boolean) ? 'MANUAL_FRAME_ARM_AVAILABLE' : 'MANUAL_FRAME_ARM_NOT_AVAILABLE', manual_availability: manualAvailability }, null, 2));
    return;
  }
  if (process.env.SOL_PARITY_CONFIRM_PAID !== '1') throw new Error('paid_run_requires_SOL_PARITY_CONFIRM_PAID=1');

  for (const key of ['INSTAGRAM_MEDIA_RESOLVER_ENABLED','TIKTOK_MEDIA_RESOLVER_ENABLED','YOUTUBE_MEDIA_RESOLVER_ENABLED','FACEBOOK_MEDIA_RESOLVER_ENABLED','SNAPCHAT_MEDIA_RESOLVER_ENABLED']) process.env[key] = 'true';
  process.env.MEDIA_MAX_SELECTED_FRAMES = process.env.MEDIA_MAX_SELECTED_FRAMES || '24';
  const cfg = loadConfig();
  const transcription = selectTranscriptionProvider(cfg);
  const ocr = selectOcrProvider(cfg);
  const runId = `sol-parity-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.resolve(repoRoot, args.out ?? path.join('artifacts', 'sol-parity', 'runs', runId));
  await mkdir(runDir, { recursive: true });
  const attemptsPath = path.join(runDir, 'model-attempts.jsonl');
  const canonicalPath = path.join(runDir, 'canonicalization.jsonl');
  const errorsPath = path.join(runDir, 'case-errors.jsonl');
  await Promise.all([rm(attemptsPath, { force: true }), rm(canonicalPath, { force: true }), rm(errorsPath, { force: true })]);
  await writeJsonAtomic(path.join(runDir, 'run-manifest.json'), {
    schema_version: 1,
    run_id: runId,
    started_at: new Date().toISOString(),
    git_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    corpus_path: path.relative(repoRoot, corpusPath),
    ground_truth_loaded_during_inference: false,
    cache_used: false,
    google_candidates_sent_to_sol: false,
    production_target: false,
    model: 'gpt-5.6-sol',
    reasoning_effort: 'high',
    matrix: args.matrix,
    cases: cases.map((item) => item.case_id),
    manual_frame_arm: Object.values(manualAvailability).some(Boolean) ? 'MANUAL_FRAME_ARM_AVAILABLE' : 'MANUAL_FRAME_ARM_NOT_AVAILABLE',
  });

  const canonicalByAttempt = new Map<string, { destinations: Awaited<ReturnType<typeof canonicalizeDestination>>[]; decision: ReturnType<typeof simulateDecision> }>();
  for (const [caseIndex, item] of cases.entries()) {
    console.log(`[sol-parity] case=${item.case_id} index=${caseIndex + 1}/${cases.length} stage=acquire`);
    const temp = await createJobTemp(cfg.tempDir, `sol-parity-${item.case_id}`);
    const caseStarted = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.jobTimeoutMs);
    try {
      const resolver = resolverFor(item.platform, cfg);
      const parsedUrl = new URL(item.source_url);
      if (!resolver.supports({ platform: item.platform, url: parsedUrl })) throw new Error(`resolver_not_available:${item.platform}`);
      const acquisitionStarted = Date.now();
      const media = await resolver.resolve({ jobId: `sol-parity-${item.case_id}`, sourceUrl: item.source_url, workDir: temp.dir, signal: controller.signal });
      const acquisitionMs = Date.now() - acquisitionStarted;
      const framesStarted = Date.now();
      const probe = await inspectMedia(cfg, media.localFilePath, controller.signal);
      const playable = await normalizeMedia(cfg, media.localFilePath, probe, temp.dir, controller.signal);
      const frames = deduplicateFrames(await extractFrames(cfg, probe, playable, temp.dir, controller.signal));
      const frameMs = Date.now() - framesStarted;
      const sets = buildAutomaticFrameSets(frames, Math.min(cfg.vayrinFrameBudget, cfg.maxSelectedFrames), cfg.vayrinFrameStrategy);
      const manual = await loadManualFrameSet(path.resolve(repoRoot, item.manual_frames_directory));
      const frameSets = { ...sets, ...(manual ? { F3: manual } : {}) };

      const transcriptStarted = Date.now();
      const transcriptResult = media.captionsTranscript?.length
        ? { provider: media.captionsSource ?? 'platform_captions', segments: media.captionsTranscript, language: media.captionsLanguage ?? null, status: 'success' as const }
        : await transcription.transcribe({ audioPath: await extractAudio(cfg, playable, probe, temp.dir, controller.signal), hasAudio: probe.hasAudio, sourceUrl: media.canonicalUrl, platform: item.platform, signal: controller.signal });
      const transcriptMs = Date.now() - transcriptStarted;
      const ocrStarted = Date.now();
      const ocrSegments = deduplicateOcrSegments(await ocr.extract({ frames, signal: controller.signal }));
      const ocrMs = Date.now() - ocrStarted;
      const evidence: SourceEvidence = {
        caption: cleanText([media.metadataTitle, media.metadataDescription].filter(Boolean).join('\n'), 8_000),
        transcript: transcriptResult.segments,
        ocr: ocrSegments,
        source_location_context: cleanText(media.metadataLocation, 500),
        creator_handle: cleanText(media.metadataCreatorHandle, 200),
        creator_name: cleanText(media.metadataCreatorName, 200),
      };

      for (const matrix of args.matrix) {
        const frameSet = frameSets[matrix.frame];
        if (!frameSet) continue;
        console.log(`[sol-parity] case=${item.case_id} arm=${matrix.frame}:${matrix.model} stage=sol`);
        const call = await callSolParity({ frameSet, modelArm: matrix.model, platform: item.platform, evidence, signal: controller.signal });
        const attemptId = `${item.case_id}-${matrix.frame}-${matrix.model}-${randomUUID().slice(0, 8)}`;
        const attempt: PersistedModelAttempt = {
          schema_version: 1,
          run_id: runId,
          attempt_id: attemptId,
          persisted_at: new Date().toISOString(),
          case_id: item.case_id,
          source_url: item.source_url,
          platform: item.platform,
          frame_arm: matrix.frame,
          model_arm: matrix.model,
          model: call.model,
          prompt_version: call.prompt_version,
          web_search_enabled: call.web_search_enabled,
          images_only: call.images_only,
          input_manifest: { frame_count: call.frame_manifest.length, frames: call.frame_manifest, caption_characters: call.input_lengths.caption, transcript_characters: call.input_lengths.transcript, ocr_characters: call.input_lengths.ocr, source_location_characters: call.input_lengths.location },
          timings_ms: { acquisition: acquisitionMs, frame_extraction: frameMs, transcription: transcriptMs, ocr: ocrMs, sol: call.latency_ms, web_search: null, canonicalization: null, total: Date.now() - caseStarted },
          usage: call.usage,
          estimated_model_cost_usd: call.estimated_model_cost_usd,
          web_search_calls: call.web_search_calls,
          web_search_queries: call.web_search_queries,
          web_search_sources: call.web_search_sources,
          response_id: call.response_id,
          response_status: call.response_status,
          raw_model_output: call.raw_model_output,
          payload: call.payload,
          failure: call.failure,
        };
        // Critical ordering boundary: durable raw response first, Places second, labels much later.
        await persistModelAttempt(attemptsPath, attempt);
        const canonicalStarted = Date.now();
        const destinations = [];
        for (const destination of call.payload?.results ?? []) destinations.push(await canonicalizeDestination({ destination, apiKey: cfg.googlePlacesServerApiKey || null }));
        const decision = simulateDecision(call.payload, destinations);
        canonicalByAttempt.set(attemptId, { destinations, decision });
        await appendFile(canonicalPath, `${JSON.stringify({ attempt_id: attemptId, case_id: item.case_id, frame_arm: matrix.frame, model_arm: matrix.model, persisted_at: new Date().toISOString(), canonicalization_ms: Date.now() - canonicalStarted, places_calls: destinations.reduce((sum, value) => sum + value.places_calls, 0), destinations, simulated_decision: decision, actual_save_performed: false })}\n`, 'utf8');
      }
    } catch (error) {
      await appendFile(errorsPath, `${JSON.stringify({ case_id: item.case_id, source_url: item.source_url, persisted_at: new Date().toISOString(), stage: 'pre_model_or_case', error: error instanceof Error ? error.message.slice(0, 300) : 'unknown_error' })}\n`, 'utf8');
      console.error(`[sol-parity] case=${item.case_id} failed=${error instanceof Error ? error.message : 'unknown'}`);
    } finally {
      clearTimeout(timeout);
      await temp.cleanup();
    }
  }

  // Labels enter memory only now, after every raw model response is durable.
  const attempts = await readPersistedAttempts(attemptsPath).catch(() => [] as PersistedModelAttempt[]);
  const { loadGroundTruthAfterPersistence } = await import('../solParity/persistence.js');
  const groundTruth = await loadGroundTruthAfterPersistence(groundTruthPath) as import('../solParity/scoring.js').GroundTruthManifest;
  const { scoreAttempt, summarizeScores } = await import('../solParity/scoring.js');
  const truthById = new Map(groundTruth.cases.map((truth) => [truth.case_id, truth]));
  const scores = attempts.flatMap((attempt) => {
    const truth = truthById.get(attempt.case_id);
    const canonical = canonicalByAttempt.get(attempt.attempt_id);
    return truth && canonical ? [scoreAttempt({ attempt, truth, canonicalized: canonical.destinations, decision: canonical.decision })] : [];
  });
  await writeJsonAtomic(path.join(runDir, 'scores.json'), { schema_version: 1, run_id: runId, scored_at: new Date().toISOString(), cases_requested: cases.length, model_attempts_persisted: attempts.length, scores, summary: summarizeScores(scores, attempts) });
  console.log(`[sol-parity] complete run=${runId} requested_cases=${cases.length} persisted_attempts=${attempts.length} output=${runDir}`);
}

main().catch((error) => {
  console.error(`[sol-parity] fatal=${error instanceof Error ? error.message : 'unknown_error'}`);
  process.exitCode = 1;
});
