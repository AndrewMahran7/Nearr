import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { canonicalizePremiumHypothesis } from '../../../services/media-worker/src/premium/premiumCanonicalization.ts';
import { evaluatePremiumRecognitionSafety } from '../../../services/media-worker/src/premium/premiumRecognitionSafety.ts';
import { applyAutomaticDeepReviewPolicy } from '../../../services/media-worker/src/automaticDeep/automaticDeepRecognitionProvider.ts';
import { planAutomaticCompletion } from '../../../lib/automaticCompletion.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const definition = {
  id: 'retained_policy.v2', boundary: 'deterministic_policy_replay',
  variants: Object.fromEntries(['baseline_repaired', 'winner', 'policy_parity'].map((name) => [name, {
    comparisonScope: 'current_source_policy_parity_only', performanceAblation: false,
    transforms: [], placesExecutionModeApplied: false,
    note: 'Variant names identify captured source arms. This adapter does not execute media or Places-session scheduling changes; their dedicated benchmarks supply performance evidence.',
  }])),
};
const loaded = new Map();
function readChecked(ref) {
  const file = path.resolve(root, ref.path);
  if (!file.startsWith(root + path.sep)) throw new Error('evidence_path_outside_repo');
  if (!loaded.has(file)) {
    const bytes = fs.readFileSync(file), digest = crypto.createHash('sha256').update(bytes).digest('hex');
    // Legacy JSONL was captured with Windows CRLF. Git may check it out with LF.
    // Accept only the exact capture or its deterministic newline-only equivalent.
    const normalizedText = bytes.toString('utf8').replace(/\r\n/g, '\n');
    const newlineDigests = [digest, ...[normalizedText, normalizedText.replace(/\n/g, '\r\n')].map((s) => crypto.createHash('sha256').update(s).digest('hex'))];
    if (!newlineDigests.includes(ref.sha256)) throw new Error('evidence_hash_mismatch');
    loaded.set(file, { digest: ref.sha256, actualDigest: digest, rows: bytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse) });
  }
  if (loaded.get(file).digest !== ref.sha256) throw new Error('evidence_hash_mismatch');
  return loaded.get(file).rows.find((row) => row.case_id === ref.caseId);
}
function projection(hypothesis) {
  return { id: hypothesis.canonical?.googlePlaceId ?? null, name: hypothesis.name, locality: hypothesis.city, region: hypothesis.region, country: hypothesis.country, address: hypothesis.canonical?.formattedAddress ?? null };
}
export async function recognize(input, context) {
  const raw = readChecked(input.evidenceRefs.find((r) => r.path.endsWith('model-attempts.jsonl')));
  const retained = readChecked(input.evidenceRefs.find((r) => r.path.endsWith('local-runtime.jsonl')));
  if (!raw || !retained || raw.attempt_id !== retained.attempt_id) throw new Error('unpaired_retained_attempt');
  const start = performance.now(), stages = [], execution = structuredClone(retained.execution), providerReplay = [];
  let lookups = 0;
  // Query replay is admitted only if ALL result IDs have full retained objects.
  // Selected/alternative lists do not generally preserve rejected provider rows.
  for (let d = 0; d < execution.destinations.length; d++) {
    const destination = execution.destinations[d], model = raw.payload?.results[d];
    if (!model) throw new Error('model_runtime_destination_mismatch');
    const modelHypotheses = [model, ...model.alternatives.slice(0, 2).map((a) => ({ ...a, confidence: model.confidence, alternatives: [], supporting_clues: model.supporting_clues, contradictions: model.contradictions, web_research_used: model.web_research_used }))];
    for (let h = 0; h < destination.hypotheses.length; h++) {
      const hypothesis = destination.hypotheses[h], full = [hypothesis.canonical, hypothesis.providerParent, ...(hypothesis.canonicalAlternatives ?? [])].filter(Boolean);
      const byId = new Map(full.map((c) => [c.googlePlaceId, c]));
      const requests = hypothesis.canonicalizationCalls;
      const complete = requests.length > 0 && requests.every((r) => r.resultCount === r.resultIds.length && r.resultIds.every((id) => byId.has(id)) && r.outcome !== 'PROVIDER_FAILURE');
      if (!complete) { providerReplay.push({ name: hypothesis.name, replayed: false, reason: 'full_provider_response_not_retained', calls: requests.length }); continue; }
      const begin = performance.now() - start;
      const canonical = await canonicalizePremiumHypothesis({
        hypothesis: modelHypotheses[h], apiKey: 'local-replay-no-network', signal: context.signal,
        maxCalls: modelHypotheses.length > 1 ? 1 : 2,
        search: async (query) => {
          const request = requests.find((r) => r.query === query);
          if (!request) throw new Error('query_not_in_frozen_provider_evidence');
          lookups++;
          return { ok: true, results: request.resultIds.map((id) => structuredClone(byId.get(id))) };
        },
      });
      Object.assign(hypothesis, { canonicalStatus: canonical.status, canonical: canonical.selected, providerParent: canonical.providerParent, canonicalAlternatives: canonical.alternatives, canonicalizationCalls: canonical.calls });
      stages.push({ name: 'canonicalization_local_replay', startMs: begin, endMs: performance.now() - start });
      providerReplay.push({ name: hypothesis.name, replayed: true, calls: canonical.calls.length });
    }
    const primary = destination.hypotheses[0], begin = performance.now() - start;
    const policy = evaluatePremiumRecognitionSafety({ hypothesis: model, evidenceBasis: primary.evidenceBasis, canonicalStatus: primary.canonicalStatus, canonical: primary.canonical, hypothesisCount: destination.hypotheses.length, destinationCount: execution.destinations.length, allowDistinctiveVisualAutoSave: false });
    Object.assign(destination, policy, { safetyReasons: policy.reasons });
    stages.push({ name: 'premium_policy_replay', startMs: begin, endMs: performance.now() - start });
  }
  const premiumDecisions = execution.destinations.map((d) => d.decision);
  // This conditional replay starts AFTER escalation. It does not synthesize the
  // missing normal-model result, metadata, source geography, or routing decision.
  const ordinary = applyAutomaticDeepReviewPolicy(execution);
  const finalizerCandidates = ordinary.destinations.flatMap((d) => d.hypotheses.filter((h) => h.canonical).map((h) => ({ ...h.canonical, upstreamSafetyDecision: d.decision === 'REJECT' ? 'REJECT' : 'REVIEW' })));
  const begin = performance.now() - start, finalization = planAutomaticCompletion(finalizerCandidates);
  stages.push({ name: 'automatic_deep_and_finalizer_replay', startMs: begin, endMs: performance.now() - start });
  const candidates = ordinary.destinations.flatMap((d) => d.hypotheses.map(projection));
  const places = ordinary.destinations.map((d) => projection(d.hypotheses[0]));
  return {
    caseId: input.caseId, status: finalization.action === 'save' ? 'completed' : ordinary.outcome === 'PREMIUM_TECHNICAL_FAILURE' ? 'failed' : 'review',
    places, candidates, autonomous: finalization.action === 'save', confidence: ordinary.destinations[0]?.hypotheses[0]?.confidence ?? null,
    multiPlaceDecision: ordinary.destinationIntent === 'MULTIPLE_DESTINATIONS' || ordinary.destinations.length > 1,
    unsupportedAutosave: finalization.action === 'save', // Every deep case remains REVIEW by the active policy.
    wallTimeMs: performance.now() - start, firstUsableResultMs: null, stages, retries: 0, cacheBehavior: 'read_only_retained_evidence',
    providerUsage: [{ provider: 'local', operation: 'places_record_replay', calls: lookups, costUsd: 0, measurement: 'measured' }],
    providerLedgerComplete: true, boundary: 'deterministic_policy_replay', failureClass: null,
    replayScope: 'conditional_after_deep_escalation; stored_evidence_basis; canonicalization_only_with_complete_retained_response; no_full_source_metadata_or_geography_reconstruction',
    premiumDecisions, ordinaryDecisions: ordinary.destinations.map((d) => d.decision), finalizationReason: finalization.reason, providerReplay,
    historicalUsageNotInExperimentLedger: { modelCostUsd: raw.estimated_model_cost_usd, modelLatencyMs: raw.timings_ms.sol, totalLatencyMs: raw.timings_ms.total },
  };
}
