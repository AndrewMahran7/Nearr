/** Pure shared-prefix accounting for the opt-in empty-evidence ablation. */
import { createHash } from 'node:crypto';
import { canReviewEmptyEvidence } from '../automaticDeep/emptyEvidencePolicy.js';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

export function emptyEvidenceReplayObservation(original: any) {
  const started = performance.now();
  const e = original.inference_evidence;
  const normal = e?.normal_model_evidence;
  const entries = original.entries ?? [];
  const firstDeep = entries.findIndex((entry: any) => entry.operation === 'openai_responses');
  // The automatic wrapper preserves normal parse diagnostics. Demand successful
  // normal-provider transport as well as a valid empty schema, and a real Deep
  // boundary. Missing provenance cannot be interpreted as a healthy empty pass.
  const prefix = firstDeep > 0 ? entries.slice(0, firstDeep) : [];
  const healthyPrefix = prefix.length > 0 && prefix.every((entry: any) =>
    entry.operation === 'gemini_generate' && entry.status === 'complete' &&
    entry.http_status === 200 && entry.dispatch_attempted === true && Number.isFinite(entry.cost_usd));
  const eligible = normal && healthyPrefix && canReviewEmptyEvidence({ evidence: normal,
    parseDiagnostics: e.model_parse_diagnostics, recognitionFailureClass: undefined });
  if (!eligible) return { observation: original, stopped: false, savedUsd: 0 };
  if (original.autonomous || original.places.length) throw new Error('empty_stop_parent_has_autonomous_output');
  if (!original.provider_ledger_complete || !Number.isFinite(original.cost_usd) ||
      entries.some((entry: any) => entry.status !== 'complete' || !Number.isFinite(entry.cost_usd))) {
    throw new Error('empty_stop_requires_complete_measured_ledger');
  }
  const cost = prefix.reduce((sum: number, entry: any) => sum + entry.cost_usd, 0);
  const overhead = performance.now() - started;
  const observation = { ...original, status: 'review', autonomous: false, places: [], candidates: [],
    multi_place_detected: false, first_usable_result_ms: null,
    elapsed_ms: original.elapsed_ms == null ? null : original.elapsed_ms + overhead,
    entries: prefix.map((entry: any) => ({ ...entry, replayed: true })),
    provider_calls: prefix.length, reserved_attempts: prefix.length, cost_usd: cost,
    cost_basis: 'measured_provider_ledger', committed_budget_usd: cost, stopped_reason: null,
    provider_usage: [{ provider: 'gemini_generate', measurement: 'retained', calls: prefix.length, cost_usd: cost }],
    observed_scoring_pool: [], observed_scoring_pool_available: false,
    inference_evidence: { source_geography: e.source_geography, frame_diversity: e.frame_diversity,
      model_evidence: normal, grounded_model_evidence: e.normal_grounded_model_evidence,
      normal_model_evidence: normal, normal_grounded_model_evidence: e.normal_grounded_model_evidence,
      normal_specificity: e.normal_specificity, model_parse_diagnostics: e.model_parse_diagnostics,
      recognition_failure_class: null, automatic_deep_runtime: null },
    runtime_finalization_status: 'needs_help', reason_codes: ['valid_empty_evidence_requires_review'],
    per_place_decisions: [], automatic_deep: { invoked: false, attempts: 0, emptyEvidenceReview: true },
    routing: { choice: 'review_after_valid_empty_pass', policy_version: 'empty-evidence-review-v1',
      parent_observation_sha256: hash(JSON.stringify(original)), prefix_request_hashes: prefix.map((entry: any) => entry.request_sha256),
      avoided_calls: entries.length - prefix.length, avoided_cost_usd: original.cost_usd - cost,
      provider_requests_dispatched: 0, policy_latency_ms: overhead,
      cost_boundary: 'Counterfactual retained common-prefix usage; no new spending. Original full ledger remains frozen.',
      latency_boundary: 'Conservative original full-run latency plus local policy overhead; no speedup credited.' } };
  return { observation, stopped: true, savedUsd: original.cost_usd - cost };
}

