import crypto from 'node:crypto';

export const VIEWS = Object.freeze(['full', 'description_hidden', 'location_hidden', 'visual_only', 'text_only']);
export const LABELS = Object.freeze(['VERIFIED_EXACT_SINGLE', 'VERIFIED_MULTI', 'VERIFIED_REGION_ONLY', 'KNOWN_NEGATIVE', 'AMBIGUOUS', 'UNVERIFIED']);
export const SPLITS = Object.freeze(['development', 'calibration', 'held_out']);
const CASE_ID = /^g_[a-f0-9]{16}$/;
const SOURCE_GROUP_ID = /^sg_[a-f0-9]{16}$/;
const PLACE_GROUP_ID = /^pg_[a-f0-9]{16}$/;
const TEXT_FIELDS = ['caption', 'description', 'hashtags', 'tagged_accounts', 'location_tag', 'source_geography', 'transcript'];

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const opaqueCaseId = (platform, contentId) => `g_${sha256(`${platform}\0${contentId}`).slice(0, 16)}`;
export const opaqueSourceGroupId = (identity) => `sg_${sha256(identity).slice(0, 16)}`;
export const opaquePlaceGroupId = (identity) => `pg_${sha256(identity).slice(0, 16)}`;
export const heldoutRunKey = (seal, milestone, view) => sha256([seal.manifest_sha256, seal.labels_sha256, seal.splits_sha256, milestone, view].join('\0'));
const fail = (code) => { throw new Error(code); };
const array = (x) => Array.isArray(x) ? x : [];
const str = (x) => typeof x === 'string' ? x : '';
export const norm = (x) => str(x).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = (x) => norm(x).replaceAll(' ', '');
function sourceUrlKey(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) fail('invalid_public_url');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|igsh|si)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return sha256(url.toString());
}

export function validateManifest(records) {
  const ids = new Set(), publicIds = new Map();
  for (const r of records) {
    if (!CASE_ID.test(r.case_id ?? '') || ids.has(r.case_id)) fail(`invalid_or_duplicate_case_id:${r.case_id}`);
    ids.add(r.case_id);
    if (!SOURCE_GROUP_ID.test(r.source_group_id ?? '')) fail(`invalid_source_group:${r.case_id}`);
    if (!['instagram', 'tiktok', 'youtube', 'facebook', 'other'].includes(r.platform)) fail(`invalid_platform:${r.case_id}`);
    if (r.source_public_id != null && typeof r.source_public_id !== 'string') fail(`invalid_public_id:${r.case_id}`);
    if (r.source_url_reference != null && (typeof r.source_url_reference !== 'string' || !/^https?:\/\//i.test(r.source_url_reference))) fail(`invalid_public_url:${r.case_id}`);
    if (!r.source_public_id && !r.source_url_reference) fail(`missing_source_identity:${r.case_id}`);
    // Compare both identities when available: an ID-bearing record and a
    // URL-only record for the same post must not escape duplicate grouping.
    // Query params such as YouTube/Facebook ?v= remain part of the identity.
    const publicKeys = [r.source_public_id ? `${r.platform}\0id:${r.source_public_id}` : null,
      r.source_url_reference ? `${r.platform}\0url:${sourceUrlKey(r.source_url_reference)}` : null].filter(Boolean);
    for (const key of publicKeys) {
      if (publicIds.has(key) && publicIds.get(key) !== r.source_group_id) fail(`duplicate_post_across_groups:${r.case_id}`);
      publicIds.set(key, r.source_group_id);
    }
    if (r.retrieval_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(r.retrieval_date)) fail(`invalid_retrieval_date:${r.case_id}`);
    if (!Array.isArray(r.categories) || !r.categories.every((x) => typeof x === 'string')) fail(`invalid_categories:${r.case_id}`);
    if (!r.evidence || typeof r.evidence !== 'object' || Array.isArray(r.evidence)) fail(`invalid_evidence:${r.case_id}`);
    for (const field of ['caption', 'description', 'location_tag', 'transcript']) if (r.evidence[field] != null && typeof r.evidence[field] !== 'string') fail(`invalid_evidence_field:${r.case_id}:${field}`);
    for (const field of ['hashtags', 'tagged_accounts', 'frame_paths', 'frame_sha256']) if (r.evidence[field] != null && (!Array.isArray(r.evidence[field]) || !r.evidence[field].every((x) => typeof x === 'string'))) fail(`invalid_evidence_field:${r.case_id}:${field}`);
    if (r.evidence.source_geography != null && (typeof r.evidence.source_geography !== 'object' || Array.isArray(r.evidence.source_geography) || Object.keys(r.evidence.source_geography).some((x) => !['country', 'region', 'city'].includes(x)) || Object.values(r.evidence.source_geography).some((x) => x != null && typeof x !== 'string'))) fail(`invalid_source_geography:${r.case_id}`);
    if (!Array.isArray(r.answer_spans) || !r.answer_spans.every((x) => TEXT_FIELDS.includes(x.field) && Number.isInteger(x.start) && Number.isInteger(x.end) && x.start >= 0 && x.end > x.start && typeof x.kind === 'string' && !Object.hasOwn(x, 'text'))) fail(`invalid_answer_spans:${r.case_id}`);
    if (!r.view_eligibility || !VIEWS.every((x) => typeof r.view_eligibility[x] === 'boolean')) fail(`invalid_view_eligibility:${r.case_id}`);
    if (!['candidate', 'ready'].includes(r.state) || !['new_unscored', 'historical_outcomes_already_exposed'].includes(r.exposure)) fail(`invalid_case_state:${r.case_id}`);
    if (['full', 'description_hidden', 'location_hidden'].some((view) => r.view_eligibility[view]) && !array(r.evidence.frame_paths).length) fail(`missing_visual_evidence_for_view:${r.case_id}`);
    if ((r.view_eligibility.description_hidden || r.view_eligibility.visual_only) && (r.visual_answer_overlay !== false || r.mask_review?.answer_fields_checked !== true || !r.mask_review?.reviewer || !r.mask_review?.reviewed_at)) fail(`masked_view_review_missing:${r.case_id}`);
    if (r.view_eligibility.visual_only && !array(r.evidence.frame_paths).length) fail(`invalid_visual_only_eligibility:${r.case_id}`);
    if (r.view_eligibility.text_only && !TEXT_FIELDS.some((x) => Boolean(r.evidence[x]?.length || (typeof r.evidence[x] === 'object' && Object.keys(r.evidence[x]).length)))) fail(`invalid_text_only_eligibility:${r.case_id}`);
  }
  return { cases: ids.size, sourceGroups: new Set(records.map((r) => r.source_group_id)).size };
}

export function validateLabels(manifest, labels) {
  const byCase = new Map(manifest.map((r) => [r.case_id, r])), ids = new Set();
  for (const l of labels) {
    if (!byCase.has(l.case_id) || ids.has(l.case_id)) fail(`orphan_or_duplicate_label:${l.case_id}`);
    ids.add(l.case_id);
    if (!LABELS.includes(l.label_class)) fail(`invalid_label_class:${l.case_id}`);
    if (!Array.isArray(l.expected_places) || !Array.isArray(l.provenance) || !Array.isArray(l.place_group_ids)) fail(`invalid_label_arrays:${l.case_id}`);
    if (l.proposed_places != null && !Array.isArray(l.proposed_places)) fail(`invalid_proposed_places:${l.case_id}`);
    if (!l.expected_places.every((p) => ['depicted', 'mentioned_only'].includes(p.role))) fail(`invalid_place_role:${l.case_id}`);
    if (!l.provenance.every((p) => p && typeof p.kind === 'string' && typeof p.reference === 'string')) fail(`invalid_provenance:${l.case_id}`);
    if (!l.place_group_ids.every((x) => PLACE_GROUP_ID.test(x))) fail(`invalid_place_group:${l.case_id}`);
    if (['VERIFIED_EXACT_SINGLE', 'VERIFIED_MULTI'].includes(l.label_class)) {
      const wanted = l.label_class === 'VERIFIED_MULTI' ? 2 : 1;
      const depicted = l.expected_places.filter((p) => p.role !== 'mentioned_only');
      if (depicted.length < wanted || (l.label_class === 'VERIFIED_EXACT_SINGLE' && depicted.length !== 1)) fail(`incomplete_exact_label:${l.case_id}`);
      if (!l.provenance.some((p) => !/model|prediction/i.test(p.kind)) || l.complete_set_established !== true) fail(`unproven_exact_label:${l.case_id}`);
      for (const p of depicted) if (!p.name || !Array.isArray(p.aliases)) fail(`invalid_expected_place:${l.case_id}`);
      if (byCase.get(l.case_id).state === 'ready' && (depicted.some((p) => !PLACE_GROUP_ID.test(p.place_group_id ?? '') || !l.place_group_ids.includes(p.place_group_id)) || new Set(depicted.map((p) => p.place_group_id)).size !== depicted.length)) fail(`incomplete_place_group_mapping:${l.case_id}`);
    }
    if (['KNOWN_NEGATIVE', 'AMBIGUOUS', 'UNVERIFIED'].includes(l.label_class) && l.expected_places.some((p) => p.role !== 'mentioned_only')) fail(`unsupported_exact_truth:${l.case_id}`);
    if (l.label_class === 'VERIFIED_REGION_ONLY' && (!l.geography || !(l.geography.country || l.geography.region))) fail(`missing_region_truth:${l.case_id}`);
  }
  return { labeled: ids.size, unlabeled: manifest.length - ids.size };
}

export function holdoutEligibility(record, label) {
  const reasons = [];
  if (record.state !== 'ready') reasons.push('not_ready');
  if (record.view_eligibility?.full !== true || !array(record.evidence?.frame_paths).length) reasons.push('full_visual_evidence_missing');
  if (record.visual_answer_overlay !== false || record.mask_review?.answer_fields_checked !== true || record.mask_review?.permitted_media_derivative !== true || !record.mask_review?.reviewer || !record.mask_review?.reviewed_at) reasons.push('visual_mask_review_missing');
  if (array(record.evidence?.frame_sha256).length !== array(record.evidence?.frame_paths).length || !array(record.evidence?.frame_sha256).every((x) => /^[a-f0-9]{64}$/.test(x))) reasons.push('frame_hashes_missing');
  if (record.exposure !== 'new_unscored') reasons.push('historical_outcome_exposed');
  if (!record.retrieval_date) reasons.push('source_not_retrieved');
  if (!label || ['UNVERIFIED', 'AMBIGUOUS'].includes(label.label_class)) reasons.push('truth_not_adjudicated');
  if (!label?.review || !['accept', 'region_only', 'negative'].includes(label.review.decision) || !label.review.reviewer || !label.review.reviewed_at || label.review.independent !== true) reasons.push('independent_manual_review_missing');
  const expectedDecision = { VERIFIED_EXACT_SINGLE: 'accept', VERIFIED_MULTI: 'accept', VERIFIED_REGION_ONLY: 'region_only', KNOWN_NEGATIVE: 'negative' }[label?.label_class];
  if (expectedDecision && label?.review?.decision !== expectedDecision) reasons.push('review_label_mismatch');
  if (label?.collected_by && label.collected_by === label?.review?.reviewer) reasons.push('reviewer_not_independent');
  if (['VERIFIED_EXACT_SINGLE', 'VERIFIED_MULTI'].includes(label?.label_class)) {
    const independentProof = array(label.provenance).some((p) => p.independent === true && p.reference);
    if (!independentProof) reasons.push('independent_provenance_missing');
    if (label.label_class === 'VERIFIED_MULTI' && label.complete_set_established !== true) reasons.push('incomplete_multi_set');
    const depicted = array(label.expected_places).filter((p) => p.role === 'depicted');
    if (depicted.some((p) => !PLACE_GROUP_ID.test(p.place_group_id ?? '') || !array(label.place_group_ids).includes(p.place_group_id))) reasons.push('place_group_mapping_missing');
  }
  return { eligible: reasons.length === 0, reasons };
}

// Source and place identities form connected components; no connected component
// may cross splits. A historical outcome forces the whole component to development.
export function proposeSplits(manifest, labels, seed = 'recognition-gold-v1') {
  validateManifest(manifest); validateLabels(manifest, labels);
  const byId = new Map(manifest.map((r, i) => [r.case_id, i]));
  const labelById = new Map(labels.map((l) => [l.case_id, l]));
  const parent = manifest.map((_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function join(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
  const owner = new Map();
  for (const r of manifest) {
    const i = byId.get(r.case_id), label = labelById.get(r.case_id);
    for (const key of [`source:${r.source_group_id}`, ...array(label?.place_group_ids).map((id) => `place:${id}`)]) {
      if (owner.has(key)) join(i, owner.get(key)); else owner.set(key, i);
    }
  }
  const components = new Map();
  for (let i = 0; i < manifest.length; i++) {
    const id = find(i);
    if (!components.has(id)) components.set(id, []);
    components.get(id).push(manifest[i]);
  }
  const assignments = {};
  for (const records of components.values()) {
    const possible = records.every((r) => holdoutEligibility(r, labelById.get(r.case_id)).eligible);
    const forcedDevelopment = records.some((r) => r.exposure === 'historical_outcomes_already_exposed');
    const unit = [...records.map((r) => r.case_id)].sort().join('|');
    const bucket = parseInt(sha256(`${seed}\0${unit}`).slice(0, 8), 16) / 2 ** 32;
    const split = forcedDevelopment || !possible ? 'development' : bucket < 0.65 ? 'development' : bucket < 0.82 ? 'calibration' : 'held_out';
    for (const r of records) assignments[r.case_id] = split;
  }
  return { schema_version: 1, seed, assignments };
}

export function validateSplits(manifest, labels, splitFile) {
  const labelById = new Map(labels.map((l) => [l.case_id, l]));
  const bySource = new Map(), byPlace = new Map();
  if (Object.keys(splitFile.assignments ?? {}).length !== manifest.length) fail('split_case_count_mismatch');
  for (const r of manifest) {
    const split = splitFile.assignments[r.case_id];
    if (!SPLITS.includes(split)) fail(`missing_or_invalid_split:${r.case_id}`);
    if (bySource.has(r.source_group_id) && bySource.get(r.source_group_id) !== split) fail(`source_group_leakage:${r.source_group_id}`);
    bySource.set(r.source_group_id, split);
    for (const pg of array(labelById.get(r.case_id)?.place_group_ids)) {
      if (byPlace.has(pg) && byPlace.get(pg) !== split) fail(`place_group_leakage:${pg}`);
      byPlace.set(pg, split);
    }
    if (split === 'held_out' && !holdoutEligibility(r, labelById.get(r.case_id)).eligible) fail(`ineligible_holdout:${r.case_id}`);
  }
  for (const id of Object.keys(splitFile.assignments)) if (!manifest.some((r) => r.case_id === id)) fail(`orphan_split:${id}`);
  return Object.fromEntries(SPLITS.map((s) => [s, manifest.filter((r) => splitFile.assignments[r.case_id] === s).length]));
}

function bearing(record, field) { return record.answer_spans.some((x) => x.field === field); }
function safeField(record, field) {
  const value = record.evidence[field];
  if (field === 'source_geography' && value != null) {
    const safe = {};
    for (const key of ['country', 'region', 'city']) if (value[key] != null) {
      if (typeof value[key] !== 'string') fail('invalid_source_geography');
      safe[key] = value[key];
    }
    return safe;
  }
  return value == null ? null : structuredClone(value);
}
export function inferencePayload(record, label, view) {
  if (!VIEWS.includes(view) || record.view_eligibility?.[view] !== true) fail(`ineligible_view:${view}`);
  if (['description_hidden', 'visual_only'].includes(view) && (record.visual_answer_overlay !== false || record.mask_review?.answer_fields_checked !== true || !record.mask_review?.reviewer || !record.mask_review?.reviewed_at)) fail('masked_view_review_missing');
  const visual = view !== 'text_only';
  const frames = visual ? array(record.evidence.frame_paths) : [];
  if (view === 'visual_only' && (!frames.length || record.visual_answer_overlay === true)) fail('visual_only_not_clean');
  const evidence = Object.fromEntries(TEXT_FIELDS.map((key) => [key, null]));
  if (view !== 'visual_only') {
    for (const key of TEXT_FIELDS) evidence[key] = safeField(record, key);
    if (view === 'description_hidden') {
      evidence.caption = null; evidence.description = null; evidence.hashtags = null;
      const answerNames = [...array(label?.expected_places), ...array(label?.proposed_places)].flatMap((p) => [p.name, ...array(p.aliases)]).map(compact).filter((x) => x.length >= 4);
      for (const key of ['tagged_accounts', 'location_tag', 'source_geography', 'transcript']) {
        const normalized = compact(JSON.stringify(evidence[key]));
        if (bearing(record, key) || answerNames.some((name) => normalized.includes(name))) evidence[key] = null;
      }
    }
    if (view === 'location_hidden') { evidence.location_tag = null; evidence.source_geography = null; }
  }
  const payload = {
    schema_version: 1,
    input_id: `i_${sha256(`${record.case_id}\0${view}`).slice(0, 24)}`,
    view,
    evidence,
    media: { frames: frames.map((_, i) => `frames/${String(i).padStart(3, '0')}.jpg`) },
    cache_policy: 'disabled',
  };
  // The label object is deliberately never spread or serialized into the payload.
  // Checking known answer tokens in the strongest mask catches accidental text flow.
  if (view === 'visual_only') {
    const value = JSON.stringify(payload.evidence);
    const tokens = [...array(label?.expected_places), ...array(label?.proposed_places)].flatMap((p) => [p.name, ...array(p.aliases)]).map(norm).filter((x) => x.length >= 4);
    if (tokens.some((x) => norm(value).includes(x))) fail('visual_answer_leak');
  }
  return payload;
}

const distanceMeters = (a, b) => {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
};
export function placeMatches(pred, truth) {
  if (truth.place_id && pred.place_id && truth.place_id === pred.place_id) return true;
  if (truth.place_id && pred.place_id && truth.place_id.split(':')[0] === pred.place_id.split(':')[0]) return false;
  const aliases = [truth.name, ...array(truth.aliases)].map(norm).filter(Boolean);
  if (!aliases.includes(norm(pred.name))) return false;
  for (const key of ['country', 'region', 'city']) if (truth[key] && (!pred[key] || norm(truth[key]) !== norm(pred[key]))) return false;
  if (truth.coordinates && pred.coordinates) return distanceMeters(truth.coordinates, pred.coordinates) <= (truth.accepted_radius_meters ?? 100);
  if (truth.branch_disambiguation === true && !truth.coordinates && !truth.address && !array(truth.accepted_addresses).length) return false;
  if (truth.address || array(truth.accepted_addresses).length) return Boolean(pred.address && [truth.address, ...array(truth.accepted_addresses)].map(norm).includes(norm(pred.address)));
  // Exact names without geographic anchors are insufficient for physical identity.
  return Boolean(truth.country && (truth.region || truth.city));
}
function matchCount(predicted, expected) {
  const owners = Array(expected.length).fill(-1);
  function augment(i, seen) {
    for (let j = 0; j < expected.length; j++) if (!seen.has(j) && placeMatches(predicted[i], expected[j])) {
      seen.add(j);
      if (owners[j] < 0 || augment(owners[j], seen)) { owners[j] = i; return true; }
    }
    return false;
  }
  return predicted.reduce((n, _, i) => n + Number(augment(i, new Set())), 0);
}
const ratio = (n, d) => ({ numerator: n, denominator: d, rate: d ? n / d : null });
export function scoreOne(record, label, observation, split, view) {
  if (observation?.input_id !== `i_${sha256(`${record.case_id}\0${view}`).slice(0, 24)}` || observation.view !== view) fail(`observation_identity_mismatch:${record.case_id}`);
  if (!['completed', 'review', 'failed'].includes(observation.status)) fail(`invalid_observation_status:${record.case_id}`);
  if (observation.autonomous === true && observation.status !== 'completed') fail(`invalid_autonomous_status:${record.case_id}`);
  if (!Array.isArray(observation.places) || !Array.isArray(observation.candidates) || typeof observation.autonomous !== 'boolean') fail(`invalid_observation_shape:${record.case_id}`);
  if (observation.wrong_confident_cache != null && typeof observation.wrong_confident_cache !== 'boolean') fail(`invalid_cache_signal:${record.case_id}`);
  if (observation.cost_usd != null && (!Number.isFinite(observation.cost_usd) || observation.cost_usd < 0)) fail(`invalid_observation_cost:${record.case_id}`);
  if (observation.elapsed_ms != null && (!Number.isFinite(observation.elapsed_ms) || observation.elapsed_ms < 0)) fail(`invalid_observation_elapsed:${record.case_id}`);
  if (label.label_class === 'VERIFIED_MULTI' && typeof observation.multi_place_detected !== 'boolean') fail(`missing_multi_detection:${record.case_id}`);
  const places = array(observation.places), candidates = array(observation.candidates);
  const expected = array(label.expected_places).filter((p) => p.role !== 'mentioned_only');
  const exactEligible = ['VERIFIED_EXACT_SINGLE', 'VERIFIED_MULTI'].includes(label.label_class);
  const tp = exactEligible ? matchCount(places, expected) : null;
  const exactSet = exactEligible ? tp === expected.length && places.length === expected.length : null;
  const autonomous = observation.autonomous === true;
  const autonomousPlaceOutput = autonomous && places.length > 0;
  const correctAutonomous = exactEligible ? autonomous && exactSet : null;
  const wrongConfident = observation.wrong_confident_cache === true || (autonomousPlaceOutput && (exactEligible ? !exactSet : ['KNOWN_NEGATIVE', 'VERIFIED_REGION_ONLY'].includes(label.label_class)));
  const geographic = label.geography ?? (expected.length === 1 ? expected[0] : {});
  const statedGeo = [observation.geography, ...places].filter(Boolean);
  const wrongCountry = Boolean(autonomous && geographic.country && statedGeo.some((p) => p.country && norm(p.country) !== norm(geographic.country)));
  const wrongRegion = Boolean(autonomous && geographic.region && statedGeo.some((p) => p.region && norm(p.region) !== norm(geographic.region)));
  const multiDetected = label.label_class === 'VERIFIED_MULTI' && typeof observation.multi_place_detected === 'boolean' ? observation.multi_place_detected : null;
  return {
    case_id: record.case_id, source_group_id: record.source_group_id, split, view, label_class: label.label_class,
    status: observation.status, autonomous, autonomous_place_output: autonomousPlaceOutput, wrong_confident: wrongConfident, exact_eligible: exactEligible, reasonable_autonomous_expected: label.reasonable_autonomous_expected !== false,
    correct_autonomous: correctAutonomous, exact_set: exactSet,
    exact_top1: label.label_class === 'VERIFIED_EXACT_SINGLE' ? Boolean(candidates[0] && placeMatches(candidates[0], expected[0])) : null,
    candidate_recall_at_1: exactEligible ? matchCount(candidates.slice(0, 1), expected) / expected.length : null,
    candidate_recall_at_3: exactEligible ? matchCount(candidates.slice(0, 3), expected) / expected.length : null,
    candidate_recall_at_5: exactEligible ? matchCount(candidates.slice(0, 5), expected) / expected.length : null,
    true_positives: tp, predicted_places: places.length, expected_places: expected.length,
    multi_detected: multiDetected, extras: exactEligible ? places.length - tp : null, misses: exactEligible ? expected.length - tp : null,
    negative_correct_abstention: label.label_class === 'KNOWN_NEGATIVE' ? observation.status !== 'failed' && !wrongConfident && places.length === 0 : null,
    negative_unsupported_exact: label.label_class === 'KNOWN_NEGATIVE' ? autonomousPlaceOutput : null,
    region_correct: label.label_class === 'VERIFIED_REGION_ONLY' ? observation.status !== 'failed' && !wrongCountry && !wrongRegion && Boolean(observation.geography?.country || observation.geography?.region) && (!geographic.country || norm(observation.geography?.country) === norm(geographic.country)) && (!geographic.region || norm(observation.geography?.region) === norm(geographic.region)) : null,
    region_unsupported_exact: label.label_class === 'VERIFIED_REGION_ONLY' ? autonomousPlaceOutput : null,
    wrong_country: wrongCountry, wrong_region: wrongRegion,
    elapsed_ms: Number.isFinite(observation.elapsed_ms) ? observation.elapsed_ms : null,
    time_to_correct_usable_ms: observation.status !== 'failed' && exactSet && Number.isFinite(observation.first_usable_result_ms) ? observation.first_usable_result_ms : null,
    cost_usd: measuredCost(observation, record.case_id),
  };
}
function measuredCost(observation, caseId) {
  if (observation.provider_ledger_complete !== true) return null;
  const usage = observation.provider_usage;
  if (!Array.isArray(usage)) fail(`invalid_provider_ledger:${caseId}`);
  if (observation.cost_basis === 'no_paid_calls') {
    if (usage.length || observation.cost_usd !== 0) fail(`invalid_zero_cost_assertion:${caseId}`);
    return 0;
  }
  if (observation.cost_basis !== 'measured_provider_ledger' || !usage.length || usage.some((u) => !u || !u.provider || !['measured', 'retained'].includes(u.measurement) || !Number.isInteger(u.calls) || u.calls < 0 || !Number.isFinite(u.cost_usd) || u.cost_usd < 0)) fail(`invalid_provider_ledger:${caseId}`);
  const sum = usage.reduce((n, u) => n + u.cost_usd, 0);
  if (observation.cost_usd != null && (!Number.isFinite(observation.cost_usd) || Math.abs(observation.cost_usd - sum) > 1e-8)) fail(`provider_cost_mismatch:${caseId}`);
  return sum;
}
export function summarizeScores(rows) {
  const expected = rows.filter((r) => r.exact_eligible && r.reasonable_autonomous_expected);
  const correct = expected.filter((r) => r.correct_autonomous === true);
  const adjudicable = rows.filter((r) => !['AMBIGUOUS', 'UNVERIFIED'].includes(r.label_class));
  const automatic = adjudicable.filter((r) => r.autonomous_place_output);
  const multi = rows.filter((r) => r.label_class === 'VERIFIED_MULTI');
  const multiAutomatic = multi.filter((r) => r.status === 'completed' && r.autonomous_place_output);
  const multiReview = multi.filter((r) => r.status === 'review' && r.predicted_places > 0);
  const singles = rows.filter((r) => r.label_class === 'VERIFIED_EXACT_SINGLE');
  const negative = rows.filter((r) => r.label_class === 'KNOWN_NEGATIVE');
  const region = rows.filter((r) => r.label_class === 'VERIFIED_REGION_ONLY');
  const sum = (rs, key) => rs.reduce((n, r) => n + (r[key] ?? 0), 0);
  const mp = sum(multiAutomatic, 'true_positives'), pp = sum(multiAutomatic, 'predicted_places'), ep = sum(multi, 'expected_places');
  const allCostKnown = rows.length > 0 && rows.every((r) => r.cost_usd !== null);
  const totalCost = allCostKnown ? sum(rows, 'cost_usd') : null;
  const correctUsable = rows.filter((r) => r.exact_set && r.status !== 'failed');
  const quantile = (values, q) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * q;
    return sorted[Math.floor(position)] + (sorted[Math.ceil(position)] - sorted[Math.floor(position)]) * (position - Math.floor(position));
  };
  const distribution = (values) => {
    const measured = values.filter(Number.isFinite);
    return { n: measured.length, p50: quantile(measured, .5), p75: quantile(measured, .75), p90: quantile(measured, .9), p95: quantile(measured, .95) };
  };
  return {
    cases: rows.length,
    correct_autonomous_resolution: ratio(correct.length, expected.length),
    autonomous_precision: ratio(automatic.filter((r) => r.correct_autonomous === true).length, automatic.length),
    autonomous_unadjudicable_outputs: rows.filter((r) => r.autonomous && ['AMBIGUOUS', 'UNVERIFIED'].includes(r.label_class)).length,
    wrong_confident: ratio(adjudicable.filter((r) => r.wrong_confident).length, adjudicable.length),
    single: { cases: singles.length, exact_top1: ratio(singles.filter((r) => r.exact_top1).length, singles.length), candidate_recall_at_1: ratio(singles.filter((r) => r.candidate_recall_at_1 === 1).length, singles.length), correct_autonomous: ratio(singles.filter((r) => r.correct_autonomous).length, singles.filter((r) => r.reasonable_autonomous_expected).length) },
    multi: { cases: multi.length, detection: ratio(multi.filter((r) => r.multi_detected).length, multi.length), place_precision: ratio(mp, pp), place_recall: ratio(mp, ep), f1: pp + ep ? 2 * mp / (pp + ep) : null, exact_set: ratio(multiAutomatic.filter((r) => r.exact_set).length, multi.length), extra_places: sum(multiAutomatic, 'extras'), missed_places: ep - mp, review_proposal_exact_set: ratio(multiReview.filter((r) => r.exact_set).length, multiReview.length) },
    negative: { cases: negative.length, correct_abstention: ratio(negative.filter((r) => r.negative_correct_abstention).length, negative.length), unsupported_exact: ratio(negative.filter((r) => r.negative_unsupported_exact).length, negative.length) },
    region: { cases: region.length, correct_geography: ratio(region.filter((r) => r.region_correct).length, region.length), unsupported_exact: ratio(region.filter((r) => r.region_unsupported_exact).length, region.length) },
    wrong_country: ratio(rows.filter((r) => r.wrong_country).length, adjudicable.length),
    wrong_region: ratio(rows.filter((r) => r.wrong_region).length, adjudicable.length),
    latency: { submitted: distribution(rows.map((r) => r.elapsed_ms)), correct_usable: distribution(rows.map((r) => r.time_to_correct_usable_ms)), correct_autonomous: distribution(correct.map((r) => r.elapsed_ms)) },
    cost: { total_usd: totalCost, per_submission: totalCost === null ? null : totalCost / rows.length, per_correct_result: totalCost === null || !correctUsable.length ? null : totalCost / correctUsable.length, per_correct_autonomous: totalCost === null || !correct.length ? null : totalCost / correct.length },
  };
}

export function renderReview(record, label) {
  const escape = (x) => str(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const e = record.evidence;
  return `<!doctype html><meta charset="utf-8"><title>Gold label review</title><style>body{font:16px/1.5 system-ui;max-width:940px;margin:2rem auto;padding:0 1rem}pre{white-space:pre-wrap;background:#eee;padding:1rem}label{display:block;margin:.4rem 0}</style><h1>Label review</h1><p>Case ${escape(record.case_id)} · ${escape(record.platform)} · ${escape(record.state)}</p><p><a href="${escape(record.source_url_reference)}" rel="noopener noreferrer">Public source</a></p><h2>Source evidence</h2><pre>${escape(JSON.stringify({ caption:e.caption, description:e.description, hashtags:e.hashtags, tagged_accounts:e.tagged_accounts, location_tag:e.location_tag, transcript:e.transcript }, null, 2))}</pre><h2>Proposed truth</h2><pre>${escape(JSON.stringify({ label_class:label?.label_class ?? 'UNVERIFIED', expected_places:label?.expected_places ?? [], proposed_places:label?.proposed_places ?? [], provenance:label?.provenance ?? [], confidence:label?.confidence ?? null, categories:record.categories, split_eligibility:holdoutEligibility(record,label) }, null, 2))}</pre><h2>Review decision</h2><p>Record the decision in the private label file; this read-only page never mutates labels.</p>${['accept','reject','needs_more_research','region_only','ambiguous','negative'].map((x) => `<label><input type="radio" name="decision">${escape(x)}</label>`).join('')}`;
}
