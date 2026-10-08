#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { holdoutEligibility, inferencePayload, proposeSplits, renderReview, scoreOne, sha256, summarizeScores, validateLabels, validateManifest, validateSplits, VIEWS } from './core.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataset = path.join(repo, 'artifacts/recognition-gold-dataset');
const local = path.join(repo, '.local/recognition-gold-dataset');
const defaults = {
  manifest: path.join(dataset, 'dataset_manifest.jsonl'),
  labels: path.join(dataset, 'dataset_labels_private.jsonl'),
  splits: path.join(dataset, 'dataset_splits.json'),
  seal: path.join(dataset, 'heldout_seal_private.json'),
};
function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected_argument:${argv[i]}`);
    const key = argv[i].slice(2).replaceAll('-', '_');
    if (['explicit_heldout', 'independent'].includes(key)) { out[key] = true; continue; }
    if (++i >= argv.length) throw new Error(`missing_argument:${key}`);
    out[key] = argv[i];
  }
  return out;
}
function parseJsonl(file, missingOkay = false) {
  if (!fs.existsSync(file)) {
    if (missingOkay) return [];
    throw new Error(`missing_dataset_file:${path.basename(file)}`);
  }
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((x) => x.trim()).map((x, i) => {
    try { return JSON.parse(x); } catch { throw new Error(`invalid_jsonl:${path.basename(file)}:${i + 1}`); }
  });
}
function read(opts, needLabels = true) {
  const manifest = parseJsonl(opts.manifest ?? defaults.manifest);
  const labels = needLabels ? parseJsonl(opts.labels ?? defaults.labels) : [];
  validateManifest(manifest);
  if (needLabels) validateLabels(manifest, labels);
  return { manifest, labels };
}
function splitsFile(opts, manifest, labels) {
  const file = opts.splits ?? defaults.splits;
  if (!fs.existsSync(file)) throw new Error('missing_splits');
  const splits = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateSplits(manifest, labels, splits);
  return splits;
}
function writeOnce(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { flag: 'wx' });
}
function csv(rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const cell = (v) => {
    const x = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[\r\n",]/.test(x) ? `"${x.replaceAll('"', '""')}"` : x;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
function materialize(opts) {
  const { manifest, labels } = read(opts);
  const record = manifest.find((r) => r.case_id === opts.case);
  if (!record) throw new Error('unknown_case');
  if (!VIEWS.includes(opts.view)) throw new Error('unknown_view');
  const label = labels.find((l) => l.case_id === opts.case);
  const input = inferencePayload(record, label, opts.view);
  const root = path.join(local, 'materialized');
  const runName = sha256(`${input.input_id}\0${sha256(JSON.stringify(record.evidence))}`).slice(0, 24);
  const dir = path.join(root, runName);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(dir); // Immutable materialization: a repeated attempt must not overwrite evidence.
  try {
    const frameSources = opts.view === 'text_only' ? [] : record.evidence.frame_paths ?? [];
    if (frameSources.length) fs.mkdirSync(path.join(dir, 'frames'));
    for (let i = 0; i < frameSources.length; i++) {
      const from = path.resolve(repo, frameSources[i]);
      if (!fs.statSync(from).isFile()) throw new Error('invalid_frame');
      const to = path.join(dir, input.media.frames[i]);
      const child = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', from, '-frames:v', '1', '-map_metadata', '-1', '-map_chapters', '-1', '-an', '-q:v', '2', to], { stdio: 'ignore', windowsHide: true });
      if (child.status !== 0) throw new Error('frame_sanitization_failed');
    }
    writeOnce(path.join(dir, 'input.json'), JSON.stringify(input, null, 2) + '\n');
    const map = { input_id: input.input_id, case_id: record.case_id, view: opts.view, materialized_sha256: sha256(fs.readFileSync(path.join(dir, 'input.json'))), frame_sha256: input.media.frames.map((p) => sha256(fs.readFileSync(path.join(dir, p)))) };
    writeOnce(path.join(local, 'mappings', `${runName}.json`), JSON.stringify(map, null, 2) + '\n');
    return { input: path.join(dir, 'input.json'), mapping: path.join(local, 'mappings', `${runName}.json`), frames: input.media.frames.length };
  } catch (error) {
    // Do not leave a partly materialized inference input behind.
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('invalid_cleanup_target');
    fs.rmSync(resolved, { recursive: true, force: true });
    throw error;
  }
}
function seal(opts) {
  const manifestFile = path.resolve(opts.manifest ?? defaults.manifest);
  const privateRoot = path.resolve(local) + path.sep;
  if (!manifestFile.startsWith(privateRoot)) throw new Error('holdout_requires_private_combined_manifest');
  const { manifest, labels } = read(opts);
  const splits = splitsFile(opts, manifest, labels);
  const held = manifest.filter((r) => splits.assignments[r.case_id] === 'held_out');
  const groups = new Set(held.map((r) => r.source_group_id));
  if (manifest.length < 250 || groups.size < 60 || held.length < 60 || held.length > 80) throw new Error('holdout_quality_size_gate');
  const byId = new Map(labels.map((l) => [l.case_id, l]));
  for (const r of held) if (!holdoutEligibility(r, byId.get(r.case_id)).eligible) throw new Error(`holdout_review_gate:${r.case_id}`);
  const classes = new Set(held.map((r) => byId.get(r.case_id).label_class));
  if (!['VERIFIED_EXACT_SINGLE', 'VERIFIED_MULTI', 'KNOWN_NEGATIVE'].every((x) => classes.has(x))) throw new Error('holdout_missing_label_slice');
  if (!['description_hidden', 'location_hidden', 'visual_only', 'text_only'].every((view) => held.some((r) => r.view_eligibility[view]))) throw new Error('holdout_missing_ablation_slice');
  if (!held.some((r) => r.misleading_metadata === true || (Array.isArray(r.misleading_metadata) && r.misleading_metadata.length))) throw new Error('holdout_missing_misleading_metadata');
  if (new Set(held.map((r) => r.platform)).size < 2 || new Set(held.flatMap((r) => r.categories)).size < 5) throw new Error('holdout_platform_or_category_imbalance');
  const countries = new Set(held.map((r) => r.geography?.country ?? byId.get(r.case_id)?.geography?.country ?? byId.get(r.case_id)?.expected_places?.[0]?.country).filter(Boolean));
  if (countries.size < 3) throw new Error('holdout_geography_imbalance');
  const sealDoc = {
    schema_version: 1, created_at: new Date().toISOString(), heldout_cases: held.length, heldout_source_groups: groups.size,
    manifest_sha256: sha256(fs.readFileSync(opts.manifest ?? defaults.manifest)),
    labels_sha256: sha256(fs.readFileSync(opts.labels ?? defaults.labels)),
    splits_sha256: sha256(fs.readFileSync(opts.splits ?? defaults.splits)),
    source_group_ids: [...groups].sort(),
  };
  writeOnce(opts.seal ?? defaults.seal, JSON.stringify(sealDoc, null, 2) + '\n');
  return { heldout_cases: held.length, heldout_source_groups: groups.size, seal_path: opts.seal ?? defaults.seal };
}
function score(opts) {
  if (!opts.observations || !opts.view || !opts.split) throw new Error('score_requires_observations_view_split');
  if (!['development', 'calibration', 'held_out'].includes(opts.split) || !VIEWS.includes(opts.view)) throw new Error('invalid_score_slice');
  const { manifest, labels } = read(opts);
  const splits = splitsFile(opts, manifest, labels);
  if (opts.split === 'held_out') {
    if (!opts.explicit_heldout) throw new Error('heldout_requires_explicit_flag');
    const sealDoc = JSON.parse(fs.readFileSync(opts.seal ?? defaults.seal, 'utf8'));
    for (const [key, file] of [['manifest_sha256', opts.manifest ?? defaults.manifest], ['labels_sha256', opts.labels ?? defaults.labels], ['splits_sha256', opts.splits ?? defaults.splits]]) if (sealDoc[key] !== sha256(fs.readFileSync(file))) throw new Error(`holdout_seal_mismatch:${key}`);
  }
  const selected = manifest.filter((r) => splits.assignments[r.case_id] === opts.split && r.view_eligibility[opts.view]);
  if (!selected.length) throw new Error('empty_score_slice');
  const byLabel = new Map(labels.map((l) => [l.case_id, l]));
  const observations = parseJsonl(opts.observations);
  const byInput = new Map(observations.map((o) => [o.input_id, o]));
  if (byInput.size !== observations.length) throw new Error('duplicate_observation');
  const rows = selected.map((r) => {
    const input = inferencePayload(r, byLabel.get(r.case_id), opts.view);
    const o = byInput.get(input.input_id);
    if (!o) throw new Error(`missing_observation:${r.case_id}`);
    return scoreOne(r, byLabel.get(r.case_id), o, opts.split, opts.view);
  });
  if (observations.length !== rows.length) throw new Error('orphan_observation');
  const summary = summarizeScores(rows);
  const out = opts.out ?? path.join(dataset, `baseline_results_${opts.split}_${opts.view}.json`);
  const privateOut = path.join(local, 'scores', `${path.basename(out, path.extname(out))}_per_case_private.csv`);
  writeOnce(privateOut, csv(rows));
  writeOnce(out, JSON.stringify({ schema_version: 1, split: opts.split, view: opts.view, observation_count: rows.length, summary, per_case_private_path: path.relative(repo, privateOut) }, null, 2) + '\n');
  return { output: out, private_per_case: privateOut, summary };
}
function review(opts) {
  const { manifest, labels } = read(opts);
  const record = manifest.find((r) => r.case_id === opts.case);
  if (!record) throw new Error('unknown_case');
  if (opts.decision) {
    if (!['accept', 'reject', 'needs_more_research', 'region_only', 'ambiguous', 'negative'].includes(opts.decision) || !opts.reviewer) throw new Error('invalid_review_decision');
    const decision = { schema_version: 1, case_id: record.case_id, decision: opts.decision, reviewer: opts.reviewer, reviewed_at: new Date().toISOString(), independent: opts.independent === true, notes: opts.notes ?? null };
    const decisionFile = path.join(local, 'review_decisions_private', `${record.case_id}-${Date.now()}-${sha256(cryptoRandom()).slice(0, 8)}.json`);
    writeOnce(decisionFile, JSON.stringify(decision, null, 2) + '\n');
    return { output: decisionFile, action: 'recorded_for_private_label_adjudication' };
  }
  const output = path.join(local, 'review', `${record.case_id}.html`);
  writeOnce(output, renderReview(record, labels.find((l) => l.case_id === record.case_id)));
  return { output };
}
function cryptoRandom() { return `${Date.now()}-${Math.random()}-${process.pid}`; }
function main() {
  const [command, ...raw] = process.argv.slice(2), opts = args(raw);
  let result;
  if (command === 'validate') { const { manifest, labels } = read(opts); result = { manifest: validateManifest(manifest), labels: validateLabels(manifest, labels) }; if (fs.existsSync(opts.splits ?? defaults.splits)) result.splits = validateSplits(manifest, labels, JSON.parse(fs.readFileSync(opts.splits ?? defaults.splits, 'utf8'))); }
  else if (command === 'split') { const { manifest, labels } = read(opts); const splits = proposeSplits(manifest, labels, opts.seed); writeOnce(opts.splits ?? defaults.splits, JSON.stringify(splits, null, 2) + '\n'); result = validateSplits(manifest, labels, splits); }
  else if (command === 'materialize') result = materialize(opts);
  else if (command === 'seal') result = seal(opts);
  else if (command === 'score') result = score(opts);
  else if (command === 'review') result = review(opts);
  else throw new Error('usage: validate|split|materialize|seal|score|review');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
