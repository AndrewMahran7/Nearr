import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreCase, summarize, pairedBootstrap, paretoFrontier, distribution } from './metrics.mjs';
import { validateDataset, validateObservation, validateAdapterVariant, quarantineObservation, inferenceInput, writeOnce, csv } from './runner.mjs';

const input = { caseId: 'a', group: 'venue-a', split: 'TRAIN_DEVELOPMENT', kind: 'real' };
const label = { caseId: 'a', label: 'VERIFIED_EXACT_SINGLE', expectedPlaces: [{ name: 'Cafe', aliases: ['Cafe'], locality: 'Boston' }], provenance: [{ reference: 'founder' }], multiPlaceExpected: false };
const observation = { caseId: 'a', status: 'completed', places: [{ name: 'Cafe', locality: 'Boston' }], candidates: [{ name: 'Cafe', locality: 'Boston' }], autonomous: true, multiPlaceDecision: false, wallTimeMs: 10, providerUsage: [], providerLedgerComplete: true, boundary: 'deterministic_policy_replay' };
test('same brand wrong branch fails exact matching', () => {
  assert.equal(scoreCase(input, label, { ...observation, places: [{ name: 'Cafe', locality: 'Chicago' }] }).correctAutonomous, false);
});
test('non-Latin venue names do not collapse to one empty identifier', () => {
  const japanese = { ...label, expectedPlaces: [{ name: '東京駅', aliases: ['東京駅'] }] };
  assert.equal(scoreCase(input, japanese, { ...observation, places: [{ name: '大阪駅' }] }).exactSet, false);
  assert.equal(scoreCase(input, japanese, { ...observation, places: [{ name: '東京駅' }] }).exactSet, true);
});
test('review is useful but never an autonomous success', () => {
  const row = scoreCase(input, label, { ...observation, status: 'review', autonomous: false });
  assert.equal(row.exactSet, true); assert.equal(row.correctAutonomous, false);
  assert.equal(summarize([row]).autonomousResultPrecision.rate, null);
});
test('unverified and synthetic cases never enlarge real exact denominator', () => {
  const rows = [scoreCase(input, label, observation), scoreCase({ ...input, kind: 'composite_control' }, label, observation), scoreCase(input, { ...label, label: 'UNVERIFIED' }, observation)];
  assert.equal(summarize(rows).exactEligible, 1);
});
test('negative autonomous results lower precision', () => {
  const rows = [scoreCase(input, label, observation), scoreCase({ ...input, caseId: 'negative' }, { ...label, label: 'KNOWN_NEGATIVE' }, observation)];
  assert.equal(summarize(rows).autonomousResultPrecision.rate, .5);
  assert.equal(summarize(rows).autonomousPlacePrecision.rate, .5);
});
test('multi requires detection and complete set with no extra', () => {
  const multi = { ...label, label: 'VERIFIED_MULTI', multiPlaceExpected: true, completeSetEstablished: true, expectedPlaces: [{ name: 'One', aliases: ['One'] }, { name: 'Two', aliases: ['Two'] }] };
  const o = { ...observation, multiPlaceDecision: true, places: [{ name: 'One' }, { name: 'Two' }] };
  assert.equal(scoreCase(input, multi, o).correctAutonomous, true);
  assert.equal(scoreCase(input, multi, { ...o, multiPlaceDecision: false }).correctAutonomous, false);
  const extra = scoreCase(input, multi, { ...o, places: [...o.places, { name: 'Three' }] });
  assert.equal(extra.correctAutonomous, false); assert.equal(extra.tp, 2);
  const summary = summarize([extra]); assert.equal(summary.multi.placePrecision.rate, 2 / 3); assert.equal(summary.multi.placeRecall.rate, 1);
});
test('matching uses complete assignment when aliases overlap', () => {
  const truth = { ...label, label: 'VERIFIED_MULTI', multiPlaceExpected: true, expectedPlaces: [{ name: 'A', aliases: ['A', 'B'] }, { name: 'A', aliases: ['A'] }] };
  assert.equal(scoreCase(input, truth, { ...observation, multiPlaceDecision: true, places: [{ name: 'A' }, { name: 'B' }] }).exactSet, true);
});
test('missing costs and timings stay null', () => {
  const row = scoreCase(input, label, { ...observation, wallTimeMs: null, providerLedgerComplete: false });
  assert.equal(row.costUsd, null); assert.equal(summarize([row]).cost.costPerSubmission, null);
  assert.deepEqual(distribution([null, undefined, NaN]), { n: 0, p50: null, p75: null, p90: null, p95: null });
});
test('provisional geography never becomes scoring truth', () => {
  const row = scoreCase(input, { ...label, label: 'UNVERIFIED', country: 'France', region: 'Paris' }, { ...observation, places: [{ name: 'Cafe', country: 'United States', region: 'Massachusetts' }] });
  assert.equal(row.wrongCountry, null); assert.equal(row.wrongRegion, null);
});
test('reject cross-split related sources and exposed heldout', () => {
  assert.throws(() => validateDataset([input, { ...input, caseId: 'b', split: 'HELD_OUT_TEST' }], [label, { ...label, caseId: 'b' }]), /group_leakage/);
  assert.throws(() => validateDataset([{ ...input, split: 'HELD_OUT_TEST', exposure: 'historical_outcomes_already_exposed' }], [label]), /exposed_heldout/);
  assert.throws(() => validateDataset([input], [{ ...label, label: 'VERIFIED_MULTI', completeSetEstablished: false }]), /incomplete_multi_truth/);
});
test('failed jobs cannot carry confident outcomes and unknown cost is explicit', () => {
  assert.throws(() => validateObservation(input, { ...observation, status: 'failed' }), /failed_or_review_autonomy/);
  assert.throws(() => validateObservation(input, { ...observation, providerUsage: [{ calls: 1, measurement: 'measured', costUsd: -1 }] }), /invalid_usage/);
  assert.throws(() => validateObservation(input, { ...observation, boundary: 'fresh_end_to_end' }, 'deterministic_policy_replay'), /observation_boundary_mismatch/);
});
test('quarantining failed confidence preserves the safety violation count', () => {
  const original = { ...observation, status: 'failed' };
  const quarantined = quarantineObservation(input, original, 'failed_or_review_autonomy:a', 'deterministic_policy_replay');
  validateObservation(input, quarantined);
  const row = scoreCase(input, label, quarantined);
  assert.equal(row.correctAutonomous, false);
  assert.equal(summarize([row]).safety.failedConfidentResults, 1);
  assert.equal(summarize([row]).safety.invalidObservations, 1);
});
test('missing retained observation is unavailable, not a scored wrong prediction or free call', () => {
  const row = scoreCase(input, label, { ...observation, observationAvailable: false, places: [], candidates: [], autonomous: false, wallTimeMs: null, providerLedgerComplete: false });
  assert.equal(row.exactSet, null); assert.equal(row.correctAutonomous, null);
  const summary = summarize([row]);
  assert.equal(summary.submittedReal, 1); assert.equal(summary.exactLabeledCases, 1);
  assert.equal(summary.exactEligible, 0); assert.equal(summary.unavailableObservations, 1);
  assert.equal(summary.correctAutonomousResolution.rate, null); assert.equal(summary.cost.totalUsd, null);
});
test('unknown provider consumption cannot be promoted to measured zero', () => {
  const o = { ...observation, providerUsage: [{ provider: 'unknown', operation: 'unknown', calls: null, costUsd: 0, measurement: 'unknown' }] };
  validateObservation(input, o); assert.equal(scoreCase(input, label, o).costUsd, null);
});
test('an adapter cannot silently accept an ablation it never implements', () => {
  const definition = { id: 'policy', boundary: 'deterministic_policy_replay', variants: { winner: { transforms: [], performanceAblation: false } } };
  assert.equal(validateAdapterVariant(definition, 'winner').performanceAblation, false);
  assert.throws(() => validateAdapterVariant(definition, 'places_bounded'), /unsupported_adapter_variant/);
});
test('label-derived grouping and source catalog metadata never reach the adapter', () => {
  const projected = inferenceInput({ ...input, groupKeys: ['place:secret answer'], sourceKeys: ['catalog secret'], categories: ['known answer'], expectedPlaces: ['answer'], sourceLicenses: ['source description'], evidenceRefs: [{ path: 'frozen-evidence.json', caseId: 'opaque-record' }] });
  assert.equal(JSON.stringify(projected).includes('secret'), false);
  assert.deepEqual(Object.keys(projected).sort(), ['caseId', 'evidenceRefs', 'sourceUrl']);
});
test('write once protects baseline even on repeated invocation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-eval-test-'));
  try { const file = path.join(directory, 'baseline_results.csv'); writeOnce(file, 'first'); assert.throws(() => writeOnce(file, 'second'), /EEXIST/); assert.equal(fs.readFileSync(file, 'utf8'), 'first'); }
  finally { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('paired cluster bootstrap and Pareto never compare unknown/mismatched arms', () => {
  const row = scoreCase(input, label, observation), report = pairedBootstrap([row], [row], 50);
  assert.deepEqual(report.correctAutonomousDelta95, [0, 0]); assert.equal(report.independentGroups, 1);
  const a = { name: 'a', gatesPassed: true, accuracy: 1, precision: 1, p90: 20, cost: 2, boundary: 'policy', datasetHash: 'same' };
  const b = { ...a, name: 'b', p90: 10 };
  assert.deepEqual(paretoFrontier([a, b, { ...a, name: 'unknown', cost: null }]).map((x) => x.name), ['b']);
  assert.equal(paretoFrontier([a, { ...b, datasetHash: 'different' }]).length, 2);
});
test('paired statistics reject missing, duplicate, relabeled or differently scoped rows', () => {
  const row = scoreCase(input, label, observation);
  assert.throws(() => pairedBootstrap([row], []), /paired_case_set_mismatch/);
  assert.throws(() => pairedBootstrap([row], [row, row]), /paired_duplicate_case/);
  for (const key of ['group', 'label', 'boundary', 'split']) assert.throws(() => pairedBootstrap([row], [{ ...row, [key]: 'different' }]), new RegExp(`paired_${key}_mismatch`));
});
test('CSV quotes nested data, commas and actual newlines', () => assert.equal(csv([{ a: 'one,two', b: 'a\nb' }], ['a', 'b']), 'a,b\n"one,two","a\nb"\n'));
