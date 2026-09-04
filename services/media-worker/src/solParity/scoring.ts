import type { CanonicalizedDestination, PersistedModelAttempt, SimulatedDecision, SolDestination } from './types.js';

export type GroundTruthCase = {
  case_id: string;
  source: string;
  accepted_exact_identities: string[];
  accepted_aliases: string[];
  accepted_truthful_partials: string[];
  known_wrong_identities: string[];
  expected_broad_geography: string[];
  multi_place_expectation: 'ONE' | 'MULTIPLE' | 'NONE' | 'UNKNOWN';
};
export type GroundTruthManifest = { schema_version: 1; frozen_at: string; cases: GroundTruthCase[] };

export type AttemptScore = {
  attempt_id: string;
  case_id: string;
  frame_arm: string;
  model_arm: string;
  top1: string | null;
  exact_top1: boolean;
  useful_top1: boolean;
  useful_top3: boolean;
  wrong_top1: boolean;
  truthful_partial: boolean;
  no_answer: boolean;
  semantic_nonsense: boolean;
  geography_contradiction: boolean;
  simulated_decision: SimulatedDecision;
  wrong_autosave: boolean;
};

function norm(value: string): string {
  return value.toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a')
    .normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}
function compatible(value: string, accepted: string[]): boolean {
  const candidate = norm(value);
  return accepted.some((item) => {
    const expected = norm(item);
    if (!expected) return false;
    if (candidate === expected) return true;
    const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
    const expectedTokens = expected.split(' ').filter(Boolean);
    return expectedTokens.length > 0 && expectedTokens.every((token) => candidateTokens.has(token));
  });
}
function destinationText(destination: SolDestination): string {
  return [destination.name, destination.city, destination.region, destination.country].filter(Boolean).join(' ');
}

export function scoreAttempt(args: {
  attempt: PersistedModelAttempt;
  truth: GroundTruthCase;
  canonicalized: CanonicalizedDestination[];
  decision: SimulatedDecision;
}): AttemptScore {
  const results = args.attempt.payload?.results ?? [];
  const top = results[0] ?? null;
  const noAnswer = !top;
  const exactSet = [...args.truth.accepted_exact_identities, ...args.truth.accepted_aliases];
  const negative = args.truth.multi_place_expectation === 'NONE';
  const topText = top ? destinationText(top) : '';
  const exact = !!top && compatible(top.name, exactSet);
  const partial = !!top && compatible(topText, args.truth.accepted_truthful_partials);
  const geography = !!top && compatible(topText, args.truth.expected_broad_geography);
  const multiCorrect = args.truth.multi_place_expectation === 'MULTIPLE' && args.attempt.payload?.scene_class === 'MULTIPLE_DESTINATIONS';
  const useful = negative
    ? noAnswer
    : args.truth.multi_place_expectation === 'MULTIPLE'
      ? multiCorrect && (exact || partial || geography || exactSet.length === 0)
      : exact || partial || geography;
  const firstDestinationHypotheses = top ? [top.name, ...top.alternatives.map((item) => item.name)].slice(0, 4) : [];
  const usefulTop3 = negative ? noAnswer : multiCorrect || firstDestinationHypotheses.some((name) => compatible(name, [...exactSet, ...args.truth.accepted_truthful_partials]));
  const nonsense = !!top && !exact && compatible(top.name, args.truth.known_wrong_identities);
  const geoContradiction = !!top && !exact && !partial && args.truth.expected_broad_geography.length > 0 && !geography;
  const wrong = !!top && !useful;
  return {
    attempt_id: args.attempt.attempt_id,
    case_id: args.attempt.case_id,
    frame_arm: args.attempt.frame_arm,
    model_arm: args.attempt.model_arm,
    top1: top?.name ?? null,
    exact_top1: exact,
    useful_top1: useful,
    useful_top3: useful || usefulTop3,
    wrong_top1: wrong,
    truthful_partial: !exact && useful,
    no_answer: noAnswer,
    semantic_nonsense: nonsense,
    geography_contradiction: geoContradiction,
    simulated_decision: args.decision,
    wrong_autosave: args.decision === 'WOULD_AUTO_SAVE' && !useful,
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
}

export function summarizeScores(scores: AttemptScore[], attempts: PersistedModelAttempt[]): Record<string, unknown> {
  const groups = new Map<string, AttemptScore[]>();
  for (const score of scores) {
    const key = `${score.frame_arm}:${score.model_arm}`;
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }
  const byAttempt = new Map(attempts.map((attempt) => [attempt.attempt_id, attempt]));
  return Object.fromEntries([...groups.entries()].map(([key, rows]) => {
    const observed = rows.map((row) => byAttempt.get(row.attempt_id)).filter((item): item is PersistedModelAttempt => !!item);
    const costs = observed.map((item) => item.estimated_model_cost_usd).filter((item): item is number => item !== null);
    const latency = observed.map((item) => item.timings_ms.total).filter(Number.isFinite);
    return [key, {
      cases: rows.length,
      exact_top1: rows.filter((row) => row.exact_top1).length,
      useful_top1: rows.filter((row) => row.useful_top1).length,
      useful_top3: rows.filter((row) => row.useful_top3).length,
      wrong_top1: rows.filter((row) => row.wrong_top1).length,
      wrong_autosave: rows.filter((row) => row.wrong_autosave).length,
      truthful_partial: rows.filter((row) => row.truthful_partial).length,
      no_answer: rows.filter((row) => row.no_answer).length,
      semantic_nonsense: rows.filter((row) => row.semantic_nonsense).length,
      geography_contradiction: rows.filter((row) => row.geography_contradiction).length,
      median_latency_ms: percentile(latency, 0.5),
      p95_latency_ms: percentile(latency, 0.95),
      model_cost_usd: costs.length === observed.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(6)) : null,
      web_search_calls: observed.reduce((sum, item) => sum + item.web_search_calls, 0),
    }];
  }));
}
