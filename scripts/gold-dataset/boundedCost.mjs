/** Supplementary sensitivity analysis. Never overwrites primary unknown costs
 * or claims that a reserved maximum is a settled provider bill. */
import { pairedGroupComparison } from './experiments.mjs';
const fail = (reason) => { throw new Error(reason); };
const finite = (v) => Number.isFinite(v) && v >= 0;
export function boundedProviderCost(observation, carriedRequests) {
  if (!Array.isArray(observation.entries)) fail('physical_entries_required_for_cost_bounds');
  let lower = 0, upper = 0, unknown = 0;
  for (const entry of observation.entries) {
    if (entry.status === 'complete' && finite(entry.cost_usd)) {
      lower += entry.cost_usd; upper += entry.cost_usd; continue;
    }
    const carried = carriedRequests.find((r) => r.request_sha256 === entry.request_sha256 &&
      r.reserved_upper_usd === entry.reservation_usd);
    if (!carried || entry.status !== 'unknown' || entry.dispatch_attempted !== true ||
        entry.cost_usd !== null || !finite(entry.reservation_usd) ||
        !['google_text_search', 'google_legacy_search', 'google_geocode'].includes(entry.operation)) {
      fail('unknown_charge_has_no_valid_fixed_request_bound');
    }
    upper += entry.reservation_usd; unknown++;
  }
  if (!unknown && (!finite(observation.cost_usd) || Math.abs(lower - observation.cost_usd) > 1e-8)) fail('measured_cost_bound_mismatch');
  return { lower_usd: lower, upper_usd: upper, unknown_requests: unknown };
}

export function conservativeCostSensitivity(baseline, candidate, baselineObservations, candidateObservations, carriedRequests, options) {
  const identity = (row) => `${row.input_id}\0${row.view}`;
  if (baseline.cohort_sha256 !== candidate.cohort_sha256 || baseline.input_inventory_sha256 !== candidate.input_inventory_sha256 ||
      JSON.stringify(baseline.evaluator) !== JSON.stringify(candidate.evaluator)) fail('bounded_cost_pair_mismatch');
  const bounds = (scores, observations) => {
    const byInput = new Map(observations.map((o) => [identity(o), o]));
    if (byInput.size !== scores.rows.length) fail('bounded_cost_cohort_mismatch');
    return scores.rows.map((row) => {
      const observation = byInput.get(identity(row)); if (!observation) fail('bounded_cost_observation_missing');
      return { row, bound: boundedProviderCost(observation, carriedRequests) };
    });
  };
  const a = bounds(baseline, baselineObservations), b = bounds(candidate, candidateObservations);
  const totals = (rows) => ({ lower_usd: rows.reduce((sum, r) => sum + r.bound.lower_usd, 0),
    upper_usd: rows.reduce((sum, r) => sum + r.bound.upper_usd, 0), unknown_requests: rows.reduce((sum, r) => sum + r.bound.unknown_requests, 0) });
  // Deliberately less favorable than any shared-charge treatment: give baseline
  // every unknown charge its minimum and candidate every unknown its maximum.
  // Each bootstrap draw therefore upper-bounds the actual candidate/base ratio.
  const comparison = pairedGroupComparison(a.map(({ row, bound }) => ({ ...row, cost_usd: bound.lower_usd })),
    b.map(({ row, bound }) => ({ ...row, cost_usd: bound.upper_usd })), baseline.group_universe, options);
  return { version: 1, kind: 'conservative_tariff_bound_sensitivity',
    exact_primary_cost_metrics_unchanged: true, baseline_bounds: totals(a), candidate_bounds: totals(b),
    method: 'Baseline unknown requests assigned their lower bound; candidate unknown requests assigned their reserved upper bound in every connected-group bootstrap draw. These are bounds, not measured costs. Even shared unknown requests are treated adversarially.',
    worst_case_cost_per_correct_autonomous_ratio: comparison.paired_ratios.cost_per_correct_autonomous_ratio,
    worst_case_mean_cost_difference: comparison.metrics.mean_cost_usd,
    bootstrap: { independent_groups: comparison.independent_groups, iterations: comparison.iterations, seed: comparison.seed, confidence: comparison.confidence },
    safety: comparison.safety };
}
