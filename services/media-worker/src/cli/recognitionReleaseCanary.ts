import { createHash } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
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
import { buildAutomaticFrameSets } from '../solParity/frames.js';
import { validateInferenceCase } from '../solParity/corpus.js';
import type { InferenceCase } from '../solParity/types.js';
import { selectModelProvider, type AnalyzeOutput } from '../providers/model.js';
import { withAutomaticDeepRecognition } from '../automaticDeep/automaticDeepRecognitionProvider.js';
import { estimateGeminiCostUsd } from '../providers/geminiPricing.js';

type Lane = 'easy_business' | 'hard_natural' | 'ambiguous' | 'parent_child' | 'zero_recovery';
type CanaryCase = InferenceCase & { lane: Lane };
type Truth = {
  case_id: string;
  accepted_exact_identities: string[];
  accepted_aliases: string[];
  accepted_truthful_partials: string[];
  expected_broad_geography: string[];
  known_wrong_identities: string[];
};
type Attempt = {
  schema_version: 1;
  run_id: string;
  case_id: string;
  lane: Lane;
  model: string;
  persisted_at: string;
  evidence_fingerprint: string;
  frame_count: number;
  cheap_candidates: string[];
  final_candidates: string[];
  prompt_version: string;
  recognition_failure_class: string | null;
  cheap_usage: AnalyzeOutput['usage'] | null;
  cheap_cost_usd: number | null;
  cheap_latency_ms: number;
  sol_invoked: boolean;
  sol_attempts: number;
  sol_cost_usd: number | null;
  sol_latency_ms: number;
  places_requests: number;
  total_cost_usd: number | null;
  total_latency_ms: number;
};

const MODELS = ['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'] as const;

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

function fold(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function identityMatch(candidate: string, accepted: readonly string[]): boolean {
  const value = fold(candidate);
  return !!value && accepted.some((item) => {
    const truth = fold(item);
    return value === truth || (truth.length >= 5 && value.includes(truth)) || (value.length >= 5 && truth.includes(value));
  });
}

async function appendDurable(filePath: string, value: unknown): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
  const handle = await open(filePath, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

function fingerprintInput(args: {
  frameHashes: string[];
  caption: string | null;
  transcript: unknown;
  ocr: unknown;
  location: string | null;
}): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

function cheapCandidates(output: AnalyzeOutput): string[] {
  return output.automaticDeep?.invoked
    ? output.automaticDeep.normalCandidates.map((candidate) => candidate.name).filter(Boolean).slice(0, 3)
    : output.evidence.places.map((candidate) => candidate.name).filter(Boolean).slice(0, 3);
}

async function main(): Promise<void> {
  if (process.env.RECOGNITION_CANARY_CONFIRM_PAID !== '1') {
    throw new Error('paid_run_requires_RECOGNITION_CANARY_CONFIRM_PAID=1');
  }
  const envLoad = loadEnvFiles();
  const repoRoot = envLoad.repoRoot;
  const manifestPath = path.join(repoRoot, 'artifacts', 'recognition-release-canary', 'manifest.json');
  const corpusPath = path.join(repoRoot, 'artifacts', 'sol-parity', 'inference-corpus.json');
  const truthPath = path.join(repoRoot, 'artifacts', 'sol-parity', 'ground-truth.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { cases: Array<{ case_id: string; lane: Lane }> };
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as { cases: unknown[] };
  const corpusById = new Map(corpus.cases.map(validateInferenceCase).map((item) => [item.case_id, item]));
  const cases = manifest.cases.map(({ case_id, lane }) => {
    const item = corpusById.get(case_id);
    if (!item) throw new Error(`canary_case_missing:${case_id}`);
    return { ...item, lane } as CanaryCase;
  });
  if (cases.length !== 16) throw new Error(`canary_must_have_16_cases:${cases.length}`);

  for (const key of ['INSTAGRAM_MEDIA_RESOLVER_ENABLED','TIKTOK_MEDIA_RESOLVER_ENABLED','YOUTUBE_MEDIA_RESOLVER_ENABLED','FACEBOOK_MEDIA_RESOLVER_ENABLED','SNAPCHAT_MEDIA_RESOLVER_ENABLED']) {
    process.env[key] = 'true';
  }
  process.env.MEDIA_ANALYSIS_PROVIDER = 'gemini';
  process.env.AUTOMATIC_DEEP_RECOGNITION_ENABLED = 'true';
  process.env.MEDIA_MAX_SELECTED_FRAMES ||= '24';
  const baseCfg = loadConfig();
  const transcription = selectTranscriptionProvider(baseCfg);
  const ocr = selectOcrProvider(baseCfg);
  const runId = `recognition-canary-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(repoRoot, 'artifacts', 'recognition-release-canary', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  const attemptsPath = path.join(runDir, 'attempts.jsonl');
  const errorsPath = path.join(runDir, 'errors.jsonl');
  await Promise.all([rm(attemptsPath, { force: true }), rm(errorsPath, { force: true })]);
  await appendDurable(path.join(runDir, 'run-manifest.jsonl'), {
    schema_version: 1,
    run_id: runId,
    started_at: new Date().toISOString(),
    git_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    models: MODELS,
    cases: cases.map(({ case_id, lane }) => ({ case_id, lane })),
    same_evidence_per_model: true,
    ground_truth_loaded_during_inference: false,
    recognition_cache_reads: false,
    production_target: false,
  });

  const attempts: Attempt[] = [];
  for (const [caseIndex, item] of cases.entries()) {
    console.log(`[release-canary] case=${item.case_id} ${caseIndex + 1}/${cases.length} stage=acquire`);
    const temp = await createJobTemp(baseCfg.tempDir, `release-canary-${item.case_id}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), baseCfg.jobTimeoutMs);
    try {
      const resolver = resolverFor(item.platform, baseCfg);
      const parsedUrl = new URL(item.source_url);
      if (!resolver.supports({ platform: item.platform, url: parsedUrl })) throw new Error(`resolver_not_available:${item.platform}`);
      const media = await resolver.resolve({
        jobId: `release-canary-${item.case_id}`,
        sourceUrl: item.source_url,
        workDir: temp.dir,
        signal: controller.signal,
      });
      const probe = await inspectMedia(baseCfg, media.localFilePath, controller.signal);
      const playable = await normalizeMedia(baseCfg, media.localFilePath, probe, temp.dir, controller.signal);
      const frames = deduplicateFrames(await extractFrames(baseCfg, probe, playable, temp.dir, controller.signal));
      const frameSet = buildAutomaticFrameSets(
        frames,
        Math.min(baseCfg.vayrinFrameBudget, baseCfg.maxSelectedFrames),
        baseCfg.vayrinFrameStrategy,
      ).F1;
      const transcript = media.captionsTranscript?.length
        ? { segments: media.captionsTranscript }
        : await transcription.transcribe({
            audioPath: await extractAudio(baseCfg, playable, probe, temp.dir, controller.signal),
            hasAudio: probe.hasAudio,
            sourceUrl: media.canonicalUrl,
            platform: item.platform,
            signal: controller.signal,
          });
      const ocrSegments = deduplicateOcrSegments(await ocr.extract({ frames, signal: controller.signal }));
      const caption = cleanText([media.metadataTitle, media.metadataDescription].filter(Boolean).join('\n'), 8_000);
      const inputFingerprint = fingerprintInput({
        frameHashes: frameSet.frames.map((frame) => `${frame.aHash}:${frame.timestampSeconds}`),
        caption,
        transcript: transcript.segments,
        ocr: ocrSegments,
        location: cleanText(media.metadataLocation, 500),
      });

      for (const model of MODELS) {
        console.log(`[release-canary] case=${item.case_id} model=${model} stage=inference`);
        process.env.GEMINI_MODEL = model;
        const modelCfg = loadConfig();
        const provider = withAutomaticDeepRecognition(selectModelProvider(modelCfg), modelCfg);
        try {
          const output = await provider.analyze({
            platform: item.platform,
            canonicalUrl: media.canonicalUrl,
            transcript: transcript.segments,
            ocr: ocrSegments,
            ocrExtracted: ocr.extractsVisibleText,
            frames: frameSet.frames,
            metadataTitle: media.metadataTitle,
            metadataDescription: media.metadataDescription,
            metadataLocation: media.metadataLocation,
            metadataCreatorHandle: media.metadataCreatorHandle,
            metadataCreatorName: media.metadataCreatorName,
            shareJobId: `release-canary-${item.case_id}`,
            signal: controller.signal,
          });
          const cheapUsage = output.cheapPass?.usage ?? output.usage ?? null;
          const cheapCost = estimateGeminiCostUsd({
            model,
            inputTokens: cheapUsage?.inputTokens ?? 0,
            outputTokens: cheapUsage?.outputTokens ?? 0,
            thinkingTokens: cheapUsage?.thinkingTokens ?? 0,
          });
          const solCost = output.automaticDeepRecognition?.telemetry.knownModelCostUsd ?? null;
          const attempt: Attempt = {
            schema_version: 1,
            run_id: runId,
            case_id: item.case_id,
            lane: item.lane,
            model,
            persisted_at: new Date().toISOString(),
            evidence_fingerprint: inputFingerprint,
            frame_count: frameSet.frames.length,
            cheap_candidates: cheapCandidates(output),
            final_candidates: output.evidence.places.map((candidate) => candidate.name).filter(Boolean).slice(0, 3),
            prompt_version: output.promptVersion,
            recognition_failure_class: output.recognitionFailureClass ?? null,
            cheap_usage: cheapUsage,
            cheap_cost_usd: cheapCost,
            cheap_latency_ms: output.cheapPass?.latencyMs ?? output.latencyMs ?? 0,
            sol_invoked: output.automaticDeep?.invoked === true,
            sol_attempts: output.automaticDeep?.attempts ?? 0,
            sol_cost_usd: solCost,
            sol_latency_ms: output.automaticDeepRecognition?.telemetry.timingsMs.sol ?? 0,
            places_requests: output.automaticDeepRecognition?.telemetry.placesRequests ?? 0,
            total_cost_usd: cheapCost == null || (output.automaticDeep?.invoked && solCost == null)
              ? null
              : Number((cheapCost + (solCost ?? 0)).toFixed(8)),
            total_latency_ms: output.latencyMs ?? 0,
          };
          await appendDurable(attemptsPath, attempt);
          attempts.push(attempt);
        } catch (error) {
          await appendDurable(errorsPath, {
            case_id: item.case_id,
            lane: item.lane,
            model,
            stage: 'inference',
            error: error instanceof Error ? error.message.slice(0, 240) : 'unknown_error',
          });
        }
      }
    } catch (error) {
      await appendDurable(errorsPath, {
        case_id: item.case_id,
        lane: item.lane,
        stage: 'acquisition',
        error: error instanceof Error ? error.message.slice(0, 240) : 'unknown_error',
      });
    } finally {
      clearTimeout(timeout);
      await temp.cleanup();
    }
  }

  // Evaluation labels enter memory only after every inference response has
  // been durably appended above.
  const truthManifest = JSON.parse(await readFile(truthPath, 'utf8')) as { cases: Truth[] };
  const truthById = new Map(truthManifest.cases.map((truth) => [truth.case_id, truth]));
  const scores = attempts.map((attempt) => {
    const truth = truthById.get(attempt.case_id);
    if (!truth) throw new Error(`truth_missing:${attempt.case_id}`);
    const exactSet = [...truth.accepted_exact_identities, ...truth.accepted_aliases];
    const plausibleSet = [...exactSet, ...truth.accepted_truthful_partials, ...truth.expected_broad_geography];
    const cheapTop1 = attempt.cheap_candidates[0] ?? '';
    const finalTop1 = attempt.final_candidates[0] ?? '';
    return {
      case_id: attempt.case_id,
      lane: attempt.lane,
      model: attempt.model,
      exact_at_1: identityMatch(cheapTop1, exactSet),
      exact_at_3: attempt.cheap_candidates.some((candidate) => identityMatch(candidate, exactSet)),
      plausible_top_1: identityMatch(cheapTop1, plausibleSet),
      final_plausible_top_1: identityMatch(finalTop1, plausibleSet),
      absurd_contradiction: identityMatch(finalTop1, truth.known_wrong_identities),
      automatic_completion: attempt.final_candidates.length > 0 && !attempt.recognition_failure_class,
      manual_intervention: attempt.final_candidates.length === 0 || !!attempt.recognition_failure_class,
      gemini_only: attempt.final_candidates.length > 0 && !attempt.sol_invoked && !attempt.recognition_failure_class,
      sol_invoked: attempt.sol_invoked,
      sol_attempts: attempt.sol_attempts,
      cheap_cost_usd: attempt.cheap_cost_usd,
      sol_cost_usd: attempt.sol_cost_usd,
      total_cost_usd: attempt.total_cost_usd,
      cheap_latency_ms: attempt.cheap_latency_ms,
      total_latency_ms: attempt.total_latency_ms,
    };
  });
  const summaries = MODELS.map((model) => {
    const rows = scores.filter((score) => score.model === model);
    const attemptsForModel = attempts.filter((attempt) => attempt.model === model);
    const count = rows.length;
    const rate = (predicate: (row: typeof rows[number]) => boolean) => count ? rows.filter(predicate).length / count : 0;
    const total = (key: 'cheap_cost_usd' | 'sol_cost_usd' | 'total_cost_usd' | 'cheap_latency_ms' | 'total_latency_ms') =>
      rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
    return {
      model,
      cases_scored: count,
      acquisition_or_inference_failures: 16 - count,
      exact_at_1: rate((row) => row.exact_at_1),
      exact_at_3: rate((row) => row.exact_at_3),
      plausible_top_1: rate((row) => row.plausible_top_1),
      automatic_completion_rate: rate((row) => row.automatic_completion),
      manual_intervention_rate: rate((row) => row.manual_intervention),
      gemini_only_completion_rate: rate((row) => row.gemini_only),
      easy_solved_without_sol: rows.filter((row) => row.lane === 'easy_business' && row.gemini_only && row.plausible_top_1).length,
      easy_cases_scored: rows.filter((row) => row.lane === 'easy_business').length,
      hard_sol_escalations: rows.filter((row) => row.lane === 'hard_natural' && row.sol_invoked).length,
      hard_cases_scored: rows.filter((row) => row.lane === 'hard_natural').length,
      sol_invocations: rows.filter((row) => row.sol_invoked).length,
      sol_calls: rows.reduce((sum, row) => sum + row.sol_attempts, 0),
      absurd_contradictions: rows.filter((row) => row.absurd_contradiction).length,
      cheap_cost_usd: Number(total('cheap_cost_usd').toFixed(6)),
      sol_cost_usd: Number(total('sol_cost_usd').toFixed(6)),
      total_cost_usd: attemptsForModel.some((attempt) => attempt.total_cost_usd == null)
        ? null
        : Number(total('total_cost_usd').toFixed(6)),
      median_cheap_latency_ms: rows.map((row) => row.cheap_latency_ms).sort((a, b) => a - b)[Math.floor(count / 2)] ?? null,
      median_total_latency_ms: rows.map((row) => row.total_latency_ms).sort((a, b) => a - b)[Math.floor(count / 2)] ?? null,
    };
  });
  const report = {
    schema_version: 1,
    run_id: runId,
    completed_at: new Date().toISOString(),
    cases_requested: 16,
    model_attempts_requested: 48,
    model_attempts_persisted: attempts.length,
    errors: 48 - attempts.length,
    scoring_policy: 'cheap-lane identity scores; final automatic-completion and contradiction scores after routed Sol',
    summaries,
    scores,
  };
  await appendDurable(path.join(runDir, 'report.jsonl'), report);
  console.log(JSON.stringify({ run_dir: path.relative(repoRoot, runDir), summaries }, null, 2));
}

main().catch((error) => {
  console.error(`[release-canary] fatal=${error instanceof Error ? error.message : 'unknown_error'}`);
  process.exitCode = 1;
});
