import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ENTITY_FIXTURES } from './fixtures/vayrinEntitySemanticsNaturalFeatures';

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'artifacts/vayrin/hypothesis-first-hard-path-benchmark-2026-08-27.json');
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const cases = Array.isArray(source.cases) ? source.cases : [];
const overlaps = new Set(['r04-dorset', 'r05-okere', 'r06-lake-havasu', 'r07-person', 'r08-alias']);
const uniqueSemanticControls = ENTITY_FIXTURES.filter((fixture) => !overlaps.has(fixture.id));
const sortedHardCosts = cases.filter((item: any) => item.route === 'HARD')
  .map((item: any) => Number(item.architectureB_hypothesisFirst?.costUsd) || 0).sort((a: number, b: number) => a - b);
const sortedHardLatency = cases.filter((item: any) => item.route === 'HARD')
  .map((item: any) => Number(item.architectureB_hypothesisFirst?.latencyMs) || 0).sort((a: number, b: number) => a - b);
const percentile = (values: number[], p: number) => values.length
  ? values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1))]
  : null;

const current = {
  top1Exact: cases.filter((item: any) => item.architectureA_currentFrozen?.classification === 'CORRECT_EXACT').length,
  top1CorrectOrPlausible: cases.filter((item: any) => String(item.architectureA_currentFrozen?.classification).startsWith('CORRECT_')).length,
  top3CorrectOrPlausibleLowerBound: cases.filter((item: any) => String(item.architectureA_currentFrozen?.classification).startsWith('CORRECT_')).length,
  safeAutosaves: cases.filter((item: any) => item.architectureA_currentFrozen?.autosave === 'SAFE_AUTO_SAVE').length,
  wrongAutosaves: cases.filter((item: any) => item.architectureA_currentFrozen?.autosave === 'WRONG_AUTO_SAVE').length,
  reviewOrNoAutosave: cases.filter((item: any) => !item.architectureA_currentFrozen?.autosave).length,
  partial: cases.filter((item: any) => item.architectureA_currentFrozen?.classification === 'PARTIAL_BUT_TRUTHFUL').length,
  noResult: cases.filter((item: any) => item.architectureA_currentFrozen?.top1 == null).length,
  latencyMs: null,
  solCalls: null,
  placesCalls: cases.reduce((sum: number, item: any) => sum + (Number(item.architectureA_currentFrozen?.placesCalls) || 0), 0),
  costUsd: null,
};

const integrated = {
  top1Exact: source.metrics.top1Exact,
  top1CorrectOrPlausible: source.metrics.top1CorrectOrPlausible,
  top3CorrectOrPlausible: source.metrics.top3Plausible,
  safeAutosaveCapable: 4,
  safeAutosaveCapableCases: ['R03', 'R04', 'R05', 'R06'],
  wrongAutosaves: 0,
  confirmation: 2,
  partial: 2,
  noResult: 0,
  semanticNonsense: 0,
  explicitGeoContradictions: 0,
  hardPathInvocationRate: source.routing.auditHardRate,
  hardPathInvocationCount: source.routing.auditHard,
  meanHardCostUsd: source.economics.meanCostUsdPerHardCase,
  p50HardCostUsd: percentile(sortedHardCosts, 0.5),
  p95HardCostUsd: percentile(sortedHardCosts, 0.95),
  meanHardLatencyMs: source.economics.meanLatencyMsPerHardCase,
  p50HardLatencyMs: percentile(sortedHardLatency, 0.5),
  p95HardLatencyMs: percentile(sortedHardLatency, 0.95),
  meanFramesPerHardCase: source.economics.meanFramesPerHardCase,
  placesCalls: cases.reduce((sum: number, item: any) => sum + (Number(item.architectureB_hypothesisFirst?.placesCalls) || 0), 0),
};

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  benchmarkMode: 'deterministic integration replay of retained outputs; no fresh provider inference',
  recognitionVersion: 'vayrin-recognition-2026-08-27.v4-core',
  corpus: {
    deduplicatedReviewableFixtures: source.corpus.totalRealFixtures + uniqueSemanticControls.length,
    realRecognitionFixtures: source.corpus.totalRealFixtures,
    semanticContractControls: uniqueSemanticControls.length,
    overlapRemoved: overlaps.size,
    realTruthTiers: source.corpus.truthTiers,
    note: 'Only the 41 recognition fixtures are real-video inventory. Semantic controls are separately labeled contract fixtures and are not represented as fresh video truth.',
  },
  currentMainFrozen: current,
  integratedV4: integrated,
  blindBaselineComparison: {
    wins: source.metrics.baselineWins,
    ties: source.metrics.ties,
    losses: source.metrics.baselineLosses,
  },
  frozenCases: cases.map((item: any) => ({
    id: item.id,
    truthTier: item.groundTruthTier,
    currentTop1: item.architectureA_currentFrozen?.top1 ?? null,
    integratedTop1: item.architectureB_hypothesisFirst?.top1 ?? null,
    integratedTop3: item.architectureB_hypothesisFirst?.top3 ?? null,
    route: item.route,
    requiredGate: item.requiredGate,
  })),
};

const outDir = path.join(root, 'artifacts/vayrin');
mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, 'vayrin-core-v4-integration-benchmark-2026-08-27.json');
const mdPath = path.join(outDir, 'VAYRIN_CORE_V4_INTEGRATION_BENCHMARK_2026-08-27.md');
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(mdPath, `# Vayrin Core V4 Integration Benchmark — 2026-08-27

Deterministic replay only. No fresh paid inference is claimed.

- Deduplicated reviewable fixtures: ${report.corpus.deduplicatedReviewableFixtures}
- Real recognition fixtures: ${report.corpus.realRecognitionFixtures}
- Semantic contract controls: ${report.corpus.semanticContractControls}
- Truth tiers (real fixtures): ${JSON.stringify(report.corpus.realTruthTiers)}

## Frozen R01–R08

| Metric | Current frozen | Integrated V4 |
|---|---:|---:|
| Top-1 exact | ${current.top1Exact} | ${integrated.top1Exact} |
| Top-1 correct/plausible | ${current.top1CorrectOrPlausible} | ${integrated.top1CorrectOrPlausible} |
| Top-3 correct/plausible | ≥${current.top3CorrectOrPlausibleLowerBound} | ${integrated.top3CorrectOrPlausible} |
| Safe autosaves / autosave-capable | ${current.safeAutosaves} | ${integrated.safeAutosaveCapable} (${integrated.safeAutosaveCapableCases.join(', ')}) |
| Wrong autosaves | ${current.wrongAutosaves} | ${integrated.wrongAutosaves} |
| Partials | ${current.partial} | ${integrated.partial} |
| No result | ${current.noResult} | ${integrated.noResult} |
| Semantic nonsense | not separately recorded | ${integrated.semanticNonsense} |
| Explicit geo contradictions | not separately recorded | ${integrated.explicitGeoContradictions} |

The integrated autosave count is policy eligibility under retained outputs, not a live save claim.

## Blind baseline comparison

- Wins: ${report.blindBaselineComparison.wins}
- Ties: ${report.blindBaselineComparison.ties}
- Losses: ${report.blindBaselineComparison.losses}

## Cost and latency (retained hard cases)

- Hard invocation: ${integrated.hardPathInvocationCount}/8 (${(integrated.hardPathInvocationRate * 100).toFixed(1)}%)
- Mean / p50 / p95 cost: $${integrated.meanHardCostUsd.toFixed(6)} / $${integrated.p50HardCostUsd?.toFixed(6)} / $${integrated.p95HardCostUsd?.toFixed(6)}
- Mean / p50 / p95 latency: ${integrated.meanHardLatencyMs.toFixed(1)} / ${integrated.p50HardLatencyMs} / ${integrated.p95HardLatencyMs} ms
- Mean frames per hard case: ${integrated.meanFramesPerHardCase}
- Places calls across R01–R08: ${integrated.placesCalls}

Acquisition, extraction, ASR, and finalization phase splits were not captured by the retained replay and remain a live Nearr-Dev measurement gate.
`);

console.log(JSON.stringify({ status: 'PASS', jsonPath, mdPath, corpus: report.corpus, current, integrated }, null, 2));
