import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFiles } from '../config/loadEnvFiles.js';
import { loadFixtureCorrections, loadRegressionCorpus, loadRegressionGroundTruth } from '../recognitionRegression/fixtures.js';
import { calculateMetrics, scoreCase } from '../recognitionRegression/scoring.js';
import { assertBaselineDoesNotDecrease, enforceRatchet } from '../recognitionRegression/ratchet.js';
import { buildCaseDiff } from '../recognitionRegression/reporting.js';
import { RECOGNITION_CATEGORIES, type BaselineCaseContract, type RatchetBaseline, type RegressionAttempt } from '../recognitionRegression/types.js';
import { writeJsonAtomic } from '../solParity/persistence.js';

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const runArg = argv.indexOf('--run');
  const positional = argv.find((item) => !item.startsWith('--'));
  const run = runArg >= 0 ? argv[runArg + 1] : positional ?? 'artifacts/recognition-regression/runs/current-live-baseline';
  if (!run) throw new Error('missing_run_path');
  const recordBaseline = argv.includes('--record-baseline');
  const updateBaseline = argv.includes('--update-baseline');
  if (recordBaseline && updateBaseline) throw new Error('choose_record_or_update_baseline');
  const repoRoot = loadEnvFiles().repoRoot;
  const runDir = path.resolve(repoRoot, run);
  const resultPath = path.join(runDir, 'results.json');
  const previous = JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown> & { attempts: RegressionAttempt[] };
  if (!Array.isArray(previous.attempts) || previous.attempts.some((attempt) => attempt.cacheReadUsed !== false)) throw new Error('invalid_or_cache_contaminated_attempts');
  const allCorpus = await loadRegressionCorpus(repoRoot);
  const selectedIds = new Set(previous.attempts.map((attempt) => attempt.caseId));
  const corpus = allCorpus.filter((item) => selectedIds.has(item.caseId));
  if (corpus.length !== previous.attempts.length) throw new Error('case_disappeared_during_rescore');
  const categoryById = new Map(corpus.map((item) => [item.caseId, item.category]));
  const attempts = previous.attempts.map((attempt) => ({ ...attempt, category: categoryById.get(attempt.caseId) ?? attempt.category }));
  const truth = await loadRegressionGroundTruth(repoRoot);
  const truthById = new Map(truth.map((item) => [item.caseId, item]));
  const scores = attempts.map((attempt) => scoreCase(attempt, truthById.get(attempt.caseId)!));
  const metrics = calculateMetrics(corpus, attempts, scores);
  const baselinePath = path.join(repoRoot, 'artifacts', 'recognition-regression', 'baseline.json');
  const priorBaseline = JSON.parse(await readFile(baselinePath, 'utf8')) as RatchetBaseline;
  const corrections = await loadFixtureCorrections(repoRoot);
  if (!updateBaseline) enforceRatchet(priorBaseline, scores, corrections);
  const latencyValues = attempts.map((attempt) => attempt.latencyMs).filter((value) => value > 0);
  const costValues = attempts.map((attempt) => attempt.costUsd).filter((value): value is number => value != null);
  const output = {
    ...previous, attempts,
    rescoredAt: new Date().toISOString(), metrics, scores,
    cost: { knownModelSpendUsd: costValues.reduce((sum, value) => sum + value, 0), attemptsWithUnknownModelCost: previous.attempts.length - costValues.length, otherProviderSpendUsd: null },
    latency: { p50Ms: percentile(latencyValues, .5), p95Ms: percentile(latencyValues, .95) },
    safety: { correctAutosaves: scores.filter((score) => score.autoSaveCorrect).length, wrongAutosaves: scores.filter((score) => score.wrongAutosave).length, correctReviews: scores.filter((score) => score.reviewCorrect).length },
    diff: { cases: buildCaseDiff(priorBaseline.caseContracts ?? [], attempts, scores, truthById) },
  };
  await writeJsonAtomic(resultPath, output);
  await writeJsonAtomic(path.join(repoRoot, 'artifacts', 'recognition-regression', 'latest-live-results.json'), output);
  await writeJsonAtomic(path.join(repoRoot, 'artifacts', 'recognition-regression', 'latest-results.json'), output);
  const failureDirs = [path.join(runDir, 'case-results'), path.join(repoRoot, 'artifacts', 'recognition-regression', 'case-results')];
  await Promise.all(failureDirs.map((directory) => mkdir(directory, { recursive: true })));
  for (const directory of failureDirs) {
    const files = await readdir(directory);
    await Promise.all(files.filter((file) => file.endsWith('.json')).map((file) => rm(path.join(directory, file), { force: true })));
  }
  for (const score of scores.filter((item) => item.scorable && !item.exactAt3)) {
    const attempt = attempts.find((item) => item.caseId === score.caseId)!;
    const target = truthById.get(score.caseId)!;
    const artifact = { caseId: score.caseId, category: score.category, groundTruth: target.canonicalName, returnedTop3: attempt.candidates.slice(0, 3), recognitionVersion: attempt.recognitionVersion, evidenceVersion: attempt.evidenceVersion, modelPath: attempt.modelPath, frameManifest: attempt.frameManifest, placesCallCount: attempt.placesCallCount, classification: score.classification, failureClass: score.classification, cacheReadUsed: attempt.cacheReadUsed };
    await Promise.all(failureDirs.map((directory) => writeJsonAtomic(path.join(directory, `${score.caseId}.json`), artifact)));
  }
  if (recordBaseline || updateBaseline) {
    const baseline: RatchetBaseline = {
      schemaVersion: 2, recognitionVersion: String(previous.recognitionVersion ?? 'simple-sol-premium.v2'), recordedAt: new Date().toISOString(),
      passingCaseIds: scores.filter((score) => score.exactAt3).map((score) => score.caseId),
      perCategoryExactAt3Minimum: Object.fromEntries(RECOGNITION_CATEGORIES.map((category) => [category, metrics.perCategory[category].exactAt3])) as RatchetBaseline['perCategoryExactAt3Minimum'],
      productTargetExactAt3Percent: Object.fromEntries(RECOGNITION_CATEGORIES.map((category) => [category, 100])) as RatchetBaseline['productTargetExactAt3Percent'],
      wrongAutosavesMaximum: 0, fixtureCorrections: corrections,
      caseContracts: scores.map((score): BaselineCaseContract => ({ caseId: score.caseId, category: score.category, groundTruth: truthById.get(score.caseId)?.canonicalName ?? '', exactAt1: score.exactAt1, exactAt3: score.exactAt3, top3: attempts.find((item) => item.caseId === score.caseId)?.candidates.slice(0, 3).map((candidate) => candidate.name) ?? [], classification: score.classification })),
    };
    if (recordBaseline) assertBaselineDoesNotDecrease(priorBaseline, baseline);
    if (updateBaseline && !corrections.length) throw new Error('fixture_update_requires_reviewed_correction');
    if (scores.some((score) => score.wrongAutosave)) throw new Error('baseline_has_wrong_autosave');
    await writeJsonAtomic(baselinePath, baseline);
  }
  console.log(JSON.stringify({ runDir, metrics, cost: output.cost, latency: output.latency, safety: output.safety, failed: scores.filter((score) => score.scorable && !score.exactAt3).map((score) => score.caseId) }, null, 2));
}

main().catch((error) => { console.error(`[recognition-rescore] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
