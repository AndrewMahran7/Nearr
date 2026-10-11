/** Label-free finalizer ablation. Reuses frozen provider evidence and proves
 * baseline parity before changing the opt-in veto. Makes no provider requests. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseMediaEvidence } from '../../supabase/functions/process-share-jobs/mediaEvidence.ts';
import { planMediaFinalization } from '../../supabase/functions/process-share-jobs/mediaFinalizationPlanner.ts';
import { observedPlace, scoredCandidates } from '../../services/media-worker/src/evaluation/goldRuntimeAdapter.ts';
import { verifyFrozenRun, freezeInferenceRun } from './experimentsCli.mjs';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const stable = (v: any): string => JSON.stringify(v && typeof v === 'object' ? Array.isArray(v) ? v.map((x) => JSON.parse(stable(x))) : Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, JSON.parse(stable(v[k]))])) : v);

export function replayTenantGuard(source: string, out: string, frozenOut: string, mode: 'tenant' | 'atomic_multi' | 'parent_category' = 'tenant') {
  if (!['tenant', 'atomic_multi', 'parent_category'].includes(mode)) throw new Error('invalid_replay_mode');
  const verified = verifyFrozenRun(source);
  const originalRun = JSON.parse(fs.readFileSync(path.join(source, 'run.json'), 'utf8'));
  const context = originalRun.configuration.decisionContext ?? { autoSaveAuthorized: true, auditRecordPresent: true };
  const rows: any[] = []; let evaluated = 0, changed = 0;
  for (const observation of verified.observations) {
    const e = observation.inference_evidence, original = e?.finalization_plan;
    if (!original || observation.status === 'failed') { rows.push(observation); continue; }
    const parsed = parseMediaEvidence(e.grounded_model_evidence);
    if (!parsed.ok) throw new Error('retained_evidence_parse_failed');
    const args = { groundedEvidence: parsed.value, ordinaryResult: e.resolver_result,
      mediaMentions: e.resolver_input?.mediaMentions, automaticDeepRuntime: e.automatic_deep_runtime,
      sourceGeography: e.source_geography, context };
    const control = planMediaFinalization(args);
    if (stable(control) !== stable(original)) throw new Error('frozen_finalizer_control_parity_failed');
    const started = performance.now();
    const plan = planMediaFinalization({ ...args,
      ...(mode === 'tenant' ? { requireLegacyCandidateIdentity: true } : mode === 'parent_category' ? { legacyParentCategoryVeto: true } :
        { atomicMultiPlace: true, originalMultiPlaceEvidence: e.normal_grounded_model_evidence ?? undefined }) });
    const replayMs = performance.now() - started;
    const places = plan.autonomousPlaces.map((p: any) => observedPlace(p.candidate, p.logicalResultId)).filter(Boolean);
    if (places.some((p) => !observation.places.some((old: any) => stable(p) === stable(old)))) throw new Error('veto_ablation_created_identity');
    if (places.length !== observation.places.length) changed++;
    evaluated++;
    rows.push({ ...observation, status: places.length ? 'completed' : 'review', autonomous: places.length > 0,
      places, candidates: scoredCandidates(plan, e.resolver_result, e.automatic_deep_runtime),
      multi_place_detected: plan.multiPlaceDetected, elapsed_ms: observation.elapsed_ms + replayMs,
      first_usable_result_ms: places.length || plan.reviewCandidates.length ? observation.elapsed_ms + replayMs : null,
      inference_evidence: { ...e, finalization_plan: plan }, runtime_finalization_status: plan.status,
      reason_codes: plan.reasonCodes, per_place_decisions: plan.perPlaceDecisions,
      derived_finalizer_replay: { parent_observation_sha256: hash(JSON.stringify(observation)),
        baseline_control_equal: true, replay_compute_ms: replayMs, physical_provider_requests: 0,
        timing_boundary: 'Retained measured baseline latency plus local veto replay; not a fresh end-to-end latency measurement.',
        cost_boundary: 'Retained original provider cost; zero new paid requests.' } });
  }
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const files = ['scripts/gold-dataset/replayTenantGuard.ts', 'supabase/functions/process-share-jobs/mediaFinalizationPlanner.ts', 'supabase/functions/process-share-jobs/adaptiveLegacyIdentity.ts', 'services/media-worker/src/evaluation/goldRuntimeAdapter.ts'];
  const configuration = { experiment: mode + '_veto_replay_v1',
    ...(mode === 'tenant' ? { legacyTenantIdentity: true } : mode === 'parent_category' ? { legacyParentCategoryVeto: true } : { atomicMultiPlace: true }),
    decisionContext: context, parent_configuration_sha256: originalRun.configuration_sha256,
    parent_receipt_sha256: verified.receipt_sha256, replay_source_hashes: Object.fromEntries(files.map((f) => [f, hash(fs.readFileSync(path.join(repo, f)))])) };
  const run = { ...originalRun, started_at: new Date().toISOString(), configuration,
    configuration_sha256: hash(JSON.stringify(configuration)), derived_from_frozen_run: verified.receipt_sha256,
    measured_fresh_inference: false, new_paid_requests: 0 };
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(run, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(out, 'observations.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { flag: 'wx' });
  for (const f of ['provider-ledger.jsonl', 'completion.json']) fs.copyFileSync(path.join(source, f), path.join(out, f), fs.constants.COPYFILE_EXCL);
  const frozen = freezeInferenceRun(out, frozenOut);
  return { evaluated, changed, observations: rows.length, new_paid_requests: 0, frozen_receipt_sha256: frozen.receipt_sha256 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (![5, 6].includes(process.argv.length)) throw new Error('usage_source_out_frozen_out_optional_mode');
  console.log(JSON.stringify(replayTenantGuard(process.argv[2]!, process.argv[3]!, process.argv[4]!, process.argv[5] as 'tenant' | 'atomic_multi' | 'parent_category' | undefined)));
}
