import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { accountLedger, accountExperiments, providerEnvironment, launchBatch, verifyRuntimeSnapshot, verifyFixedRequestCarry } from './paidBatch.mjs';

const line = (row) => JSON.stringify(row) + '\n';
test('fixed-price timeout carry reserves the full upper bound without claiming settled billing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-fixed-carry-'));
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  try {
    const prior = path.join(root, 'prior'); fs.mkdirSync(path.join(prior, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(prior, 'batch-plan.json'), JSON.stringify({ version: 1, run_directory: 'runtime' }));
    fs.writeFileSync(path.join(prior, 'batch-completion.json'), '{}');
    const rate = { operation: 'google_text_search', requestUsd: .032, maxRequestUsd: .032 };
    fs.writeFileSync(path.join(prior, 'config.json'), JSON.stringify({ budget: { rates: [rate] } }));
    const entry = { sequence: 1, operation: rate.operation, request_sha256: 'bounded-request',
      rate_card_sha256: hash(JSON.stringify(rate)), reservation_usd: .032, status: 'unknown',
      cost_usd: null, dispatch_attempted: true, failure_code: 'provider_aborted_charge_unknown' };
    const ledger = path.join(prior, 'runtime/provider-ledger.jsonl'); fs.writeFileSync(ledger, line(entry));
    const receipt = { version: 1, scope: 'budget_admission_only', reason: 'synthetic lost response', attempts: [{
      batch: 'prior', sequence: 1, request_sha256: entry.request_sha256, reserved_upper_usd: .032,
      ledger_sha256: hash(fs.readFileSync(ledger)) }] };
    const carry = path.join(root, 'carry.json'); fs.writeFileSync(carry, JSON.stringify(receipt));
    const account = accountExperiments(root);
    const result = verifyFixedRequestCarry(root, carry, account);
    assert.equal(result.carried_upper_usd, .032); assert.equal(result.billing_still_unknown, true);
    assert.equal(account.charged_rate_card_usd, 0); assert.equal(account.reserved_unknown_usd, .032);
    const config = path.join(root, 'next.json'), inputs = path.join(root, 'inputs.json');
    fs.writeFileSync(config, JSON.stringify({ budget: { maxUsd: 49.98, maxCalls: 5, allowPaidRequests: true } }));
    fs.writeFileSync(inputs, '["neutral/input.json"]');
    const args = { root, batch: 'next', inputsFile: inputs, configFile: config, fixedRequestCarry: carry,
      expected: { usd: .5, calls: 1, providers: ['google'], basis: 'synthetic bounded continuation' } };
    assert.throws(() => launchBatch(args), /cumulative_experiment_budget_exceeded/);
    fs.writeFileSync(config, JSON.stringify({ budget: { maxUsd: 1, maxCalls: 5, allowPaidRequests: true } }));
    assert.equal(launchBatch(args).plan.cumulative_prior_committed_usd, .032);
    assert.equal(launchBatch(args).plan.fixed_request_carry.billing_still_unknown, true);
    receipt.attempts[0].reserved_upper_usd = 0; fs.writeFileSync(carry, JSON.stringify(receipt));
    assert.throws(() => verifyFixedRequestCarry(root, carry, account), /unbounded_or_unmatched/);
    receipt.attempts[0].reserved_upper_usd = .032;
    fs.writeFileSync(ledger, line({ ...entry, operation: 'openai_responses' }));
    receipt.attempts[0].ledger_sha256 = hash(fs.readFileSync(ledger)); fs.writeFileSync(carry, JSON.stringify(receipt));
    assert.throws(() => verifyFixedRequestCarry(root, carry, account), /unbounded_or_unmatched/);
    fs.writeFileSync(ledger, line(entry));
    assert.throws(() => verifyFixedRequestCarry(root, carry, account), /immutable_completed_batch/);
  } finally {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('nearr-fixed-carry-')) throw new Error('unsafe_cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
test('cumulative ledger counts completed attempts once and retains unknown reservations', () => {
  const reserved = { sequence: 1, request_sha256: 'a', reservation_usd: 2, status: 'reserved', cost_usd: null, dispatch_attempted: false };
  const complete = { ...reserved, status: 'complete', cost_usd: .1, dispatch_attempted: true };
  const unknown = { ...reserved, sequence: 2, request_sha256: 'b', status: 'unknown', dispatch_attempted: true };
  assert.deepEqual(accountLedger(line(reserved) + line(complete) + line(unknown)), { charged_rate_card_usd: .1, reserved_unknown_usd: 2, dispatched_calls: 2, unresolved_attempts: 1 });
  assert.throws(() => accountLedger(line(reserved) + '{'), /requires_reconciliation/);
  assert.throws(() => accountLedger(line(reserved) + line({ ...complete, request_sha256: 'changed' })), /history_changed/);
});

test('child environment excludes application secrets and does not execute shell text', () => {
  const env = providerEnvironment('GEMINI_API_KEY="literal-$()-value"\nSUPABASE_SERVICE_ROLE_KEY=forbidden\nGOOGLE_PLACES_KEY=maps # local\n', { PATH: 'bin', SUPABASE_SERVICE_ROLE_KEY: 'secret', RAILWAY_TOKEN: 'secret' });
  assert.deepEqual(env, { PATH: 'bin', GEMINI_API_KEY: 'literal-$()-value', GOOGLE_PLACES_KEY: 'maps' });
});

test('admission refuses cumulative overspend and unresolved calls before launching a child', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-budget-'));
  try {
    const prior = path.join(root, 'prior'); fs.mkdirSync(path.join(prior, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(prior, 'batch-plan.json'), JSON.stringify({ version: 1, run_directory: 'runtime' }));
    const entry = { sequence: 1, request_sha256: 'a', reservation_usd: 49, status: 'complete', cost_usd: 49, dispatch_attempted: true };
    fs.writeFileSync(path.join(prior, 'runtime/provider-ledger.jsonl'), line(entry));
    const config = path.join(root, 'config.json'), inputs = path.join(root, 'inputs.json');
    fs.writeFileSync(config, JSON.stringify({ budget: { maxUsd: 2, maxCalls: 5, allowPaidRequests: true }, runtime: { jobTimeoutMs: 1000 } }));
    fs.writeFileSync(inputs, JSON.stringify(['neutral/input.json']));
    let called = false;
    const args = { root, batch: 'next', inputsFile: inputs, configFile: config, expected: { usd: .5, calls: 1, providers: ['google'], basis: 'synthetic control' }, execute: true, child: () => { called = true; } };
    assert.throws(() => launchBatch(args), /cumulative_experiment_budget_exceeded/);
    fs.writeFileSync(path.join(prior, 'runtime/provider-ledger.jsonl'), line({ ...entry, status: 'unknown', cost_usd: null }));
    assert.throws(() => launchBatch(args), /unresolved_paid_attempts_require_reconciliation/);
    assert.equal(called, false);
    assert.equal(fs.existsSync(path.join(root, '.paid-batch.lock')), false);
  } finally {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('nearr-budget-')) throw new Error('unsafe_cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('snapshot admission binds copied code bytes and rejects changes or path escapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-budget-snapshot-'));
  try {
    const relative = 'services/media-worker/src/cli/recognitionGoldInference.ts';
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'synthetic runtime');
    const receipt = { version: 1, files: [{ path: relative, sha256: createHash('sha256').update('synthetic runtime').digest('hex') }] };
    fs.writeFileSync(path.join(root, 'runtime-snapshot.json'), JSON.stringify(receipt));
    assert.match(verifyRuntimeSnapshot(root), /^[a-f0-9]{64}$/);
    fs.writeFileSync(file, 'mutated runtime');
    assert.throws(() => verifyRuntimeSnapshot(root), /runtime_snapshot_hash_mismatch/);
    receipt.files[0].path = '../outside';
    fs.writeFileSync(path.join(root, 'runtime-snapshot.json'), JSON.stringify(receipt));
    assert.throws(() => verifyRuntimeSnapshot(root), /invalid_runtime_snapshot_file/);
  } finally {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('nearr-budget-snapshot-')) throw new Error('unsafe_cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
