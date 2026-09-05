import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnvFiles } from '../config/loadEnvFiles.js';
import { parseCategory, selectCorpus } from '../recognitionRegression/corpus.js';
import { assertInferenceEnvelope, BenchmarkLifecycle, buildInferenceEnvelope } from '../recognitionRegression/firewall.js';
import { loadFixtureCorrections, loadRegressionCorpus, loadRegressionGroundTruth } from '../recognitionRegression/fixtures.js';
import { assertNoCasesDisappear, persistAttempt } from '../recognitionRegression/persistence.js';
import { assertBaselineDoesNotDecrease, enforceRatchet } from '../recognitionRegression/ratchet.js';
import { buildCaseDiff, percentile, persistFailureArtifacts } from '../recognitionRegression/reporting.js';
import { calculateMetrics, scoreCase } from '../recognitionRegression/scoring.js';
import { RECOGNITION_CATEGORIES, type BaselineCaseContract, type RatchetBaseline, type RecognitionCategory, type RegressionAttempt } from '../recognitionRegression/types.js';
import type { PersistedModelAttempt } from '../solParity/types.js';

type RuntimeLine = { attempt_id: string; execution?: { destinations?: Array<{ decision?: string; hypotheses?: Array<{ name?: string; entityType?: string; city?: string | null; region?: string | null; country?: string | null; evidenceBasis?: string; canonicalStatus?: string; canonical?: { latitude?: number; longitude?: number } | null }> }>; telemetry?: { engineVersion?: string; evidenceVersion?: string; placesRequests?: number } } };
import { writeJsonAtomic } from '../solParity/persistence.js';

export type LiveArgs = { category: RecognitionCategory | null; all: boolean; dryRun: boolean; includeResearch: boolean; recordBaseline: boolean; out: string | null };
export function parseLiveArgs(argv: string[]): LiveArgs {
  const args: LiveArgs = { category: null, all: false, dryRun: false, includeResearch: false, recordBaseline: false, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--category') args.category = parseCategory(argv[++index] ?? '');
    else if (arg === '--all') args.all = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--include-research') args.includeResearch = true;
    else if (arg === '--record-baseline') args.recordBaseline = true;
    else if (arg === '--out') args.out = argv[++index] ?? null;
    else throw new Error(`unknown_argument:${arg}`);
  }
  if (args.all && args.category) throw new Error('choose_all_or_category');
  if (!args.all && !args.category) args.all = true;
  return args;
}

function readJsonl<T>(raw: string): T[] { return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T); }

async function readBaseline(filePath: string): Promise<RatchetBaseline | null> {
  try { return JSON.parse(await readFile(filePath, 'utf8')) as RatchetBaseline; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

function normalizeAttempt(runId: string, item: PersistedModelAttempt, category: RecognitionCategory, runtime?: RuntimeLine): RegressionAttempt {
  const destinations = item.payload?.results ?? [];
  const hypotheses = destinations.flatMap((destination) => [destination, ...destination.alternatives]).slice(0, 3);
  const runtimeHypotheses = runtime?.execution?.destinations?.flatMap((destination) => destination.hypotheses ?? []) ?? [];
  const decision = runtime?.execution?.destinations?.[0]?.decision;
  return {
    schemaVersion: 2, runId, caseId: item.case_id, category, sourceUrl: item.source_url,
    recognitionVersion: 'simple-sol-premium.v2', evidenceVersion: 'premium-evidence-2026-09-05.v1', modelPath: `${item.model}/${item.frame_arm}:${item.model_arm}`,
    acquisitionStatus: 'ACQUIRED', status: item.failure ? 'TECHNICAL_FAILURE' : 'COMPLETED',
    candidates: hypotheses.map((candidate, index) => { const canonical = runtimeHypotheses[index]; return ({ rank: index + 1, name: canonical?.name ?? candidate.name, identityType: canonical?.entityType ?? candidate.entity_type,
      locality: [canonical?.city ?? candidate.city, canonical?.region ?? candidate.region].filter(Boolean).join(', ') || null, country: canonical?.country ?? candidate.country, latitude: canonical?.canonical?.latitude ?? null, longitude: canonical?.canonical?.longitude ?? null,
      evidenceType: canonical?.evidenceBasis ?? 'MODEL_HYPOTHESIS', canonicalizationStatus: canonical?.canonicalStatus ?? null,
      specificity: candidate.entity_type === 'ADMIN_AREA' ? 'ADMIN_AREA' : candidate.entity_type === 'BROAD_AREA' ? 'BROAD_AREA' : candidate.entity_type === 'UNKNOWN' ? 'UNKNOWN' : 'SPECIFIC_PHYSICAL_PLACE' }); }),
    safetyDecision: decision === 'AUTO_SAVE' ? 'AUTO_SAVE' : decision === 'REVIEW' || decision === 'NAMED_LEAD' ? 'REVIEW' : 'MANUAL_FALLBACK', frameManifest: item.input_manifest.frames.map((frame) => ({ timestampSeconds: frame.timestamp_seconds, sha256: frame.sha256 })),
    placesCallCount: runtime?.execution?.telemetry?.placesRequests ?? 0, cacheReadUsed: false, modelRequests: 1, apiRequests: 1 + item.web_search_calls + (runtime?.execution?.telemetry?.placesRequests ?? 0),
    costUsd: item.estimated_model_cost_usd, latencyMs: item.timings_ms.total, failureCode: item.failure?.code ?? null, persistedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const args = parseLiveArgs(process.argv.slice(2));
  const repoRoot = loadEnvFiles().repoRoot;
  const selected = selectCorpus(await loadRegressionCorpus(repoRoot), args.category);
  const corpus = (args.includeResearch ? selected : selected.filter((item) => !item.researchOnly)).filter((item) => item.fixtureKind !== 'CONTRACT_CONTROL');
  const envelopes = corpus.map(buildInferenceEnvelope);
  envelopes.forEach(assertInferenceEnvelope);
  if (args.dryRun) {
    console.log(JSON.stringify({ mode: 'dry_run', category: args.category ?? 'ALL', includeResearch: args.includeResearch, cases: corpus.map((item) => item.caseId), cacheReadUsed: false, groundTruthLoaded: false }, null, 2));
    return;
  }
  if (process.env.RECOGNITION_LIVE_CONFIRM_PAID !== '1') throw new Error('paid_run_requires_RECOGNITION_LIVE_CONFIRM_PAID=1');
  const lifecycle = new BenchmarkLifecycle(); lifecycle.inferenceStarted();
  const runId = `recognition-live-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.resolve(repoRoot, args.out ?? path.join('artifacts', 'recognition-regression', 'runs', runId));
  const parityDir = path.join(runDir, 'backend');
  await mkdir(runDir, { recursive: true });
  const inferenceCorpusPath = path.join(runDir, 'inference-corpus.json');
  await writeFile(inferenceCorpusPath, `${JSON.stringify({
    schema_version: 1,
    note: 'Generated inference-only V2 manifest. Contains no labels, aliases, truth coordinates, or prior answers.',
    cases: corpus.map((item) => ({
      case_id: item.caseId,
      source: item.sourceCorpus,
      platform: new URL(item.sourceUrl).hostname.includes('instagram') ? 'instagram' : new URL(item.sourceUrl).hostname.includes('tiktok') ? 'tiktok' : new URL(item.sourceUrl).hostname.includes('youtube') ? 'youtube' : new URL(item.sourceUrl).hostname.includes('facebook') ? 'facebook' : 'snapchat',
      source_url: item.sourceUrl,
      categories: [item.category],
      manual_frames_directory: item.evidenceFixture ?? 'artifacts/recognition-regression/no-manual-frames',
    })),
  }, null, 2)}\n`, 'utf8');
  const workerDir = path.join(repoRoot, 'services', 'media-worker');
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/solParityBenchmark.ts', '--corpus', path.relative(repoRoot, inferenceCorpusPath), '--skip-scoring', '--matrix', 'F1:M1', '--out', path.relative(repoRoot, parityDir)], {
    cwd: workerDir,
    stdio: 'inherit',
    env: { ...process.env, SOL_PARITY_CONFIRM_PAID: '1' },
  });
  if (child.status !== 0) throw new Error(`backend_benchmark_failed:${child.status}:${child.error?.message ?? 'no_spawn_error'}`);
  const modelAttempts = readJsonl<PersistedModelAttempt>(await readFile(path.join(parityDir, 'model-attempts.jsonl'), 'utf8'));
  const runtimeLines = readJsonl<RuntimeLine>(await readFile(path.join(parityDir, 'local-runtime.jsonl'), 'utf8'));
  const attemptByCase = new Map(modelAttempts.map((item) => [item.case_id, item]));
  const runtimeByAttempt = new Map(runtimeLines.map((item) => [item.attempt_id, item]));
  const attemptsPath = path.join(runDir, 'attempts.jsonl');
  const attempts: RegressionAttempt[] = [];
  for (const item of corpus) {
    const model = attemptByCase.get(item.caseId);
    const normalized = model ? normalizeAttempt(runId, model, item.category, runtimeByAttempt.get(model.attempt_id)) : {
      schemaVersion: 2 as const, runId, caseId: item.caseId, category: item.category, sourceUrl: item.sourceUrl,
      recognitionVersion: 'simple-sol-premium.v2', evidenceVersion: 'premium-evidence-2026-09-05.v1', modelPath: 'CURRENT_BACKEND_NO_MODEL_RESULT',
      acquisitionStatus: 'ACQUISITION_BLOCKED' as const, status: 'TECHNICAL_FAILURE' as const, candidates: [], safetyDecision: 'MANUAL_FALLBACK' as const,
      frameManifest: [], placesCallCount: 0, cacheReadUsed: false as const, modelRequests: 0, apiRequests: 0, costUsd: null, latencyMs: 0,
      failureCode: 'NO_PERSISTED_MODEL_ATTEMPT', persistedAt: new Date().toISOString(),
    };
    attempts.push(normalized);
    await persistAttempt(attemptsPath, normalized, attempts.length === 1 ? lifecycle : undefined);
  }
  assertNoCasesDisappear(corpus.map((item) => item.caseId), attempts);
  lifecycle.ranked();
  const truth = await loadRegressionGroundTruth(repoRoot); lifecycle.truthLoaded();
  const truthById = new Map(truth.map((item) => [item.caseId, item]));
  const scores = attempts.map((attempt) => scoreCase(attempt, truthById.get(attempt.caseId)!)); lifecycle.scored();
  const metrics = calculateMetrics(corpus, attempts, scores);
  const baselinePath = path.join(repoRoot, 'artifacts', 'recognition-regression', 'baseline.json');
  const previous = await readBaseline(baselinePath);
  const corrections = await loadFixtureCorrections(repoRoot);
  const isFullScorableRun = !args.category && !args.includeResearch;
  if (isFullScorableRun && previous?.passingCaseIds.length) enforceRatchet(previous, scores, corrections);
  const caseContracts = scores.map((score): BaselineCaseContract => ({ caseId: score.caseId, category: score.category, groundTruth: truthById.get(score.caseId)?.canonicalName ?? '', exactAt1: score.exactAt1, exactAt3: score.exactAt3, top3: attempts.find((item) => item.caseId === score.caseId)?.candidates.slice(0, 3).map((candidate) => candidate.name) ?? [], classification: score.classification }));
  const nextBaseline: RatchetBaseline = {
    schemaVersion: 2,
    recognitionVersion: 'simple-sol-premium.v2',
    recordedAt: new Date().toISOString(),
    passingCaseIds: scores.filter((score) => score.exactAt3).map((score) => score.caseId),
    perCategoryExactAt3Minimum: Object.fromEntries(RECOGNITION_CATEGORIES.map((category) => [category, metrics.perCategory[category].exactAt3])) as RatchetBaseline['perCategoryExactAt3Minimum'],
    productTargetExactAt3Percent: Object.fromEntries(RECOGNITION_CATEGORIES.map((category) => [category, 100])) as RatchetBaseline['productTargetExactAt3Percent'],
    wrongAutosavesMaximum: 0,
    fixtureCorrections: corrections,
    caseContracts,
  };
  if (args.recordBaseline) {
    if (args.category || args.includeResearch) throw new Error('baseline_requires_full_scorable_corpus');
    if (scores.some((score) => score.wrongAutosave)) throw new Error('baseline_has_wrong_autosave');
    if (previous?.passingCaseIds.length) assertBaselineDoesNotDecrease(previous, nextBaseline);
    await writeJsonAtomic(baselinePath, nextBaseline);
  }
  const latencies = attempts.map((item) => item.latencyMs).filter((value) => value > 0);
  const knownCosts = attempts.map((item) => item.costUsd).filter((value): value is number => value !== null);
  const result = {
    schemaVersion: 2, runId, mode: 'LIVE_CURRENT_BACKEND', generatedAt: new Date().toISOString(), category: args.category ?? 'ALL',
    groundTruthLoadedAfterPersistence: true, cacheReadUsed: false, actualSavePerformed: false,
    modelRequests: attempts.reduce((sum, item) => sum + item.modelRequests, 0), apiRequests: attempts.reduce((sum, item) => sum + item.apiRequests, 0),
    cost: { knownModelSpendUsd: knownCosts.reduce((sum, value) => sum + value, 0), attemptsWithUnknownModelCost: attempts.length - knownCosts.length, otherProviderSpendUsd: null },
    latency: { p50Ms: percentile(latencies, .5), p95Ms: percentile(latencies, .95) },
    safety: { correctAutosaves: scores.filter((score) => score.autoSaveCorrect).length, wrongAutosaves: scores.filter((score) => score.wrongAutosave).length, correctReviews: scores.filter((score) => score.reviewCorrect).length },
    attempts, scores, metrics, diff: { cases: buildCaseDiff(previous?.caseContracts ?? [], attempts, scores, truthById) },
  };
  await writeFile(path.join(runDir, 'results.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await persistFailureArtifacts(runDir, attempts, scores, truthById);
  if (isFullScorableRun) {
    await writeJsonAtomic(path.join(repoRoot, 'artifacts', 'recognition-regression', 'latest-results.json'), result);
    await writeJsonAtomic(path.join(repoRoot, 'artifacts', 'recognition-regression', 'latest-live-results.json'), result);
  }
  console.log(JSON.stringify({ runDir, ...result, attempts: undefined, scores: undefined }, null, 2));
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('/recognitionLiveBenchmark.ts');
if (invokedDirectly) main().catch((error) => { console.error(`[recognition-live] ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
