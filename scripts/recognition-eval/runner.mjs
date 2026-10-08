import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { scoreCase, summarize, pairedBootstrap } from './metrics.mjs';

export const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
export function writeOnce(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { flag: 'wx' });
}
export function csv(rows, columns) {
  const cell = (v) => { const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[\r\n",]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return [columns.join(','), ...rows.map((row) => columns.map((k) => cell(row[k])).join(','))].join('\n') + '\n';
}
export function validateDataset(inputs, labels) {
  const ids = new Set(), groups = new Map();
  const labelById = new Map(labels.map((x) => [x.caseId, x]));
  if (labelById.size !== labels.length) throw new Error('duplicate_labels');
  for (const input of inputs) {
    if (ids.has(input.caseId)) throw new Error(`duplicate_case:${input.caseId}`);
    if (!input.group || !['TRAIN_DEVELOPMENT', 'CALIBRATION', 'HELD_OUT_TEST'].includes(input.split)) throw new Error(`invalid_split:${input.caseId}`);
    if (groups.has(input.group) && groups.get(input.group) !== input.split) throw new Error(`group_leakage:${input.group}`);
    const label = labelById.get(input.caseId);
    if (!label) throw new Error(`missing_label:${input.caseId}`);
    if (!['VERIFIED_EXACT_SINGLE', 'VERIFIED_MULTI', 'VERIFIED_REGION_ONLY', 'KNOWN_NEGATIVE', 'UNVERIFIED'].includes(label.label)) throw new Error(`invalid_label:${input.caseId}`);
    if (['VERIFIED_EXACT_SINGLE', 'VERIFIED_MULTI'].includes(label.label) && (!label.expectedPlaces?.length || !label.provenance?.length)) throw new Error(`unproven_exact_label:${input.caseId}`);
    if (label.label === 'VERIFIED_MULTI' && (label.expectedPlaces.length < 2 || !label.completeSetEstablished)) throw new Error(`incomplete_multi_truth:${input.caseId}`);
    if (input.split === 'HELD_OUT_TEST' && input.exposure === 'historical_outcomes_already_exposed') throw new Error(`exposed_heldout:${input.caseId}`);
    ids.add(input.caseId); groups.set(input.group, input.split);
  }
  if (labelById.size !== ids.size) throw new Error('orphan_labels');
}
export function validateObservation(input, o) {
  if (!o || o.caseId !== input.caseId || !['completed', 'review', 'failed'].includes(o.status)) throw new Error(`invalid_observation:${input.caseId}`);
  if (!['deterministic_policy_replay', 'retained_historical_observation', 'local_media_microbenchmark', 'fresh_end_to_end'].includes(o.boundary)) throw new Error(`missing_boundary:${input.caseId}`);
  if (o.status !== 'completed' && o.autonomous === true) throw new Error(`failed_or_review_autonomy:${input.caseId}`);
  if (!Array.isArray(o.places) || !Array.isArray(o.candidates) || !Array.isArray(o.providerUsage)) throw new Error(`missing_observation_fields:${input.caseId}`);
  if (o.wallTimeMs !== null && (!Number.isFinite(o.wallTimeMs) || o.wallTimeMs < 0)) throw new Error(`invalid_wall_clock:${input.caseId}`);
  for (const u of o.providerUsage) if (!['measured', 'retained', 'estimated', 'unknown'].includes(u.measurement) || !Number.isInteger(u.calls) || u.calls < 0 || (u.costUsd !== null && (!Number.isFinite(u.costUsd) || u.costUsd < 0))) throw new Error(`invalid_usage:${input.caseId}`);
  for (const span of o.stages ?? []) if (!Number.isFinite(span.startMs) || !Number.isFinite(span.endMs) || span.endMs < span.startMs) throw new Error(`invalid_span:${input.caseId}`);
}
function seal(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(seal); Object.freeze(value); }
  return value;
}
function denyNetwork() {
  const blocked = () => { throw new Error('evaluation_network_disabled'); };
  globalThis.fetch = blocked; http.request = blocked; http.get = blocked; https.request = blocked; https.get = blocked;
  net.connect = blocked; net.createConnection = blocked; tls.connect = blocked; syncBuiltinESMExports();
  // No provider/database credentials are inherited by an adapter. Only audited local
  // adapters are supported; this is a guardrail, not a sandbox for hostile plugins.
  for (const key of Object.keys(process.env)) if (/(TOKEN|SECRET|API_KEY|SERVICE_ROLE|DATABASE_URL|SUPABASE|RAILWAY)/i.test(key)) delete process.env[key];
}
export async function run(args) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const options = Object.fromEntries(args.reduce((pairs, x, i) => x.startsWith('--') ? [...pairs, [x.slice(2), args[i + 1]]] : pairs, []));
  const variant = options.variant;
  if (!variant || !/^[a-z0-9_-]+$/.test(variant)) throw new Error('safe_variant_name_required');
  const datasetDir = path.resolve(root, options.dataset ?? 'artifacts/recognition-optimization-2026-10-08/policy-replay-dataset');
  const frozen = JSON.parse(fs.readFileSync(path.join(datasetDir, 'freeze.json'), 'utf8'));
  const inputBytes = fs.readFileSync(path.join(datasetDir, 'inputs.json'));
  const labelBytes = fs.readFileSync(path.join(datasetDir, 'labels.json'));
  if (hash(inputBytes) !== frozen.inputSha256 || hash(labelBytes) !== frozen.labelSha256) throw new Error('dataset_hash_mismatch');
  const inputs = JSON.parse(inputBytes).cases;
  // Labels are not parsed or passed to the adapter until every observation is durable.
  const split = options.split ?? 'TRAIN_DEVELOPMENT';
  if (split === 'HELD_OUT_TEST') throw new Error('heldout_requires_new_generation_and_explicit_final_run_authorization');
  const selected = inputs.filter((i) => i.split === split);
  if (!selected.length) throw new Error(`empty_split:${split}`);
  const output = path.resolve(root, options.out ?? `artifacts/recognition-optimization-2026-10-08/runs/${variant}`);
  if (fs.existsSync(output)) throw new Error(`immutable_output_exists:${output}`);
  let recognize, adapterProvenance;
  if (options.observations) {
    if (variant === 'baseline_repaired') throw new Error('baseline_repaired_requires_executable_policy_adapter');
    const bytes = fs.readFileSync(path.resolve(root, options.observations)), observed = JSON.parse(bytes).observations;
    const mapped = new Map(observed.map((o) => [o.caseId, o]));
    if (mapped.size !== observed.length) throw new Error('duplicate_retained_observations');
    recognize = async (input) => mapped.get(input.caseId) ?? ({ caseId: input.caseId, status: 'failed', places: [], candidates: [], autonomous: false, multiPlaceDecision: null, wallTimeMs: null, providerUsage: [], providerLedgerComplete: false, boundary: 'retained_historical_observation', failureClass: 'stored_observation_unavailable' });
    adapterProvenance = { kind: 'retained_historical_observation', sha256: hash(bytes) };
  } else {
    const adapterName = options.adapter ?? 'retained-policy';
    if (!/^[a-z0-9_-]+$/.test(adapterName)) throw new Error('audited_local_adapter_required');
    const file = path.join(root, 'scripts/recognition-eval/adapters', `${adapterName}.mjs`);
    adapterProvenance = { path: path.relative(root, file), sha256: hash(fs.readFileSync(file)) };
    denyNetwork(); ({ recognize } = await import(pathToFileURL(file).href));
    if (typeof recognize !== 'function') throw new Error('adapter_recognize_export_required');
  }
  const sourcePaths = ['services/media-worker/src/premium/premiumCanonicalization.ts', 'services/media-worker/src/premium/premiumRecognitionSafety.ts', 'services/media-worker/src/automaticDeep/automaticDeepRecognitionProvider.ts', 'lib/automaticCompletion.ts', 'lib/exactIdentitySafety.ts'];
  const sourceProvenance = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), files: sourcePaths.map((file) => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })) };
  writeOnce(path.join(output, 'run.json'), JSON.stringify({ schemaVersion: 1, variant, split, startedAt: new Date().toISOString(), inputSha256: frozen.inputSha256, labelSha256: frozen.labelSha256, adapterProvenance, sourceProvenance, paidSpendUsd: 0, observationCount: selected.length }, null, 2) + '\n');
  const observations = [];
  for (const input of selected) {
    let observed;
    try { observed = await recognize(seal(structuredClone(input)), { variant, signal: new AbortController().signal }); validateObservation(input, observed); }
    catch (error) { observed = { caseId: input.caseId, status: 'failed', places: [], candidates: [], autonomous: false, multiPlaceDecision: null, wallTimeMs: null, providerUsage: [], providerLedgerComplete: false, boundary: 'deterministic_policy_replay', failureClass: `adapter_failure:${String(error.message).slice(0, 200)}` }; }
    observations.push(observed);
    writeOnce(path.join(output, 'observations', `${input.caseId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`), JSON.stringify(observed, null, 2) + '\n');
  }
  const labels = JSON.parse(labelBytes).cases;
  validateDataset(inputs, labels);
  const labelMap = new Map(labels.map((l) => [l.caseId, l]));
  const rows = selected.map((input, i) => scoreCase(input, labelMap.get(input.caseId), observations[i]));
  const columns = ['caseId', 'group', 'split', 'kind', 'label', 'boundary', 'status', 'autonomous', 'correctAutonomous', 'exactSet', 'top1', 'tp', 'expectedCount', 'predictedCount', 'multiCorrect', 'wrongCountry', 'wrongRegion', 'unsupportedAutosave', 'wallTimeMs', 'timeToCorrectUsableMs', 'costUsd', 'retries', 'cacheBehavior', 'failureClass', 'places', 'candidates', 'stages'];
  writeOnce(path.join(output, variant === 'baseline_repaired' ? 'baseline_results.csv' : 'per_case_results.csv'), csv(rows, columns));
  writeOnce(path.join(output, 'scores.json'), JSON.stringify(rows, null, 2) + '\n');
  writeOnce(path.join(output, 'summary.json'), JSON.stringify(summarize(rows), null, 2) + '\n');
  const ledger = observations.flatMap((o) => o.providerUsage.map((u) => ({ variant, caseId: o.caseId, boundary: o.boundary, ...u })));
  writeOnce(path.join(output, 'provider_usage_ledger.csv'), csv(ledger, ['variant', 'caseId', 'boundary', 'provider', 'operation', 'calls', 'costUsd', 'measurement']));
  if (options.compare) writeOnce(path.join(output, 'paired_comparison.json'), JSON.stringify(pairedBootstrap(JSON.parse(fs.readFileSync(path.resolve(root, options.compare), 'utf8')), rows), null, 2) + '\n');
  console.log(JSON.stringify({ variant, cases: rows.length, output, paidSpendUsd: 0 }));
  return { rows, summary: summarize(rows) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run(process.argv.slice(2));
