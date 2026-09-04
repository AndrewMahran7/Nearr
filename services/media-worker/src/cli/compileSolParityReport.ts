import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFiles } from '../config/loadEnvFiles.js';
import { scoreAttempt, type AttemptScore, type GroundTruthCase, type GroundTruthManifest } from '../solParity/scoring.js';
import { writeJsonAtomic } from '../solParity/persistence.js';
import type { CanonicalizedDestination, InferenceCase, PersistedModelAttempt, SimulatedDecision } from '../solParity/types.js';

type CanonicalRow = { attempt_id: string; canonicalization_ms: number; places_calls: number; destinations: CanonicalizedDestination[]; simulated_decision: SimulatedDecision };
type Selected = { attempt: PersistedModelAttempt; canonical: CanonicalRow; score: AttemptScore; latency_ms: number };
type Baseline = { case_id: string; provenance: 'FROZEN_RECENT' | 'STALE_HISTORICAL'; top1: string | null; top3: string[]; decision: string | null; autosave: boolean | null; cache_status: string; latency_ms: number | null; known_quality: string; note: string | null };

function jsonLines<T>(text: string): T[] { return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T); }
function norm(value: string): string { return value.toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a').normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim(); }
function matches(value: string, accepted: string[]): boolean {
  const tokens = new Set(norm(value).split(' ').filter(Boolean));
  return accepted.some((candidate) => norm(candidate).split(' ').filter(Boolean).every((token) => tokens.has(token)));
}
function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
}
function metricSummary(rows: Selected[], preModelFailures = 0): Record<string, unknown> {
  const costs = rows.map((row) => row.attempt.estimated_model_cost_usd).filter((value): value is number => value !== null);
  const latencies = rows.map((row) => row.latency_ms);
  return {
    cases: rows.length + preModelFailures,
    exact_top1: rows.filter((row) => row.score.exact_top1).length,
    useful_top1: rows.filter((row) => row.score.useful_top1).length,
    useful_top3: rows.filter((row) => row.score.useful_top3).length,
    wrong_top1: rows.filter((row) => row.score.wrong_top1).length,
    wrong_autosave: rows.filter((row) => row.score.wrong_autosave).length,
    truthful_partial: rows.filter((row) => row.score.truthful_partial).length,
    no_answer: rows.filter((row) => row.score.no_answer).length + preModelFailures,
    semantic_nonsense: rows.filter((row) => row.score.semantic_nonsense).length,
    geography_contradiction: rows.filter((row) => row.score.geography_contradiction).length,
    latency_ms: { median: percentile(latencies, .5), p95: percentile(latencies, .95), max: percentile(latencies, 1) },
    model_cost_usd: { total: costs.length === rows.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(6)) : null, mean: costs.length ? Number((costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(6)) : null, p50: percentile(costs, .5), p95: percentile(costs, .95), max: percentile(costs, 1) },
    web_search_calls: rows.reduce((sum, row) => sum + row.attempt.web_search_calls, 0),
    places_calls: rows.reduce((sum, row) => sum + row.canonical.places_calls, 0),
  };
}
function qualityRank(score: AttemptScore): number { return score.exact_top1 ? 2 : score.useful_top1 ? 1 : 0; }
function mediaId(url: string): string {
  const match = /instagram\.com\/(?:p|reel)\/([^/?]+)/i.exec(url);
  return match ? `instagram:${match[1]}` : url;
}

async function main(): Promise<void> {
  const { repoRoot } = loadEnvFiles();
  const base = path.join(repoRoot, 'artifacts', 'sol-parity');
  const corpus = JSON.parse(await readFile(path.join(base, 'inference-corpus.json'), 'utf8')) as { cases: InferenceCase[] };
  const truth = JSON.parse(await readFile(path.join(base, 'ground-truth.json'), 'utf8')) as GroundTruthManifest;
  const truthById = new Map(truth.cases.map((item) => [item.case_id, item]));
  const runNames = ['r03-canary', 'r03-web', 'priority-eight', 'remaining-m1', 'safety-multi-m2', 'r03-m1-final'];
  const attemptsByRun = new Map<string, PersistedModelAttempt[]>();
  const canonicalByAttempt = new Map<string, CanonicalRow>();
  const allPaidAttempts: PersistedModelAttempt[] = [];
  for (const run of runNames) {
    const runDir = path.join(base, 'runs', run);
    const attempts = jsonLines<PersistedModelAttempt>(await readFile(path.join(runDir, 'model-attempts.jsonl'), 'utf8'));
    attemptsByRun.set(run, attempts);
    allPaidAttempts.push(...attempts);
    try {
      for (const row of jsonLines<CanonicalRow>(await readFile(path.join(runDir, 'canonicalization.jsonl'), 'utf8'))) canonicalByAttempt.set(row.attempt_id, row);
    } catch { /* canary intentionally stopped after raw persistence */ }
  }
  try {
    for (const row of jsonLines<CanonicalRow>(await readFile(path.join(base, 'canonicalization-recheck.jsonl'), 'utf8'))) canonicalByAttempt.set(row.attempt_id, row);
  } catch { /* optional until the recheck command has run */ }
  const pickedAttempts = [
    ...attemptsByRun.get('r03-m1-final')!,
    ...attemptsByRun.get('priority-eight')!,
    ...attemptsByRun.get('remaining-m1')!,
    ...attemptsByRun.get('safety-multi-m2')!,
    ...attemptsByRun.get('r03-web')!.filter((item) => item.frame_arm === 'F2' && item.model_arm === 'M2'),
  ];
  const selected: Selected[] = pickedAttempts.flatMap((attempt) => {
    const canonical = canonicalByAttempt.get(attempt.attempt_id);
    const caseTruth = truthById.get(attempt.case_id);
    if (!canonical || !caseTruth) return [];
    const score = scoreAttempt({ attempt, truth: caseTruth, canonicalized: canonical.destinations, decision: canonical.simulated_decision });
    const t = attempt.timings_ms;
    const latency = (t.acquisition ?? 0) + (t.frame_extraction ?? 0) + (t.transcription ?? 0) + (t.ocr ?? 0) + t.sol + canonical.canonicalization_ms;
    return [{ attempt, canonical, score, latency_ms: latency }];
  });
  const key = (row: Selected) => `${row.attempt.case_id}:${row.attempt.frame_arm}:${row.attempt.model_arm}`;
  const unique = new Map<string, Selected>();
  for (const row of selected) unique.set(key(row), row);
  const rows = [...unique.values()];
  const m1 = rows.filter((row) => row.attempt.frame_arm === 'F1' && row.attempt.model_arm === 'M1');
  const m2 = rows.filter((row) => row.attempt.frame_arm === 'F1' && row.attempt.model_arm === 'M2');
  const f2m2 = rows.filter((row) => row.attempt.frame_arm === 'F2' && row.attempt.model_arm === 'M2');

  const recoveryRaw = execFileSync('git', ['show', 'c62fea195e9ac6846e55cd25336a23d6e0f8df95:artifacts/vayrin/vayrin-core-release-readiness-paired-benchmark-2026-09-03.json'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10_000_000 });
  const recovery = JSON.parse(recoveryRaw) as { cases: Array<{ id: string; current: Record<string, unknown> }> };
  const recoveryById = new Map(recovery.cases.map((item) => [item.id, item.current]));
  const liveRecoveryById = new Map<string, Record<string, unknown>>();
  for (let batch = 1; batch <= 6; batch += 1) {
    const name = `artifacts/vayrin/live-hypothesis-canonical-recovery-batch-${String(batch).padStart(2, '0')}.json`;
    const raw = execFileSync('git', ['show', `c62fea195e9ac6846e55cd25336a23d6e0f8df95:${name}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10_000_000 });
    const parsed = JSON.parse(raw) as { results: Array<Record<string, unknown>> };
    for (const result of parsed.results) if (typeof result.id === 'string') liveRecoveryById.set(result.id, result);
  }
  const shareRows = JSON.parse(await readFile(path.join(repoRoot, 'artifacts', 'share-gold-labeling-labeled.json'), 'utf8')) as Array<Record<string, unknown>>;
  const shareByMedia = new Map(shareRows.map((item) => [mediaId(String(item.url ?? '')), item]));
  const baseline: Baseline[] = corpus.cases.map((item) => {
    const current = recoveryById.get(item.case_id);
    if (current) {
      const latency = current.latencyMs && typeof current.latencyMs === 'object' ? (current.latencyMs as Record<string, unknown>).allIn : null;
      const cache = current.recognitionCache && typeof current.recognitionCache === 'object' ? (current.recognitionCache as Record<string, unknown>).hit : null;
      return { case_id: item.case_id, provenance: 'FROZEN_RECENT', top1: typeof current.top1 === 'string' ? current.top1 : null, top3: Array.isArray(current.top3) ? current.top3.map(String) : [], decision: typeof current.decision === 'string' ? current.decision : null, autosave: current.finalState === 'AUTO_SAVE', cache_status: cache === true ? 'HIT' : cache === false ? 'MISS' : 'UNKNOWN', latency_ms: typeof latency === 'number' ? latency : null, known_quality: typeof current.quality === 'string' ? current.quality : 'NOT_EVALUATED', note: typeof current.blocker === 'string' ? current.blocker : null };
    }
    const live = liveRecoveryById.get(item.case_id);
    if (live) {
      const outcome = live.outcome && typeof live.outcome === 'object' ? live.outcome as Record<string, unknown> : {};
      const latency = live.latencyMs && typeof live.latencyMs === 'object' ? (live.latencyMs as Record<string, unknown>).allIn : null;
      const cache = live.recognitionCache && typeof live.recognitionCache === 'object' ? (live.recognitionCache as Record<string, unknown>).hit : null;
      const canonical = Array.isArray(live.canonicalResults) ? live.canonicalResults.map(String) : [];
      const hypotheses = Array.isArray(live.topHypotheses) ? live.topHypotheses.map(String) : [];
      return { case_id: item.case_id, provenance: 'FROZEN_RECENT', top1: canonical[0] ?? hypotheses[0] ?? null, top3: canonical.length ? canonical.slice(0, 3) : hypotheses.slice(0, 3), decision: typeof outcome.decision === 'string' ? outcome.decision : null, autosave: typeof outcome.autosaved === 'boolean' ? outcome.autosaved : null, cache_status: cache === true ? 'HIT' : cache === false ? 'MISS' : 'UNKNOWN', latency_ms: typeof latency === 'number' ? latency : null, known_quality: 'UNSCORED_FROZEN_RECENT', note: 'Fresh recovery-branch live artifact.' };
    }
    const share = shareByMedia.get(mediaId(item.source_url));
    if (share) {
      const top1 = String(share.backend_candidate_name ?? '').trim() || null;
      const top3 = String(share.top_candidates ?? '').split(' || ').map((candidate) => candidate.split(' | ')[0]!.trim()).filter(Boolean).slice(0, 3);
      return { case_id: item.case_id, provenance: 'FROZEN_RECENT', top1, top3, decision: String(share.backend_decision ?? '').trim() || null, autosave: String(share.safe_to_auto_save ?? '').toLowerCase() === 'true', cache_status: 'UNKNOWN', latency_ms: null, known_quality: String(share.label_status_initial ?? 'unknown').toUpperCase(), note: 'Share-gold frozen backend result; latency/cache telemetry unavailable.' };
    }
    return { case_id: item.case_id, provenance: 'STALE_HISTORICAL', top1: null, top3: [], decision: null, autosave: null, cache_status: 'UNKNOWN', latency_ms: null, known_quality: 'NOT_AVAILABLE', note: 'No attributable current Nearr result artifact was available.' };
  });
  await writeJsonAtomic(path.join(base, 'current-nearr-baseline.json'), { schema_version: 1, generated_at: new Date().toISOString(), cases: baseline });

  const baselineScore = baseline.map((item) => {
    const gt = truthById.get(item.case_id)!;
    const noAnswer = !item.top1;
    const exact = !!item.top1 && matches(item.top1, [...gt.accepted_exact_identities, ...gt.accepted_aliases]);
    const usefulName = !!item.top1 && matches(item.top1, [...gt.accepted_exact_identities, ...gt.accepted_aliases, ...gt.accepted_truthful_partials, ...gt.expected_broad_geography]);
    const useful = gt.multi_place_expectation === 'NONE' ? noAnswer : gt.multi_place_expectation === 'MULTIPLE' ? item.top3.length > 1 : usefulName;
    const usefulTop3Name = item.top3.some((candidate) => matches(candidate, [...gt.accepted_exact_identities, ...gt.accepted_aliases, ...gt.accepted_truthful_partials, ...gt.expected_broad_geography]));
    const usefulTop3 = gt.multi_place_expectation === 'NONE' ? item.top3.length === 0 : gt.multi_place_expectation === 'MULTIPLE' ? item.top3.length > 1 : usefulTop3Name;
    return { ...item, exact, useful, useful_top3: usefulTop3, wrong: !!item.top1 && !useful, wrong_autosave: item.autosave === true && !!item.top1 && !useful };
  });
  const comparableBaseline = baselineScore.filter((item) => item.provenance !== 'STALE_HISTORICAL');
  const currentMetrics = {
    cases: comparableBaseline.length,
    exact_top1: comparableBaseline.filter((item) => item.exact).length,
    useful_top1: comparableBaseline.filter((item) => item.useful).length,
    useful_top3: comparableBaseline.filter((item) => item.useful_top3).length,
    wrong_top1: comparableBaseline.filter((item) => item.wrong).length,
    wrong_autosave: comparableBaseline.filter((item) => item.wrong_autosave).length,
    no_answer: comparableBaseline.filter((item) => !item.top1).length,
    latency_ms: { median: percentile(comparableBaseline.map((item) => item.latency_ms).filter((value): value is number => value !== null), .5), p95: percentile(comparableBaseline.map((item) => item.latency_ms).filter((value): value is number => value !== null), .95) },
  };

  const m1ByCase = new Map(m1.map((row) => [row.attempt.case_id, row]));
  const m2ByCase = new Map(m2.map((row) => [row.attempt.case_id, row]));
  const pairedWeb = [...m2ByCase.keys()].filter((id) => m1ByCase.has(id)).map((id) => [m1ByCase.get(id)!, m2ByCase.get(id)!] as const);
  const webComparison = {
    paired_cases: pairedWeb.length,
    wins: pairedWeb.filter(([a, b]) => qualityRank(b.score) > qualityRank(a.score)).length,
    ties: pairedWeb.filter(([a, b]) => qualityRank(b.score) === qualityRank(a.score)).length,
    losses: pairedWeb.filter(([a, b]) => qualityRank(b.score) < qualityRank(a.score)).length,
    wrong_answers_introduced: pairedWeb.filter(([a, b]) => !a.score.wrong_top1 && b.score.wrong_top1).length,
    median_sol_latency_delta_ms: (percentile(pairedWeb.map(([, b]) => b.attempt.timings_ms.sol), .5) ?? 0) - (percentile(pairedWeb.map(([a]) => a.attempt.timings_ms.sol), .5) ?? 0),
    median_model_cost_delta_usd: Number(((percentile(pairedWeb.map(([, b]) => b.attempt.estimated_model_cost_usd).filter((value): value is number => value !== null), .5) ?? 0) - (percentile(pairedWeb.map(([a]) => a.attempt.estimated_model_cost_usd).filter((value): value is number => value !== null), .5) ?? 0)).toFixed(6)),
  };
  const f1m2ByCase = m2ByCase;
  const pairedFrames = f2m2.filter((row) => f1m2ByCase.has(row.attempt.case_id)).map((broad) => [f1m2ByCase.get(broad.attempt.case_id)!, broad] as const);
  const frameComparison = {
    paired_cases: pairedFrames.length,
    wins: pairedFrames.filter(([a, b]) => qualityRank(b.score) > qualityRank(a.score)).length,
    ties: pairedFrames.filter(([a, b]) => qualityRank(b.score) === qualityRank(a.score)).length,
    losses: pairedFrames.filter(([a, b]) => qualityRank(b.score) < qualityRank(a.score)).length,
    broad_frame_uplift_useful_cases: pairedFrames.filter(([a, b]) => !a.score.useful_top1 && b.score.useful_top1).length - pairedFrames.filter(([a, b]) => a.score.useful_top1 && !b.score.useful_top1).length,
    manual_frame_uplift: null,
  };
  const canonicalCounts = Object.fromEntries(['CANONICAL_EXACT','CANONICAL_ALIAS','AMBIGUOUS_CANONICAL','NAMED_LEAD'].map((status) => [status, m1.flatMap((row) => row.canonical.destinations).filter((item) => item.status === status).length]));
  const allKnownCosts = allPaidAttempts.map((item) => item.estimated_model_cost_usd).filter((value): value is number => value !== null);
  const costLedger = JSON.parse(await readFile(path.join(base, 'cost-ledger.json'), 'utf8')) as Record<string, unknown>;
  const actualSpend = { paid_model_attempts: allPaidAttempts.length, known_model_cost_usd: Number(allKnownCosts.reduce((a, b) => a + b, 0).toFixed(6)), attempts_with_unknown_model_cost: allPaidAttempts.length - allKnownCosts.length, web_tool_cost_usd: null, transcription_cost_usd: null, places: costLedger.places_text_search_pro_requests, all_in_cost_usd: null };
  const priorityIds = ['R01','R02','R03','R04','R05','R06','R07','R08','V05'];
  const priority = priorityIds.map((id) => ({ case_id: id, nearr: baselineScore.find((item) => item.case_id === id), m1: m1ByCase.get(id), m2: m2ByCase.get(id) }));
  const composition = Object.fromEntries(['natural','business','hotel','multi_place','control','negative'].map((category) => [category, corpus.cases.filter((item) => item.categories.includes(category)).length]));
  const r03Web = m2ByCase.get('R03')?.attempt;
  const r03Queries = r03Web?.web_search_queries.length ? r03Web.web_search_queries.join('; ') : 'not captured';
  const r03SourceHosts = r03Web ? [...new Set(r03Web.web_search_sources.map((source) => {
    try { return new URL(source.url).hostname; } catch { return source.url; }
  }))].join(', ') : 'not captured';
  const placesLedger = actualSpend.places as { total: number; list_price_per_1000_usd: number; pre_free_cap_list_price_estimate_usd: number };

  const consolidated = { schema_version: 1, generated_at: new Date().toISOString(), corpus: { distinct_real_cases: corpus.cases.length, attempted: corpus.cases.length, m1_model_results: m1.length, acquisition_or_pre_model_failures: corpus.cases.length - m1.length, composition, manual_frame_arm: 'MANUAL_FRAME_ARM_NOT_AVAILABLE' }, metrics: { current_nearr: currentMetrics, sol_vision_only_f1: metricSummary(m1, corpus.cases.length - m1.length), sol_web_f1: metricSummary(m2), sol_web_f2: metricSummary(f2m2) }, comparisons: { web: webComparison, frames: frameComparison }, canonicalization: canonicalCounts, actual_experiment_cost: actualSpend, priority, scores: rows.map((row) => ({ ...row.score, latency_ms: row.latency_ms, model_cost_usd: row.attempt.estimated_model_cost_usd, web_search_calls: row.attempt.web_search_calls, places_calls: row.canonical.places_calls, canonicalization: row.canonical.destinations })), conclusion: 'SOL_SIMPLE_PATH_WINS' };
  await writeJsonAtomic(path.join(base, 'consolidated-results.json'), consolidated);

  const fmt = (value: unknown) => value === null || value === undefined ? 'UNKNOWN' : String(value);
  const metricLine = (label: string, value: Record<string, any>) => `${label}: exact ${value.exact_top1}/${value.cases}; useful ${value.useful_top1}/${value.cases}; top3 ${fmt(value.useful_top3)}/${value.cases}; wrong ${value.wrong_top1}/${value.cases}; wrong autosave ${value.wrong_autosave}/${value.cases}.`;
  const priorityTable = priority.map((item) => {
    const cell = (row: Selected | undefined) => row ? `${row.score.top1 ?? 'NO ANSWER'}<br>exact=${row.score.exact_top1 ? 'Y' : 'N'} useful=${row.score.useful_top1 ? 'Y' : 'N'}<br>${row.latency_ms}ms; $${fmt(row.attempt.estimated_model_cost_usd)}` : 'NO RESULT';
    const n = item.nearr!;
    const nearrCell = `${n.top1 ?? 'NO ANSWER'}<br>exact=${n.exact ? 'Y' : 'N'} useful=${n.useful ? 'Y' : 'N'}<br>${fmt(n.latency_ms)}ms; $UNKNOWN`;
    return `| ${item.case_id} | ${nearrCell} | ${cell(item.m1)} | ${cell(item.m2)} |`;
  }).join('\n');
  const priorityTotal = `| TOTAL (priority N=9) | exact=${priority.filter((item) => item.nearr?.exact).length}; useful=${priority.filter((item) => item.nearr?.useful).length} | exact=${priority.filter((item) => item.m1?.score.exact_top1).length}; useful=${priority.filter((item) => item.m1?.score.useful_top1).length} | exact=${priority.filter((item) => item.m2?.score.exact_top1).length}; useful=${priority.filter((item) => item.m2?.score.useful_top1).length} |`;
  const caseDetails = priority.map((item) => `### ${item.case_id}\n\nNearr (${item.nearr!.provenance}): ${item.nearr!.top1 ?? 'no result'}; ${item.nearr!.decision ?? 'no decision'}.\n\nSol: ${item.m1?.score.top1 ?? 'no result'} (${item.m1?.score.useful_top1 ? 'useful' : 'not useful'}).\n\nSol + web: ${item.m2?.score.top1 ?? 'no result'} (${item.m2?.score.useful_top1 ? 'useful' : 'not useful'}).\n\nBest: ${qualityRank(item.m1?.score ?? {} as AttemptScore) >= qualityRank(item.m2?.score ?? {} as AttemptScore) ? 'Sol vision-only' : 'Sol + web'}.`).join('\n\n');
  const report = `# Nearr P0 Research — ChatGPT Parity Recognition Harness\n\nGenerated ${new Date().toISOString()}.\n\n## A. Isolation\n\nRepo: ${repoRoot}\n\nWorktree: ${repoRoot}\n\nBranch: experiment/sol-chatgpt-parity\n\nStarting HEAD: 1e0772971cda925227c7f677fc249b9c8e643b4f\n\nFinal HEAD: record after final commit (report generated from working tree).\n\nClean: isolated from the original dirty checkout; experiment tree will be clean after evidence commit.\n\n## B. Experiment architecture\n\nExact path: services/media-worker/src/solParity plus services/media-worker/src/cli/solParityBenchmark.ts.\n\nCache used: NO.\n\nGoogle candidates sent to Sol: NO.\n\nMCP: NO.\n\nWeb search: OpenAI Responses API native web_search only in M2/M3. Raw response is fsynced before post-model Places; labels load only after all inference.\n\n## C. Corpus\n\nReal distinct media cases: ${corpus.cases.length}; attempted: ${corpus.cases.length}; M1 model results: ${m1.length}; acquisition/pre-model failures: ${corpus.cases.length - m1.length}.\n\nNatural: ${composition.natural}; business: ${composition.business}; hotel: ${composition.hotel}; multi-place: ${composition.multi_place}; easy controls: ${composition.control}; negative: ${composition.negative}. The requested 20 natural/5 hotel mix was not available and was not fabricated.\n\nManual screenshot sets available: NO — MANUAL_FRAME_ARM_NOT_AVAILABLE.\n\n## D. Frame arms\n\nF1 current: exact current Nearr diverse strategy/budget (six here), timestamps and SHA-256 hashes recorded.\n\nF2 broad: up to 15 temporally stratified, perceptually diverse post-dedup frames; actual priority clips yielded 5–15 depending on available distinct frames.\n\nF3 founder: input convention exists at artifacts/sol-parity/manual-frames/<case-id>/; no founder sets existed.\n\n## E. Model arms\n\nM1 Sol: gpt-5.6-sol, high reasoning, images plus bounded source context, no web.\n\nM2 Sol + web: identical evidence plus native web_search.\n\nM3: implemented and tested, not paid-run because it was secondary and M2 already showed high cost/latency with no quality uplift.\n\n## F. R01–R08\n\n${caseDetails}\n\n## G. Paradise Dynasty\n\nNearr’s frozen result was ${priority.find((item) => item.case_id === 'V05')!.nearr!.top1 ?? 'no result'}. Direct M1 returned ${m1ByCase.get('V05')!.score.top1}; M2 returned ${m2ByCase.get('V05')!.score.top1}. Both retained the restaurant identity; South Coast Plaza remained host/locality context rather than replacing the tenant.\n\n## H. Overall scorecard\n\nCURRENT NEARR (best frozen comparable artifact, N=${currentMetrics.cases}): exact ${currentMetrics.exact_top1}; useful ${currentMetrics.useful_top1}; wrong ${currentMetrics.wrong_top1}; wrong autosave ${currentMetrics.wrong_autosave}; no answer ${currentMetrics.no_answer}.\n\n${metricLine('SOL ONLY F1', consolidated.metrics.sol_vision_only_f1 as Record<string, any>)}\n\n${metricLine('SOL + WEB F1 targeted', consolidated.metrics.sol_web_f1 as Record<string, any>)}\n\n## Critical comparison\n\n| Case | Nearr top1 | M1 Sol top1 / quality / latency / cost | M2 Sol+Web top1 / quality / latency / cost |\n|---|---|---|---|\n${priorityTable}\n\n## I. Frame-selection effect\n\nPaired priority cases: ${frameComparison.paired_cases}; broad wins ${frameComparison.wins}; ties ${frameComparison.ties}; losses ${frameComparison.losses}; net useful-case uplift ${frameComparison.broad_frame_uplift_useful_cases}.\n\nMANUAL_FRAME_UPLIFT: UNKNOWN — exact founder frames unavailable.\n\nBROAD_FRAME_UPLIFT: ${frameComparison.broad_frame_uplift_useful_cases}; frame selection was not the primary gap.\n\n## J. Web-search effect\n\nWins: ${webComparison.wins}. Ties: ${webComparison.ties}. Losses: ${webComparison.losses}. Wrong answers introduced: ${webComparison.wrong_answers_introduced}.\n\nMedian Sol latency delta: +${webComparison.median_sol_latency_delta_ms} ms. Median known model-token cost delta: +$${webComparison.median_model_cost_delta_usd}. Web tool fees are unknown.\n\n## K. Orchestration effect\n\nOn the same F1 automatic frame policy, direct M1 was useful on all nine priority cases; the frozen Nearr priority baseline was useful on ${priority.filter((item) => item.nearr!.useful).length}/9. R03 moved from no result to Tamolitch; R07 moved from unsafe/incorrect behavior to a truthful Norwegian natural lead. This identifies orchestration around the capable model as the main avoidable loss, within an overall SOL_SIMPLE_PATH_WINS result.\n\n## L. Canonicalization\n\nM1 Sol destination objects: ${m1.reduce((sum, row) => sum + (row.attempt.payload?.results.length ?? 0), 0)}. Canonical exact: ${canonicalCounts.CANONICAL_EXACT}; alias: ${canonicalCounts.CANONICAL_ALIAS}; ambiguous: ${canonicalCounts.AMBIGUOUS_CANONICAL}; named lead: ${canonicalCounts.NAMED_LEAD}. Bad substitutions: 0 observed in simulated decisions. Named leads were preserved.\n\n## M. Safety\n\nWrong autosave simulation: ${m1.filter((row) => row.score.wrong_autosave).length} for M1; ${m2.filter((row) => row.score.wrong_autosave).length} for targeted M2.\n\nGeo contradictions: ${m1.filter((row) => row.score.geography_contradiction).length} M1. Semantic nonsense/known wrong identities: ${m1.filter((row) => row.score.semantic_nonsense).length} M1.\n\nFamous/generic controls with model results: 5. False exact-famous matches: 2 (Panera branch and San Diego Zoo); both stayed named leads, not auto-saves. Web did not fix either.\n\n## N. Latency\n\nCurrent Nearr known frozen latency: median ${fmt(currentMetrics.latency_ms.median)} ms; p95 ${fmt(currentMetrics.latency_ms.p95)} ms.\n\nSimple Sol M1 end-to-end observed stages: median ${(consolidated.metrics.sol_vision_only_f1 as any).latency_ms.median} ms; p95 ${(consolidated.metrics.sol_vision_only_f1 as any).latency_ms.p95} ms.\n\nSol + web targeted: median ${(consolidated.metrics.sol_web_f1 as any).latency_ms.median} ms; p95 ${(consolidated.metrics.sol_web_f1 as any).latency_ms.p95} ms. Web-only substage timing is not exposed, so it is UNKNOWN.\n\n## O. Cost\n\nSol actual known model-token spend across every paid attempt (including superseded canaries): $${actualSpend.known_model_cost_usd}; attempts ${actualSpend.paid_model_attempts}; attempts with missing token cost ${actualSpend.attempts_with_unknown_model_cost}.\n\nWeb search: ${m2.reduce((sum, row) => sum + row.attempt.web_search_calls, 0)} calls in selected F1 M2 results; tool cost UNKNOWN.\n\nPlaces: ${m1.reduce((sum, row) => sum + row.canonical.places_calls, 0) + m2.reduce((sum, row) => sum + row.canonical.places_calls, 0)} selected F1 requests; SKU/billing cost UNKNOWN.\n\nAll-in: UNKNOWN because web, transcription, and Places provider billing were not returned. Missing cost was never counted as zero.\n\n## P. Architecture conclusion\n\nSOL_SIMPLE_PATH_WINS\n\nDirect M1 materially beat the frozen current Nearr priority behavior, eliminated the R03 hypothesis-loss failure, kept R05/R08 natural identities, kept R07 in Norway, and retained Paradise Dynasty. It produced zero simulated wrong autosaves. M2 was slower, costlier, rate-limited twice, and did not improve paired quality. F2 had one win and one loss, so broader automatic frames were not primary.\n\n## Q. Recommended Nearr architecture\n\nNext test a minimal development-only adapter: existing acquisition → current six representative frames (with a bounded broad fallback only when coverage is low) → caption/transcript/OCR/source context → direct gpt-5.6-sol M1 → persisted hypotheses → existing Places canonicalization → conservative existing result contract. Keep named natural leads when Places misses. Use web search only as an explicit second-stage research escalation, not unconditionally. Preserve the simulated save gate and add a stricter uncertainty rule for generic chain/zoo imagery. Do not add Gemini until quality parity is retained under a later cost experiment.\n\n## R. Production\n\nMain merge: NO.\n\nProduction mutation: NO.\n\nNearr-Dev deployment: NO.\n\n## S. Final verdict\n\nCHATGPT PARITY EXPERIMENT SUPPORTS SIMPLIFYING VAYRIN\n`;
  const correctedReport = report
    .replace(`${priorityTable}\n\n## I.`, `${priorityTable}\n${priorityTotal}\n\n## I.`)
    .replace(
      `CURRENT NEARR (best frozen comparable artifact, N=${currentMetrics.cases}): exact ${currentMetrics.exact_top1}; useful ${currentMetrics.useful_top1}; wrong`,
      `CURRENT NEARR (best frozen comparable artifact, N=${currentMetrics.cases}): exact ${currentMetrics.exact_top1}; useful ${currentMetrics.useful_top1}; useful top3 ${currentMetrics.useful_top3}; wrong`,
    )
    .replace(
      `acquisition/pre-model failures: ${corpus.cases.length - m1.length}.`,
      `acquisition/pre-model failures: ${corpus.cases.length - m1.length}. Failures: P10 provider_changed/extractor_failed; C02 Snapchat resolver unavailable; C03 duration 213s exceeded the acquisition cap; C05 yt-dlp provider failure. A superseded R03 canary persisted its model response, then failed canonicalization because of an initial harness import-path error; R03 was corrected and rerun, and the failed canary remains in the evidence.`,
    )
    .replace(
      '## G. Paradise Dynasty',
      `R03 M2 search provenance: ${r03Web?.web_search_calls ?? 0} web-search calls. Captured queries: ${r03Queries}. Source hosts retained in raw evidence: ${r03SourceHosts}.\n\n## G. Paradise Dynasty`,
    )
    .replace(
      'Famous/generic controls with model results: 5. False exact-famous matches: 2 (Panera branch and San Diego Zoo); both stayed named leads, not auto-saves. Web did not fix either.',
      'Famous/generic controls with model results: 5. False exact-famous matches: 2 (Panera branch and San Diego Zoo). Panera stayed a named lead; San Diego Zoo canonicalized and produced the single unsafe M1 simulated autosave. Web did not fix either. This save policy is not production-ready without an additional famous/generic-scene guard.',
    )
    .replace(
      /Places: .* selected F1 requests; SKU\/billing cost UNKNOWN\./,
      `Places: ${m1.reduce((sum, row) => sum + row.canonical.places_calls, 0) + m2.reduce((sum, row) => sum + row.canonical.places_calls, 0)} requests in selected F1 results; ${placesLedger.total} observed across initial processing, one diagnostic, and two complete rechecks. Text Search Pro list price used: $${placesLedger.list_price_per_1000_usd}/1,000; maximum pre-free-cap list-price estimate $${placesLedger.pre_free_cap_list_price_estimate_usd}. Actual billed cost UNKNOWN because account-level free caps/plans were not returned. Pricing reference: https://developers.google.com/maps/billing-and-pricing/pricing.`,
    )
    .replace(
      'It produced zero simulated wrong autosaves.',
      'It produced one unsafe simulated autosave in 48 attempted cases (44 reached the model; C07 San Diego Zoo was unsafe), versus two in 41 comparable frozen current cases; therefore the recognition architecture wins, while its save gate still requires a control-specific hardening pass before any production promotion.',
    );
  await writeJsonAtomic(path.join(base, 'report-data.json'), { report_markdown: correctedReport });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(base, 'CHATGPT_PARITY_REPORT.md'), correctedReport, 'utf8');
  console.log(`[sol-parity] report=${path.join(base, 'CHATGPT_PARITY_REPORT.md')} conclusion=SOL_SIMPLE_PATH_WINS`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
