/** Local paid-experiment coordinator. It never reads labels or sends provider requests. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(message); };
const finite = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const parse = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const SECRET_NAMES = ['GEMINI_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_PLACES_SERVER_API_KEY', 'OPENAI_API_KEY', 'VAYRIN_OPENAI_API_KEY', 'MEDIA_TRANSCRIPTION_API_KEY'];

/** Account for each physical attempt once. Unsettled calls retain their full reservation. */
export function accountLedger(text) {
  const entries = new Map();
  for (const line of text.split('\n').filter((x) => x.trim())) {
    let row;
    try { row = JSON.parse(line); } catch { fail('incomplete_provider_ledger_requires_reconciliation'); }
    if (!Number.isInteger(row.sequence) || row.sequence < 1 || !finite(row.reservation_usd) || !['reserved', 'complete', 'unknown'].includes(row.status)) fail('invalid_provider_ledger');
    const prior = entries.get(row.sequence);
    if (prior && (prior.request_sha256 !== row.request_sha256 || prior.reservation_usd !== row.reservation_usd || prior.status === 'complete')) fail('provider_ledger_history_changed');
    if (row.status === 'complete' && (!finite(row.cost_usd) || row.cost_usd > row.reservation_usd + 1e-12)) fail('invalid_completed_provider_charge');
    entries.set(row.sequence, row);
  }
  return {
    charged_rate_card_usd: [...entries.values()].filter((x) => x.status === 'complete').reduce((n, x) => n + x.cost_usd, 0),
    reserved_unknown_usd: [...entries.values()].filter((x) => x.status !== 'complete').reduce((n, x) => n + x.reservation_usd, 0),
    dispatched_calls: [...entries.values()].filter((x) => x.dispatch_attempted).length,
    unresolved_attempts: [...entries.values()].filter((x) => x.status !== 'complete').length,
  };
}

export function accountExperiments(root) {
  const result = { charged_rate_card_usd: 0, reserved_unknown_usd: 0, dispatched_calls: 0, unresolved_attempts: 0, batches: [] };
  if (!fs.existsSync(root)) return result;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name), planFile = path.join(directory, 'batch-plan.json');
    if (!fs.existsSync(planFile)) continue;
    const plan = parse(planFile);
    if (plan.version !== 1 || plan.run_directory !== 'runtime') fail('invalid_batch_plan');
    const ledger = path.join(directory, 'runtime', 'provider-ledger.jsonl');
    const amounts = accountLedger(fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8') : '');
    for (const key of ['charged_rate_card_usd', 'reserved_unknown_usd', 'dispatched_calls', 'unresolved_attempts']) result[key] += amounts[key];
    result.batches.push({ batch: entry.name, ...amounts });
  }
  return result;
}

/** Reconcile budget exposure, never billing: a completed batch may retain a
 * fixed-tariff request whose response was lost. Carry its entire reservation.
 * Token-priced calls, unfinished batches and unlisted attempts still block. */
export function verifyFixedRequestCarry(root, file, account) {
  const receipt = parse(file);
  if (receipt.version !== 1 || receipt.scope !== 'budget_admission_only' || !receipt.reason ||
      !Array.isArray(receipt.attempts) || receipt.attempts.length !== account.unresolved_attempts) fail('invalid_fixed_request_carry');
  const seen = new Set(); let reserved = 0;
  for (const item of receipt.attempts) {
    if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(item.batch) || !Number.isInteger(item.sequence) ||
        !account.batches.some((batch) => batch.batch === item.batch && batch.unresolved_attempts > 0) ||
        seen.has(`${item.batch}:${item.sequence}`)) fail('invalid_fixed_request_carry');
    seen.add(`${item.batch}:${item.sequence}`);
    const dir = path.join(root, item.batch), ledger = path.join(dir, 'runtime/provider-ledger.jsonl');
    if (!fs.existsSync(path.join(dir, 'batch-completion.json')) || sha(fs.readFileSync(ledger)) !== item.ledger_sha256) fail('fixed_carry_requires_immutable_completed_batch');
    const entry = fs.readFileSync(ledger, 'utf8').split('\n').filter((s) => s.trim()).map(JSON.parse)
      .filter((row) => row.sequence === item.sequence).at(-1);
    const rates = parse(path.join(dir, 'config.json')).budget.rates;
    const rate = rates.find((r) => sha(JSON.stringify(r)) === entry?.rate_card_sha256);
    if (!entry || entry.status !== 'unknown' || entry.dispatch_attempted !== true || entry.cost_usd !== null ||
        !['provider_aborted_charge_unknown', 'provider_transport_charge_unknown'].includes(entry.failure_code) ||
        !['google_text_search', 'google_legacy_search', 'google_geocode'].includes(entry.operation) ||
        !rate || rate.operation !== entry.operation || !finite(rate.requestUsd) || rate.requestUsd <= 0 ||
        rate.requestUsd !== entry.reservation_usd || rate.maxRequestUsd !== entry.reservation_usd ||
        item.request_sha256 !== entry.request_sha256 || item.reserved_upper_usd !== entry.reservation_usd) fail('unbounded_or_unmatched_fixed_request_carry');
    reserved += entry.reservation_usd;
  }
  if (account.batches.some((batch) => receipt.attempts.filter((item) => item.batch === batch.batch).length !== batch.unresolved_attempts)) fail('fixed_carry_attempt_set_mismatch');
  if (Math.abs(reserved - account.reserved_unknown_usd) > 1e-12) fail('fixed_carry_reservation_mismatch');
  return { receipt_sha256: sha(fs.readFileSync(file)), carried_upper_usd: reserved,
    billing_still_unknown: true, treatment: 'Full reservation remains in cumulative committed exposure; no cost is imputed into provider ledgers.' };
}

/** Do not inherit application/DB credentials. Only explicit provider keys enter the child. */
export function providerEnvironment(envText, parent = process.env) {
  const child = {};
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'LANG', 'LC_ALL']) if (parent[name]) child[name] = parent[name];
  for (const name of SECRET_NAMES) if (parent[name]?.trim()) child[name] = parent[name].trim();
  for (const line of envText.split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !SECRET_NAMES.includes(match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    if (/[\r\n]/.test(value)) fail('multiline_provider_credential_not_supported');
    if (!child[match[1]] && value) child[match[1]] = value;
  }
  return child;
}

export function verifyRuntimeSnapshot(root) {
  root = path.resolve(root);
  const receiptFile = path.join(root, 'runtime-snapshot.json');
  const receipt = parse(receiptFile);
  if (receipt.version !== 1 || !Array.isArray(receipt.files) || !receipt.files.length) fail('invalid_runtime_snapshot');
  const paths = new Set();
  for (const entry of receipt.files) {
    const file = path.resolve(root, entry.path);
    if (typeof entry.path !== 'string' || !file.startsWith(root + path.sep) || paths.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('invalid_runtime_snapshot_file');
    paths.add(entry.path);
    if (fs.lstatSync(file).isSymbolicLink() || sha(fs.readFileSync(file)) !== entry.sha256) fail('runtime_snapshot_hash_mismatch');
  }
  if (!paths.has('services/media-worker/src/cli/recognitionGoldInference.ts')) fail('runtime_snapshot_cli_missing');
  return sha(fs.readFileSync(receiptFile));
}

export function launchBatch({ root, batch, inputsFile, configFile, credentialEnv, tsxLoader, expected, runtimeRoot, fixedRequestCarry, projectCapUsd = 50, execute = false, child = spawnSync }) {
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(batch)) fail('invalid_batch_name');
  if (!finite(projectCapUsd) || projectCapUsd > 50) fail('authorized_cap_cannot_exceed_50_usd');
  if (!expected || !finite(expected.usd) || !Number.isInteger(expected.calls) || expected.calls < 1 || !Array.isArray(expected.providers) || !expected.providers.length || !expected.basis) fail('prebatch_expected_estimate_required');
  const config = parse(configFile), inputs = parse(inputsFile);
  if (!Array.isArray(inputs) || !inputs.length || !inputs.every((p) => typeof p === 'string')) fail('neutral_input_path_array_required');
  if (!finite(config.budget?.maxUsd) || config.budget.maxUsd > projectCapUsd || expected.usd > config.budget.maxUsd || !Number.isInteger(config.budget.maxCalls) || config.budget.maxCalls < expected.calls) fail('invalid_batch_budget');
  root = path.resolve(root);
  fs.mkdirSync(root, { recursive: true });
  const lockPath = path.join(root, '.paid-batch.lock');
  let lock;
  try { lock = fs.openSync(lockPath, 'wx'); } catch { fail('another_paid_batch_or_stale_lock_requires_inspection'); }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, batch, created_at: new Date().toISOString() }));
  try {
    const account = accountExperiments(root), committed = account.charged_rate_card_usd + account.reserved_unknown_usd;
    if (account.unresolved_attempts && !fixedRequestCarry) fail('unresolved_paid_attempts_require_reconciliation');
    const carry = account.unresolved_attempts ? verifyFixedRequestCarry(root, fixedRequestCarry, account) : null;
    if (committed + config.budget.maxUsd > projectCapUsd + 1e-12) fail('cumulative_experiment_budget_exceeded');
    const repo = runtimeRoot ? path.resolve(runtimeRoot) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const snapshotHash = runtimeRoot ? verifyRuntimeSnapshot(repo) : null;
    const cli = path.join(repo, 'services/media-worker/src/cli/recognitionGoldInference.ts');
    const configBytes = fs.readFileSync(configFile), inputBytes = fs.readFileSync(inputsFile);
    const plan = { version: 1, batch, created_at: new Date().toISOString(), input_count: inputs.length, inputs_sha256: sha(inputBytes), configuration_sha256: sha(configBytes), expected_calls: expected.calls, expected_providers: expected.providers, expected_usd: expected.usd, expected_basis: expected.basis, worst_case_including_retries_usd: config.budget.maxUsd, worst_case_calls: config.budget.maxCalls, cumulative_prior_committed_usd: committed, authorized_total_cap_usd: projectCapUsd, run_directory: 'runtime', invoice_cost: 'Unknown; accounting uses actual provider usage multiplied by frozen rates, before credits/tax/discounts.', canonical_data_reads: false };
    plan.runtime_snapshot_sha256 = snapshotHash;
    if (carry) plan.fixed_request_carry = carry;
    if (!execute) return { dry_run: true, plan, prior_account: account };
    if (config.budget.allowPaidRequests !== true) fail('paid_requests_disabled');
    const directory = path.join(root, batch);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'batch-plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'config.json'), configBytes, { flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'inputs.json'), inputBytes, { flag: 'wx' });
    const childEnv = providerEnvironment(fs.readFileSync(credentialEnv, 'utf8'));
    const log = fs.openSync(path.join(directory, 'runtime.log'), 'wx');
    let result;
    try {
      result = child(process.execPath, ['--import', pathToFileURL(path.resolve(tsxLoader)).href, cli, '--inputs', path.join(directory, 'inputs.json'), '--config', path.join(directory, 'config.json'), '--out', path.join(directory, 'runtime'), '--execute'], { cwd: repo, env: childEnv, windowsHide: true, stdio: ['ignore', log, log], timeout: Math.min(86_400_000, config.runtime.jobTimeoutMs * inputs.length + 120_000) });
    } finally { fs.closeSync(log); }
    const finalAccount = accountExperiments(root);
    const completion = { finished_at: new Date().toISOString(), exit_code: result.status ?? null, signal: result.signal ?? null, process_error_code: result.error?.code ?? null, account: finalAccount };
    fs.writeFileSync(path.join(directory, 'batch-completion.json'), JSON.stringify(completion, null, 2) + '\n', { flag: 'wx' });
    return completion;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

function main() {
  const args = process.argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute') { opts.execute = true; continue; }
    if (!['--root', '--batch', '--inputs', '--config', '--credential-env', '--tsx-loader', '--expected', '--project-cap-usd', '--runtime-root'].includes(args[i]) || !args[i + 1]) fail('invalid_paid_batch_arguments');
    opts[args[i].slice(2)] = args[++i];
  }
  const result = launchBatch({ root: opts.root, batch: opts.batch, inputsFile: opts.inputs, configFile: opts.config, credentialEnv: opts['credential-env'], tsxLoader: opts['tsx-loader'], runtimeRoot: opts['runtime-root'], expected: parse(opts.expected), projectCapUsd: opts['project-cap-usd'] ? Number(opts['project-cap-usd']) : 50, execute: opts.execute });
  console.log(JSON.stringify(result));
  if (opts.execute && result.exit_code !== 0) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'paid_batch_failed'); process.exitCode = 1; }
}
