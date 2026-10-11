import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from './core.mjs';
import { freezeInferenceRun, verifyFrozenRun } from './experimentsCli.mjs';
import { assembleNoDispatchContinuation } from './resumeFrozen.mjs';

test('continuation preserves attempted failures and unknown charges; only zero-dispatch records can resume', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-resume-'));
  try {
    const entry = { sequence: 1, reservation_usd: .032, cost_usd: null, status: 'unknown',
      dispatch_attempted: true, request_sha256: 'attempted', operation: 'google_text_search' };
    const make = (letter, extra) => ({ input_id: 'i_' + letter.repeat(24), input_sha256: 'a'.repeat(64), view: 'full',
      status: 'failed', autonomous: false, places: [], candidates: [], elapsed_ms: 1, first_usable_result_ms: null,
      provider_calls: 0, entries: [], cost_usd: null, error_code: 'provider_aborted_charge_unknown', ...extra });
    const attempted = make('a', { entries: [entry], provider_calls: 1, elapsed_ms: 6000 });
    const blocked = make('b', {});
    const resumed = make('b', { status: 'review', error_code: undefined, elapsed_ms: 50, provider_calls: 1,
      cost_usd: .01, entries: [{ ...entry, request_sha256: 'resumed', status: 'complete', cost_usd: .01 }] });
    function freeze(name, rows, budget = 9.5, model = 'same') {
      const staging = path.join(root, name), out = staging + '-frozen'; fs.mkdirSync(staging);
      const configuration = { runtime: { model }, budget: { maxUsd: budget, maxCalls: 100 }, decisionContext: {} };
      const files = { 'run.json': { configuration, configuration_sha256: sha256(JSON.stringify(configuration)), runtime_sources: { sha256: 'unchanged' },
        inputs: rows.map((r) => ({ input_id: r.input_id, input_sha256: r.input_sha256 })) },
      'completion.json': { inputs: rows.length } };
      for (const [file, value] of Object.entries(files)) fs.writeFileSync(path.join(staging, file), JSON.stringify(value));
      fs.writeFileSync(path.join(staging, 'observations.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
      fs.writeFileSync(path.join(staging, 'provider-ledger.jsonl'), rows.flatMap((r) => r.entries).map(JSON.stringify).join('\n') + '\n');
      freezeInferenceRun(staging, out); return out;
    }
    const parent = freeze('parent', [attempted, blocked]), continuation = freeze('continuation', [resumed], 8.5);
    const args = { parent, continuation, stoppedReason: 'provider_aborted_charge_unknown', staging: path.join(root, 'merged'), out: path.join(root, 'frozen') };
    assembleNoDispatchContinuation(args);
    const rows = verifyFrozenRun(args.out).observations;
    assert.equal(rows[0].status, 'failed'); assert.equal(rows[0].cost_usd, null);
    assert.equal(rows[1].status, 'review'); assert.equal(rows[1].elapsed_ms, 51);
    assert.equal(rows[1].entries[0].sequence, 2);
    const completion = JSON.parse(fs.readFileSync(path.join(args.out, 'completion.json')));
    assert.equal(completion.known_cost_usd, .01); assert.equal(completion.reserved_unknown_usd, .032);
    assert.equal(completion.provider_ledger_complete, false); assert.equal(completion.cost_usd, null);
    assert.equal(completion.failures, 1);
    const selectedAttempt = freeze('bad-selection', [{ ...resumed, input_id: attempted.input_id }]);
    assert.throws(() => assembleNoDispatchContinuation({ ...args, continuation: selectedAttempt }), /exact_zero_dispatch_set/);
    const changedModel = freeze('changed-model', [resumed], 8.5, 'different');
    assert.throws(() => assembleNoDispatchContinuation({ ...args, continuation: changedModel }), /recognition_or_runtime_changed/);
  } finally {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('nearr-resume-')) throw new Error('unsafe_cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
