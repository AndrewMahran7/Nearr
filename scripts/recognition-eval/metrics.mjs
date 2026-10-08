// Scoring only. This module never supplies labels to an inference adapter.
export const normalize = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function quantile(values, q) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const p = (xs.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return xs[lo] + (xs[hi] - xs[lo]) * (p - lo);
}
export function distribution(xs) {
  const values = xs.filter(Number.isFinite);
  return { n: values.length, p50: quantile(values, .5), p75: quantile(values, .75), p90: quantile(values, .9), p95: quantile(values, .95) };
}
export function rate(numerator, denominator) {
  if (!denominator) return { numerator, denominator, rate: null, wilson95: null };
  const p = numerator / denominator, z = 1.95996398454, d = 1 + z * z / denominator;
  const mid = (p + z * z / (2 * denominator)) / d;
  const half = z * Math.sqrt(p * (1 - p) / denominator + z * z / (4 * denominator * denominator)) / d;
  return { numerator, denominator, rate: p, wilson95: [Math.max(0, mid - half), Math.min(1, mid + half)] };
}
function match(place, truth) {
  if (truth.id && place.id) return place.id === truth.id;
  if (!(truth.aliases ?? [truth.name]).some((s) => normalize(s) === normalize(place.name))) return false;
  // Branch name alone never establishes its physical locality.
  if (truth.locality && ![place.locality, place.address, place.name].some((s) => normalize(s).includes(normalize(truth.locality)))) return false;
  if (truth.country && place.country && normalize(truth.country) !== normalize(place.country)) return false;
  return true;
}
function matchCount(places, expected) {
  // Maximum bipartite match; greedy matching can incorrectly fail overlapping aliases.
  const matched = Array(expected.length).fill(-1);
  function visit(p, seen) {
    for (let t = 0; t < expected.length; t++) if (!seen.has(t) && match(places[p], expected[t])) {
      seen.add(t);
      if (matched[t] < 0 || visit(matched[t], seen)) { matched[t] = p; return true; }
    }
    return false;
  }
  return places.reduce((n, _, p) => n + Number(visit(p, new Set())), 0);
}
export function scoreCase(input, label, observation) {
  const places = observation.places ?? [], candidates = observation.candidates ?? [];
  const observationAvailable = observation.observationAvailable !== false;
  const exactLabelEligible = input.kind === 'real' && ['VERIFIED_EXACT_SINGLE', 'VERIFIED_MULTI'].includes(label.label);
  const exactEligible = exactLabelEligible && observationAvailable;
  const expected = label.expectedPlaces ?? [];
  const tp = exactEligible ? matchCount(places, expected) : null;
  const exactSet = exactEligible ? tp === expected.length && places.length === expected.length : null;
  const multiExpected = label.label === 'VERIFIED_MULTI';
  const multiCorrect = !observationAvailable || label.multiPlaceExpected == null ? null : observation.multiPlaceDecision === label.multiPlaceExpected;
  const autonomous = observation.autonomous === true && observation.status === 'completed';
  const correctAutonomous = exactEligible ? autonomous && exactSet && (!multiExpected || multiCorrect) : null;
  const top1 = label.label === 'VERIFIED_EXACT_SINGLE' && exactEligible ? Boolean(candidates[0] && match(candidates[0], expected[0])) : null;
  const geographyAdjudicated = ['VERIFIED_EXACT_SINGLE', 'VERIFIED_MULTI', 'VERIFIED_REGION_ONLY'].includes(label.label);
  const wrongCountry = geographyAdjudicated && autonomous && label.country && places.some((p) => p.country) ? places.some((p) => p.country && normalize(p.country) !== normalize(label.country)) : null;
  const wrongRegion = geographyAdjudicated && autonomous && label.region && places.some((p) => p.region) ? places.some((p) => p.region && normalize(p.region) !== normalize(label.region)) : null;
  const usage = observation.providerUsage ?? [];
  // An empty ledger only means zero with an explicit complete-ledger assertion.
  const costKnown = observationAvailable && observation.providerLedgerComplete === true && usage.every((u) => u.measurement !== 'unknown' && Number.isFinite(u.costUsd));
  const costUsd = costKnown ? usage.reduce((n, u) => n + u.costUsd, 0) : null;
  return {
    caseId: input.caseId, group: input.group, split: input.split, kind: input.kind, label: label.label,
    status: observation.status, autonomous, observationAvailable, exactLabelEligible, exactEligible, exactSet, correctAutonomous, top1,
    predictedCount: places.length, expectedCount: expected.length, tp, multiCorrect, multiExpected,
    wrongCountry, wrongRegion, unsupportedAutosave: observation.unsupportedAutosave ?? null,
    knownNegativeAutosave: observationAvailable && label.label === 'KNOWN_NEGATIVE' ? autonomous : null,
    failedConfidentResult: (observation.status === 'failed' && observation.autonomous === true) || observation.invalidAutonomyObserved === true,
    observationValidationError: observation.observationValidationError ?? null,
    confidence: observation.confidence ?? null, places, candidates,
    candidateRecall: Object.fromEntries([1, 3, 5, candidates.length].map((k) => [String(k), exactEligible ? matchCount(candidates.slice(0, k), expected) / expected.length : null])),
    wallTimeMs: Number.isFinite(observation.wallTimeMs) ? observation.wallTimeMs : null,
    // Adapter can record completed-result latency; it cannot know correctness before labels load.
    timeToCorrectUsableMs: exactSet ? (observation.firstUsableResultMs ?? observation.wallTimeMs ?? null) : null,
    costUsd, retries: observation.retries ?? null, cacheBehavior: observation.cacheBehavior ?? 'unknown',
    failureClass: observation.failureClass ?? null, stages: observation.stages ?? [], boundary: observation.boundary,
  };
}
export function summarize(rows) {
  const submitted = rows.filter((r) => r.kind === 'real'), real = submitted.filter((r) => r.observationAvailable !== false), exact = real.filter((r) => r.exactEligible);
  const autonomous = exact.filter((r) => r.autonomous), correct = exact.filter((r) => r.correctAutonomous);
  const adjudicableAutomatic = real.filter((r) => r.autonomous && (r.exactEligible || r.label === 'KNOWN_NEGATIVE'));
  const single = exact.filter((r) => r.label === 'VERIFIED_EXACT_SINGLE'), multi = exact.filter((r) => r.label === 'VERIFIED_MULTI');
  const sum = (rs, key) => rs.reduce((n, r) => n + (r[key] ?? 0), 0);
  const trueRate = (rs, key) => rate(rs.filter((r) => r[key] === true).length, rs.filter((r) => r[key] !== null).length);
  const p = sum(multi, 'tp'), predicted = sum(multi, 'predictedCount'), expected = sum(multi, 'expectedCount');
  const allCostsKnown = submitted.length > 0 && submitted.every((r) => r.costUsd !== null), total = allCostsKnown ? sum(real, 'costUsd') : null;
  return {
    submittedReal: submitted.length, observedReal: real.length, unavailableObservations: submitted.length - real.length, exactLabeledCases: submitted.filter((r) => r.exactLabelEligible ?? r.exactEligible).length, exactEligible: exact.length, unverifiedExcluded: real.filter((r) => r.label === 'UNVERIFIED').length,
    correctAutonomousResolution: rate(correct.length, exact.length), autonomousCoverage: rate(correct.length, exact.length),
    autonomousResultPrecision: rate(correct.length, adjudicableAutomatic.length),
    autonomousPlacePrecision: rate(sum(autonomous, 'tp'), sum(adjudicableAutomatic, 'predictedCount')),
    single: { exactTop1: trueRate(single, 'top1'), correctAutonomous: trueRate(single, 'correctAutonomous') },
    multi: { cases: multi.length, detection: trueRate(real.filter((r) => r.multiCorrect !== null), 'multiCorrect'), placePrecision: rate(p, predicted), placeRecall: rate(p, expected), f1: predicted + expected ? 2 * p / (predicted + expected) : null, exactSet: trueRate(multi, 'exactSet'), correctAutonomous: trueRate(multi, 'correctAutonomous') },
    safety: { wrongCountry: trueRate(real, 'wrongCountry'), wrongRegion: trueRate(real, 'wrongRegion'), unsupportedAutosave: trueRate(real, 'unsupportedAutosave'), negativeAutosave: trueRate(real, 'knownNegativeAutosave'), failedConfidentResults: rows.filter((r) => r.failedConfidentResult).length, invalidObservations: rows.filter((r) => r.observationValidationError).length },
    latency: { all: distribution(real.map((r) => r.wallTimeMs)), correctUsable: distribution(exact.map((r) => r.timeToCorrectUsableMs)), correctAutonomous: distribution(correct.map((r) => r.wallTimeMs)), review: distribution(real.filter((r) => r.status === 'review').map((r) => r.wallTimeMs)) },
    cost: { totalUsd: total, knownSubmissions: real.filter((r) => r.costUsd !== null).length, costPerSubmission: total === null ? null : total / real.length, costPerCorrectResult: total === null || !exact.some((r) => r.exactSet) ? null : total / exact.filter((r) => r.exactSet).length, costPerCorrectAutonomousResult: total === null || !correct.length ? null : total / correct.length },
    boundaries: [...new Set(rows.map((r) => r.boundary))],
  };
}
export function pairedBootstrap(before, after, iterations = 2000, seed = 731) {
  if (new Set(before.map((r) => r.caseId)).size !== before.length || new Set(after.map((r) => r.caseId)).size !== after.length) throw new Error('paired_duplicate_case');
  const byId = new Map(after.map((r) => [r.caseId, r]));
  if (before.length !== after.length || before.some((r) => !byId.has(r.caseId))) throw new Error('paired_case_set_mismatch');
  for (const row of before) {
    const other = byId.get(row.caseId);
    for (const key of ['group', 'split', 'kind', 'label', 'expectedCount', 'boundary']) if (row[key] !== other[key]) throw new Error(`paired_${key}_mismatch:${row.caseId}`);
  }
  const pairs = before.filter((r) => r.exactEligible && byId.get(r.caseId)?.exactEligible).map((r) => [r, byId.get(r.caseId)]);
  const groups = new Map();
  for (const pair of pairs) { const key = pair[0].group; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(pair); }
  const clusters = [...groups.values()], deltas = [], latencyDeltas = [];
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }
  for (let i = 0; clusters.length && i < iterations; i++) {
    const selected = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]).flat();
    deltas.push(selected.reduce((n, [a, b]) => n + Number(b.correctAutonomous) - Number(a.correctAutonomous), 0) / selected.length);
    const timed = selected.filter(([a, b]) => a.boundary === b.boundary && Number.isFinite(a.wallTimeMs) && Number.isFinite(b.wallTimeMs));
    if (timed.length) latencyDeltas.push(quantile(timed.map((p) => p[1].wallTimeMs), .9) - quantile(timed.map((p) => p[0].wallTimeMs), .9));
  }
  return { submittedPairs: before.length, unavailablePairs: before.filter((r) => r.observationAvailable === false || byId.get(r.caseId).observationAvailable === false).length, pairedCases: pairs.length, independentGroups: clusters.length, iterations, correctAutonomousDelta95: deltas.length ? [quantile(deltas, .025), quantile(deltas, .975)] : null, p90WallClockDelta95: latencyDeltas.length ? [quantile(latencyDeltas, .025), quantile(latencyDeltas, .975)] : null, changedCases: pairs.filter(([a, b]) => a.correctAutonomous !== b.correctAutonomous || a.autonomous !== b.autonomous).map(([a, b]) => ({ caseId: a.caseId, before: a.correctAutonomous, after: b.correctAutonomous, beforeAutonomous: a.autonomous, afterAutonomous: b.autonomous })) };
}
export function paretoFrontier(arms) {
  const comparable = arms.filter((a) => a.gatesPassed === true && Number.isFinite(a.accuracy) && Number.isFinite(a.precision) && Number.isFinite(a.p90) && Number.isFinite(a.cost));
  return comparable.filter((a) => !comparable.some((b) => b !== a && b.boundary === a.boundary && b.datasetHash === a.datasetHash && b.accuracy >= a.accuracy && b.precision >= a.precision && b.p90 <= a.p90 && b.cost <= a.cost && (b.accuracy > a.accuracy || b.precision > a.precision || b.p90 < a.p90 || b.cost < a.cost)));
}
