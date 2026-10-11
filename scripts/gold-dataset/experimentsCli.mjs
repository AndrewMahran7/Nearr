#!/usr/bin/env node
/** Separate trusted scoring/learning process. Planning and neutral application never open labels. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { sha256, scoreOne, summarizeScores, heldoutRunKey, validateManifest, validateLabels, validateSplits, VIEWS } from './core.mjs';
import { EXPERIMENT_VERSION, objectHash, validateObservations, connectedGroups,
  makeLearningRows, fitRouter, calibrateRouter, applyRouter, pairedGroupComparison,
  experimentMetrics, paretoFrontier } from './experiments.mjs';
import { loadEvaluatorAliases } from './evaluatorAliases.mjs';

const fail = (reason) => { throw new Error(reason); };
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const jsonl = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
const serialized = (value) => JSON.stringify(value, null, 2) + '\n';
const lines = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
const hashFile = (file) => sha256(fs.readFileSync(file));
const identity = (row) => `${row.input_id}\0${row.view}`;
const RUN_FILES = Object.freeze(['run.json', 'observations.jsonl', 'provider-ledger.jsonl', 'completion.json']);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inputInventory = (observations) => objectHash(observations.map((o) => ({ input_id: o.input_id, view: o.view, input_sha256: o.input_sha256 })).sort((a, b) => identity(a).localeCompare(identity(b))));
const autonomousSignature = (observation) => objectHash({ autonomous: observation.autonomous,
  places: observation.autonomous ? observation.places.map((p) => objectHash({ place_id: p.place_id ?? null,
    name: String(p.name ?? '').trim().toLowerCase(), coordinates: p.coordinates ?? null,
    country: p.country ?? null, region: p.region ?? null })).sort() : [],
  multi_place_detected: observation.autonomous ? observation.multi_place_detected : null });
const groupTokens = (universe) => [...new Set(universe.flatMap((r) => [`source:${r.source_group_id}`, ...r.place_group_ids.map((p) => `place:${p}`)]).map(sha256))].sort();

function writeOnce(file, content) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, content, { flag: 'wx' });
}
function createDirectory(dir) {
  fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
  fs.mkdirSync(dir); // A partially written or completed experiment is never overwritten.
}
function finalizeReceipt(dir, kind, extra = {}) {
  const receipt = { version: EXPERIMENT_VERSION, kind, frozen_at: new Date().toISOString(),
    files: Object.fromEntries(RUN_FILES.map((name) => [name, hashFile(path.join(dir, name))])), ...extra };
  writeOnce(path.join(dir, 'receipt.json'), serialized(receipt));
  return { directory: path.resolve(dir), receipt_sha256: hashFile(path.join(dir, 'receipt.json')), ...receipt };
}

/** Freeze all four runtime artifacts before any scorer receives a label path. */
export function freezeInferenceRun(source, out) {
  const bytes = Object.fromEntries(RUN_FILES.map((name) => [name, fs.readFileSync(path.join(source, name))]));
  const observations = bytes['observations.jsonl'].toString('utf8').split(/\r?\n/).filter(Boolean).map((s) => JSON.parse(s));
  validateObservations(observations);
  const run = JSON.parse(bytes['run.json']), completion = JSON.parse(bytes['completion.json']);
  if (run.configuration_sha256 !== objectHash(run.configuration)) fail('runtime_configuration_hash_mismatch');
  if (completion.inputs !== observations.length || !Array.isArray(run.inputs) || run.inputs.length !== observations.length ||
      new Set(run.inputs.map((r) => r.input_id)).size !== observations.length ||
      observations.some((o) => !run.inputs.some((i) => i.input_id === o.input_id && i.input_sha256 === o.input_sha256))) fail('runtime_observation_inventory_mismatch');
  createDirectory(out);
  for (const name of RUN_FILES) writeOnce(path.join(out, name), bytes[name]);
  return finalizeReceipt(out, 'runtime_inference', { configuration_sha256: run.configuration_sha256,
    observation_count: observations.length, observation_identity_sha256: objectHash(observations.map(identity).sort()) });
}

export function verifyFrozenRun(dir) {
  const receipt = json(path.join(dir, 'receipt.json'));
  if (receipt.version !== EXPERIMENT_VERSION || !['runtime_inference', 'routed_replay'].includes(receipt.kind) ||
      objectHash(Object.keys(receipt.files).sort()) !== objectHash([...RUN_FILES].sort())) fail('invalid_frozen_run_receipt');
  for (const name of RUN_FILES) if (hashFile(path.join(dir, name)) !== receipt.files[name]) fail(`frozen_run_hash_mismatch:${name}`);
  const observations = jsonl(path.join(dir, 'observations.jsonl'));
  validateObservations(observations);
  if (observations.length !== receipt.observation_count || objectHash(observations.map(identity).sort()) !== receipt.observation_identity_sha256) fail('frozen_observation_identity_mismatch');
  return { receipt, receipt_sha256: hashFile(path.join(dir, 'receipt.json')), observations };
}

/** No subprocess dispatch: emit hash-bound validation argv for the existing runner. */
export function planExperiments(spec, out) {
  if (spec.version !== 1 || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(spec.experiment_id) || !Array.isArray(spec.jobs) || !spec.jobs.length) fail('invalid_experiment_plan');
  const ids = new Set();
  const jobs = spec.jobs.map((job) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(job.arm_id) || !['early', 'escalated', 'baseline'].includes(job.stage) ||
        !['development', 'calibration', 'held_out'].includes(job.split) || !VIEWS.includes(job.view)) fail('invalid_experiment_job');
    if (job.split === 'held_out' && !['baseline_v1', 'final_candidate_v1'].includes(job.milestone)) fail('heldout_plan_requires_major_milestone');
    const id = `${job.arm_id}:${job.stage}:${job.split}:${job.view}`;
    if (ids.has(id)) fail('duplicate_experiment_job'); ids.add(id);
    const inputs = json(job.inputs), configuration = json(job.configuration);
    if (!Array.isArray(inputs) || !inputs.length || !inputs.every((p) => typeof p === 'string' && path.basename(p) === 'input.json')) fail('neutral_input_path_list_required');
    const inputHashes = inputs.map((file) => {
      const input = json(file);
      if (!/^i_[a-f0-9]{24}$/.test(input.input_id) || input.view !== job.view || input.cache_policy !== 'disabled' ||
          ['labels', 'expected_places', 'case_id', 'split', 'source_group_id'].some((k) => k in input)) fail('non_neutral_planned_input');
      return { input_id: input.input_id, sha256: hashFile(file) };
    });
    if (new Set(inputHashes.map((r) => r.input_id)).size !== inputHashes.length) fail('duplicate_planned_input');
    return { ...job, inputs_sha256: hashFile(job.inputs), configuration_sha256: objectHash(configuration), input_hashes: inputHashes,
      validation_argv: ['node', '--import', 'tsx', 'src/cli/recognitionGoldInference.ts', '--inputs', path.resolve(job.inputs), '--config', path.resolve(job.configuration)],
      execution_argv_requires_separate_authorization: ['node', '--import', 'tsx', 'src/cli/recognitionGoldInference.ts', '--inputs', path.resolve(job.inputs), '--config', path.resolve(job.configuration), '--out', path.resolve(job.output), '--execute'] };
  });
  const plan = { version: EXPERIMENT_VERSION, experiment_id: spec.experiment_id, jobs,
    created_at: new Date().toISOString(), calls_dispatched: 0,
    working_directory: 'services/media-worker',
    note: 'This command only records a plan. Existing runner validates budget and evidence. Held-out materialization/scoring remains controlled by the existing seal and milestone ledger.' };
  writeOnce(out, serialized(plan)); return { out, plan_sha256: hashFile(out), jobs: jobs.length, calls_dispatched: 0 };
}

/** Only dev/cal shards. Hash verification precedes the supplied label loader. */
export function scoreFrozenRun({ frozen, split, view, loadDataset, loadEvaluator = null }) {
  if (!['development', 'calibration'].includes(split)) fail('experiment_tuning_cannot_score_heldout_use_existing_milestone_cli');
  if (!VIEWS.includes(view)) fail('invalid_score_view');
  const verified = verifyFrozenRun(frozen); // Do not move a label read above this boundary.
  const { manifest, labels, splits } = loadDataset();
  if (manifest.some((r) => splits.assignments?.[r.case_id] !== split)) fail('physically_separate_single_split_shard_required');
  validateManifest(manifest); validateLabels(manifest, labels); validateSplits(manifest, labels, splits);
  const evaluator = loadEvaluator?.() ?? null;
  const scorerSources = Object.fromEntries(['core.mjs', 'evaluatorAliases.mjs', 'experiments.mjs', 'experimentsCli.mjs'].map((name) => [name, hashFile(fileURLToPath(new URL(name, import.meta.url)))]));
  const byLabel = new Map(labels.map((l) => [l.case_id, l]));
  const universe = manifest.map((r) => ({ case_id: r.case_id, source_group_id: r.source_group_id,
    place_group_ids: byLabel.get(r.case_id)?.place_group_ids ?? [], split }));
  const groups = connectedGroups(universe);
  const selected = manifest.filter((r) => r.state === 'ready' && r.view_eligibility[view]);
  const byInput = new Map(verified.observations.map((o) => [identity(o), o]));
  if (!selected.length || selected.length !== byInput.size) fail('score_observation_cohort_mismatch');
  const rows = selected.map((r) => {
    const input_id = `i_${sha256(`${r.case_id}\0${view}`).slice(0, 24)}`;
    const observation = byInput.get(`${input_id}\0${view}`);
    if (!observation) fail('missing_scoring_observation');
    return { ...scoreOne(r, byLabel.get(r.case_id), observation, split, view, evaluator), input_id, group_id: groups.get(r.case_id),
      place_group_ids: byLabel.get(r.case_id)?.place_group_ids ?? [],
      autonomous_signature: autonomousSignature(observation) };
  });
  return { version: EXPERIMENT_VERSION, kind: 'private_experiment_scores', split, view,
    scored_at: new Date().toISOString(), scorer_sources: scorerSources, scorer_sha256: objectHash(scorerSources),
    evaluator: evaluator?.metadata ?? { evaluator_version: 'default-exact-name', core_sha256: scorerSources['core.mjs'] },
    frozen_receipt_sha256: verified.receipt_sha256, observation_sha256: verified.receipt.files['observations.jsonl'],
    input_inventory_sha256: inputInventory(verified.observations),
    dataset_sha256: objectHash({ manifest, labels, splits }), cohort_sha256: objectHash(rows.map((r) => r.case_id).sort()),
    group_universe: universe, rows, metrics: experimentMetrics(rows), summary: summarizeScores(rows) };
}

function verifiedLearningInput(scoreFile, frozen, split) {
  const verified = verifyFrozenRun(frozen), scores = json(scoreFile);
  if (scores.version !== EXPERIMENT_VERSION || scores.kind !== 'private_experiment_scores' || scores.split !== split ||
      scores.frozen_receipt_sha256 !== verified.receipt_sha256 || scores.observation_sha256 !== verified.receipt.files['observations.jsonl']) fail('learning_requires_matching_frozen_scores');
  if (scores.rows.some((r) => r.split !== split)) fail('learning_split_mismatch');
  return { scores, rows: makeLearningRows(scores.rows, verified.observations) };
}

export function fitExperiment({ scores, frozen, options, out }) {
  const input = verifiedLearningInput(scores, frozen, 'development');
  const model = fitRouter(input.rows, options);
  // Include unselected bridge cases when checking development/calibration separation.
  model.training_group_tokens = groupTokens(input.scores.group_universe);
  model.provenance = { development_scores_sha256: hashFile(scores), development_frozen_receipt_sha256: input.scores.frozen_receipt_sha256 };
  writeOnce(out, serialized(model)); return { out, model_sha256: hashFile(out), family: model.family };
}
export function calibrateExperiment({ model: modelFile, scores, frozen, options, out }) {
  const input = verifiedLearningInput(scores, frozen, 'calibration');
  const original = json(modelFile);
  if (groupTokens(input.scores.group_universe).some((token) => original.training_group_tokens.includes(token))) fail('training_calibration_source_or_place_leakage');
  const model = calibrateRouter(original, input.rows, options);
  model.provenance = { ...model.provenance, uncalibrated_model_sha256: hashFile(modelFile), calibration_scores_sha256: hashFile(scores),
    calibration_frozen_receipt_sha256: input.scores.frozen_receipt_sha256 };
  writeOnce(out, serialized(model)); return { out, policy_sha256: hashFile(out), threshold: model.calibration.threshold };
}

/** Label-free process: only a frozen policy and frozen model outputs are opened. */
export function applyExperiment({ policy: policyFile, early, escalated, accounting, out }) {
  const policy = json(policyFile), a = verifyFrozenRun(early), b = escalated ? verifyFrozenRun(escalated) : null;
  const byInput = new Map(b?.observations.map((o) => [identity(o), o]) ?? []);
  const earlyIds = new Set(a.observations.map(identity));
  if ([...byInput.keys()].some((id) => !earlyIds.has(id))) fail('orphan_escalation_observation');
  const observations = a.observations.map((observation) => {
    const start = performance.now();
    // First compute the decision and its bookkeeping, then record measured local overhead.
    const output = applyRouter(policy, observation, byInput.get(identity(observation)), { accounting });
    const ms = performance.now() - start;
    output.routing.policy_latency_ms = ms;
    if (output.elapsed_ms != null) output.elapsed_ms += ms;
    if (output.first_usable_result_ms != null) output.first_usable_result_ms += ms;
    return output;
  });
  createDirectory(out);
  writeOnce(path.join(out, 'run.json'), serialized({ version: EXPERIMENT_VERSION, kind: 'offline_router_replay',
    policy_file_sha256: hashFile(policyFile), policy_content_sha256: objectHash(policy),
    early_receipt_sha256: a.receipt_sha256, escalated_receipt_sha256: b?.receipt_sha256 ?? null,
    accounting, labels_read: false, provider_requests_dispatched: 0,
    note: 'Counterfactual selected-stage cost from measured frozen runs, not new spending; local router latency is measured.' }));
  writeOnce(path.join(out, 'observations.jsonl'), lines(observations));
  writeOnce(path.join(out, 'provider-ledger.jsonl'), lines(observations.flatMap((o) => (o.entries ?? []).map((entry) => ({ input_id: o.input_id, replayed: true, ...entry })))));
  writeOnce(path.join(out, 'completion.json'), serialized({ inputs: observations.length, failures: observations.filter((o) => o.status === 'failed').length,
    provider_requests_dispatched: 0, early: observations.filter((o) => o.routing.choice === 'early').length,
    escalated: observations.filter((o) => o.routing.choice === 'escalated').length,
    missing_escalation: observations.filter((o) => o.routing.choice === 'missing_escalation').length }));
  return finalizeReceipt(out, 'routed_replay', { observation_count: observations.length,
    observation_identity_sha256: objectHash(observations.map(identity).sort()) });
}

/** Private scored reports only. Held-out comparisons require existing milestone provenance. */
export function compareExperiments({ baseline, candidates, options, out }) {
  const base = json(baseline), arms = [{ arm_id: 'baseline', metrics: experimentMetrics(base.rows) }], comparisons = [];
  if (base.kind !== 'private_experiment_scores') fail('private_score_report_required');
  if (!Object.keys(candidates).length || 'baseline' in candidates) fail('unique_candidate_arm_ids_required');
  if (base.split === 'held_out' && (base.milestone?.name !== 'baseline_v1' || Object.keys(candidates).length !== 1)) fail('heldout_requires_single_frozen_major_milestone_pair');
  for (const [arm_id, file] of Object.entries(candidates)) {
    const candidate = json(file);
    if (candidate.kind !== base.kind || candidate.split !== base.split || candidate.view !== base.view ||
        candidate.dataset_sha256 !== base.dataset_sha256 || candidate.cohort_sha256 !== base.cohort_sha256 ||
        candidate.input_inventory_sha256 !== base.input_inventory_sha256 ||
        objectHash(candidate.group_universe) !== objectHash(base.group_universe)) fail('comparison_requires_identical_scored_cohort');
    if (objectHash(candidate.evaluator ?? null) !== objectHash(base.evaluator ?? null)) fail('comparison_requires_identical_evaluator');
    if (base.split === 'held_out' && (candidate.milestone?.name !== 'final_candidate_v1' || candidate.milestone?.seal_sha256 !== base.milestone.seal_sha256)) fail('heldout_requires_single_frozen_major_milestone_pair');
    comparisons.push({ arm_id, ...pairedGroupComparison(base.rows, candidate.rows, base.group_universe, options) });
    arms.push({ arm_id, metrics: experimentMetrics(candidate.rows) });
  }
  const report = { version: EXPERIMENT_VERSION, split: base.split, view: base.view,
    input_score_hashes: { baseline: hashFile(baseline), ...Object.fromEntries(Object.entries(candidates).map(([id, file]) => [id, hashFile(file)])) },
    comparisons, metrics: arms, pareto: paretoFrontier(arms),
    decision_policy: 'Tune development/calibration only. Freeze a major-milestone candidate before existing held-out inference/scoring; never tune to the held-out tail.' };
  writeOnce(out, serialized(report)); return { out, comparisons: comparisons.length, pareto: report.pareto };
}

/** Strict CSV reader for existing core per-case exports, including quoted newlines and commas. */
export function parseScoreCsv(source) {
  const records = []; let row = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); if (row.some((v) => v !== '')) records.push(row); row = []; };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"') {
      if (cell || closed) fail('invalid_score_csv_quote'); quoted = true;
    } else if (c === ',') pushCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; pushRow(); }
    else { if (closed) fail('invalid_score_csv_quote'); cell += c; }
  }
  if (quoted) fail('unterminated_score_csv_quote');
  if (cell || row.length || closed) pushRow();
  const header = records.shift();
  if (!header?.length || header.some((v) => !/^[a-z][a-z0-9_]*$/.test(v)) || new Set(header).size !== header.length) fail('invalid_score_csv_header');
  const strings = new Set(['case_id', 'source_group_id', 'split', 'view', 'label_class', 'status']);
  return records.map((cells) => {
    if (cells.length !== header.length) fail('invalid_score_csv_width');
    return Object.fromEntries(header.map((name, i) => {
      const value = cells[i];
      if (strings.has(name)) return [name, value];
      if (!value) return [name, null];
      if (value === 'true' || value === 'false') return [name, value === 'true'];
      if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) fail('invalid_score_csv_value');
      return [name, Number(value)];
    }));
  });
}

/** Import a completed core milestone score. No manifest or label path is accepted. */
export function importMilestone({ frozen, summary: summaryFile, marker: markerFile, seal: sealFile, groups: groupsFile, out, repo = REPO }) {
  const verified = verifyFrozenRun(frozen), summary = json(summaryFile), marker = json(markerFile), seal = json(sealFile), context = json(groupsFile);
  const sealHash = hashFile(sealFile);
  if (summary.split !== 'held_out' || !VIEWS.includes(summary.view) || !['baseline_v1', 'final_candidate_v1'].includes(marker.milestone) ||
      !seal.allowed_milestones?.includes(marker.milestone) || marker.view !== summary.view ||
      marker.observation_sha256 !== verified.receipt.files['observations.jsonl'] ||
      !Number.isFinite(Date.parse(marker.reserved_at)) || !Number.isFinite(Date.parse(verified.receipt.frozen_at)) ||
      Date.parse(verified.receipt.frozen_at) > Date.parse(marker.reserved_at) ||
      path.basename(markerFile) !== heldoutRunKey(seal, marker.milestone, marker.view) + '.json' ||
      path.resolve(repo, marker.output) !== path.resolve(summaryFile)) fail('invalid_existing_milestone_linkage');
  if (context.version !== 1 || context.seal_sha256 !== sealHash || !Array.isArray(context.group_universe)) fail('seal_bound_group_context_required');
  const allowed = new Set(['case_id', 'source_group_id', 'place_group_ids', 'split']);
  for (const r of context.group_universe) if (Object.keys(r).some((k) => !allowed.has(k)) ||
      !/^g_[a-f0-9]{16}$/.test(r.case_id) || !/^sg_[a-f0-9]{16}$/.test(r.source_group_id) ||
      !Array.isArray(r.place_group_ids) || r.place_group_ids.some((p) => !/^pg_[a-f0-9]{16}$/.test(p)) ||
      !['development', 'calibration', 'held_out'].includes(r.split)) fail('opaque_group_context_only');
  const groups = connectedGroups(context.group_universe), byCase = new Map(context.group_universe.map((r) => [r.case_id, r]));
  const csvFile = path.resolve(repo, summary.per_case_private_path);
  const raw = parseScoreCsv(fs.readFileSync(csvFile, 'utf8'));
  if (!raw.length || raw.length !== summary.observation_count || raw.length !== verified.observations.length ||
      new Set(raw.map((r) => r.case_id)).size !== raw.length ||
      raw.some((r) => r.split !== 'held_out' || r.view !== summary.view || byCase.get(r.case_id)?.split !== 'held_out' || byCase.get(r.case_id)?.source_group_id !== r.source_group_id) ||
      objectHash(summarizeScores(raw)) !== objectHash(summary.summary)) fail('milestone_csv_summary_mismatch');
  const byInput = new Map(verified.observations.map((o) => [identity(o), o]));
  const rows = raw.map((r) => {
    const input_id = `i_${sha256(`${r.case_id}\0${r.view}`).slice(0, 24)}`, o = byInput.get(`${input_id}\0${r.view}`);
    if (!o || o.status !== r.status || o.autonomous !== r.autonomous || o.elapsed_ms !== r.elapsed_ms) fail('milestone_csv_observation_mismatch');
    return { ...r, input_id, group_id: groups.get(r.case_id), place_group_ids: byCase.get(r.case_id).place_group_ids, autonomous_signature: autonomousSignature(o) };
  });
  const report = { version: EXPERIMENT_VERSION, kind: 'private_experiment_scores', split: 'held_out', view: summary.view,
    evaluator: summary.evaluator ?? null,
    frozen_receipt_sha256: verified.receipt_sha256, observation_sha256: verified.receipt.files['observations.jsonl'],
    input_inventory_sha256: inputInventory(verified.observations),
    dataset_sha256: objectHash({ manifest: seal.manifest_sha256, labels: seal.labels_sha256, splits: seal.splits_sha256 }),
    cohort_sha256: objectHash(rows.map((r) => r.case_id).sort()), group_universe: context.group_universe, rows, metrics: experimentMetrics(rows),
    milestone: { name: marker.milestone, seal_sha256: sealHash, marker_sha256: hashFile(markerFile), summary_sha256: hashFile(summaryFile),
      csv_sha256: hashFile(csvFile), group_context_sha256: hashFile(groupsFile), imported_at: new Date().toISOString(), labels_opened: false },
    limitation: 'Existing trusted scorer export imported; this process does not re-adjudicate gold identities or cryptographically authenticate the coordinator group context.' };
  writeOnce(out, serialized(report)); return { out, milestone: marker.milestone, cases: rows.length, labels_opened: false };
}

function parseArgs(argv) {
  const [command, ...rest] = argv, args = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i]) || !rest[i + 1] || rest[i].slice(2) in args) fail('invalid_experiment_arguments');
    args[rest[i].slice(2)] = rest[i + 1];
  }
  return { command, args };
}
export function main(argv) {
  const { command, args: a } = parseArgs(argv);
  const commands = {
    plan: ['spec', 'out'], freeze: ['run', 'out'], score: ['frozen', 'split', 'view', 'manifest', 'labels', 'splits', 'out', 'evaluator-config?'],
    fit: ['scores', 'frozen', 'options', 'out'], calibrate: ['model', 'scores', 'frozen', 'options', 'out'],
    apply: ['policy', 'early', 'escalated?', 'accounting?', 'out'], compare: ['baseline', 'candidates', 'options?', 'out'],
    'import-milestone': ['frozen', 'summary', 'marker', 'seal', 'groups', 'out'],
  };
  const keys = commands[command];
  if (!keys || Object.keys(a).some((k) => !keys.map((s) => s.replace('?', '')).includes(k)) || keys.some((k) => !k.endsWith('?') && !a[k])) fail('invalid_experiment_arguments');
  if (command === 'plan') return planExperiments(json(a.spec), a.out);
  if (command === 'freeze') return freezeInferenceRun(a.run, a.out);
  if (command === 'score') {
    // These paths are accepted only by scoring, never forwarded to inference/application.
    const report = scoreFrozenRun({ frozen: a.frozen, split: a.split, view: a.view,
      loadEvaluator: a['evaluator-config'] ? () => loadEvaluatorAliases(json(a['evaluator-config'])) : null,
      loadDataset: () => {
        const manifest = jsonl(a.manifest), splits = json(a.splits);
        if (manifest.some((r) => splits.assignments?.[r.case_id] !== a.split)) fail('physically_separate_single_split_shard_required');
        return { manifest, labels: jsonl(a.labels), splits };
      } });
    writeOnce(a.out, serialized(report)); return { out: a.out, metrics: report.metrics };
  }
  if (command === 'fit') return fitExperiment({ scores: a.scores, frozen: a.frozen, options: json(a.options), out: a.out });
  if (command === 'calibrate') return calibrateExperiment({ model: a.model, scores: a.scores, frozen: a.frozen, options: json(a.options), out: a.out });
  if (command === 'apply') return applyExperiment({ policy: a.policy, early: a.early, escalated: a.escalated, accounting: a.accounting ?? 'sequential_incremental', out: a.out });
  if (command === 'compare') return compareExperiments({ baseline: a.baseline, candidates: json(a.candidates), options: a.options ? json(a.options) : {}, out: a.out });
  if (command === 'import-milestone') return importMilestone({ frozen: a.frozen, summary: a.summary, marker: a.marker, seal: a.seal, groups: a.groups, out: a.out });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(serialized(main(process.argv.slice(2)))); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
