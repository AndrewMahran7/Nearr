import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { holdoutEligibility, inferencePayload, opaqueCaseId, opaquePlaceGroupId, opaqueSourceGroupId, placeMatches, proposeSplits, renderReview, scoreOne, summarizeScores, validateLabels, validateManifest, validateSplits } from './core.mjs';

const cid = opaqueCaseId('instagram', 'example-123');
const gid = opaqueSourceGroupId('instagram:example-123');
const pg = opaquePlaceGroupId('place:mallorca:cala-varques');
const manifest = (overrides = {}) => ({
  case_id: cid, source_group_id: gid, platform: 'instagram', source_public_id: 'example-123',
  source_url_reference: 'https://instagram.com/reel/example-123', retrieval_date: '2026-10-08',
  categories: ['beach'], state: 'ready', exposure: 'new_unscored',
  evidence: { caption: 'At Cala Varques today', description: 'Cala Varques, Mallorca', hashtags: ['#CalaVarques'], tagged_accounts: ['cala.varques'], location_tag: 'Cala Varques', source_geography: { city: 'Mallorca' }, transcript: 'Welcome to Cala Varques', frame_paths: ['C:/private/Cala Varques/frame.jpg'] },
  answer_spans: [
    { field: 'caption', start: 3, end: 15, kind: 'exact_place' },
    { field: 'description', start: 0, end: 12, kind: 'exact_place' },
    { field: 'transcript', start: 11, end: 23, kind: 'exact_place' },
    { field: 'location_tag', start: 0, end: 12, kind: 'exact_place' },
    { field: 'tagged_accounts', start: 0, end: 12, kind: 'exact_place' },
    { field: 'source_geography', start: 0, end: 8, kind: 'geography' },
  ],
  view_eligibility: { full: true, description_hidden: true, location_hidden: true, visual_only: true, text_only: true },
  ...overrides,
});
const label = (overrides = {}) => ({
  case_id: cid, label_class: 'VERIFIED_EXACT_SINGLE',
  expected_places: [{ place_id: 'google:123', name: 'Cala Varques', aliases: ['Cala Varques'], role: 'depicted', country: 'Spain', region: 'Balearic Islands', coordinates: { lat: 39.5, lng: 3.3 }, accepted_radius_meters: 100 }],
  complete_set_established: true, place_group_ids: [pg], reasonable_autonomous_expected: true,
  provenance: [{ kind: 'source_caption', reference: 'https://instagram.com/reel/example-123' }, { kind: 'official_tourism', reference: 'https://example.org/cala', independent: true }],
  review: { decision: 'accept', reviewer: 'reviewer-b', reviewed_at: '2026-10-08T00:00:00Z', independent: true }, ...overrides,
});
const pred = { place_id: 'google:123', name: 'Cala Varques', country: 'Spain', region: 'Balearic Islands' };
const observation = (record, view, overrides = {}) => ({
  input_id: inferencePayload(record, label(), view).input_id, view, status: 'completed', autonomous: true,
  places: [pred], candidates: [pred], multi_place_detected: false, geography: { country: 'Spain', region: 'Balearic Islands' },
  elapsed_ms: 100, cost_usd: 0.01, ...overrides,
});

test('opaque IDs have no answer text and source group duplicates are caught', () => {
  assert.match(cid, /^g_[a-f0-9]{16}$/);
  assert.doesNotMatch(cid, /Cala/i);
  assert.equal(validateManifest([manifest()]).cases, 1);
  assert.throws(() => validateManifest([manifest(), manifest({ case_id: opaqueCaseId('instagram', 'mirror'), source_group_id: opaqueSourceGroupId('wrong') })]), /duplicate_post_across_groups/);
  assert.equal(validateLabels([manifest()], [label()]).labeled, 1);
  const watchA = manifest({ case_id: opaqueCaseId('youtube', 'a'), source_group_id: opaqueSourceGroupId('watch-a'), platform: 'youtube', source_public_id: null, source_url_reference: 'https://youtube.com/watch?v=a' });
  const watchB = manifest({ case_id: opaqueCaseId('youtube', 'b'), source_group_id: opaqueSourceGroupId('watch-b'), platform: 'youtube', source_public_id: null, source_url_reference: 'https://youtube.com/watch?v=b' });
  assert.equal(validateManifest([watchA, watchB]).sourceGroups, 2);
  assert.throws(() => validateManifest([watchA, { ...watchB, source_url_reference: watchA.source_url_reference }]), /duplicate_post_across_groups/);
});

test('answer spans contain offsets, not duplicated text', () => {
  assert.throws(() => validateManifest([manifest({ answer_spans: [{ field: 'caption', start: 3, end: 15, kind: 'exact_place', text: 'Cala Varques' }] })]), /invalid_answer_spans/);
});

test('masked payloads exclude answer-bearing source metadata, path names, labels and cache', () => {
  const r = manifest(), l = label();
  const full = inferencePayload(r, l, 'full');
  assert.match(JSON.stringify(full), /Cala Varques/);
  const desc = inferencePayload(r, l, 'description_hidden');
  assert.equal(desc.evidence.caption, null);
  assert.equal(desc.evidence.description, null);
  assert.equal(desc.evidence.hashtags, null);
  assert.equal(desc.evidence.transcript, null);
  assert.equal(desc.evidence.location_tag, null);
  const unannotated = manifest({ answer_spans: [] });
  const descUnannotated = inferencePayload(unannotated, l, 'description_hidden');
  assert.equal(descUnannotated.evidence.transcript, null);
  assert.equal(descUnannotated.evidence.location_tag, null);
  const loc = inferencePayload(r, l, 'location_hidden');
  assert.equal(loc.evidence.location_tag, null);
  assert.equal(loc.evidence.source_geography, null);
  assert.match(loc.evidence.caption, /Cala Varques/); // This view removes geography, not caption.
  const visual = inferencePayload(r, l, 'visual_only');
  const serialized = JSON.stringify(visual);
  assert.doesNotMatch(serialized, /Cala|Varques|instagram|example-123|private|source_url|place_id|candidate|case_id|answer_spans|ground_truth|debug_context/i);
  assert.deepEqual(visual.media.frames, ['frames/000.jpg']);
  assert.equal(visual.cache_policy, 'disabled');
  assert.ok(Object.values(visual.evidence).every((x) => x === null));
  const text = inferencePayload(r, l, 'text_only');
  assert.deepEqual(text.media.frames, []);
  assert.match(text.evidence.caption, /Cala Varques/);
});

test('visual only cannot be claimed for missing frames or answer overlays', () => {
  assert.throws(() => validateManifest([manifest({ evidence: { caption: 'Answer' } })]), /missing_visual_evidence_for_view/);
  assert.throws(() => inferencePayload(manifest({ visual_answer_overlay: true }), label(), 'visual_only'), /visual_only_not_clean/);
  assert.throws(() => validateManifest([manifest({ visual_answer_overlay: true })]), /description_hidden_overlay_leak/);
});

test('historical, unreviewed and weakly verified cases cannot enter holdout', () => {
  assert.deepEqual(holdoutEligibility(manifest(), label()), { eligible: true, reasons: [] });
  assert.ok(holdoutEligibility(manifest({ exposure: 'historical_outcomes_already_exposed' }), label()).reasons.includes('historical_outcome_exposed'));
  assert.ok(holdoutEligibility(manifest(), label({ review: { decision: 'accept' } })).reasons.includes('independent_manual_review_missing'));
  assert.ok(holdoutEligibility(manifest(), label({ provenance: [{ kind: 'source_caption', reference: 'source' }] })).reasons.includes('independent_provenance_missing'));
  assert.ok(holdoutEligibility(manifest(), label({ review: { decision: 'negative', reviewer: 'reviewer-b', reviewed_at: '2026-10-08T00:00:00Z', independent: true } })).reasons.includes('review_label_mismatch'));
  assert.ok(holdoutEligibility(manifest(), label({ collected_by: 'reviewer-b' })).reasons.includes('reviewer_not_independent'));
  assert.ok(holdoutEligibility(manifest({ evidence: { caption: 'Cala Varques' }, view_eligibility: { full: false, description_hidden: false, location_hidden: false, visual_only: false, text_only: true } }), label()).reasons.includes('full_visual_evidence_missing'));
});

test('source and place connected groups cannot cross splits', () => {
  const a = manifest(), la = label();
  const b = manifest({ case_id: opaqueCaseId('youtube', 'other'), source_group_id: opaqueSourceGroupId('youtube:other'), platform: 'youtube', source_public_id: 'other', source_url_reference: 'https://youtube.com/watch?v=other' });
  const lb = label({ case_id: b.case_id });
  const proposed = proposeSplits([a, b], [la, lb]);
  assert.equal(proposed.assignments[a.case_id], proposed.assignments[b.case_id]);
  assert.throws(() => validateSplits([a, b], [la, lb], { assignments: { [a.case_id]: 'development', [b.case_id]: 'held_out' } }), /place_group_leakage/);
  const exposed = manifest({ exposure: 'historical_outcomes_already_exposed' });
  assert.equal(proposeSplits([exposed], [la]).assignments[cid], 'development');
});

test('single score requires exact physical identity and excludes review from autonomous rate', () => {
  const r = manifest(), l = label(), good = scoreOne(r, l, observation(r, 'full'), 'development', 'full');
  assert.equal(good.exact_top1, true);
  assert.equal(good.correct_autonomous, true);
  const wrong = scoreOne(r, l, observation(r, 'full', { places: [{ place_id: 'google:wrong', name: 'Cala Varques', country: 'Spain', region: 'Balearic Islands' }], candidates: [{ place_id: 'google:wrong', name: 'Cala Varques', country: 'Spain', region: 'Balearic Islands' }] }), 'development', 'full');
  assert.equal(wrong.correct_autonomous, false);
  const review = scoreOne(r, l, observation(r, 'full', { status: 'review', autonomous: false, places: [] }), 'development', 'full');
  const summary = summarizeScores([good, wrong, review]);
  assert.deepEqual(summary.correct_autonomous_resolution, { numerator: 1, denominator: 3, rate: 1 / 3 });
  assert.deepEqual(summary.autonomous_precision, { numerator: 1, denominator: 2, rate: 0.5 });
  assert.deepEqual(summary.wrong_confident, { numerator: 1, denominator: 3, rate: 1 / 3 });
  assert.equal(summary.latency.correct_autonomous.p90, 100);
});

test('branch name alone is insufficient when branch location cannot be checked', () => {
  const branch = { name: 'Cafe Chain', aliases: ['Cafe Chain'], place_id: 'google:branch-a', branch_disambiguation: true, country: 'USA', city: 'New York' };
  assert.equal(placeMatches({ name: 'Cafe Chain', place_id: 'osm:branch-b', country: 'USA', city: 'New York' }, branch), false);
  assert.equal(placeMatches({ name: 'Cafe Chain', place_id: 'google:branch-a' }, branch), true);
  assert.equal(placeMatches({ name: 'Cafe Chain', country: 'USA', city: 'New York', address: '12 First Street' }, { ...branch, accepted_addresses: ['12 First Street'] }), true);
});

test('multi scores maximum distinct place assignment, extra and missed places', () => {
  const r = manifest();
  const l = label({ label_class: 'VERIFIED_MULTI', expected_places: [
    { place_id: 'google:a', name: 'One', aliases: ['One', 'Two'], role: 'depicted', country: 'Spain', region: 'Balearic Islands' },
    { place_id: 'google:b', name: 'Two', aliases: ['Two'], role: 'depicted', country: 'Spain', region: 'Balearic Islands' },
    { name: 'Mentioned only', aliases: ['Mentioned only'], role: 'mentioned_only' },
  ] });
  const o = observation(r, 'full', { places: [
    { place_id: 'google:a', name: 'One' }, { place_id: 'google:b', name: 'Two' }, { place_id: 'google:extra', name: 'Extra' },
  ], multi_place_detected: true });
  const row = scoreOne(r, l, o, 'development', 'full');
  assert.equal(row.true_positives, 2);
  assert.equal(row.expected_places, 2);
  assert.equal(row.extras, 1);
  assert.equal(row.misses, 0);
  assert.equal(row.exact_set, false);
  const m = summarizeScores([row]).multi;
  assert.equal(m.place_precision.rate, 2 / 3);
  assert.equal(m.place_recall.rate, 1);
  assert.equal(m.f1, 0.8);
  assert.equal(summarizeScores([scoreOne(r, l, { ...o, multi_place_detected: null }, 'development', 'full')]).multi.detection.rate, null);
});

test('negative and region only cases count unsupported exact output', () => {
  const r = manifest();
  const negative = label({ label_class: 'KNOWN_NEGATIVE', expected_places: [], complete_set_established: false });
  const neg = scoreOne(r, negative, observation(r, 'full'), 'development', 'full');
  assert.equal(neg.negative_unsupported_exact, true);
  const region = label({ label_class: 'VERIFIED_REGION_ONLY', expected_places: [], complete_set_established: false, geography: { country: 'Spain', region: 'Balearic Islands' } });
  const bad = scoreOne(r, region, observation(r, 'full', { places: [], geography: { country: 'USA', region: 'California' } }), 'development', 'full');
  assert.equal(bad.region_correct, false);
  assert.equal(bad.wrong_country, true);
  const summary = summarizeScores([neg, bad]);
  assert.equal(summary.correct_autonomous_resolution.rate, null);
  assert.equal(summary.autonomous_precision.rate, 0);
  const failedNegative = scoreOne(r, negative, observation(r, 'full', { status: 'failed', autonomous: false, places: [] }), 'development', 'full');
  assert.equal(failedNegative.negative_correct_abstention, false);
  const emptyCompletedNegative = scoreOne(r, negative, observation(r, 'full', { places: [] }), 'development', 'full');
  assert.equal(emptyCompletedNegative.negative_correct_abstention, true);
  assert.equal(summarizeScores([emptyCompletedNegative]).autonomous_precision.rate, null);
  const cachedNegative = scoreOne(r, negative, observation(r, 'full', { status: 'review', autonomous: false, places: [], wrong_confident_cache: true }), 'development', 'full');
  assert.equal(cachedNegative.negative_correct_abstention, false);
  assert.equal(cachedNegative.wrong_confident, true);
});

test('scorer rejects noncompleted autonomous observations and missing arrays', () => {
  const r = manifest();
  assert.throws(() => scoreOne(r, label(), observation(r, 'full', { status: 'failed' }), 'development', 'full'), /invalid_autonomous_status/);
  assert.throws(() => scoreOne(r, label(), observation(r, 'full', { candidates: null }), 'development', 'full'), /invalid_observation_shape/);
});

test('review HTML escapes source and proposed label content', () => {
  const html = renderReview(manifest({ evidence: { caption: '<script>alert(1)</script>' } }), label());
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /independent/);
});

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0;
test('materialization re-encodes source metadata and hides source names, paths, labels, and cache', { skip: !ffmpegAvailable }, () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-gold-mask-'));
  const frameDir = path.join(scratch, 'Cala Varques private frame path');
  const frame = path.join(frameDir, 'CalaVarquesSecret.jpg');
  const caseId = opaqueCaseId('instagram', randomUUID());
  const r = manifest({ case_id: caseId, source_public_id: randomUUID(), source_group_id: opaqueSourceGroupId(randomUUID()), evidence: { ...manifest().evidence, frame_paths: [frame] } });
  const l = label({ case_id: caseId });
  let output;
  try {
    fs.mkdirSync(frameDir);
    const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=0.1', '-metadata', 'title=CalaVarquesSecret', '-frames:v', '1', frame], { stdio: 'ignore', windowsHide: true });
    assert.equal(generated.status, 0);
    const manifestFile = path.join(scratch, 'manifest.jsonl'), labelsFile = path.join(scratch, 'labels.jsonl');
    fs.writeFileSync(manifestFile, JSON.stringify(r) + '\n');
    fs.writeFileSync(labelsFile, JSON.stringify(l) + '\n');
    const run = spawnSync(process.execPath, ['scripts/gold-dataset/cli.mjs', 'materialize', '--manifest', manifestFile, '--labels', labelsFile, '--case', caseId, '--view', 'visual_only'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr);
    output = JSON.parse(run.stdout);
    const inputBytes = fs.readFileSync(output.input, 'utf8');
    assert.doesNotMatch(inputBytes, /Cala|Varques|Secret|instagram|source_public|source_url|label|candidate|ground_truth|private/i);
    assert.equal(JSON.parse(inputBytes).cache_policy, 'disabled');
    const relative = path.relative(path.dirname(output.input), path.join(path.dirname(output.input), 'frames', '000.jpg'));
    assert.equal(relative.replaceAll('\\', '/'), 'frames/000.jpg');
    const frameBytes = fs.readFileSync(path.join(path.dirname(output.input), 'frames', '000.jpg')).toString('latin1');
    assert.doesNotMatch(frameBytes, /CalaVarquesSecret/);
    assert.match(path.basename(path.dirname(output.input)), /^[a-f0-9]{24}$/);
    assert.match(path.basename(output.mapping), /^[a-f0-9]{24}\.json$/);
  } finally {
    const scratchRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(path.resolve(scratch).startsWith(scratchRoot));
    fs.rmSync(scratch, { recursive: true, force: true });
    if (output) {
      const localRoot = path.resolve(root, '.local/recognition-gold-dataset') + path.sep;
      assert.ok(path.resolve(path.dirname(output.input)).startsWith(localRoot));
      assert.ok(path.resolve(output.mapping).startsWith(localRoot));
      fs.rmSync(path.dirname(output.input), { recursive: true, force: true });
      fs.rmSync(output.mapping, { force: true });
    }
  }
});

test('CLI scores a development observation and rejects an unsealed held-out attempt', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-gold-score-'));
  const caseId = opaqueCaseId('youtube', randomUUID());
  const r = manifest({ case_id: caseId, source_group_id: opaqueSourceGroupId(randomUUID()), platform: 'youtube', source_public_id: randomUUID(), source_url_reference: 'https://youtube.com/watch?v=score', evidence: { ...manifest().evidence, frame_paths: ['C:/nonexistent/frame.jpg'] } });
  const l = label({ case_id: caseId });
  const manifestFile = path.join(scratch, 'manifest.jsonl'), labelsFile = path.join(scratch, 'labels.jsonl');
  const splitFile = path.join(scratch, 'splits.json'), observationsFile = path.join(scratch, 'observations.jsonl');
  const resultFile = path.join(scratch, `score-${randomUUID()}.json`);
  let privateResult;
  try {
    fs.writeFileSync(manifestFile, JSON.stringify(r) + '\n');
    fs.writeFileSync(labelsFile, JSON.stringify(l) + '\n');
    fs.writeFileSync(splitFile, JSON.stringify({ schema_version: 1, assignments: { [caseId]: 'development' } }));
    fs.writeFileSync(observationsFile, JSON.stringify(observation(r, 'full')) + '\n');
    const command = ['scripts/gold-dataset/cli.mjs', 'score', '--manifest', manifestFile, '--labels', labelsFile, '--splits', splitFile, '--split', 'development', '--view', 'full', '--observations', observationsFile, '--out', resultFile];
    const scored = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(scored.status, 0, scored.stderr);
    const output = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.deepEqual(output.summary.correct_autonomous_resolution, { numerator: 1, denominator: 1, rate: 1 });
    privateResult = path.resolve(root, output.per_case_private_path);
    assert.ok(fs.existsSync(privateResult));
    assert.doesNotMatch(fs.readFileSync(resultFile, 'utf8'), /Cala Varques|google:123/);
    const held = spawnSync(process.execPath, [...command.slice(0, command.indexOf('--split')), '--split', 'held_out', ...command.slice(command.indexOf('--view'))], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.notEqual(held.status, 0);
    assert.match(held.stderr, /heldout_requires_explicit_flag|ineligible_holdout/);
  } finally {
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(path.resolve(scratch).startsWith(tempRoot));
    fs.rmSync(scratch, { recursive: true, force: true });
    if (privateResult) {
      const localRoot = path.resolve(root, '.local/recognition-gold-dataset') + path.sep;
      assert.ok(privateResult.startsWith(localRoot));
      fs.rmSync(privateResult, { force: true });
    }
  }
});
