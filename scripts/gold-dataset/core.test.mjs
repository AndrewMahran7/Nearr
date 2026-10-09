import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { benchmarkReadiness, heldoutRunKey, holdoutEligibility, independentGroupCount, inferencePayload, opaqueCaseId, opaquePlaceGroupId, opaqueSourceGroupId, placeMatches, proposeSplits, renderReview, scoreOne, sha256, summarizeScores, validateLabels, validateManifest, validateSplits } from './core.mjs';

const cid = opaqueCaseId('instagram', 'example-123');
const gid = opaqueSourceGroupId('instagram:example-123');
const pg = opaquePlaceGroupId('place:mallorca:cala-varques');
const manifest = (overrides = {}) => ({
  case_id: cid, source_group_id: gid, platform: 'instagram', source_public_id: 'example-123',
  source_url_reference: 'https://instagram.com/reel/example-123', retrieval_date: '2026-10-08',
  categories: ['beach'], state: 'ready', exposure: 'new_unscored',
  evidence: { caption: 'At Cala Varques today', description: 'Cala Varques, Mallorca', hashtags: ['#CalaVarques'], tagged_accounts: ['cala.varques'], location_tag: 'Cala Varques', source_geography: { city: 'Mallorca' }, transcript: 'Welcome to Cala Varques', transcript_source: 'spoken_audio', frame_paths: ['C:/private/Cala Varques/open.jpg', 'C:/private/Cala Varques/middle.jpg', 'C:/private/Cala Varques/end.jpg'], frame_sha256: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)] },
  visual_review: { duration_seconds: 10, frame_timestamps_seconds: [1, 5, 9], coverage: ['opening', 'middle', 'ending'], entire_video_inspected: true, reviewer: 'collector-a', reviewed_at: '2026-10-08T00:00:00Z' },
  answer_spans: [
    { field: 'caption', start: 3, end: 15, kind: 'exact_place' },
    { field: 'description', start: 0, end: 12, kind: 'exact_place' },
    { field: 'transcript', start: 11, end: 23, kind: 'exact_place' },
    { field: 'location_tag', start: 0, end: 12, kind: 'exact_place' },
    { field: 'tagged_accounts', start: 0, end: 12, kind: 'exact_place' },
    { field: 'source_geography', start: 0, end: 8, kind: 'geography' },
  ],
  view_eligibility: { full: true, description_hidden: true, location_hidden: true, visual_audio: true, visual_only: true, text_only: true },
  evidence_note: 'test fixture',
  visual_answer_overlay: false, mask_review: { answer_fields_checked: true, permitted_media_derivative: true, reviewer: 'reviewer-b', reviewed_at: '2026-10-08T00:00:00Z' },
  ...overrides,
});
const label = (overrides = {}) => ({
  case_id: cid, label_class: 'VERIFIED_EXACT_SINGLE',
  expected_places: [{ place_id: 'google:123', place_group_id: pg, name: 'Cala Varques', aliases: ['Cala Varques'], role: 'depicted', country: 'Spain', region: 'Balearic Islands', coordinates: { lat: 39.5, lng: 3.3 }, accepted_radius_meters: 100 }],
  complete_set_established: true, place_group_ids: [pg], reasonable_autonomous_expected: true, confidence: 'HIGH', collected_by: 'collector-a',
  provenance: [{ kind: 'source_caption', reference: 'https://instagram.com/reel/example-123' }, { kind: 'official_tourism', reference: 'https://example.org/cala', independent: true }],
  review_passes: [
    { decision: 'accept', reviewer: 'collector-a', reviewed_at: '2026-10-08T00:00:00Z', evidence_inspected: true, verification_reference: 'official source A', accepted_place_group_ids: [pg] },
    { decision: 'accept', reviewer: 'reviewer-b', reviewed_at: '2026-10-08T01:00:00Z', evidence_inspected: true, verification_reference: 'independent source B', accepted_place_group_ids: [pg], independent: true, blind_to_first_pass: true },
  ],
  review_agreement: 'agree',
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
  const idAndUrl = manifest({ case_id: opaqueCaseId('youtube', 'same-id'), platform: 'youtube', source_public_id: 'same-id', source_url_reference: 'https://youtube.com/watch?v=same-id' });
  const urlOnly = manifest({ case_id: opaqueCaseId('youtube', 'url-only-duplicate'), source_group_id: opaqueSourceGroupId('wrong-group'), platform: 'youtube', source_public_id: null, source_url_reference: 'https://youtube.com/watch?v=same-id&utm_source=tracking' });
  assert.throws(() => validateManifest([idAndUrl, urlOnly]), /duplicate_post_across_groups/);
});

test('answer spans contain offsets, not duplicated text', () => {
  assert.throws(() => validateManifest([manifest({ answer_spans: [{ field: 'caption', start: 3, end: 15, kind: 'exact_place', text: 'Cala Varques' }] })]), /invalid_answer_spans/);
});

test('text-only eligibility accepts absent caption and description when other text exists', () => {
  const r = manifest({ evidence: { ...manifest().evidence, caption: null, description: null } });
  assert.equal(validateManifest([r]).cases, 1);
  const empty = manifest({ evidence: { ...r.evidence, hashtags: [], tagged_accounts: [], location_tag: null, source_geography: null, transcript: null }, view_eligibility: { ...r.view_eligibility, visual_audio: false } });
  assert.throws(() => validateManifest([empty]), /invalid_text_only_eligibility/);
});

test('evidence views keep only intended modalities and exclude paths, labels and cache', () => {
  const r = manifest(), l = label();
  const full = inferencePayload(r, l, 'full');
  assert.match(JSON.stringify(full), /Cala Varques/);
  const desc = inferencePayload(r, l, 'description_hidden');
  assert.equal(desc.evidence.caption, null);
  assert.equal(desc.evidence.description, null);
  assert.equal(desc.evidence.hashtags, null);
  assert.equal(desc.evidence.transcript, 'Welcome to Cala Varques');
  assert.equal(desc.evidence.location_tag, 'Cala Varques');
  const unannotated = manifest({ answer_spans: [] });
  const descUnannotated = inferencePayload(unannotated, l, 'description_hidden');
  assert.equal(descUnannotated.evidence.transcript, 'Welcome to Cala Varques');
  assert.equal(descUnannotated.evidence.location_tag, 'Cala Varques');
  const compactHandle = manifest({ answer_spans: [], evidence: { ...r.evidence, tagged_accounts: ['@CalaVarques'], location_tag: null, transcript: null } });
  assert.deepEqual(inferencePayload(compactHandle, l, 'description_hidden').evidence.tagged_accounts, ['@CalaVarques']);
  const loc = inferencePayload(r, l, 'location_hidden');
  assert.equal(loc.evidence.location_tag, null);
  assert.equal(loc.evidence.source_geography, null);
  assert.match(loc.evidence.caption, /Cala Varques/); // This view removes geography, not caption.
  const visual = inferencePayload(r, l, 'visual_only');
  const serialized = JSON.stringify(visual);
  assert.doesNotMatch(serialized, /Cala|Varques|instagram|example-123|private|source_url|place_id|candidate|case_id|answer_spans|ground_truth|debug_context/i);
  assert.deepEqual(visual.media.frames, ['frames/000.jpg', 'frames/001.jpg', 'frames/002.jpg']);
  assert.equal(visual.cache_policy, 'disabled');
  assert.ok(Object.values(visual.evidence).every((x) => x === null));
  const visualAudio = inferencePayload(r, l, 'visual_audio');
  assert.deepEqual(visualAudio.media.frames, ['frames/000.jpg', 'frames/001.jpg', 'frames/002.jpg']);
  assert.equal(visualAudio.evidence.transcript, 'Welcome to Cala Varques');
  assert.ok(Object.entries(visualAudio.evidence).every(([key, value]) => key === 'transcript' || value === null));
  assert.doesNotMatch(JSON.stringify(visualAudio), /instagram|source_url|cala\.varques|example-123|private/i);
  const text = inferencePayload(r, l, 'text_only');
  assert.deepEqual(text.media.frames, []);
  assert.match(text.evidence.caption, /Cala Varques/);
});

test('nested source geography cannot carry debug truth or cache into inference', () => {
  const attack = manifest({ evidence: { ...manifest().evidence, source_geography: { country: 'Spain', debug_context: { ground_truth: 'Cala Varques', candidate_cache: 'Cala Varques' } } } });
  assert.throws(() => validateManifest([attack]), /invalid_source_geography/);
  const raw = JSON.stringify(inferencePayload(attack, label(), 'text_only'));
  assert.doesNotMatch(raw, /debug_context|ground_truth|candidate_cache/);
});

test('normal visual-only keeps legitimate in-video text; separate pixel-text masking requires reviewed derivatives', () => {
  assert.throws(() => validateManifest([manifest({ evidence: { caption: 'Answer' } })]), /missing_visual_evidence_for_view/);
  const overlay = manifest({ visual_answer_overlay: true });
  assert.equal(validateManifest([overlay]).cases, 1);
  assert.deepEqual(inferencePayload(overlay, label(), 'visual_only').media.frames, ['frames/000.jpg', 'frames/001.jpg', 'frames/002.jpg']);
  assert.deepEqual(holdoutEligibility(overlay, label()), { eligible: true, reasons: [] });
  const masked = manifest({ view_eligibility: { ...overlay.view_eligibility, visual_pixel_text_masked: true } });
  assert.throws(() => validateManifest([masked]), /pixel_text_mask_evidence_missing/);
  const reviewed = manifest({ view_eligibility: masked.view_eligibility, evidence: { ...overlay.evidence, pixel_text_masked_frame_paths: ['C:/private/masked-1.jpg', 'C:/private/masked-2.jpg', 'C:/private/masked-3.jpg'], pixel_text_masked_frame_sha256: ['d'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)] }, mask_review: { ...overlay.mask_review, pixel_text_mask_verified: true } });
  assert.equal(validateManifest([reviewed]).cases, 1);
  assert.deepEqual(inferencePayload(reviewed, label(), 'visual_pixel_text_masked').media.frames, ['frames/000.jpg', 'frames/001.jpg', 'frames/002.jpg']);
  assert.ok(Object.values(inferencePayload(reviewed, label(), 'visual_pixel_text_masked').evidence).every((x) => x === null));
});

test('visual-audio requires a transcript of spoken audio, not copied social text', () => {
  const r = manifest({ evidence: { ...manifest().evidence, transcript_source: undefined } });
  assert.throws(() => validateManifest([r]), /visual_audio_spoken_transcript_missing/);
  assert.throws(() => inferencePayload(r, label(), 'visual_audio'), /visual_audio_spoken_transcript_missing/);
});

test('READY requires reviewed opening, middle and ending frames with matching hashes', () => {
  assert.equal(validateManifest([manifest()]).cases, 1);
  assert.throws(() => validateManifest([manifest({ visual_review: { ...manifest().visual_review, entire_video_inspected: false } })]), /ready_visual_review_missing/);
  assert.throws(() => validateManifest([manifest({ visual_review: { ...manifest().visual_review, frame_timestamps_seconds: [1, 2, 3] } })]), /ready_visual_review_missing/);
  assert.throws(() => validateManifest([manifest({ evidence: { ...manifest().evidence, frame_sha256: ['a'.repeat(64)] } })]), /ready_visual_evidence_missing/);
  assert.equal(validateManifest([manifest({ state: 'candidate', visual_review: undefined })]).cases, 1);
});

test('completion gate counts benchmark-ready cases and reports exact slice deficits', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    case_id: `case-${i}`, state: 'ready', view_eligibility: { full: true, description_hidden: i < 50, visual_only: i < 30 },
    evidence: { frame_paths: ['open', 'middle', 'end'] }, categories: [i < 50 ? 'waterfall' : 'food', ...(i < 25 ? ['branch_disambiguation'] : [])],
    misleading_metadata: i < 25,
  }));
  const labels = rows.map((r, i) => ({ case_id: r.case_id, confidence: 'HIGH', label_class: i < 30 ? 'VERIFIED_MULTI' : i < 55 ? 'KNOWN_NEGATIVE' : 'VERIFIED_EXACT_SINGLE', complete_set_established: true }));
  const complete = benchmarkReadiness(rows, labels);
  assert.equal(complete.eligible, true);
  assert.deepEqual(complete.remaining, { ready: 0, complete_multi: 0, outdoor: 0, description_hidden: 0, visual_only: 0, misleading_metadata: 0, branch_disambiguation: 0, verified_negative: 0 });
  rows[199].state = 'candidate';
  rows[24].misleading_metadata = false;
  const short = benchmarkReadiness(rows, labels);
  assert.equal(short.eligible, false);
  assert.equal(short.remaining.ready, 1);
  assert.equal(short.remaining.misleading_metadata, 1);
});

test('historical, unreviewed and weakly verified cases cannot enter holdout', () => {
  assert.deepEqual(holdoutEligibility(manifest(), label()), { eligible: true, reasons: [] });
  assert.ok(holdoutEligibility(manifest({ exposure: 'historical_outcomes_already_exposed' }), label()).reasons.includes('historical_outcome_exposed'));
  assert.ok(holdoutEligibility(manifest(), label({ review: { decision: 'accept' } })).reasons.includes('independent_manual_review_missing'));
  assert.ok(holdoutEligibility(manifest(), label({ provenance: [{ kind: 'source_caption', reference: 'source' }] })).reasons.includes('independent_provenance_missing'));
  assert.ok(holdoutEligibility(manifest(), label({ review: { decision: 'negative', reviewer: 'reviewer-b', reviewed_at: '2026-10-08T00:00:00Z', independent: true } })).reasons.includes('review_label_mismatch'));
  assert.ok(holdoutEligibility(manifest(), label({ collected_by: 'reviewer-b' })).reasons.includes('reviewer_not_independent'));
  assert.ok(holdoutEligibility(manifest({ evidence: { caption: 'Cala Varques' }, view_eligibility: { full: false, description_hidden: false, location_hidden: false, visual_only: false, text_only: true } }), label()).reasons.includes('full_visual_evidence_missing'));
  assert.ok(holdoutEligibility(manifest({ evidence: { ...manifest().evidence, frame_sha256: [] } }), label()).reasons.includes('frame_hashes_missing'));
  assert.ok(holdoutEligibility(manifest({ mask_review: { answer_fields_checked: true, reviewer: 'reviewer-b' } }), label()).reasons.includes('visual_mask_review_missing'));
  assert.ok(holdoutEligibility(manifest(), label({ confidence: 'MEDIUM' })).reasons.includes('high_confidence_missing'));
  assert.ok(holdoutEligibility(manifest(), label({ review_agreement: 'disagree' })).reasons.includes('heldout_double_review_missing_or_disagreed'));
  assert.ok(holdoutEligibility(manifest(), label({ review_passes: [label().review_passes[0], { ...label().review_passes[1], blind_to_first_pass: false }] })).reasons.includes('heldout_double_review_missing_or_disagreed'));
  assert.ok(holdoutEligibility(manifest(), label({ review_passes: [label().review_passes[0], { ...label().review_passes[1], accepted_place_group_ids: [opaquePlaceGroupId('other')] }] })).reasons.includes('heldout_double_review_missing_or_disagreed'));
  assert.throws(() => validateLabels([manifest()], [label({ confidence: 'MEDIUM' })]), /ready_requires_high_confidence/);
  assert.throws(() => validateLabels([manifest()], [label({ label_class: 'UNVERIFIED', expected_places: [] })]), /ready_truth_review_missing/);
  assert.throws(() => validateLabels([manifest()], [label({ review: { decision: 'accept', reviewer: 'collector-a', reviewed_at: '2026-10-08T01:00:00Z', independent: true } })]), /ready_truth_review_missing/);
});

test('each ready depicted exact place needs a distinct shared place group', () => {
  assert.throws(() => validateLabels([manifest()], [label({ expected_places: [{ ...label().expected_places[0], place_group_id: undefined }] })]), /incomplete_place_group_mapping/);
  assert.equal(validateLabels([manifest({ state: 'candidate' })], [label({ expected_places: [{ ...label().expected_places[0], place_group_id: undefined }] })]).labeled, 1);
  const multi = label({ label_class: 'VERIFIED_MULTI', expected_places: [
    { ...label().expected_places[0], name: 'One' }, { ...label().expected_places[0], name: 'Two' },
  ] });
  assert.throws(() => validateLabels([manifest()], [multi]), /incomplete_place_group_mapping/);
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
  assert.equal(independentGroupCount([a, b], [la, lb]), 1);
  assert.equal(independentGroupCount([a, b], [la, label({ case_id: b.case_id, place_group_ids: [opaquePlaceGroupId('different')] })]), 2);
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
  assert.throws(() => scoreOne(r, l, { ...o, multi_place_detected: null }, 'development', 'full'), /missing_multi_detection/);
  const failed = scoreOne(r, l, { ...o, status: 'failed', autonomous: false }, 'development', 'full');
  assert.equal(summarizeScores([failed]).multi.place_precision.rate, null);
  assert.equal(summarizeScores([failed]).multi.place_recall.rate, 0);
  assert.equal(summarizeScores([failed]).multi.exact_set.rate, 0);
  const review = scoreOne(r, l, { ...o, status: 'review', autonomous: false, places: o.places.slice(0, 2) }, 'development', 'full');
  assert.equal(summarizeScores([review]).multi.place_precision.rate, null);
  assert.equal(summarizeScores([review]).multi.review_proposal_exact_set.rate, 1);
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
  const reviewWithSuggestion = scoreOne(r, negative, observation(r, 'full', { status: 'review', autonomous: false }), 'development', 'full');
  assert.equal(reviewWithSuggestion.negative_correct_abstention, false);
});

test('cost requires an explicit complete measured provider ledger', () => {
  const r = manifest(), l = label();
  const unknown = scoreOne(r, l, observation(r, 'full'), 'development', 'full');
  assert.equal(summarizeScores([unknown]).cost.total_usd, null);
  const paid = scoreOne(r, l, observation(r, 'full', { cost_usd: 0.01, cost_basis: 'measured_provider_ledger', provider_ledger_complete: true, provider_usage: [{ provider: 'Places', measurement: 'measured', calls: 1, cost_usd: 0.01 }] }), 'development', 'full');
  assert.equal(summarizeScores([paid]).cost.total_usd, 0.01);
  const free = scoreOne(r, l, observation(r, 'full', { cost_usd: 0, cost_basis: 'no_paid_calls', provider_ledger_complete: true, provider_usage: [] }), 'development', 'full');
  assert.equal(free.cost_usd, 0);
  assert.throws(() => scoreOne(r, l, observation(r, 'full', { cost_usd: 0, cost_basis: 'measured_provider_ledger', provider_ledger_complete: true, provider_usage: [{ provider: 'Places', measurement: 'measured', calls: 1, cost_usd: 0.01 }] }), 'development', 'full'), /provider_cost_mismatch/);
});

test('held-out run identity survives resealing and permits each view only once', () => {
  const frozen = { manifest_sha256: 'a'.repeat(64), labels_sha256: 'b'.repeat(64), splits_sha256: 'c'.repeat(64) };
  assert.equal(heldoutRunKey({ ...frozen, created_at: 'first' }, 'baseline_v1', 'full'), heldoutRunKey({ ...frozen, created_at: 'second' }, 'baseline_v1', 'full'));
  assert.notEqual(heldoutRunKey(frozen, 'baseline_v1', 'full'), heldoutRunKey(frozen, 'baseline_v1', 'visual_only'));
});

test('scorer rejects noncompleted autonomous observations and missing arrays', () => {
  const r = manifest();
  assert.throws(() => scoreOne(r, label(), observation(r, 'full', { status: 'failed' }), 'development', 'full'), /invalid_autonomous_status/);
  assert.throws(() => scoreOne(r, label(), observation(r, 'full', { candidates: null }), 'development', 'full'), /invalid_observation_shape/);
});

test('review HTML escapes source and proposed label content', () => {
  const html = renderReview(manifest({ evidence: { caption: '<script>alert(1)</script>' } }), label({ label_class: 'UNVERIFIED', expected_places: [], proposed_places: [{ name: 'Cala Varques', aliases: [] }] }));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /independent/);
  assert.match(html, /proposed_places/);
});

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0;
test('materialization re-encodes source metadata and hides source names, paths, labels, and cache', { skip: !ffmpegAvailable }, () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-gold-mask-'));
  const frameDir = path.join(scratch, 'Cala Varques private frame path');
  const frame = path.join(frameDir, 'CalaVarquesSecret.jpg');
  const maskedFrame = path.join(frameDir, 'PixelTextMaskedSecret.jpg');
  const caseId = opaqueCaseId('instagram', randomUUID());
  const r = manifest({ case_id: caseId, source_public_id: randomUUID(), source_group_id: opaqueSourceGroupId(randomUUID()), state: 'candidate', view_eligibility: { ...manifest().view_eligibility, visual_pixel_text_masked: true }, mask_review: { ...manifest().mask_review, pixel_text_mask_verified: true }, evidence: { ...manifest().evidence, frame_paths: [frame], pixel_text_masked_frame_paths: [maskedFrame] } });
  const l = label({ case_id: caseId });
  const outputs = [];
  try {
    fs.mkdirSync(frameDir);
    const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=0.1', '-metadata', 'title=CalaVarquesSecret', '-frames:v', '1', frame], { stdio: 'ignore', windowsHide: true });
    assert.equal(generated.status, 0);
    const maskedGenerated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=16x16:d=0.1', '-metadata', 'title=PixelTextMaskedSecret', '-frames:v', '1', maskedFrame], { stdio: 'ignore', windowsHide: true });
    assert.equal(maskedGenerated.status, 0);
    r.evidence.frame_sha256 = [sha256(fs.readFileSync(frame))];
    r.evidence.pixel_text_masked_frame_sha256 = [sha256(fs.readFileSync(maskedFrame))];
    const manifestFile = path.join(scratch, 'manifest.jsonl'), labelsFile = path.join(scratch, 'labels.jsonl'), splitFile = path.join(scratch, 'splits.json');
    fs.writeFileSync(manifestFile, JSON.stringify(r) + '\n');
    fs.writeFileSync(labelsFile, JSON.stringify(l) + '\n');
    fs.writeFileSync(splitFile, JSON.stringify({ schema_version: 1, assignments: { [caseId]: 'development' } }));
    const run = spawnSync(process.execPath, ['scripts/gold-dataset/cli.mjs', 'materialize', '--manifest', manifestFile, '--labels', labelsFile, '--splits', splitFile, '--case', caseId, '--view', 'visual_only'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    outputs.push(output);
    const inputBytes = fs.readFileSync(output.input, 'utf8');
    assert.doesNotMatch(inputBytes, /Cala|Varques|Secret|instagram|source_public|source_url|label|candidate|ground_truth|private/i);
    assert.equal(JSON.parse(inputBytes).cache_policy, 'disabled');
    const relative = path.relative(path.dirname(output.input), path.join(path.dirname(output.input), 'frames', '000.jpg'));
    assert.equal(relative.replaceAll('\\', '/'), 'frames/000.jpg');
    const frameBytes = fs.readFileSync(path.join(path.dirname(output.input), 'frames', '000.jpg')).toString('latin1');
    assert.doesNotMatch(frameBytes, /CalaVarquesSecret/);
    assert.match(path.basename(path.dirname(output.input)), /^[a-f0-9]{24}$/);
    assert.match(path.basename(output.mapping), /^[a-f0-9]{24}\.json$/);
    const audioRun = spawnSync(process.execPath, ['scripts/gold-dataset/cli.mjs', 'materialize', '--manifest', manifestFile, '--labels', labelsFile, '--splits', splitFile, '--case', caseId, '--view', 'visual_audio'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(audioRun.status, 0, audioRun.stderr);
    const audioOutput = JSON.parse(audioRun.stdout);
    outputs.push(audioOutput);
    const audioInput = JSON.parse(fs.readFileSync(audioOutput.input, 'utf8'));
    assert.equal(audioInput.evidence.transcript, 'Welcome to Cala Varques');
    assert.ok(Object.entries(audioInput.evidence).every(([key, value]) => key === 'transcript' || value === null));
    const pixelRun = spawnSync(process.execPath, ['scripts/gold-dataset/cli.mjs', 'materialize', '--manifest', manifestFile, '--labels', labelsFile, '--splits', splitFile, '--case', caseId, '--view', 'visual_pixel_text_masked'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(pixelRun.status, 0, pixelRun.stderr);
    const pixelOutput = JSON.parse(pixelRun.stdout);
    outputs.push(pixelOutput);
    assert.notEqual(sha256(fs.readFileSync(path.join(path.dirname(pixelOutput.input), 'frames', '000.jpg'))), sha256(fs.readFileSync(path.join(path.dirname(output.input), 'frames', '000.jpg'))));
    assert.ok(Object.values(JSON.parse(fs.readFileSync(pixelOutput.input, 'utf8')).evidence).every((x) => x === null));
  } finally {
    const scratchRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(path.resolve(scratch).startsWith(scratchRoot));
    fs.rmSync(scratch, { recursive: true, force: true });
    for (const output of outputs) {
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
  const r = manifest({ case_id: caseId, source_group_id: opaqueSourceGroupId(randomUUID()), platform: 'youtube', source_public_id: randomUUID(), source_url_reference: 'https://youtube.com/watch?v=score', evidence: { ...manifest().evidence, frame_paths: ['C:/nonexistent/open.jpg', 'C:/nonexistent/middle.jpg', 'C:/nonexistent/end.jpg'] } });
  const l = label({ case_id: caseId });
  const manifestFile = path.join(scratch, 'manifest.jsonl'), labelsFile = path.join(scratch, 'labels.jsonl');
  const splitFile = path.join(scratch, 'splits.json'), observationsFile = path.join(scratch, 'observations.jsonl');
  const resultFile = path.join(scratch, `score-${randomUUID()}.json`);
  let privateResult, privateScratch;
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
    assert.match(held.stderr, /heldout_requires_explicit_baseline_milestone|ineligible_holdout/);
    const heldSplitFile = path.join(scratch, 'held-splits.json'), fakeSealFile = path.join(scratch, 'fake-seal.json');
    fs.writeFileSync(heldSplitFile, JSON.stringify({ schema_version: 1, assignments: { [caseId]: 'held_out' } }));
    fs.writeFileSync(fakeSealFile, JSON.stringify({ heldout_cases: 1, heldout_source_groups: 1, manifest_sha256: sha256(fs.readFileSync(manifestFile)), labels_sha256: sha256(fs.readFileSync(labelsFile)), splits_sha256: sha256(fs.readFileSync(heldSplitFile)), allowed_milestones: ['baseline_v1'] }));
    const forged = spawnSync(process.execPath, ['scripts/gold-dataset/cli.mjs', 'score', '--manifest', manifestFile, '--labels', labelsFile, '--splits', heldSplitFile, '--seal', fakeSealFile, '--split', 'held_out', '--view', 'full', '--observations', observationsFile, '--out', path.join(scratch, 'forged-score.json'), '--explicit-heldout', '--milestone', 'baseline_v1'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.notEqual(forged.status, 0);
    assert.match(forged.stderr, /holdout_requires_private_combined_manifest/);
    const localRoot = path.join(root, '.local/recognition-gold-dataset');
    fs.mkdirSync(localRoot, { recursive: true });
    privateScratch = fs.mkdtempSync(path.join(localRoot, 'forged-seal-'));
    const privateManifest = path.join(privateScratch, 'manifest.jsonl'), privateLabels = path.join(privateScratch, 'labels.jsonl');
    const privateSplits = path.join(privateScratch, 'splits.json'), privateSeal = path.join(privateScratch, 'seal.json');
    fs.copyFileSync(manifestFile, privateManifest); fs.copyFileSync(labelsFile, privateLabels); fs.copyFileSync(heldSplitFile, privateSplits);
    fs.writeFileSync(privateSeal, JSON.stringify({ heldout_cases: 1, heldout_source_groups: 1, manifest_sha256: sha256(fs.readFileSync(privateManifest)), labels_sha256: sha256(fs.readFileSync(privateLabels)), splits_sha256: sha256(fs.readFileSync(privateSplits)), allowed_milestones: ['baseline_v1'] }));
    const undersized = spawnSync(process.execPath, ['scripts/gold-dataset/cli.mjs', 'score', '--manifest', privateManifest, '--labels', privateLabels, '--splits', privateSplits, '--seal', privateSeal, '--split', 'held_out', '--view', 'full', '--observations', observationsFile, '--out', path.join(scratch, 'undersized-score.json'), '--explicit-heldout', '--milestone', 'baseline_v1'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.notEqual(undersized.status, 0);
    assert.match(undersized.stderr, /holdout_quality_size_gate/);
    const publicSeal = spawnSync(process.execPath, ['scripts/gold-dataset/cli.mjs', 'seal', '--manifest', manifestFile, '--labels', labelsFile, '--splits', heldSplitFile, '--seal', fakeSealFile], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.notEqual(publicSeal.status, 0);
    assert.match(publicSeal.stderr, /holdout_requires_private_combined_manifest/);
  } finally {
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(path.resolve(scratch).startsWith(tempRoot));
    fs.rmSync(scratch, { recursive: true, force: true });
    if (privateScratch) {
      const localRoot = path.resolve(root, '.local/recognition-gold-dataset') + path.sep;
      assert.ok(path.resolve(privateScratch).startsWith(localRoot));
      fs.rmSync(privateScratch, { recursive: true, force: true });
    }
    if (privateResult) {
      const localRoot = path.resolve(root, '.local/recognition-gold-dataset') + path.sep;
      assert.ok(privateResult.startsWith(localRoot));
      fs.rmSync(privateResult, { force: true });
    }
  }
});
