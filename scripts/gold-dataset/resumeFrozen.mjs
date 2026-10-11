/** Resume only zero-dispatch batch-stop records. Never retry or replace a
 * provider-attempted outcome, read labels, or impute unknown provider charges. */
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './core.mjs';
import { freezeInferenceRun, verifyFrozenRun } from './experimentsCli.mjs';
import { accountLedger } from './paidBatch.mjs';
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const fail = (reason) => { throw new Error(reason); };
const identity = (o) => `${o.input_id}\0${o.view}`;
function recognitionConfiguration(config) {
  const copy = structuredClone(config);
  delete copy.budget.maxUsd; delete copy.budget.maxCalls;
  return copy;
}
export function assembleNoDispatchContinuation({ parent, continuation, stoppedReason, staging, out }) {
  if (!['provider_aborted_charge_unknown', 'provider_transport_charge_unknown'].includes(stoppedReason)) fail('unsupported_continuation_reason');
  const sources = [parent, continuation].map((dir) => ({ dir, ...verifyFrozenRun(dir), run: json(path.join(dir, 'run.json')) }));
  if (sources.some((s) => s.receipt.kind !== 'runtime_inference') ||
      JSON.stringify(recognitionConfiguration(sources[0].run.configuration)) !== JSON.stringify(recognitionConfiguration(sources[1].run.configuration)) ||
      JSON.stringify(sources[0].run.runtime_sources) !== JSON.stringify(sources[1].run.runtime_sources)) fail('continuation_recognition_or_runtime_changed');
  const blocked = sources[0].observations.filter((o) => o.status === 'failed' && o.error_code === stoppedReason && o.provider_calls === 0 && Array.isArray(o.entries) && o.entries.length === 0);
  const replacements = new Map(sources[1].observations.map((o) => [identity(o), o]));
  if (!blocked.length || replacements.size !== blocked.length || blocked.some((o) => !replacements.has(identity(o)) || replacements.get(identity(o)).input_sha256 !== o.input_sha256)) fail('continuation_must_replace_exact_zero_dispatch_set');
  let sequence = 0;
  const maps = sources.map(() => new Map());
  const remap = (entry, index) => {
    const map = maps[index]; if (!map.has(entry.sequence)) map.set(entry.sequence, ++sequence);
    return { ...entry, sequence: map.get(entry.sequence), source_sequence: entry.sequence,
      source_frozen_receipt_sha256: sources[index].receipt_sha256 };
  };
  const ledger = sources.flatMap((s, index) => fs.readFileSync(path.join(s.dir, 'provider-ledger.jsonl'), 'utf8')
    .split('\n').filter((x) => x.trim()).map(JSON.parse).map((entry) => remap(entry, index)));
  const observations = sources[0].observations.map((original) => {
    const resumed = replacements.get(identity(original));
    const value = resumed ?? original, index = resumed ? 1 : 0;
    if (!Array.isArray(value.entries) || value.entries.some((entry) => !maps[index].has(entry.sequence))) fail('continuation_ledger_lineage_missing');
    const elapsed = resumed && Number.isFinite(resumed.elapsed_ms) && Number.isFinite(original.elapsed_ms)
      ? resumed.elapsed_ms + original.elapsed_ms : value.elapsed_ms;
    return { ...value, entries: value.entries.map((entry) => remap(entry, index)), elapsed_ms: elapsed,
      first_usable_result_ms: resumed && Number.isFinite(resumed.first_usable_result_ms)
        ? resumed.first_usable_result_ms + original.elapsed_ms : value.first_usable_result_ms,
      continuation_provenance: { original_observation_sha256: sha256(JSON.stringify(original)),
        original_receipt_sha256: sources[0].receipt_sha256, resumed: Boolean(resumed),
        ...(resumed ? { continuation_observation_sha256: sha256(JSON.stringify(resumed)),
          continuation_receipt_sha256: sources[1].receipt_sha256, original_dispatched_calls: 0,
          original_local_check_ms: original.elapsed_ms } : {}) } };
  });
  const account = accountLedger(lines(ledger));
  const configuration = { kind: 'zero_dispatch_infrastructure_continuation', decisionContext: sources[0].run.configuration.decisionContext,
    parent_receipts: sources.map((s) => s.receipt_sha256), original_configuration_sha256: sources[0].run.configuration_sha256,
    continuation_configuration_sha256: sources[1].run.configuration_sha256,
    stopped_reason: stoppedReason, assembly_module_sha256: sha256(fs.readFileSync(new URL(import.meta.url))) };
  fs.mkdirSync(staging);
  const write = (name, value) => fs.writeFileSync(path.join(staging, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  write('run.json', { ...sources[0].run, configuration, configuration_sha256: sha256(JSON.stringify(configuration)),
    interpretation: 'Only records with zero physical provider calls resume. Original provider-attempted failures stay failed. Local check time and every request remain accounted. No heldout labels or scores are read.' });
  write('observations.jsonl', lines(observations)); write('provider-ledger.jsonl', lines(ledger));
  write('completion.json', { inputs: observations.length, failures: observations.filter((o) => o.status === 'failed').length,
    provider_calls: account.dispatched_calls, provider_ledger_complete: account.unresolved_attempts === 0,
    cost_usd: account.unresolved_attempts ? null : account.charged_rate_card_usd,
    known_cost_usd: account.charged_rate_card_usd, reserved_unknown_usd: account.reserved_unknown_usd,
    new_paid_requests: 0, resumed_zero_dispatch_cases: blocked.length });
  return freezeInferenceRun(staging, out);
}
