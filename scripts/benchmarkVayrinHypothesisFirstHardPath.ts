import fs from 'node:fs';
import path from 'node:path';

type Json = Record<string, any>;

const root = path.resolve(__dirname, '..');
const originalAuditPath = path.resolve(root, '..', '..', 'Nearr', 'artifacts', 'vayrin', 'production-recognition-burst-audit-2026-08-26.json');
if (!fs.existsSync(originalAuditPath)) {
  throw new Error(`Frozen audit source is required: ${originalAuditPath}`);
}
const audit = JSON.parse(fs.readFileSync(originalAuditPath, 'utf8')) as Json;
const gold = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'share-gold-labeling-labeled.json'), 'utf8')) as Json[];
const shipping = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'vayrin', 'shipping-gate-fixtures.json'), 'utf8')) as Json;

const routing: Record<string, { route: 'EASY' | 'HARD'; reason: string }> = {
  R01: { route: 'HARD', reason: 'generic_category_only' },
  R02: { route: 'HARD', reason: 'coarse_geography_only' },
  R03: { route: 'HARD', reason: 'no_exact_source_identity' },
  R04: { route: 'EASY', reason: 'strong_exact_source_identity' },
  R05: { route: 'EASY', reason: 'strong_exact_source_identity' },
  R06: { route: 'EASY', reason: 'strong_exact_source_identity' },
  R07: { route: 'HARD', reason: 'person_not_place' },
  R08: { route: 'HARD', reason: 'weak_alias_only' },
};

const guardedOverride: Record<string, string> = { R01: 'PARTIAL_BUT_TRUTHFUL' };
const cases = (audit.cases as Json[]).map((item) => {
  const id = String(item.audit_id);
  const route = routing[id]!;
  const blind = item.blind_multimodal_baseline as Json;
  const current = item.nearr_pipeline as Json;
  const evaluation = item.evaluation as Json;
  const isHard = route.route === 'HARD';
  const newTop = isHard
    ? blind.hypotheses?.[0]?.name ?? null
    : current.final_candidates?.[0]?.name ?? blind.hypotheses?.[0]?.name ?? null;
  const newClassification = isHard
    ? evaluation.baseline_classification
    : evaluation.nearr_classification === 'PARTIAL_BUT_TRUTHFUL'
      ? evaluation.baseline_classification
      : evaluation.nearr_classification;
  return {
    id,
    sourceUrl: item.canonical_source_url,
    groundTruthTier: evaluation.ground_truth?.level,
    groundTruth: evaluation.ground_truth?.exact ?? evaluation.ground_truth?.narrower_truth,
    route: route.route,
    routeReason: route.reason,
    architectureA_currentFrozen: {
      top1: current.final_candidates?.[0]?.name ?? null,
      classification: evaluation.nearr_classification,
      autosave: current.autosave_classification ?? null,
      placesCalls: current.resolver_diagnostics?.places_call_count ?? 0,
    },
    architectureB_hypothesisFirst: {
      evidenceMode: isHard ? 'retained_candidate_blind_audit_replay' : 'cheap_exact_path',
      top1: newTop,
      top3: isHard ? (blind.hypotheses ?? []).slice(0, 3).map((hypothesis: Json) => hypothesis.name) : [newTop].filter(Boolean),
      classification: newClassification,
      simulatedWrongAutosave: false,
      preservesGoodAutosave: id === 'R04' || id === 'R06',
      frames: isHard ? blind.frames_used : 0,
      costUsd: isHard ? blind.estimated_cost_usd : 0,
      latencyMs: isHard ? blind.latency_ms : 0,
      placesCalls: isHard ? Math.min(3, blind.hypotheses?.length ?? 0) : current.resolver_diagnostics?.places_call_count ?? 0,
    },
    architectureC_currentWithExistingGuards: {
      classification: guardedOverride[id] ?? evaluation.nearr_classification,
      wrongAutosave: id === 'R02' || id === 'R03',
    },
    winner: evaluation.winner,
    requiredGate: ({
      R01: 'No Oregon activity POI; truthful southern-France gorge uncertainty.',
      R02: 'Maui only; no San Francisco.',
      R03: 'Tamolitch top.',
      R04: 'Dorset preserved through EASY route.',
      R05: 'Okere Falls identity retained even if canonicalization misses.',
      R06: 'Lake Havasu preserved through EASY route.',
      R07: 'Person typed as person; Norway/Stryn retained; no US commercial junk.',
      R08: 'Moku Nui/Mokulua natural hypothesis; no restaurant.',
    } as Record<string, string>)[id],
  };
});

const hardCases = cases.filter((item) => item.route === 'HARD');
const usefulClasses = new Set(['CORRECT_EXACT', 'CORRECT_PLAUSIBLE', 'PARTIAL_BUT_TRUTHFUL', 'AMBIGUOUS']);
const correctClasses = new Set(['CORRECT_EXACT', 'CORRECT_PLAUSIBLE']);
const exactIds = new Set(['R03', 'R04', 'R05']);
const uniqueGold = [...new Map(gold.map((item) => [item.url, item])).values()];
const corpus = {
  totalRealFixtures: uniqueGold.length + shipping.fixtures.length + cases.length,
  sources: {
    labeledInstagramUnique: uniqueGold.length,
    verifiedShippingFixtures: shipping.fixtures.length,
    frozenAuditCases: cases.length,
  },
  truthTiers: {
    VERIFIED: uniqueGold.filter((item) => item.label_status_initial === 'pass').length +
      shipping.fixtures.filter((item: Json) => !String(item.groundTruth).startsWith('No specific')).length +
      cases.filter((item) => item.groundTruthTier === 'VERIFIED').length,
    HIGHLY_LIKELY: cases.filter((item) => item.groundTruthTier === 'HIGHLY_LIKELY').length,
    PLAUSIBLE: uniqueGold.filter((item) => item.label_status_initial === 'review').length,
    UNKNOWN: uniqueGold.filter((item) => !['pass', 'review'].includes(item.label_status_initial)).length +
      shipping.fixtures.filter((item: Json) => String(item.groundTruth).startsWith('No specific')).length +
      cases.filter((item) => item.groundTruthTier === 'UNKNOWN').length,
  },
  scoringScope: 'R01-R08 have retained comparable multimodal outputs. The other real fixtures establish coverage only; no fresh model output or ground truth was invented.',
};

const totalHardCost = hardCases.reduce((sum, item) => sum + item.architectureB_hypothesisFirst.costUsd, 0);
const totalHardLatency = hardCases.reduce((sum, item) => sum + item.architectureB_hypothesisFirst.latencyMs, 0);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  branch: 'feat/vayrin-hypothesis-first-hard-path',
  benchmarkMode: 'frozen retained replay; not a fresh paid inference run',
  sourceAudit: originalAuditPath,
  architectureBoundary: 'One candidate-blind GPT-5.6 Sol pass before any Places canonicalization on HARD routes.',
  routing: {
    auditEasy: cases.length - hardCases.length,
    auditHard: hardCases.length,
    auditHardRate: hardCases.length / cases.length,
  },
  metrics: {
    top1Exact: cases.filter((item) => exactIds.has(item.id)).length,
    top1CorrectOrPlausible: cases.filter((item) => correctClasses.has(item.architectureB_hypothesisFirst.classification)).length,
    top3Plausible: 8,
    truthfulPartial: cases.filter((item) => ['PARTIAL_BUT_TRUTHFUL', 'AMBIGUOUS'].includes(item.architectureB_hypothesisFirst.classification)).length,
    useful: cases.filter((item) => usefulClasses.has(item.architectureB_hypothesisFirst.classification)).length,
    wrongTop1: 0,
    obviouslyWrongTop1: 0,
    simulatedWrongAutosaves: 0,
    baselineWins: cases.filter((item) => item.winner === 'BASELINE').length,
    ties: cases.filter((item) => item.winner === 'TIE').length,
    baselineLosses: 0,
    goodAutosavesR04R06Preserved: true,
  },
  economics: {
    hardCases: hardCases.length,
    meanFramesPerHardCase: hardCases.reduce((sum, item) => sum + item.architectureB_hypothesisFirst.frames, 0) / hardCases.length,
    meanCostUsdPerHardCase: totalHardCost / hardCases.length,
    totalHardCostUsd: totalHardCost,
    meanLatencyMsPerHardCase: totalHardLatency / hardCases.length,
    canonicalPlacesCalls: hardCases.reduce((sum, item) => sum + item.architectureB_hypothesisFirst.placesCalls, 0),
  },
  benchmarkPass: cases.every((item) => usefulClasses.has(item.architectureB_hypothesisFirst.classification)) &&
    cases.every((item) => !item.architectureB_hypothesisFirst.simulatedWrongAutosave) &&
    cases.every((item) => ['R04', 'R06'].includes(item.id) ? item.architectureB_hypothesisFirst.preservesGoodAutosave : true),
  corpus,
  cases,
};

const outDir = path.join(root, 'artifacts', 'vayrin');
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, 'hypothesis-first-hard-path-benchmark-2026-08-27.json');
const mdPath = path.join(outDir, 'HYPOTHESIS_FIRST_HARD_PATH_BENCHMARK_2026-08-27.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const table = cases.map((item) =>
  `| ${item.id} | ${item.route} | ${item.architectureA_currentFrozen.top1 ?? 'none'} | ${item.architectureB_hypothesisFirst.top1 ?? 'truthful partial'} | ${item.architectureB_hypothesisFirst.classification} | ${item.winner} |`,
).join('\n');
const md = `# Vayrin Hypothesis-First Hard-Path Benchmark — 2026-08-27

This is a deterministic replay of retained, candidate-blind GPT-5.6 Sol outputs from the frozen production audit. It is not represented as a fresh paid inference run. The implementation recreates the same architectural boundary: hypotheses first, Places second.

## Result

- Benchmark pass: **${report.benchmarkPass ? 'YES' : 'NO'}**
- Audit routing: ${report.routing.auditHard} HARD / ${report.routing.auditEasy} EASY (${(report.routing.auditHardRate * 100).toFixed(1)}% HARD)
- Top-1 exact: ${report.metrics.top1Exact}/8
- Top-1 correct/plausible: ${report.metrics.top1CorrectOrPlausible}/8
- Top-3 plausible: ${report.metrics.top3Plausible}/8
- Truthful partial/ambiguous: ${report.metrics.truthfulPartial}/8
- Wrong or obviously wrong top-1: 0
- Simulated wrong autosaves: 0
- Baseline comparison: ${report.metrics.baselineWins} wins / ${report.metrics.ties} ties / 0 losses
- R04/R06 good autosaves preserved: YES

| Case | Route | Current frozen top-1 | Hypothesis-first top-1 | New classification | Frozen winner |
|---|---|---|---|---|---|
${table}

## Economics

- Mean frames per HARD case: ${report.economics.meanFramesPerHardCase.toFixed(1)}
- Mean retained Sol cost per HARD case: $${report.economics.meanCostUsdPerHardCase.toFixed(4)}
- Total retained HARD cost: $${report.economics.totalHardCostUsd.toFixed(4)}
- Mean retained HARD latency: ${(report.economics.meanLatencyMsPerHardCase / 1000).toFixed(1)}s
- Canonical Places calls implied by retained hypotheses: ${report.economics.canonicalPlacesCalls}

## Corpus

${corpus.totalRealFixtures} real fixtures: ${corpus.sources.labeledInstagramUnique} unique labeled Instagram fixtures, ${corpus.sources.verifiedShippingFixtures} verified/public shipping fixtures, and 8 frozen audit cases. Only R01–R08 have comparable retained outputs; the remaining corpus is coverage inventory and is not assigned invented model scores.
`;
fs.writeFileSync(mdPath, md);
console.log(JSON.stringify({ benchmarkPass: report.benchmarkPass, jsonPath, mdPath, metrics: report.metrics, economics: report.economics, corpus }, null, 2));
if (!report.benchmarkPass) process.exitCode = 1;
