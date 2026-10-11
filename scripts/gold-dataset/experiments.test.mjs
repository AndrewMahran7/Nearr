import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sha256, scoreOne, summarizeScores, heldoutRunKey, opaqueCaseId, opaqueSourceGroupId, opaquePlaceGroupId } from './core.mjs';
import { ROUTER_FAMILIES, objectHash, connectedGroups, experimentMetrics, pairedGroupComparison,
  paretoFrontier, routerFeatures, fitRouter, calibrateRouter, routeEarly,
  applyRouter, validateObservations } from './experiments.mjs';
import { freezeInferenceRun, verifyFrozenRun, scoreFrozenRun, planExperiments,
  fitExperiment, calibrateExperiment, applyExperiment, compareExperiments, parseScoreCsv, importMilestone, main } from './experimentsCli.mjs';

const id = (n) => 'i_' + sha256(String(n)).slice(0, 24);
const place = (name = 'Synthetic Copper Finch') => ({ name, place_id: 'google:synthetic', logical_result_id: 'm1' });
const observation = (n = 1, overrides = {}) => ({ input_id: id(n), input_sha256: sha256('input-' + n), view: 'full',
  status: 'completed', autonomous: true, places: [place()], candidates: [], multi_place_detected: false,
  runtime_finalization_status: 'auto_save', reason_codes: ['exact_identity_supported'],
  per_place_decisions: [{ logicalResultId: 'm1', gate: { confidenceScore: .95, exactIdentityStrength: 'source_named' } }],
  cost_usd: .01, elapsed_ms: 100, first_usable_result_ms: 90, provider_calls: 1,
  provider_ledger_complete: true, cost_basis: 'measured_provider_ledger',
  provider_usage: [{ provider: 'synthetic', measurement: 'measured', calls: 1, cost_usd: .01 }], ...overrides });
const score = (n, overrides = {}) => ({ case_id: 'c' + n, input_id: id(n), source_group_id: 's' + n,
  place_group_ids: ['p' + n], split: 'development', view: 'full', label_class: 'VERIFIED_EXACT_SINGLE',
  group_id: 'g' + n, status: 'completed', exact_eligible: true, correct_autonomous: true,
  autonomous_place_output: true, wrong_confident: false, cost_usd: .01, elapsed_ms: 100,
  autonomous_signature: 'same', ...overrides });
const universe = (rows) => rows.map((r) => ({ case_id: r.case_id, source_group_id: r.source_group_id, place_group_ids: r.place_group_ids, split: r.split }));
const learning = (split = 'development', prefix = 'd') => Array.from({ length: 12 }, (_, i) => ({
  input_id: id(prefix + i), view: 'full', split, group_id: prefix + i,
  group_tokens: [sha256(prefix + i)], eligible: true, target: i < 6 ? 0 : 1,
  features: routerFeatures(observation(i, { per_place_decisions: [{ logicalResultId: 'm1', gate: { confidenceScore: i < 6 ? .3 : .95, exactIdentityStrength: 'source_named' } }] })),
}));
function policy(family = 'rules') {
  return calibrateRouter(fitRouter(learning(), { family }), learning('calibration', 'k'),
    { minimumPrecision: 1, minimumAccepted: 2, minimumGroups: 2 });
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-experiments-'));
  t.after(() => {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('gold-experiments-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return dir;
}
function runtime(dir, rows) {
  fs.mkdirSync(dir);
  const configuration = { synthetic: true, providers_disabled: true };
  const run = { configuration, configuration_sha256: objectHash(configuration), inputs: rows.map((r) => ({ input_id: r.input_id, input_sha256: r.input_sha256 })) };
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run));
  fs.writeFileSync(path.join(dir, 'observations.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'provider-ledger.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'completion.json'), JSON.stringify({ inputs: rows.length }));
}

test('transitive source/place groups include unselected bridge cases', () => {
  const context = [
    { case_id: 'a', source_group_id: 'one', place_group_ids: ['p1'] },
    { case_id: 'bridge', source_group_id: 'one', place_group_ids: ['p2'] },
    { case_id: 'b', source_group_id: 'two', place_group_ids: ['p2'] },
    { case_id: 'c', source_group_id: 'three', place_group_ids: [] },
  ];
  const groups = connectedGroups(context);
  assert.equal(groups.get('a'), groups.get('b')); assert.notEqual(groups.get('a'), groups.get('c'));
  assert.deepEqual(groups, connectedGroups([...context].reverse()));
  assert.throws(() => connectedGroups(context.map((r, i) => ({ ...r, split: i ? 'calibration' : 'development' }))), /crosses_splits/);
});

test('paired cluster bootstrap is deterministic and keeps failure denominators', () => {
  const a = [score(1), score(2, { source_group_id: 's1' }), score(3), score(4, { status: 'failed', correct_autonomous: false, autonomous_place_output: false })];
  const b = a.map((r, i) => ({ ...r, correct_autonomous: i === 3 ? true : r.correct_autonomous, status: 'completed', elapsed_ms: 50 }));
  const opts = { iterations: 400, seed: 'reproducible' };
  const report = pairedGroupComparison(a, b, universe(a), opts);
  assert.equal(report.independent_groups, 3); assert.equal(report.cases, 4);
  assert.equal(report.metrics.correct_autonomous.difference, .25);
  assert.equal(report.metrics.failure_rate.baseline, .25);
  assert.equal(report.paired_ratios.mean_latency_ratio.estimate, .5);
  assert.equal(report.paired_ratios.mean_latency_ratio.ci.high, .5);
  assert.deepEqual(report, pairedGroupComparison([...a].reverse(), [...b].reverse(), universe(a), opts));
  assert.throws(() => pairedGroupComparison(a, b.slice(1), universe(a), opts), /case_set_mismatch/);
});

test('new wrong confident and multi regressions cannot hide in net accuracy', () => {
  const a = [score(1, { label_class: 'VERIFIED_MULTI' }), score(2, { wrong_confident: true, correct_autonomous: false }), score(3)];
  const b = [score(1, { label_class: 'VERIFIED_MULTI', wrong_confident: true, correct_autonomous: false }), score(2), score(3)];
  const report = pairedGroupComparison(a, b, universe(a), { iterations: 100 });
  assert.equal(report.metrics.wrong_confident.difference, 0);
  assert.equal(report.safety.newly_wrong_confident, 1); assert.equal(report.safety.resolved_wrong_confident, 1);
  assert.equal(report.safety.multi_correct_autonomous_regressions, 1);
});

test('unknown measurements are not imputed or given partial confidence intervals', () => {
  const a = [score(1), score(2, { cost_usd: null, elapsed_ms: null })];
  const b = a.map((r) => ({ ...r, cost_usd: .001, elapsed_ms: 10 }));
  const result = pairedGroupComparison(a, b, universe(a), { iterations: 100 });
  assert.equal(result.metrics.mean_cost_usd.baseline, null);
  assert.equal(result.metrics.mean_cost_usd.baseline_ci.low, null);
  assert.equal(result.metrics.mean_cost_usd.difference_ci.valid_draws, 0);
  assert.equal(result.paired_ratios.mean_latency_ratio.estimate, null);
  assert.equal(experimentMetrics(a).total_cost_usd, null);
  const pareto = paretoFrontier([{ arm_id: 'unknown', metrics: experimentMetrics(a) }, { arm_id: 'known', metrics: experimentMetrics(b) }]);
  assert.deepEqual(pareto.excluded_unknown, ['unknown']); assert.deepEqual(pareto.frontier, ['known']);
});

test('single-group intervals are unavailable and equal arms stay non-dominated', () => {
  const rows = [score(1)];
  assert.equal(pairedGroupComparison(rows, rows, universe(rows), { iterations: 100 }).metrics.wrong_confident.difference_ci.low, null);
  const metrics = experimentMetrics(rows);
  const frontier = paretoFrontier([{ arm_id: 'a', metrics }, { arm_id: 'same', metrics: { ...metrics } }, { arm_id: 'worse', metrics: { ...metrics, p95_latency_ms: 200 } }]);
  assert.deepEqual(frontier.frontier, ['a', 'same']); assert.deepEqual(frontier.dominated_by.worse, ['a', 'same']);
});

test('feature allowlist ignores identity strings and labels', () => {
  const original = observation(), changed = { ...original, input_id: id(90), places: [{ ...place('Other'), coordinates: { lat: 80, lng: 170 } }], expected_places: [{ name: 'LEAK' }] };
  assert.deepEqual(routerFeatures(original), routerFeatures(changed));
  assert.throws(() => validateObservations([changed]), /scorer_fields/);
});

test('four families train only dev, calibrate only cal, never promote review suggestions', () => {
  for (const family of ROUTER_FAMILIES) {
    const model = policy(family);
    assert.equal(routeEarly(model, observation()).useEarly, true, family);
    assert.equal(routeEarly(model, observation(1, { status: 'review', autonomous: false, places: [], candidates: [place()] })).useEarly, false, family);
    assert.equal(routeEarly(model, observation(1, { per_place_decisions: [{ logicalResultId: 'm1', gate: { confidenceScore: .3, exactIdentityStrength: 'source_named' } }] })).useEarly, false, family);
    assert.throws(() => fitRouter(learning('held_out'), { family }), /development_only/);
    assert.throws(() => calibrateRouter(fitRouter(learning(), { family }), learning('held_out')), /calibration_only/);
  }
});

test('logistic fit is deterministic and source/place tokens prevent split leakage', () => {
  const a = fitRouter(learning(), { family: 'small_supervised' });
  assert.deepEqual(a.weights, fitRouter([...learning()].reverse(), { family: 'small_supervised' }).weights);
  const leaked = learning('calibration', 'other'); leaked[0].group_tokens = learning()[0].group_tokens;
  assert.throws(() => calibrateRouter(a, leaked), /source_or_place_leakage/);
  const noPass = calibrateRouter(a, learning('calibration', 'cal').map((r) => ({ ...r, target: 0 })), { minimumPrecision: 1, minimumAccepted: 1, minimumGroups: 1 });
  assert.equal(routeEarly(noPass, observation()).useEarly, false);
});

test('sequential stage accounting includes failed early spend and latency', () => {
  const early = observation(1, { status: 'failed', autonomous: false, places: [], multi_place_detected: null });
  const deep = observation(1, { elapsed_ms: 900, first_usable_result_ms: 850, cost_usd: .2,
    provider_usage: [{ provider: 'deep', measurement: 'measured', calls: 2, cost_usd: .2 }], provider_calls: 2 });
  const routed = applyRouter(policy(), early, deep, { policyLatencyMs: 2 });
  assert.equal(routed.routing.choice, 'escalated'); assert.equal(routed.elapsed_ms, 1002);
  assert.equal(routed.first_usable_result_ms, 952); assert.ok(Math.abs(routed.cost_usd - .21) < 1e-12);
  assert.equal(routed.provider_calls, 3); assert.equal(routed.places[0].name, deep.places[0].name);
  const unknown = applyRouter(policy(), { ...early, provider_ledger_complete: false, cost_usd: null }, deep);
  assert.equal(unknown.cost_usd, null); assert.equal(unknown.provider_ledger_complete, false);
});

test('cumulative accounting proves early parent; early acceptance avoids unused deep charges', () => {
  const early = observation(1, { status: 'review', autonomous: false, places: [] }), deep = observation();
  assert.throws(() => applyRouter(policy(), early, deep, { accounting: 'cumulative_including_early' }), /parent_proof/);
  deep.stage_accounting = { kind: 'cumulative_including_early', includes_early_observation_sha256: objectHash(early) };
  const cumulative = applyRouter(policy(), early, deep, { accounting: 'cumulative_including_early' });
  assert.equal(cumulative.cost_usd, .01); assert.equal(cumulative.elapsed_ms, 100);
  const accepted = applyRouter(policy(), observation(), observation(1, { cost_usd: null, provider_ledger_complete: false }));
  assert.equal(accepted.routing.choice, 'early'); assert.equal(accepted.cost_usd, .01);
});

test('missing escalation is failure with unknown multi and retained early cost', () => {
  const early = observation(1, { status: 'failed', autonomous: false, places: [], multi_place_detected: null });
  const result = applyRouter(policy(), early, null);
  assert.equal(result.status, 'failed'); assert.equal(result.autonomous, false); assert.equal(result.multi_place_detected, null);
  assert.deepEqual(result.places, []); assert.deepEqual(result.candidates, []); assert.equal(result.cost_usd, .01);
  assert.equal(result.routing.choice, 'missing_escalation');
});

test('freeze binds all four files and refuses overwrite or later mutation', (t) => {
  const root = temp(t), source = path.join(root, 'source'), frozen = path.join(root, 'frozen');
  runtime(source, [observation()]); freezeInferenceRun(source, frozen);
  assert.equal(verifyFrozenRun(frozen).observations.length, 1);
  assert.throws(() => freezeInferenceRun(source, frozen), /EEXIST/);
  fs.appendFileSync(path.join(frozen, 'provider-ledger.jsonl'), '{}\n');
  assert.throws(() => verifyFrozenRun(frozen), /hash_mismatch/);
});

test('scoring checks frozen output before any label read and refuses held-out tuning', (t) => {
  const root = temp(t), source = path.join(root, 'source'), frozen = path.join(root, 'frozen');
  runtime(source, [observation()]); freezeInferenceRun(source, frozen);
  let labelsOpened = false;
  const loadDataset = () => { labelsOpened = true; throw new Error('label_loader'); };
  assert.throws(() => scoreFrozenRun({ frozen, split: 'held_out', view: 'full', loadDataset }), /cannot_score_heldout/);
  assert.equal(labelsOpened, false);
  fs.appendFileSync(path.join(frozen, 'observations.jsonl'), ' ');
  assert.throws(() => scoreFrozenRun({ frozen, split: 'development', view: 'full', loadDataset }), /hash_mismatch/);
  assert.equal(labelsOpened, false);
});

function syntheticDataset(prefix, split) {
  const case_id = opaqueCaseId('youtube', prefix), source_group_id = opaqueSourceGroupId(prefix), pg = opaquePlaceGroupId(prefix);
  const manifest = [{ case_id, source_group_id, platform: 'youtube', source_public_id: prefix, retrieval_date: '2026-01-01', categories: ['restaurant'],
    state: 'ready', exposure: 'new_unscored', evidence: { caption: 'Synthetic Copper Finch', frame_paths: ['a', 'b', 'c'], frame_sha256: [sha256('a'), sha256('b'), sha256('c')] },
    answer_spans: [], view_eligibility: { full: true, description_hidden: false, location_hidden: false, visual_only: false, text_only: false },
    mask_review: { permitted_media_derivative: true }, visual_review: { duration_seconds: 10, frame_timestamps_seconds: [0, 5, 9], coverage: ['opening', 'middle', 'ending'], entire_video_inspected: true, reviewer: 'synthetic', reviewed_at: '2026-01-01' } }];
  const labels = [{ case_id, label_class: 'VERIFIED_EXACT_SINGLE', expected_places: [{ ...place(), role: 'depicted', aliases: [], place_group_id: pg }],
    place_group_ids: [pg], complete_set_established: true, confidence: 'HIGH', provenance: [{ kind: 'synthetic_fixture', reference: 'synthetic://test' }],
    collected_by: 'test-a', review: { decision: 'accept', reviewer: 'test-b', independent: true, reviewed_at: '2026-01-01' } }];
  return { manifest, labels, splits: { assignments: { [case_id]: split } }, observation: observation(prefix, { input_id: 'i_' + sha256(case_id + '\0full').slice(0, 24) }) };
}

test('score fit calibrate apply compare lifecycle operates on separate synthetic shards', (t) => {
  const root = temp(t), paths = {};
  for (const [prefix, split] of [['dev', 'development'], ['cal', 'calibration']]) {
    const data = syntheticDataset(prefix, split), source = path.join(root, prefix), frozen = source + '-frozen';
    runtime(source, [data.observation]); freezeInferenceRun(source, frozen);
    const report = scoreFrozenRun({ frozen, split, view: 'full', loadDataset: () => data });
    assert.equal(report.metrics.correct_autonomous, 1); assert.ok(report.rows[0].group_id);
    const scores = source + '-scores.json'; fs.writeFileSync(scores, JSON.stringify(report));
    paths[prefix] = { frozen, scores };
  }
  const model = path.join(root, 'model.json'), trained = fitExperiment({ ...paths.dev, options: { family: 'rules' }, out: model });
  assert.ok(trained.model_sha256);
  const calibrated = path.join(root, 'policy.json');
  calibrateExperiment({ model, ...paths.cal, options: { minimumPrecision: 1, minimumAccepted: 1, minimumGroups: 1 }, out: calibrated });
  const out = path.join(root, 'routed'); applyExperiment({ policy: calibrated, early: paths.cal.frozen, accounting: 'sequential_incremental', out });
  const applied = verifyFrozenRun(out).observations[0]; assert.equal(applied.routing.choice, 'early');
  assert.equal(applied.cost_usd, .01); assert.equal(applied.status, 'completed');
  assert.ok(applied.routing.policy_latency_ms >= 0);
  const report = scoreFrozenRun({ frozen: out, split: 'calibration', view: 'full', loadDataset: () => syntheticDataset('cal', 'calibration') });
  const scores = path.join(root, 'routed-scores.json'); fs.writeFileSync(scores, JSON.stringify(report));
  const comparison = compareExperiments({ baseline: paths.cal.scores, candidates: { routed: scores }, options: { iterations: 100 }, out: path.join(root, 'compare.json') });
  assert.equal(comparison.comparisons, 1);
  assert.throws(() => fitExperiment({ ...paths.cal, options: { family: 'rules' }, out: path.join(root, 'leak.json') }), /matching_frozen_scores/);
});

test('plan emits hash-bound argv without dispatch or label reads', (t) => {
  const root = temp(t), neutral = path.join(root, 'input.json'), inputs = path.join(root, 'inputs.json'), config = path.join(root, 'config.json');
  fs.writeFileSync(neutral, JSON.stringify({ input_id: id(1), view: 'full', cache_policy: 'disabled' }));
  fs.writeFileSync(inputs, JSON.stringify([neutral])); fs.writeFileSync(config, '{"synthetic":true}');
  const spec = { version: 1, experiment_id: 'synthetic', jobs: [{ arm_id: 'cheap', stage: 'early', split: 'development', view: 'full', inputs, configuration: config, output: path.join(root, 'not-run') }] };
  const result = planExperiments(spec, path.join(root, 'plan.json'));
  assert.equal(result.calls_dispatched, 0); assert.equal(fs.existsSync(path.join(root, 'not-run')), false);
  assert.throws(() => planExperiments({ ...spec, jobs: [{ ...spec.jobs[0], split: 'held_out' }] }, path.join(root, 'bad.json')), /major_milestone/);
});

test('all architectures retain hard vetoes and paired stages require identical evidence', () => {
  for (const family of ROUTER_FAMILIES) {
    const model = policy(family);
    assert.equal(routeEarly(model, observation(1, { reason_codes: ['geography_conflict'] })).useEarly, false);
    assert.equal(routeEarly(model, observation(1, { reason_codes: ['upstream_exact_identity_review_required'] })).useEarly, false);
    assert.equal(routeEarly(model, observation(1, { runtime_finalization_status: 'needs_help' })).useEarly, false);
  }
  assert.throws(() => applyRouter(policy(), observation(), observation(1, { input_sha256: sha256('other input') })), /stage_identity_mismatch/);
  assert.throws(() => paretoFrontier([{ arm_id: 'same', metrics: {} }, { arm_id: 'same', metrics: {} }]), /unique_pareto/);
});

test('CSV import preserves nulls booleans quoted delimiters and rejects malformed data', () => {
  const rows = parseScoreCsv('case_id,status,correct_autonomous,cost_usd,elapsed_ms\r\n"one,""quoted""\nline",completed,true,0.001,\r\n');
  assert.deepEqual(rows, [{ case_id: 'one,"quoted"\nline', status: 'completed', correct_autonomous: true, cost_usd: .001, elapsed_ms: null }]);
  for (const invalid of ['a,a\n1,2\n', 'a,b\n1\n', 'case_id\n"open', 'cost_usd\nNaN\n', 'case_id\n"closed"junk']) assert.throws(() => parseScoreCsv(invalid), /csv/);
});

function writeCsv(file, rows) {
  const columns = Object.keys(rows[0]), cell = (value) => value == null ? '' : /[\n\r",]/.test(String(value)) ? '"' + String(value).replaceAll('"', '""') + '"' : String(value);
  fs.writeFileSync(file, [columns.join(','), ...rows.map((r) => columns.map((k) => cell(r[k])).join(','))].join('\n') + '\n');
}

test('held-out import reuses existing CSV milestone and frozen outputs without labels', (t) => {
  const root = temp(t), data = syntheticDataset('held-synthetic', 'held_out');
  const source = path.join(root, 'source'), frozen = path.join(root, 'frozen');
  runtime(source, [data.observation]); freezeInferenceRun(source, frozen);
  const sealFile = path.join(root, 'seal.json'), seal = { manifest_sha256: sha256('synthetic manifest'), labels_sha256: sha256('synthetic labels'), splits_sha256: sha256('synthetic split'), allowed_milestones: ['baseline_v1', 'final_candidate_v1'] };
  fs.writeFileSync(sealFile, JSON.stringify(seal));
  const groupsFile = path.join(root, 'groups.json'), context = { version: 1, seal_sha256: sha256(fs.readFileSync(sealFile)), group_universe: [{ case_id: data.manifest[0].case_id, source_group_id: data.manifest[0].source_group_id, place_group_ids: data.labels[0].place_group_ids, split: 'held_out' }] };
  fs.writeFileSync(groupsFile, JSON.stringify(context));
  const reports = {};
  for (const milestone of seal.allowed_milestones) {
    const rows = [scoreOne(data.manifest[0], data.labels[0], data.observation, 'held_out', 'full')];
    const csv = path.join(root, milestone + '.csv'), summary = path.join(root, milestone + '-summary.json');
    writeCsv(csv, rows);
    fs.writeFileSync(summary, JSON.stringify({ schema_version: 1, split: 'held_out', view: 'full', observation_count: 1, summary: summarizeScores(rows), per_case_private_path: path.relative(root, csv) }));
    const marker = path.join(root, heldoutRunKey(seal, milestone, 'full') + '.json');
    fs.writeFileSync(marker, JSON.stringify({ milestone, view: 'full', output: path.relative(root, summary), observation_sha256: sha256(fs.readFileSync(path.join(frozen, 'observations.jsonl'))), reserved_at: new Date(Date.now() + 1000).toISOString() }));
    const out = path.join(root, milestone + '-import.json');
    const args = { frozen, summary, marker, seal: sealFile, groups: groupsFile, out, repo: root };
    assert.equal(importMilestone(args).labels_opened, false); reports[milestone] = out;
    assert.throws(() => importMilestone({ ...args, out: path.join(root, 'bad.json'), marker: summary }), /linkage/);
    if (milestone === 'baseline_v1') {
      const premature = JSON.parse(fs.readFileSync(marker)); premature.reserved_at = '2000-01-01T00:00:00Z'; fs.writeFileSync(marker, JSON.stringify(premature));
      assert.throws(() => importMilestone({ ...args, out: path.join(root, 'late-freeze.json') }), /linkage/);
    }
  }
  assert.equal(compareExperiments({ baseline: reports.baseline_v1, candidates: { final: reports.final_candidate_v1 }, options: { iterations: 100 }, out: path.join(root, 'paired.json') }).comparisons, 1);
  assert.throws(() => compareExperiments({ baseline: reports.final_candidate_v1, candidates: { baseline: reports.baseline_v1 }, options: {}, out: path.join(root, 'bad-comparison.json') }), /candidate_arm_ids/);
  assert.throws(() => compareExperiments({ baseline: reports.baseline_v1, candidates: { one: reports.final_candidate_v1, two: reports.final_candidate_v1 }, options: {}, out: path.join(root, 'held-tuning.json') }), /major_milestone_pair/);
});

test('neutral CLI rejects extra label flags and mixed shard before label-file read', (t) => {
  assert.throws(() => main(['apply', '--policy', 'p', '--early', 'e', '--out', 'o', '--labels', 'forbidden']), /invalid_experiment_arguments/);
  const root = temp(t), data = syntheticDataset('mixed-shard', 'held_out'), source = path.join(root, 'source'), frozen = path.join(root, 'frozen');
  runtime(source, [data.observation]); freezeInferenceRun(source, frozen);
  const manifest = path.join(root, 'manifest.jsonl'), splits = path.join(root, 'splits.json');
  fs.writeFileSync(manifest, data.manifest.map((r) => JSON.stringify(r)).join('\n'));
  fs.writeFileSync(splits, JSON.stringify(data.splits));
  assert.throws(() => main(['score', '--frozen', frozen, '--split', 'development', '--view', 'full', '--manifest', manifest, '--splits', splits, '--labels', path.join(root, 'must-not-open.jsonl'), '--out', path.join(root, 'score.json')]), /physically_separate_single_split_shard/);
});
