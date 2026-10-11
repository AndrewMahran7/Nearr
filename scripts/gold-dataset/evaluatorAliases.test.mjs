import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { countryNorm, placeMatches, scoreOne, sha256 } from './core.mjs';
import { loadEvaluatorAliases, exactFullAddressMatch, canonicalFullAddress } from './evaluatorAliases.mjs';

test('full address equivalence handles compatible country suffix and typography without losing physical scope', () => {
  const truth = { country: 'United States', region: 'California', city: 'Example City', address: '114 McFadden Pl, Example City, CA 92663' };
  assert.equal(exactFullAddressMatch({ address: '114 Mc Fadden Pl, Example City, CA 92663, USA' }, truth), true);
  for (const address of ['115 McFadden Pl, Example City, CA 92663', '114 McFadden Pl, Other City, CA 92663', '114 McFadden Pl, Example City, CA 92664', '114 McFadden Pl, Example City, CA 92663, Canada']) assert.equal(exactFullAddressMatch({ address }, truth), false);
  assert.equal(exactFullAddressMatch({ address: truth.address, country: 'Canada' }, truth), false);
  assert.equal(exactFullAddressMatch({ address: truth.address, city: 'Other City' }, truth), false);
  assert.equal(exactFullAddressMatch({ address: 'Plaza, Example City' }, { ...truth, address: 'Plaza, Example City' }), false);
  const unit = { ...truth, address: '114 McFadden Pl #49, Example City, CA 92663', accepted_addresses: [truth.address] };
  assert.equal(exactFullAddressMatch({ address: unit.address }, unit), true);
  assert.equal(exactFullAddressMatch({ address: unit.address.replace('#49', '#50') }, unit), false);
  assert.equal(exactFullAddressMatch({ address: truth.address }, unit), false);
  assert.equal(canonicalFullAddress('1-chōme-4-8 Hirano, Koto City, Tokyo 135-0023', 'Japan'), canonicalFullAddress('1-4-8 Hirano, Koto City, Tokyo 135-0023, Japan', 'Japan'));
  assert.notEqual(canonicalFullAddress('1-48 Main Street', 'Japan'), canonicalFullAddress('14-8 Main Street', 'Japan'));
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-alias-synthetic-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('nearr-alias-synthetic-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = (name, value) => { const p = path.join(root, name); fs.writeFileSync(p, value); return p; };
  const json = (name, value) => file(name, JSON.stringify(value, null, 2));
  const pg = (n) => `pg_${String(n).padStart(16, '0')}`;
  const coffee = { name: 'Example Coffee Riverside', aliases: [], place_group_id: pg(1), country: 'France', city: 'Paris', coordinates: { lat: 48, lng: 2 }, address: '12 Example Avenue', accepted_radius_meters: 25, branch_disambiguation: true, role: 'depicted' };
  const coffeeRepeat = { ...coffee, aliases: ['Example Café Riverside'] };
  const b1 = { name: 'Example Coffee Centre B1', aliases: [], place_id: 'maps:shared-location', place_group_id: pg(2), country: 'Singapore', city: 'Singapore', coordinates: { lat: 1, lng: 103 }, address: '3 Example Road Basement 1', branch_disambiguation: true, role: 'depicted' };
  const tower = { ...b1, name: 'Example Cafe Tower 55F', place_id: 'maps:tower', place_group_id: pg(3), address: '5 Example Road, 55th Floor' };
  const otherCoffee = { ...coffee, name: 'Example Coffee Hill', place_group_id: pg(4), coordinates: { lat: 48.2, lng: 2.2 }, address: '25 Other Road' };
  const places = [coffee, coffeeRepeat, b1, tower, otherCoffee];
  const records = places.map((_, index) => ({ case_id: `g_${String(index + 1).padStart(16, '0')}`, source_group_id: `sg_${String(index + 1).padStart(16, '0')}`, categories: ['branch_disambiguation'], state: 'ready', evidence: { caption: 'Neutral\u2028caption\u2029text' } }));
  const labels = records.map((r, index) => ({ case_id: r.case_id, label_class: 'VERIFIED_EXACT_SINGLE', expected_places: [places[index]], reasonable_autonomous_expected: true }));
  records.push({ ...records[0], case_id: 'g_0000000000000006', source_group_id: 'sg_0000000000000006' });
  labels.push({ case_id: records[5].case_id, label_class: 'VERIFIED_MULTI', expected_places: [coffee, otherCoffee] });
  records.push({ ...records[0], case_id: 'g_0000000000000007' });
  labels.push({ case_id: records[6].case_id, label_class: 'VERIFIED_EXACT_SINGLE', expected_places: [{ ...coffee, coordinates: undefined, address: null }] });
  records.push({ ...records[0], case_id: 'g_0000000000000008' });
  labels.push({ case_id: records[7].case_id, label_class: 'VERIFIED_EXACT_SINGLE', expected_places: [{ ...coffee, place_group_id: pg(8), coordinates: undefined, address: null }] });
  const splits = { assignments: Object.fromEntries(records.map((r) => [r.case_id, 'development'])) };
  const sourceManifestPath = file('manifest.jsonl', records.map(JSON.stringify).join('\n') + '\n');
  const sourceLabelsPath = file('labels.jsonl', labels.map(JSON.stringify).join('\n') + '\n');
  const sourceSplitsPath = json('splits.json', splits);
  const hashFile = (p) => sha256(fs.readFileSync(p));
  const seal = { manifest_sha256: hashFile(sourceManifestPath), labels_sha256: hashFile(sourceLabelsPath), splits_sha256: hashFile(sourceSplitsPath) };
  const sealPath = json('seal.json', seal);
  const evidencePath = json('preexisting-operator.json', { name: 'Example Coffee', street: '12 Example Avenue' });
  const proof = (name) => ({ name, condition: null, evidence: [{ observed_name: name, path: evidencePath, sha256: hashFile(evidencePath), source_url: 'https://example.invalid/retained-operator', locator: '/name' }] });
  const entry = (truth, additions = [], conditional = [], guard = undefined) => ({ place_group_id: truth.place_group_id, canonical_names: [truth.name], existing_accepted_names: [truth.name, ...truth.aliases], cross_record_alias_union: [], proposed_additions: additions, conditional_additions: conditional, required_scope_predicate: guard });
  const floorRule = (accepted) => ({ kind: 'floor', accepted_values: accepted, independently_returned: true, horizontal_coordinates_sufficient: false, contradictory_floor_reject: true, enabled_only_when_validator_implemented: true });
  const map = { schema_version: 1, evaluator_map_version: 'synthetic-original-proof-v1', original_seal_sha256: hashFile(sealPath), canonical_sha256: { 'benchmark_manifest_private.jsonl': seal.manifest_sha256, 'benchmark_labels_private.jsonl': seal.labels_sha256, 'benchmark_splits_private.json': seal.splits_sha256 }, entries: [
    { ...entry(coffee, [proof('Example Coffee')]), cross_record_alias_union: coffeeRepeat.aliases },
    entry(b1, [], [{ ...proof('Example Coffee Centre'), condition: 'Require B1' }], floorRule(['B1', 'Basement 1'])),
    entry(tower, [], [{ ...proof('Example Cafe Tower'), condition: 'Require Floor 55' }], floorRule(['55F', '55th Floor', 'Floor 55'])),
    entry(otherCoffee, [proof('Example Coffee')]),
  ] };
  const mapPath = json('map.json', map);
  const options = { mapPath, expectedMapSha256: hashFile(mapPath), sealPath, expectedSealSha256: hashFile(sealPath), sourceManifestPath, sourceLabelsPath, sourceSplitsPath };
  const reload = () => { fs.writeFileSync(mapPath, JSON.stringify(map, null, 2)); options.expectedMapSha256 = hashFile(mapPath); return loadEvaluatorAliases(options); };
  return { root, places, records, labels, splits, map, options, reload, hashFile, evidencePath, evaluator: loadEvaluatorAliases(options) };
}

test('proven short name needs original physical branch anchor; defaults remain unchanged', (t) => {
  const f = fixture(t), truth = f.places[0], before = JSON.stringify(truth);
  const p = { name: 'Example Coffee', coordinates: { ...truth.coordinates }, country: 'FR' };
  assert.equal(placeMatches(p, truth), false);
  assert.equal(f.evaluator.placeMatches(p, truth), true);
  assert.equal(f.evaluator.placeMatches({ ...p, coordinates: { lat: 48.2, lng: 2.2 } }, truth), false);
  assert.equal(f.evaluator.placeMatches({ ...p, coordinates: undefined, city: 'Paris' }, truth), false);
  assert.equal(f.evaluator.placeMatches({ ...p, country: 'Germany' }, truth), false);
  assert.equal(f.evaluator.placeMatches({ ...p, name: 'Example' }, truth), false);
  assert.equal(f.evaluator.placeMatches({ ...p, coordinates: { lat: NaN, lng: 2 } }, truth), false);
  assert.equal(JSON.stringify(truth), before);
});

test('exact address path and approved cross-record union retain branch specificity', (t) => {
  const f = fixture(t), truth = f.places[0];
  assert.equal(f.evaluator.placeMatches({ name: 'Example Coffee', address: truth.address, country: 'France', city: 'Paris' }, truth), true);
  assert.equal(f.evaluator.placeMatches({ name: 'Example Coffee', address: '13 Example Avenue', country: 'France', city: 'Paris' }, truth), false);
  assert.equal(f.evaluator.placeMatches({ name: 'Example Café Riverside', coordinates: truth.coordinates }, truth), true);
  assert.equal(f.evaluator.placeMatches({ name: 'Example Café Riverside', coordinates: f.places[4].coordinates }, f.places[4]), false);
});

test('floor guard precedes matching ID, coordinates, names and addresses; conditional names stay disabled', (t) => {
  const f = fixture(t), b1 = f.places[2];
  const p = { place_id: b1.place_id, name: b1.name, coordinates: b1.coordinates, address: b1.address, country: 'Singapore' };
  assert.equal(f.evaluator.placeMatches(p, b1), true);
  assert.equal(f.evaluator.placeMatches({ ...p, name: 'Example Coffee', address: '3 Example Road' }, b1), false);
  assert.equal(f.evaluator.placeMatches({ ...p, address: '3 Example Road Basement 2' }, b1), false);
  assert.equal(f.evaluator.placeMatches({ ...p, name: 'Example Coffee Centre B2', address: b1.address }, b1), false);
  assert.equal(f.evaluator.placeMatches({ ...p, level: -2 }, b1), false);
  assert.equal(f.evaluator.placeMatches({ ...p, country: 'France' }, b1), false);
  assert.equal(f.evaluator.placeMatches({ name: 'Example Coffee Centre', coordinates: b1.coordinates, address: b1.address }, b1), false);
  assert.equal(f.evaluator.placeMatches({ ...p, place_id: 'maps:different-branch' }, b1), false);
  const tower = f.places[3];
  assert.equal(f.evaluator.placeMatches({ name: tower.name, coordinates: tower.coordinates, address: 'Floor 55' }, tower), true);
  assert.equal(f.evaluator.placeMatches({ name: tower.name, coordinates: tower.coordinates, address: 'Ground Floor' }, tower), false);
  assert.equal(f.evaluator.metadata.disabled_conditional_aliases, 2);
});

test('explicit original map, seal and full-source bindings cannot be replaced with shard hashes', (t) => {
  const f = fixture(t);
  assert.throws(() => loadEvaluatorAliases({ ...f.options, expectedSealSha256: undefined }), /missing_seal_binding/);
  assert.throws(() => loadEvaluatorAliases({ ...f.options, expectedMapSha256: 'f'.repeat(64) }), /map_hash_mismatch/);
  const shard = path.join(f.root, 'shard.jsonl'); fs.writeFileSync(shard, JSON.stringify(f.records[0]) + '\n');
  assert.throws(() => loadEvaluatorAliases({ ...f.options, sourceManifestPath: shard }), /original_manifest_hash_mismatch/);
  f.evaluator.assertCase(f.records[0], f.labels[0], 'development');
  assert.throws(() => f.evaluator.assertCase(f.records[0], f.labels[0], 'held_out'), /case_differs/);
  assert.throws(() => f.evaluator.assertCase({ ...f.records[0], categories: [] }, f.labels[0], 'development'), /case_differs/);
  assert.throws(() => f.evaluator.placeMatches({}, { ...f.places[0], accepted_radius_meters: 10000 }), /truth_differs/);
  f.map.canonical_sha256['benchmark_labels_private.jsonl'] = 'a'.repeat(64);
  assert.throws(() => f.reload(), /map_labels_seal_mismatch/);
});

test('unapproved unions, unobserved additions and changed retained provenance fail closed', (t) => {
  const f = fixture(t);
  f.map.entries[0].cross_record_alias_union.push('Invented branch');
  assert.throws(() => f.reload(), /unapproved_existing_name_union/);
  f.map.entries[0].cross_record_alias_union.pop();
  f.map.entries[0].proposed_additions[0].name = 'Invented name';
  assert.throws(() => f.reload(), /unproven_alias/);
  f.map.entries[0].proposed_additions[0].name = 'Example Coffee';
  fs.appendFileSync(f.evidencePath, '\n');
  assert.throws(() => f.reload(), /provenance_hash_mismatch/);
});

function observation(record, places, multi = false) {
  return { input_id: `i_${sha256(`${record.case_id}\0full`).slice(0, 24)}`, view: 'full', status: 'completed', autonomous: true, places, candidates: places, multi_place_detected: multi, cost_usd: null };
}

test('optional sixth scoring context consistently changes exact and all recall metrics, without rewriting defaults', (t) => {
  const f = fixture(t), r = f.records[0], l = f.labels[0];
  const o = observation(r, [{ name: 'Example Coffee', coordinates: f.places[0].coordinates }]);
  const old = scoreOne(r, l, o, 'development', 'full');
  const updated = scoreOne(r, l, o, 'development', 'full', f.evaluator);
  assert.equal(old.exact_set, false); assert.equal(updated.exact_set, true);
  for (const key of ['exact_top1', 'correct_autonomous']) { assert.equal(old[key], false); assert.equal(updated[key], true); }
  for (const key of ['candidate_recall_at_1', 'candidate_recall_at_3', 'candidate_recall_at_5', 'candidate_recall_at_n']) { assert.equal(old[key], 0); assert.equal(updated[key], 1); }
  assert.deepEqual(scoreOne(r, l, o, 'development', 'full'), old);
  assert.throws(() => scoreOne(r, l, o, 'development', 'full', {}), /invalid_evaluator_context/);
});

test('multi matching remains one-to-one and requires every exact branch plus multi detection', (t) => {
  const f = fixture(t), r = f.records[5], l = f.labels[5];
  const first = { name: 'Example Coffee', coordinates: f.places[0].coordinates };
  const second = { name: 'Example Coffee', coordinates: f.places[4].coordinates };
  const single = scoreOne(r, l, observation(r, [first], true), 'development', 'full', f.evaluator);
  assert.equal(single.true_positives, 1); assert.equal(single.exact_set, false); assert.equal(single.candidate_recall_at_n, .5);
  const repeat = scoreOne(r, l, observation(r, [first, { ...first }], true), 'development', 'full', f.evaluator);
  assert.equal(repeat.true_positives, 1); assert.equal(repeat.exact_set, false);
  assert.equal(scoreOne(r, l, observation(r, [first, second], true), 'development', 'full', f.evaluator).correct_autonomous, true);
  assert.equal(scoreOne(r, l, observation(r, [first, second], false), 'development', 'full', f.evaluator).correct_autonomous, false);
});

test('metadata identifies evaluator and frozen source hashes without private names or paths', (t) => {
  const f = fixture(t), m = f.evaluator.metadata;
  assert.equal(m.evaluator_map_sha256, f.options.expectedMapSha256);
  assert.equal(m.original_seal_sha256, f.options.expectedSealSha256);
  assert.match(m.core_sha256, /^[a-f0-9]{64}$/);
  assert.match(m.evaluator_module_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(m).includes(f.root), false);
  assert.equal(JSON.stringify(m).includes('Example Coffee'), false);
  assert.equal(countryNorm('SG'), countryNorm('Singapore'));
});

test('missing anchors inherit only the same sealed group and never override existing coordinates', (t) => {
  const f = fixture(t), missing = f.labels[6].expected_places[0];
  const p = { name: missing.name, coordinates: f.places[0].coordinates };
  assert.equal(f.evaluator.placeMatches(p, missing), true);
  assert.equal(f.evaluator.placeMatches({ ...p, coordinates: f.places[4].coordinates }, missing), false);
  assert.equal(f.evaluator.placeMatches({ ...p, coordinates: f.places[4].coordinates, address: f.places[0].address }, f.places[0]), false);
  assert.equal(f.evaluator.placeMatches(p, f.labels[7].expected_places[0]), false);
});

test('supplemental map feature must match its immutable evidence and cannot replace a sealed anchor', (t) => {
  const f = fixture(t), truth = f.labels[7].expected_places[0];
  const evidencePath = path.join(f.root, 'map-feature.json');
  fs.writeFileSync(evidencePath, JSON.stringify([{ lat: '48', lon: '2', osm_type: 'node', osm_id: 123 }]));
  const entry = { place_group_id: truth.place_group_id, canonical_names: [truth.name], existing_accepted_names: [truth.name], cross_record_alias_union: [], proposed_additions: [], conditional_additions: [],
    supplemental_coordinate_anchor: { kind: 'independently_adjudicated_map_feature', coordinates: { lat: 48, lng: 2 }, adjudication: 'Same named feature and locality independently verified.', evidence: [{ path: evidencePath, sha256: f.hashFile(evidencePath), source_url: 'https://example.invalid/map', locator: '/0', osm_type: 'node', osm_id: 123 }] } };
  f.map.entries.push(entry);
  assert.equal(f.reload().placeMatches({ name: truth.name, coordinates: { lat: 48, lng: 2 } }, truth), true);
  entry.supplemental_coordinate_anchor.coordinates.lat = 48.1;
  assert.throws(() => f.reload(), /anchor_feature_mismatch/);
  entry.supplemental_coordinate_anchor.coordinates.lat = 48;
  f.map.entries[0].supplemental_coordinate_anchor = entry.supplemental_coordinate_anchor;
  assert.throws(() => f.reload(), /invalid_supplemental_anchor/);
});
