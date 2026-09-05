import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFiles } from '../config/loadEnvFiles.js';
import { loadConfig } from '../config/env.js';
import { completePremiumRecognition } from '../premium/premiumRecognition.js';
import { writeJsonAtomic } from '../solParity/persistence.js';
import { scoreAttempt, summarizeScores, type GroundTruthManifest } from '../solParity/scoring.js';
import type { PersistedModelAttempt, SimulatedDecision } from '../solParity/types.js';

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function simulatedDecision(execution: Awaited<ReturnType<typeof completePremiumRecognition>>): SimulatedDecision {
  if (!execution.destinations.length) return 'WOULD_SHOW_FALLBACK';
  if (execution.destinations.some((item) => item.hypotheses.length > 1)) return 'WOULD_SHOW_OPTIONS';
  if (execution.destinations.some((item) => item.decision === 'AUTO_SAVE')) return 'WOULD_AUTO_SAVE';
  if (execution.destinations.some((item) => item.decision === 'REVIEW')) return 'WOULD_REVIEW';
  if (execution.destinations.some((item) => item.decision === 'NAMED_LEAD')) return 'WOULD_SHOW_NAMED_LEAD';
  return 'WOULD_SHOW_FALLBACK';
}

async function main(): Promise<void> {
  const runArg = process.argv[2];
  if (!runArg) throw new Error('usage: evaluatePremiumRecordedAttempts <run-directory>');
  const { repoRoot } = loadEnvFiles();
  const cfg = loadConfig();
  const runDir = path.resolve(repoRoot, runArg);
  const lines = (await readFile(path.join(runDir, 'model-attempts.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  const attempts = lines.map((line) => JSON.parse(line) as PersistedModelAttempt);
  const truth = JSON.parse(await readFile(path.join(repoRoot, 'artifacts', 'sol-parity', 'ground-truth.json'), 'utf8')) as GroundTruthManifest;
  const truthById = new Map(truth.cases.map((item) => [item.case_id, item]));
  const executions = [];
  const scores = [];
  for (const attempt of attempts) {
    const timestamps = attempt.input_manifest.frames.map((frame) => frame.timestamp_seconds);
    const baseTime = new Date(attempt.persisted_at);
    const execution = await completePremiumRecognition({
      input: {
        frameSet: {
          arm: attempt.frame_arm,
          strategy: 'current_nearr_diverse_6',
          considered_count: attempt.input_manifest.frame_count,
          mean_pairwise_distance: null,
          frames: timestamps.map((timestampSeconds, index) => ({
            path: '', timestampSeconds, width: attempt.input_manifest.frames[index]?.width ?? 0,
            height: attempt.input_manifest.frames[index]?.height ?? 0, aHash: '', reason: 'interval',
          })),
        },
        platform: attempt.platform,
        canonicalUrl: attempt.source_url,
        evidence: { caption: null, transcript: [], ocr: [], source_location_context: null, creator_handle: null, creator_name: null },
        googlePlacesApiKey: cfg.googlePlacesServerApiKey || null,
        webSearchEnabled: false,
        allowDistinctiveVisualAutoSave: false,
      },
      call: {
        model: attempt.model,
        prompt_version: attempt.prompt_version,
        web_search_enabled: attempt.web_search_enabled,
        images_only: attempt.images_only,
        latency_ms: attempt.timings_ms.sol,
        usage: attempt.usage,
        estimated_model_cost_usd: attempt.estimated_model_cost_usd,
        web_search_calls: attempt.web_search_calls,
        web_search_queries: attempt.web_search_queries,
        web_search_sources: attempt.web_search_sources,
        response_id: attempt.response_id,
        response_status: attempt.response_status,
        raw_model_output: attempt.raw_model_output,
        payload: attempt.payload,
        failure: attempt.failure,
        input_lengths: {
          caption: attempt.input_manifest.caption_characters,
          transcript: attempt.input_manifest.transcript_characters,
          ocr: attempt.input_manifest.ocr_characters,
          location: attempt.input_manifest.source_location_characters,
        },
        frame_manifest: attempt.input_manifest.frames,
      },
      requestedAt: baseTime,
      evidenceReadyAt: baseTime,
      solStartedAt: baseTime,
      solCompletedAt: new Date(baseTime.getTime() + attempt.timings_ms.sol),
    });
    const decision = simulatedDecision(execution);
    const label = truthById.get(attempt.case_id);
    if (label) scores.push(scoreAttempt({ attempt, truth: label, canonicalized: [], decision }));
    executions.push({
      case_id: attempt.case_id,
      outcome: execution.outcome,
      chargeability: execution.chargeability,
      decision,
      destinations: execution.destinations,
      places_requests: execution.telemetry.placesRequests,
      sol_latency_ms: attempt.timings_ms.sol,
      total_latency_ms: attempt.timings_ms.total,
      model_cost_usd: attempt.estimated_model_cost_usd,
    });
    console.log(`[premium-replay] case=${attempt.case_id} decision=${decision} places=${execution.telemetry.placesRequests}`);
  }
  const placeCounts = executions.map((item) => item.places_requests);
  const modelCosts = attempts.map((item) => item.estimated_model_cost_usd).filter((value): value is number => value != null);
  const solLatencies = attempts.map((item) => item.timings_ms.sol).filter(Number.isFinite);
  const priorityIds = new Set(['R01','R02','R03','R04','R05','R06','R07','R08','V05']);
  await writeJsonAtomic(path.join(runDir, 'premium-runtime-evaluation.json'), {
    schema_version: 1,
    evaluated_at: new Date().toISOString(),
    model_attempts: attempts.length,
    source_corpus_cases: truth.cases.length,
    unavailable_pre_model_cases: truth.cases.length - attempts.length,
    scores,
    score_summary: summarizeScores(scores, attempts),
    priority: scores.filter((item) => priorityIds.has(item.case_id)),
    wrong_autosaves: scores.filter((item) => item.wrong_autosave).length,
    places: {
      total: placeCounts.reduce((a, b) => a + b, 0),
      mean: placeCounts.length ? placeCounts.reduce((a, b) => a + b, 0) / placeCounts.length : null,
      median: percentile(placeCounts, .5), p95: percentile(placeCounts, .95), max: placeCounts.length ? Math.max(...placeCounts) : null,
      parity_baseline_requests_per_video: 7.6,
    },
    latency_ms: { sol_median: percentile(solLatencies, .5), sol_p95: percentile(solLatencies, .95) },
    cost: {
      known_model_total_usd: modelCosts.length === attempts.length ? modelCosts.reduce((a, b) => a + b, 0) : null,
      known_model_mean_usd: modelCosts.length === attempts.length ? modelCosts.reduce((a, b) => a + b, 0) / modelCosts.length : null,
      places_usd: 'UNKNOWN', acquisition_usd: 'UNKNOWN', transcription_usd: 'UNKNOWN', all_in_usd: 'UNKNOWN',
    },
    executions,
  });
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'unknown_error'); process.exitCode = 1; });
