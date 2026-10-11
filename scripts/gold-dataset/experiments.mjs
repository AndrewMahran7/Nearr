/** Pure experiment policies and paired statistics. No provider, file, or label readers. */
import { sha256 } from './core.mjs';

export const EXPERIMENT_VERSION = 'recognition-experiments-v1';
export const ROUTER_FAMILIES = Object.freeze(['rules', 'calibrated', 'small_supervised', 'hybrid']);
export const ROUTER_FEATURES = Object.freeze([
  'minimum_confidence', 'confidence_missing', 'exact_support_fraction',
  'source_named_fraction', 'candidate_bound_fraction', 'distinctive_visual_fraction',
  'geography_conflict', 'model_prior', 'review_option_count', 'place_count',
  'multi_detected', 'partially_unresolved', 'technical_failure',
]);
const fail = (reason) => { throw new Error(reason); };
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const list = (v) => Array.isArray(v) ? v : [];
const clamp = (n) => Math.min(1, Math.max(0, n));
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const ratio = (a, b) => b ? a / b : null;
export const objectHash = (value) => sha256(JSON.stringify(value));
const key = (r) => `${r.input_id ?? r.case_id}\0${r.view}`;

export function validateObservations(rows) {
  if (!Array.isArray(rows) || !rows.length) fail('empty_observations');
  const seen = new Set();
  for (const row of rows) {
    if (!/^i_[a-f0-9]{24}$/.test(row.input_id) || !/^[a-f0-9]{64}$/.test(row.input_sha256) || typeof row.view !== 'string' ||
        !['completed', 'review', 'failed'].includes(row.status) || typeof row.autonomous !== 'boolean' ||
        !Array.isArray(row.places) || !Array.isArray(row.candidates) ||
        (row.autonomous && row.status !== 'completed')) fail('invalid_experiment_observation');
    if (['expected_places', 'label_class', 'case_id', 'place_group_ids', 'source_group_id', 'split', 'correct_autonomous'].some((k) => k in row)) fail('observation_contains_scorer_fields');
    if (seen.has(key(row))) fail('duplicate_experiment_observation');
    seen.add(key(row));
    for (const name of ['cost_usd', 'elapsed_ms', 'first_usable_result_ms']) {
      if (row[name] != null && (!finite(row[name]) || row[name] < 0)) fail(`invalid_${name}`);
    }
  }
  return rows;
}

/** Union all sources AND places, including transitive bridge cases outside a compared slice. */
export function connectedGroups(universe) {
  const byCase = new Map();
  for (const r of universe) {
    if (!r.case_id || !r.source_group_id || !Array.isArray(r.place_group_ids)) fail('group_context_required');
    if (byCase.has(r.case_id) && objectHash(byCase.get(r.case_id)) !== objectHash(r)) fail('conflicting_group_context');
    byCase.set(r.case_id, r);
  }
  const parent = new Map([...byCase.keys()].map((id) => [id, id]));
  const find = (id) => {
    while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); }
    return id;
  };
  const owners = new Map();
  for (const r of byCase.values()) for (const token of [`source:${r.source_group_id}`, ...r.place_group_ids.map((p) => `place:${p}`)]) {
    if (owners.has(token)) parent.set(find(r.case_id), find(owners.get(token)));
    else owners.set(token, r.case_id);
  }
  const components = new Map();
  for (const r of byCase.values()) {
    const root = find(r.case_id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(r);
  }
  const groups = new Map();
  for (const records of components.values()) {
    if (new Set(records.map((r) => r.split).filter(Boolean)).size > 1) fail('connected_group_crosses_splits');
    const id = `cg_${sha256(records.map((r) => r.case_id).sort().join('\0')).slice(0, 24)}`;
    for (const r of records) groups.set(r.case_id, id);
  }
  return groups;
}

function rng(seed) {
  let value = parseInt(sha256(String(seed)).slice(0, 8), 16) >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let x = Math.imul(value ^ value >>> 15, 1 | value);
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}
export function quantile(values, q) {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b), position = (xs.length - 1) * q;
  const low = Math.floor(position), high = Math.ceil(position);
  return xs[low] + (xs[high] - xs[low]) * (position - low);
}

/** Rates use all eligible submissions, including failed ones. Missing costs/latencies stay unknown. */
export function experimentMetrics(rows) {
  const exact = rows.filter((r) => r.exact_eligible);
  const adjudicable = rows.filter((r) => !['AMBIGUOUS', 'UNVERIFIED'].includes(r.label_class));
  const autonomous = adjudicable.filter((r) => r.autonomous_place_output);
  const correct = exact.filter((r) => r.correct_autonomous === true);
  const knownCost = rows.length > 0 && rows.every((r) => finite(r.cost_usd));
  const knownLatency = rows.length > 0 && rows.every((r) => finite(r.elapsed_ms));
  const cost = knownCost ? rows.reduce((sum, r) => sum + r.cost_usd, 0) : null;
  const latency = knownLatency ? rows.map((r) => r.elapsed_ms) : [];
  return {
    correct_autonomous: ratio(correct.length, exact.length),
    autonomous_precision: ratio(autonomous.filter((r) => r.correct_autonomous === true).length, autonomous.length),
    autonomous_coverage: ratio(exact.filter((r) => r.autonomous_place_output).length, exact.length),
    wrong_confident: ratio(adjudicable.filter((r) => r.wrong_confident).length, adjudicable.length),
    failure_rate: ratio(rows.filter((r) => r.status === 'failed').length, rows.length),
    mean_cost_usd: cost == null ? null : cost / rows.length,
    total_cost_usd: cost,
    cost_per_correct_autonomous_usd: cost == null || !correct.length ? null : cost / correct.length,
    mean_latency_ms: mean(latency),
    p50_latency_ms: quantile(latency, .5), p75_latency_ms: quantile(latency, .75), p90_latency_ms: quantile(latency, .9), p95_latency_ms: quantile(latency, .95),
    known_cost_cases: rows.filter((r) => finite(r.cost_usd)).length,
    known_latency_cases: rows.filter((r) => finite(r.elapsed_ms)).length,
    cases: rows.length,
  };
}

const COMPARISON_METRICS = ['correct_autonomous', 'autonomous_precision', 'autonomous_coverage',
  'wrong_confident', 'failure_rate', 'mean_cost_usd', 'cost_per_correct_autonomous_usd',
  'mean_latency_ms', 'p50_latency_ms', 'p75_latency_ms', 'p90_latency_ms', 'p95_latency_ms'];

/** Same connected-component resample for both arms. Difference is candidate minus baseline. */
export function pairedGroupComparison(baseline, candidate, universe, options = {}) {
  const { iterations = 2000, seed = 'paired-v1', confidence = .95 } = options;
  if (!Number.isInteger(iterations) || iterations < 100 || iterations > 100_000 || !finite(confidence) || confidence <= 0 || confidence >= 1) fail('invalid_bootstrap_configuration');
  if (!baseline.length || baseline.length !== candidate.length) fail('paired_case_set_mismatch');
  const sorted = (rows) => [...rows].sort((a, b) => key(a).localeCompare(key(b)));
  const a = sorted(baseline), b = sorted(candidate), groups = connectedGroups(universe), components = new Map();
  if (new Set(a.map(key)).size !== a.length || new Set(b.map(key)).size !== b.length) fail('duplicate_paired_case');
  for (let i = 0; i < a.length; i++) {
    if (key(a[i]) !== key(b[i]) || a[i].split !== b[i].split || a[i].label_class !== b[i].label_class || a[i].exact_eligible !== b[i].exact_eligible) fail('paired_case_set_mismatch');
    const group = groups.get(a[i].case_id);
    if (!group) fail('comparison_group_context_missing');
    if (!components.has(group)) components.set(group, []);
    components.get(group).push(i);
  }
  if (new Set(a.map((r) => `${r.split}\0${r.view}`)).size !== 1) fail('comparison_requires_one_split_and_view');
  const clusters = [...components.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([, indices]) => indices);
  const observedA = experimentMetrics(a), observedB = experimentMetrics(b);
  const samples = Object.fromEntries(COMPARISON_METRICS.map((m) => [m, { baseline: [], candidate: [], difference: [] }]));
  const ratios = { mean_latency_ratio: { metric: 'mean_latency_ms', samples: [] },
    p90_latency_ratio: { metric: 'p90_latency_ms', samples: [] },
    cost_per_correct_autonomous_ratio: { metric: 'cost_per_correct_autonomous_usd', samples: [] } };
  const random = rng(seed);
  for (let draw = 0; draw < iterations; draw++) {
    const indices = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]).flat();
    const ma = experimentMetrics(indices.map((i) => a[i])), mb = experimentMetrics(indices.map((i) => b[i]));
    for (const metric of COMPARISON_METRICS) {
      if (observedA[metric] != null && ma[metric] != null) samples[metric].baseline.push(ma[metric]);
      if (observedB[metric] != null && mb[metric] != null) samples[metric].candidate.push(mb[metric]);
      if (observedA[metric] != null && observedB[metric] != null && ma[metric] != null && mb[metric] != null) samples[metric].difference.push(mb[metric] - ma[metric]);
    }
    for (const item of Object.values(ratios)) if (observedA[item.metric] > 0 && observedB[item.metric] != null && ma[item.metric] > 0 && mb[item.metric] != null) item.samples.push(mb[item.metric] / ma[item.metric]);
  }
  const alpha = (1 - confidence) / 2;
  const interval = (xs) => ({ low: clusters.length < 2 || !xs.length ? null : quantile(xs, alpha),
    high: clusters.length < 2 || !xs.length ? null : quantile(xs, 1 - alpha), valid_draws: xs.length });
  const metrics = {};
  for (const metric of COMPARISON_METRICS) metrics[metric] = {
    baseline: observedA[metric], candidate: observedB[metric],
    difference: observedA[metric] == null || observedB[metric] == null ? null : observedB[metric] - observedA[metric],
    baseline_ci: interval(samples[metric].baseline), candidate_ci: interval(samples[metric].candidate),
    difference_ci: interval(samples[metric].difference),
  };
  return { method: 'paired percentile bootstrap of connected source/place components',
    estimand: 'case-weighted submission metric; resample whole connected groups with replacement',
    difference_direction: 'candidate_minus_baseline', independent_groups: clusters.length,
    cases: a.length, iterations, seed, confidence, metrics,
    paired_ratios: Object.fromEntries(Object.entries(ratios).map(([name, item]) => [name, {
      estimate: observedA[item.metric] > 0 && observedB[item.metric] != null ? observedB[item.metric] / observedA[item.metric] : null,
      ci: interval(item.samples),
    }])),
    safety: {
      newly_wrong_confident: a.filter((r, i) => r.wrong_confident === false && b[i].wrong_confident === true).length,
      resolved_wrong_confident: a.filter((r, i) => r.wrong_confident === true && b[i].wrong_confident === false).length,
      multi_correct_autonomous_regressions: a.filter((r, i) => r.label_class === 'VERIFIED_MULTI' && r.correct_autonomous === true && b[i].correct_autonomous !== true).length,
      identical_autonomous_outcomes: a.every((r, i) => r.autonomous_signature && b[i].autonomous_signature)
        ? a.every((r, i) => r.autonomous_signature === b[i].autonomous_signature) : null,
    },
    limitations: ['Intervals are descriptive after development/calibration selection; held-out confirmation uses frozen milestones.',
      ...(clusters.length < 2 ? ['Fewer than two independent groups: confidence intervals unavailable.'] : []),
      ...(clusters.length < 20 ? ['Few independent groups: bootstrap tails are unstable.'] : [])] };
}

/** Strict dominance only; unknown required metrics are excluded, never treated as zero. */
export function paretoFrontier(arms) {
  if (!arms.length || new Set(arms.map((a) => a.arm_id)).size !== arms.length) fail('unique_pareto_arm_ids_required');
  const axes = { correct_autonomous: 'max', wrong_confident: 'min', mean_cost_usd: 'min', p95_latency_ms: 'min' };
  const comparable = arms.filter((a) => Object.keys(axes).every((k) => finite(a.metrics[k])));
  const dominates = (a, b) => Object.entries(axes).every(([k, dir]) => dir === 'min' ? a.metrics[k] <= b.metrics[k] : a.metrics[k] >= b.metrics[k]) &&
    Object.entries(axes).some(([k, dir]) => dir === 'min' ? a.metrics[k] < b.metrics[k] : a.metrics[k] > b.metrics[k]);
  return { axes, frontier: comparable.filter((a) => !comparable.some((b) => b !== a && dominates(b, a))).map((a) => a.arm_id),
    dominated_by: Object.fromEntries(comparable.map((a) => [a.arm_id, comparable.filter((b) => b !== a && dominates(b, a)).map((b) => b.arm_id)])),
    excluded_unknown: arms.filter((a) => !comparable.includes(a)).map((a) => a.arm_id),
    interpretation: 'Point-estimate Pareto set, not statistical superiority; examine paired group intervals.' };
}

/** Scalar allowlist only: identity strings, source IDs, coordinates and label fields never become features. */
export function routerFeatures(observation) {
  const decisions = list(observation.per_place_decisions);
  const selected = decisions.filter((d) => observation.places.some((p) => p.logical_result_id === d.logicalResultId));
  const relevant = selected.length ? selected : decisions;
  const confidences = relevant.map((d) => d.gate?.confidenceScore ?? d.completion?.primary?.matchScore ??
    d.legacyCandidate?.confidenceScore ?? d.legacyCandidate?.matchScore).filter(finite);
  const strengths = relevant.map((d) => d.gate?.exactIdentityStrength ?? d.completion?.primary?.exactIdentityStrength ?? d.legacyCandidate?.exactIdentityStrength);
  const codes = [...list(observation.reason_codes), ...decisions.flatMap((d) => list(d.blockingReasons)),
    ...decisions.flatMap((d) => list(d.gate?.reasonCodes))];
  const fraction = (name) => strengths.length ? strengths.filter((s) => s === name).length / strengths.length : 0;
  return [confidences.length ? clamp(Math.min(...confidences)) : .5, confidences.length ? 0 : 1,
    strengths.length ? strengths.filter((s) => ['candidate_bound', 'source_named', 'distinctive_visual'].includes(s)).length / strengths.length : 0,
    fraction('source_named'), fraction('candidate_bound'), fraction('distinctive_visual'),
    codes.some((c) => /geography_conflict|location_conflict/.test(c)) ? 1 : 0,
    codes.some((c) => /model_prior|upstream_exact_identity_review_required/.test(c)) ? 1 : 0,
    Math.min(observation.candidates.length, 10) / 10, Math.min(observation.places.length, 10) / 10,
    observation.multi_place_detected === true ? 1 : 0,
    observation.runtime_finalization_status === 'needs_help' ? 1 : 0,
    observation.status === 'failed' ? 1 : 0];
}

function earlyEligible(observation) {
  return observation.status === 'completed' && observation.autonomous === true && observation.places.length > 0;
}
function rulesPass(features, rules) {
  return features[0] >= rules.minimumConfidence &&
    (!rules.requireExactSupport || features[2] === 1) &&
    (!rules.rejectGeographyConflict || features[6] === 0) &&
    (!rules.rejectModelPrior || features[7] === 0) &&
    (!rules.requireCompleteSet || features[11] === 0);
}
function familyRulesPass(model, features) {
  // Geography, prior-only identity and unresolved-set vetoes survive every architecture.
  const rules = ['rules', 'hybrid'].includes(model.family) ? model.rules :
    { ...model.rules, minimumConfidence: 0, requireExactSupport: false };
  return rulesPass(features, rules);
}
const sigmoid = (x) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, x))));

export function makeLearningRows(scores, observations) {
  validateObservations(observations);
  const byId = new Map(observations.map((r) => [key(r), r]));
  if (scores.length !== observations.length) fail('learning_case_set_mismatch');
  return scores.map((score) => {
    const observation = byId.get(key(score));
    if (!observation || !score.group_id) fail('learning_pair_or_group_missing');
    const eligible = earlyEligible(observation);
    return { input_id: observation.input_id, view: observation.view, split: score.split, group_id: score.group_id,
      group_tokens: [`source:${score.source_group_id}`, ...list(score.place_group_ids).map((id) => `place:${id}`)].map(sha256).sort(),
      features: routerFeatures(observation), eligible,
      target: !eligible || ['AMBIGUOUS', 'UNVERIFIED'].includes(score.label_class) ? null : score.correct_autonomous === true ? 1 : 0 };
  });
}
function checkLearningRows(rows, split) {
  if (!rows.length || rows.some((r) => r.split !== split)) fail(`router_requires_${split}_only`);
  if (new Set(rows.map(key)).size !== rows.length) fail('duplicate_learning_row');
  if (new Set(rows.map((r) => r.view)).size !== 1) fail('router_requires_one_view');
  for (const r of rows) if (!r.group_id || !Array.isArray(r.group_tokens) || !r.group_tokens.length ||
      r.group_tokens.some((t) => !/^[a-f0-9]{64}$/.test(t)) || !Array.isArray(r.features) || r.features.length !== ROUTER_FEATURES.length ||
      r.features.some((x) => !finite(x) || x < 0 || x > 1) || ![null, 0, 1].includes(r.target)) fail('invalid_learning_row');
}

export function fitRouter(rows, options) {
  checkLearningRows(rows, 'development');
  const { family, epochs = 600, learningRate = .2, l2 = .02 } = options;
  if (!ROUTER_FAMILIES.includes(family) || !Number.isInteger(epochs) || epochs < 1 || epochs > 50_000 ||
      !finite(learningRate) || learningRate <= 0 || learningRate > 10 || !finite(l2) || l2 < 0) fail('invalid_router_configuration');
  const rules = { minimumConfidence: 0, requireExactSupport: false, rejectGeographyConflict: true,
    rejectModelPrior: true, requireCompleteSet: true, ...options.rules };
  if (!finite(rules.minimumConfidence) || rules.minimumConfidence < 0 || rules.minimumConfidence > 1 ||
      ['requireExactSupport', 'rejectGeographyConflict', 'rejectModelPrior', 'requireCompleteSet'].some((k) => typeof rules[k] !== 'boolean')) fail('invalid_router_rules');
  const eligible = rows.filter((r) => r.eligible && r.target != null);
  if (!eligible.length) fail('no_adjudicable_early_autonomous_training_examples');
  const groupSize = new Map();
  for (const r of eligible) groupSize.set(r.group_id, (groupSize.get(r.group_id) ?? 0) + 1);
  const weights = Array(ROUTER_FEATURES.length + 1).fill(0);
  const totalWeight = groupSize.size;
  if (family === 'small_supervised' || family === 'hybrid') {
    // Fixed feature order, no randomized splits, equal total training weight per component.
    for (let epoch = 0; epoch < epochs; epoch++) {
      const gradient = weights.map(() => 0);
      for (const row of [...eligible].sort((a, b) => key(a).localeCompare(key(b)))) {
        const x = [1, ...row.features], error = sigmoid(weights.reduce((sum, w, i) => sum + w * x[i], 0)) - row.target;
        for (let i = 0; i < weights.length; i++) gradient[i] += error * x[i] / groupSize.get(row.group_id);
      }
      for (let i = 0; i < weights.length; i++) weights[i] -= learningRate * (gradient[i] / totalWeight + (i ? l2 * weights[i] : 0));
    }
  }
  return { version: EXPERIMENT_VERSION, family, features: [...ROUTER_FEATURES], rules, weights,
    hyperparameters: { epochs, learningRate, l2 }, fitted_on: 'development', view: rows[0].view,
    development_rows_sha256: objectHash(rows), training_groups: [...new Set(rows.map((r) => r.group_id))].sort(),
    training_group_tokens: [...new Set(rows.flatMap((r) => r.group_tokens))].sort(),
    training_cases: eligible.length, calibration: null,
    restriction: 'Choose an existing early autonomous result or escalate; never promote a review candidate.' };
}

function rawScore(model, features) {
  return model.family === 'small_supervised' || model.family === 'hybrid'
    ? sigmoid(model.weights.reduce((sum, w, i) => sum + w * (i ? features[i - 1] : 1), 0)) : features[0];
}
function isotonicFit(rows) {
  const byScore = new Map();
  for (const row of rows) {
    const b = byScore.get(row.score) ?? { min: row.score, max: row.score, sum: 0, weight: 0 };
    b.sum += row.target * row.weight; b.weight += row.weight; byScore.set(row.score, b);
  }
  const blocks = [];
  for (const block of [...byScore.values()].sort((a, b) => a.min - b.min)) {
    blocks.push(block);
    while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).weight > blocks.at(-1).sum / blocks.at(-1).weight) {
      const right = blocks.pop(), left = blocks.pop();
      blocks.push({ min: left.min, max: right.max, sum: left.sum + right.sum, weight: left.weight + right.weight });
    }
  }
  return blocks.map((b) => ({ min: b.min, max: b.max, probability: b.sum / b.weight }));
}
function calibratedScore(model, features, blocks = model.calibration?.isotonic) {
  const score = rawScore(model, features);
  if (!blocks?.length) return score;
  return (blocks.find((b) => score <= b.max) ?? blocks.at(-1)).probability;
}

/** Threshold is chosen on calibration only, using early correctness, never deep correctness. */
export function calibrateRouter(model, rows, options = {}) {
  checkLearningRows(rows, 'calibration');
  if (model.fitted_on !== 'development' || model.calibration || model.view !== rows[0].view) fail('uncalibrated_development_model_required');
  if (rows.some((r) => model.training_groups.includes(r.group_id))) fail('training_calibration_group_leakage');
  if (rows.some((r) => r.group_tokens.some((token) => model.training_group_tokens.includes(token)))) fail('training_calibration_source_or_place_leakage');
  const { minimumPrecision = .98, minimumAccepted = 5, minimumGroups = 3 } = options;
  if (!finite(minimumPrecision) || minimumPrecision < 0 || minimumPrecision > 1 || !Number.isInteger(minimumAccepted) || minimumAccepted < 1 || !Number.isInteger(minimumGroups) || minimumGroups < 1) fail('invalid_calibration_configuration');
  const usable = rows.filter((r) => r.eligible && r.target != null && familyRulesPass(model, r.features));
  const sizes = new Map();
  for (const r of usable) sizes.set(r.group_id, (sizes.get(r.group_id) ?? 0) + 1);
  const isotonic = model.family === 'calibrated' ? isotonicFit(usable.map((r) => ({
    score: rawScore(model, r.features), target: r.target, weight: 1 / sizes.get(r.group_id),
  }))) : null;
  const scored = usable.map((r) => ({ ...r, probability: calibratedScore(model, r.features, isotonic) }));
  const thresholds = [...new Set([0, ...scored.map((r) => r.probability), 1 + Number.EPSILON])].sort((a, b) => a - b);
  const curve = thresholds.map((threshold) => {
    const accepted = scored.filter((r) => r.probability >= threshold);
    const correct = accepted.filter((r) => r.target === 1).length;
    return { threshold, accepted: accepted.length, groups: new Set(accepted.map((r) => r.group_id)).size,
      correct, precision: ratio(correct, accepted.length), early_coverage: accepted.length / rows.length };
  });
  // Maximize early coverage under the predeclared empirical precision requirement.
  // These are calibration-selection statistics, not a held-out precision guarantee.
  const selected = curve.filter((p) => p.precision >= minimumPrecision && p.accepted >= minimumAccepted && p.groups >= minimumGroups)
    .sort((a, b) => b.accepted - a.accepted || b.precision - a.precision || b.threshold - a.threshold)[0];
  return { ...structuredClone(model), calibration: { fitted_on: 'calibration', rows_sha256: objectHash(rows),
    groups: [...new Set(rows.map((r) => r.group_id))].sort(), threshold: selected?.threshold ?? 1 + Number.EPSILON,
    isotonic, options: { minimumPrecision, minimumAccepted, minimumGroups }, selected: selected ?? null,
    selection_curve: curve, note: 'Calibration selection only; empirical precision is not a population guarantee.' } };
}

export function routeEarly(model, observation) {
  if (model.version !== EXPERIMENT_VERSION || !model.calibration || model.calibration.fitted_on !== 'calibration' ||
      model.fitted_on !== 'development' || objectHash(model.features) !== objectHash(ROUTER_FEATURES)) fail('frozen_calibrated_router_required');
  if (observation.view !== model.view) fail('router_view_mismatch');
  const features = routerFeatures(observation);
  const probability = calibratedScore(model, features);
  const ruleEligible = familyRulesPass(model, features);
  return { useEarly: earlyEligible(observation) && ruleEligible && probability >= model.calibration.threshold,
    probability, threshold: model.calibration.threshold, ruleEligible, features };
}

function knownLedgerCost(observation) {
  if (observation.provider_ledger_complete !== true || !finite(observation.cost_usd) || !Array.isArray(observation.provider_usage)) return null;
  if (observation.cost_basis === 'no_paid_calls') {
    if (observation.cost_usd !== 0 || observation.provider_usage.length) fail('invalid_stage_zero_cost');
    return 0;
  }
  if (observation.cost_basis !== 'measured_provider_ledger' || !observation.provider_usage.length || observation.provider_usage.some((p) => !finite(p.cost_usd) || p.cost_usd < 0 || !Number.isInteger(p.calls) || p.calls < 0)) fail('invalid_stage_ledger');
  const sum = observation.provider_usage.reduce((n, p) => n + p.cost_usd, 0);
  if (Math.abs(sum - observation.cost_usd) > 1e-8) fail('stage_ledger_cost_mismatch');
  return sum;
}

/** Counterfactual routing uses only already-recorded outputs. Missing deep output is a failure. */
export function applyRouter(model, early, escalated, { accounting = 'sequential_incremental', policyLatencyMs = 0 } = {}) {
  if (!['sequential_incremental', 'cumulative_including_early'].includes(accounting) || !finite(policyLatencyMs) || policyLatencyMs < 0) fail('invalid_stage_accounting');
  validateObservations([early]);
  if (escalated) { validateObservations([escalated]); if (key(early) !== key(escalated) || early.input_sha256 !== escalated.input_sha256) fail('stage_identity_mismatch'); }
  const route = routeEarly(model, early), earlyHash = objectHash(early);
  let selected = route.useEarly ? early : escalated;
  if (!selected) selected = { ...early, status: 'failed', autonomous: false, places: [], candidates: [],
    multi_place_detected: null, first_usable_result_ms: null, reason_codes: ['required_escalation_observation_missing'] };
  if (!route.useEarly && escalated && accounting === 'cumulative_including_early' &&
      (escalated.stage_accounting?.includes_early_observation_sha256 !== earlyHash || escalated.stage_accounting?.kind !== 'cumulative_including_early')) fail('cumulative_stage_parent_proof_required');
  const stages = route.useEarly || !escalated ? [early] : accounting === 'cumulative_including_early' ? [escalated] : [early, escalated];
  const costs = stages.map(knownLedgerCost), complete = costs.every((c) => c !== null);
  const providerUsage = stages.flatMap((s) => list(s.provider_usage));
  const latencies = stages.map((s) => s.elapsed_ms), latency = latencies.every(finite) ? latencies.reduce((a, b) => a + b, 0) + policyLatencyMs : null;
  const usable = selected.first_usable_result_ms;
  const firstUsable = selected.status === 'failed' || !finite(usable) ? null :
    !route.useEarly && escalated && accounting === 'sequential_incremental'
      ? finite(early.elapsed_ms) ? early.elapsed_ms + usable + policyLatencyMs : null
      : usable + policyLatencyMs;
  return { ...structuredClone(selected), input_id: early.input_id, view: early.view,
    elapsed_ms: latency, first_usable_result_ms: firstUsable,
    cost_usd: complete ? costs.reduce((a, b) => a + b, 0) : null,
    provider_ledger_complete: complete, provider_usage: providerUsage,
    cost_basis: providerUsage.length ? 'measured_provider_ledger' : 'no_paid_calls',
    provider_calls: stages.every((s) => Number.isInteger(s.provider_calls)) ? stages.reduce((sum, s) => sum + s.provider_calls, 0) : null,
    entries: stages.flatMap((s, stage) => list(s.entries).map((entry) => ({ ...entry, router_stage: stage }))),
    routing: { version: EXPERIMENT_VERSION, family: model.family, policy_sha256: objectHash(model),
      choice: route.useEarly ? 'early' : escalated ? 'escalated' : 'missing_escalation',
      early_observation_sha256: earlyHash, escalated_observation_sha256: escalated ? objectHash(escalated) : null,
      accounting, policy_latency_ms: policyLatencyMs, probability: route.probability,
      threshold: route.threshold, rule_eligible: route.ruleEligible,
      interpretation: 'Paired offline replay; stage charges include failed requests. Acquisition and queue overhead excluded.' } };
}
