import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFiles } from '../config/loadEnvFiles.js';
import { parseCategory, selectCorpus } from '../recognitionRegression/corpus.js';
import { assertInferenceEnvelope, BenchmarkLifecycle, buildInferenceEnvelope } from '../recognitionRegression/firewall.js';
import { loadFixtureCorrections, loadRegressionCorpus, loadRegressionGroundTruth } from '../recognitionRegression/fixtures.js';
import { assertNoCasesDisappear, persistAttempt } from '../recognitionRegression/persistence.js';
import { replayCurrentRuntime } from '../recognitionRegression/replay.js';
import { assertBaselineDoesNotDecrease, diffCases, enforceRatchet } from '../recognitionRegression/ratchet.js';
import { calculateMetrics, scoreCase } from '../recognitionRegression/scoring.js';
import { RECOGNITION_CATEGORIES, type BaselineCaseContract, type RatchetBaseline, type RecognitionCategory } from '../recognitionRegression/types.js';
import { writeJsonAtomic } from '../solParity/persistence.js';

type Args = { category: RecognitionCategory | null; all: boolean; recordBaseline: boolean; out: string | null };
function parseArgs(argv: string[]): Args {
  const args: Args = { category: null, all: false, recordBaseline: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--category') args.category = parseCategory(argv[++i] ?? '');
    else if (arg === '--all') args.all = true;
    else if (arg === '--record-baseline') args.recordBaseline = true;
    else if (arg === '--out') args.out = argv[++i] ?? null;
    else throw new Error(`unknown_argument:${arg}`);
  }
  if (args.category && args.all) throw new Error('choose_category_or_all');
  if (!args.category) args.all = true;
  return args;
}

async function readBaseline(filePath: string): Promise<RatchetBaseline | null> {
  try { return JSON.parse(await readFile(filePath, 'utf8')) as RatchetBaseline; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = loadEnvFiles().repoRoot;
  const corpus = selectCorpus(await loadRegressionCorpus(repoRoot), args.category);
  corpus.map(buildInferenceEnvelope).forEach(assertInferenceEnvelope);
  const runId = `recognition-replay-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.resolve(repoRoot, args.out ?? path.join('artifacts', 'recognition-regression', 'runs', runId));
  await mkdir(runDir, { recursive: true });
  const lifecycle = new BenchmarkLifecycle();
  lifecycle.inferenceStarted();
  const attempts = await replayCurrentRuntime(repoRoot, corpus, runId);
  const attemptsPath = path.join(runDir, 'attempts.jsonl');
  for (const [index, attempt] of attempts.entries()) await persistAttempt(attemptsPath, attempt, index === 0 ? lifecycle : undefined);
  assertNoCasesDisappear(corpus.map((item) => item.caseId), attempts);
  lifecycle.ranked();

  // Ground truth enters only after every normalized inference result is persisted and ranks are fixed.
  const truth = await loadRegressionGroundTruth(repoRoot);
  lifecycle.truthLoaded();
  const truthById = new Map(truth.map((item) => [item.caseId, item]));
  const scores = attempts.map((attempt) => {
    const target = truthById.get(attempt.caseId);
    if (!target) throw new Error(`missing_ground_truth:${attempt.caseId}`);
    return scoreCase(attempt, target);
  });
  lifecycle.scored();
  const metrics = calculateMetrics(corpus, attempts, scores);
  // Deterministic replay and live inference have separate ratchets: a stochastic live
  // pass must never make the frozen CI replay impossible to run (or vice versa).
  const baselinePath = path.join(repoRoot, 'artifacts', 'recognition-regression', 'deterministic-baseline.json');
  const previous = await readBaseline(baselinePath);
  const fixtureCorrections = await loadFixtureCorrections(repoRoot);
  if (previous && previous.passingCaseIds.length) enforceRatchet(previous, scores, fixtureCorrections);
  const currentBaseline: RatchetBaseline = {
    schemaVersion: 2,
    recognitionVersion: 'simple-sol-premium.v2',
    recordedAt: new Date().toISOString(),
    passingCaseIds: scores.filter((score) => score.exactAt3).map((score) => score.caseId),
    perCategoryExactAt3Minimum: Object.fromEntries(RECOGNITION_CATEGORIES.map((category) => [category, metrics.perCategory[category].exactAt3])) as RatchetBaseline['perCategoryExactAt3Minimum'],
    productTargetExactAt3Percent: Object.fromEntries(RECOGNITION_CATEGORIES.map((category) => [category, 100])) as RatchetBaseline['productTargetExactAt3Percent'],
    wrongAutosavesMaximum: 0,
    fixtureCorrections,
    caseContracts: scores.map((score): BaselineCaseContract => ({
      caseId: score.caseId,
      category: score.category,
      groundTruth: truthById.get(score.caseId)?.canonicalName ?? '',
      exactAt1: score.exactAt1,
      exactAt3: score.exactAt3,
      top3: attempts.find((item) => item.caseId === score.caseId)?.candidates.slice(0, 3).map((candidate) => candidate.name) ?? [],
      classification: score.classification,
    })),
  };
  if (previous?.passingCaseIds.length) assertBaselineDoesNotDecrease(previous, currentBaseline);
  if (args.recordBaseline) await writeJsonAtomic(baselinePath, currentBaseline);
  const correctedIds = new Set(fixtureCorrections.map((item) => item.caseId));
  const diffSummary = previous?.passingCaseIds.length ? diffCases(previous.passingCaseIds.filter((caseId) => !correctedIds.has(caseId)).map((caseId) => ({ ...scores.find((score) => score.caseId === caseId)!, caseId, exactAt1: true, exactAt3: true })), scores) : diffCases([], scores);
  const previousById = new Map((previous?.caseContracts ?? []).map((item) => [item.caseId, item]));
  const caseDiff = scores.map((score) => {
    const before = previousById.get(score.caseId);
    const attempt = attempts.find((item) => item.caseId === score.caseId)!;
    const status = score.classification === 'TECHNICAL_FAILURE' ? 'TECHNICAL'
      : score.classification === 'BROAD_AREA_ONLY' ? 'AREA_ONLY'
      : !before ? (score.exactAt3 ? 'NEWLY_FIXED' : 'UNCHANGED_FAIL')
      : before.exactAt3 && !score.exactAt3 && correctedIds.has(score.caseId) ? 'UNCHANGED_FAIL'
      : before.exactAt3 && !score.exactAt3 ? 'REGRESSED'
      : !before.exactAt3 && score.exactAt3 ? 'NEWLY_FIXED'
      : score.exactAt3 ? 'UNCHANGED_PASS' : 'UNCHANGED_FAIL';
    return { caseId: score.caseId, category: score.category, status, groundTruth: truthById.get(score.caseId)?.canonicalName ?? '', previousTop3: before?.top3 ?? [], newTop3: attempt.candidates.slice(0, 3).map((candidate) => candidate.name), classification: score.classification };
  });
  const latencies = attempts.map((item) => item.latencyMs).filter((value) => value > 0);
  const output = {
    schemaVersion: 2, runId, mode: 'DETERMINISTIC_FROZEN_REPLAY', generatedAt: new Date().toISOString(),
    groundTruthLoadedAfterPersistence: true, cacheReadUsed: false, actualSavePerformed: false,
    casesRequested: corpus.length, attemptsPersisted: attempts.length, metrics, diff: { summary: diffSummary, cases: caseDiff }, scores,
    cost: { modelSpendUsd: attempts.every((item) => item.costUsd != null) ? attempts.reduce((sum, item) => sum + (item.costUsd ?? 0), 0) : null, otherProviderSpendUsd: null },
    latency: { p50Ms: percentile(latencies, .5), p95Ms: percentile(latencies, .95) },
  };
  await writeJsonAtomic(path.join(runDir, 'results.json'), output);
  await writeJsonAtomic(path.join(repoRoot, 'artifacts', 'recognition-regression', 'latest-deterministic-results.json'), output);
  const failures = scores.filter((score) => score.scorable && !score.exactAt3);
  for (const score of failures) {
    const attempt = attempts.find((item) => item.caseId === score.caseId)!;
    const target = truthById.get(score.caseId)!;
    await writeJsonAtomic(path.join(runDir, 'case-results', `${score.caseId}.json`), {
      caseId: score.caseId, category: score.category, groundTruth: target.canonicalName,
      returnedTop3: attempt.candidates.slice(0, 3), recognitionVersion: attempt.recognitionVersion,
      evidenceVersion: attempt.evidenceVersion, modelPath: attempt.modelPath, frameManifest: attempt.frameManifest,
      placesCallCount: attempt.placesCallCount, classification: score.classification, failureClass: score.classification,
      cacheReadUsed: attempt.cacheReadUsed,
    });
  }
  console.log(JSON.stringify({ runId, runDir, cases: corpus.length, metrics, diff: diffSummary, cost: output.cost, latency: output.latency }, null, 2));
}

main().catch((error) => { console.error(`[recognition-regression] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
