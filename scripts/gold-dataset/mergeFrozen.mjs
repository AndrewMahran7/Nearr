/** Union disjoint frozen inference batches; never selects outcomes or reads labels. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './core.mjs';
import { freezeInferenceRun, verifyFrozenRun } from './experimentsCli.mjs';
import { accountLedger } from './paidBatch.mjs';

const fail = (message) => { throw new Error(message); };
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const write = (file, data) => fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-8;

export function mergeFrozenBatches(spec, staging, out) {
  if (spec.version !== 1 || !Array.isArray(spec.parents) || spec.parents.length < 2 || !spec.equivalence_reason ||
      !Array.isArray(spec.allowed_configuration_sha256) || !Array.isArray(spec.allowed_runtime_sha256)) fail('explicit_merge_provenance_required');
  const sources = spec.parents.map((p) => {
    const verified = verifyFrozenRun(p);
    if (verified.receipt.kind !== 'runtime_inference') fail('merge_only_physical_inference_batches');
    const run = json(path.join(p, 'run.json')), completion = json(path.join(p, 'completion.json'));
    if (!spec.allowed_configuration_sha256.includes(run.configuration_sha256) || !spec.allowed_runtime_sha256.includes(run.runtime_sources?.sha256)) fail('unapproved_source_configuration_or_runtime');
    const ledgerText = fs.readFileSync(path.join(p, 'provider-ledger.jsonl'), 'utf8');
    const accounting = accountLedger(ledgerText);
    if (accounting.unresolved_attempts || completion.provider_ledger_complete !== true ||
        !close(accounting.charged_rate_card_usd, completion.cost_usd) ||
        !close(verified.observations.reduce((n, o) => n + o.cost_usd, 0), completion.cost_usd) ||
        verified.observations.some((o) => o.provider_ledger_complete !== true || !Number.isFinite(o.cost_usd))) fail('source_accounting_incomplete_or_inconsistent');
    return { ...verified, run, completion, accounting, ledger: ledgerText.trim().split('\n').filter(Boolean).map(JSON.parse) };
  });
  if (new Set(sources.map((s) => s.receipt_sha256)).size !== sources.length) fail('duplicate_source_batch');
  const ids = sources.flatMap((s) => s.observations.map((o) => `${o.input_id}\0${o.view}`));
  if (new Set(ids).size !== ids.length) fail('overlapping_inference_cohorts');
  const boundaries = sources.map((s) => s.run.inference_boundary);
  if (new Set(boundaries).size !== 1) fail('inference_boundary_mismatch');
  let sequence = 0;
  const observations = [], ledger = [], parents = [];
  for (const source of sources) {
    const sequenceMap = new Map();
    const remap = (entry) => {
      if (!sequenceMap.has(entry.sequence)) sequenceMap.set(entry.sequence, ++sequence);
      return { ...entry, sequence: sequenceMap.get(entry.sequence), source_sequence: entry.sequence, source_frozen_receipt_sha256: source.receipt_sha256 };
    };
    ledger.push(...source.ledger.map(remap));
    for (const observation of source.observations) {
      if (!Array.isArray(observation.entries) || observation.entries.some((e) => !sequenceMap.has(e.sequence))) fail('observation_ledger_lineage_missing');
      observations.push({ ...observation, entries: observation.entries.map(remap), assembled_from: {
        frozen_receipt_sha256: source.receipt_sha256, original_observation_sha256: sha256(JSON.stringify(observation)),
      } });
    }
    parents.push({ receipt_sha256: source.receipt_sha256, original_frozen_at: source.receipt.frozen_at,
      files: source.receipt.files, configuration_sha256: source.run.configuration_sha256,
      runtime_sha256: source.run.runtime_sources.sha256, observations: source.observations.length });
  }
  const configuration = { version: 1, kind: 'disjoint_frozen_batch_union', equivalence_reason: spec.equivalence_reason, parents };
  const run = { version: 1, started_at: new Date().toISOString(), configuration,
    configuration_sha256: sha256(JSON.stringify(configuration)), inference_boundary: boundaries[0],
    acquisition_included: false, canonical_database_writes: false,
    inputs: observations.map((o) => ({ input_id: o.input_id, input_sha256: o.input_sha256 })),
    runtime_sources: { sha256: sha256(JSON.stringify(parents.map((p) => p.runtime_sha256))), kind: 'explicit_parent_union' },
    interpretation: 'No new inference or outcome selection. Per-case measurements unchanged; sequence numbers are globally scoped. Original pre-scoring freezes remain authoritative.' };
  const accounting = accountLedger(lines(ledger));
  const completion = { completed_at: new Date().toISOString(), inputs: observations.length,
    failures: observations.filter((o) => o.status === 'failed').length, provider_ledger_complete: true,
    provider_calls: accounting.dispatched_calls, cost_usd: accounting.charged_rate_card_usd,
    new_paid_requests: 0, original_parent_frozen_receipts: parents.map((p) => p.receipt_sha256) };
  fs.mkdirSync(staging); // Never overwrite a failed or completed assembly.
  write(path.join(staging, 'run.json'), run);
  write(path.join(staging, 'observations.jsonl'), lines(observations));
  write(path.join(staging, 'provider-ledger.jsonl'), lines(ledger));
  write(path.join(staging, 'completion.json'), completion);
  return freezeInferenceRun(staging, out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--spec', '--staging', '--out'].includes(args[i]) || !args[i + 1] || options[args[i]]) fail('invalid_merge_arguments');
      options[args[i]] = args[i + 1];
    }
    console.log(JSON.stringify(mergeFrozenBatches(json(options['--spec']), options['--staging'], options['--out'])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
