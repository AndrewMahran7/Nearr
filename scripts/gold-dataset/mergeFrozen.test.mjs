import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from './core.mjs';
import { freezeInferenceRun, verifyFrozenRun } from './experimentsCli.mjs';
import { mergeFrozenBatches } from './mergeFrozen.mjs';

test('merge preserves measured outcomes, parent receipts and uniquely scoped physical calls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-merge-'));
  try {
    const config = { version: 1, same: 'configuration' }, configHash = sha256(JSON.stringify(config));
    const make = (name, digit) => {
      const dir = path.join(root, name); fs.mkdirSync(dir);
      const entry = { sequence: 1, request_sha256: digit.repeat(64), reservation_usd: 1, cost_usd: .1, status: 'complete', dispatch_attempted: true };
      const observation = { input_id: 'i_' + digit.repeat(24), input_sha256: digit.repeat(64), view: 'full', status: 'review', autonomous: false, places: [], candidates: [], multi_place_detected: false, cost_usd: .1, elapsed_ms: 1000, entries: [entry], provider_ledger_complete: true };
      const values = { 'run.json': { configuration: config, configuration_sha256: configHash, runtime_sources: { sha256: 'a'.repeat(64) }, inference_boundary: 'retained_timed_evidence_live_runtime', inputs: [{ input_id: observation.input_id, input_sha256: observation.input_sha256 }] },
        'completion.json': { inputs: 1, provider_ledger_complete: true, cost_usd: .1 } };
      for (const [file, value] of Object.entries(values)) fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
      fs.writeFileSync(path.join(dir, 'observations.jsonl'), JSON.stringify(observation) + '\n');
      fs.writeFileSync(path.join(dir, 'provider-ledger.jsonl'), JSON.stringify(entry) + '\n');
      const frozen = dir + '-frozen'; freezeInferenceRun(dir, frozen); return frozen;
    };
    const a = make('a', '1'), b = make('b', '2');
    const spec = { version: 1, parents: [a, b], allowed_configuration_sha256: [configHash], allowed_runtime_sha256: ['a'.repeat(64)], equivalence_reason: 'same synthetic configuration and runtime' };
    const result = mergeFrozenBatches(spec, path.join(root, 'stage'), path.join(root, 'merged'));
    const merged = verifyFrozenRun(result.directory), parents = [verifyFrozenRun(a), verifyFrozenRun(b)];
    assert.equal(merged.observations.length, 2);
    assert.deepEqual(merged.observations.map((o) => o.entries[0].sequence), [1, 2]);
    assert.deepEqual(merged.observations.map((o) => o.elapsed_ms), [1000, 1000]);
    assert.deepEqual(merged.observations.map((o) => o.assembled_from.frozen_receipt_sha256), parents.map((p) => p.receipt_sha256));
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.directory, 'completion.json'))).cost_usd, .2);
    assert.throws(() => mergeFrozenBatches({ ...spec, parents: [a, a] }, path.join(root, 'bad'), path.join(root, 'bad-frozen')), /duplicate_source_batch/);
    assert.throws(() => mergeFrozenBatches({ ...spec, allowed_runtime_sha256: [] }, path.join(root, 'bad'), path.join(root, 'bad-frozen')), /unapproved_source/);
    const overlap = make('overlap', '1');
    assert.throws(() => mergeFrozenBatches({ ...spec, parents: [a, overlap] }, path.join(root, 'bad'), path.join(root, 'bad-frozen')), /overlapping_inference_cohorts/);
    fs.appendFileSync(path.join(a, 'observations.jsonl'), ' ');
    assert.throws(() => mergeFrozenBatches(spec, path.join(root, 'bad'), path.join(root, 'bad-frozen')), /frozen_run_hash_mismatch/);
  } finally {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('nearr-merge-')) throw new Error('unsafe_cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
