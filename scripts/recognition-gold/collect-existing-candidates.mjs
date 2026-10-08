import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// An inventory of historically exposed sources, not a new gold label import.
// No network or model call is made here. The private draft is deliberately
// written under ignored .tmp rather than into inference inputs or Git.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'artifacts/recognition-gold-existing');
const privateOut = path.join(root, '.tmp/recognition-gold-existing');
const asOf = '2026-10-08';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const sourceFiles = new Map();
function read(relative) {
  const full = path.join(root, relative);
  const bytes = fs.readFileSync(full);
  sourceFiles.set(relative.replaceAll('\\', '/'), { sha256: sha(bytes), bytes: bytes.length });
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
function present(relative) { return fs.existsSync(path.join(root, relative)); }
function cleanUrl(platform, id, original) {
  if (platform === 'instagram') {
    const kind = original ? new URL(original).pathname.match(/^\/(p|reel|reels)\//)?.[1] : null;
    return kind ? `https://www.instagram.com/${kind}/${id}/` : null;
  }
  if (platform === 'youtube') return `https://www.youtube.com/watch?v=${id}`;
  if (platform === 'tiktok') {
    const creator = new URL(original).pathname.match(/^\/(@[^/]+)\/video\//)?.[1];
    return creator ? `https://www.tiktok.com/${creator}/video/${id}` : null;
  }
  if (platform === 'facebook' && /^\d+$/.test(id)) {
    if (original && new URL(original).pathname.match(/^\/reel\//)) return `https://www.facebook.com/reel/${id}/`;
    return `https://www.facebook.com/watch/?v=${id}`;
  }
  if (platform === 'snapchat') return original ? new URL(original).origin + new URL(original).pathname : null;
  return original ? new URL(original).origin + new URL(original).pathname : null;
}
function identity(url, given) {
  if (given && /^v\d+:instagram:([A-Za-z0-9_-]+)$/.test(given)) {
    const id = given.match(/^v\d+:instagram:([A-Za-z0-9_-]+)$/)[1];
    return { platform: 'instagram', id, key: `instagram:${id}`, url: url ? cleanUrl('instagram', id, url) : null };
  }
  if (given && /^instagram:([A-Za-z0-9_-]+)$/.test(given)) {
    const id = given.split(':')[1];
    return { platform: 'instagram', id, key: `instagram:${id}`, url: url ? cleanUrl('instagram', id, url) : null };
  }
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let platform, id;
  if (host === 'instagram.com') { platform = 'instagram'; id = u.pathname.match(/^\/(?:p|reel|reels)\/([^/]+)/)?.[1]; }
  else if (host === 'youtube.com' || host === 'm.youtube.com') { platform = 'youtube'; id = u.pathname.match(/^\/shorts\/([^/]+)/)?.[1] ?? (u.pathname === '/watch' ? u.searchParams.get('v') : null); }
  else if (host === 'youtu.be') { platform = 'youtube'; id = u.pathname.split('/')[1]; }
  else if (host === 'tiktok.com') { platform = 'tiktok'; id = u.pathname.match(/\/video\/(\d+)/)?.[1]; }
  else if (host === 'facebook.com' || host === 'm.facebook.com') { platform = 'facebook'; id = u.searchParams.get('v') ?? u.pathname.match(/\/(?:reel|videos)\/(?:[^/]+\/)?(\d+)/)?.[1]; }
  else if (host === 'snapchat.com') { platform = 'other'; id = u.pathname.match(/\/spotlight\/([^/]+)/)?.[1]; }
  if (!platform || !id) return null;
  return { platform, id, key: `${platform}:${id}`, url: cleanUrl(platform, id, url) };
}
const cases = new Map();
const ignored = [];
// Inherited evaluation labels and difficulty tags are not source categories.
const sourceContentCategories = new Set([
  'activity', 'attraction', 'business', 'cliff', 'event', 'food',
  'landmark', 'market', 'natural', 'nature', 'other', 'restaurant',
]);
function add({ url, givenIdentity, reference, legacyCaseId, category = [], evidence = {}, priorLabel = null, sourceRecordDate = null, note = null }) {
  const src = identity(url, givenIdentity);
  if (!src) { ignored.push({ reason: 'not_a_supported_public_social_post' }); return; }
  let c = cases.get(src.key);
  if (!c) {
    const suffix = sha(src.key).slice(0, 16);
    c = {
      case_id: `g_${suffix}`, source_group_id: `sg_${suffix}`,
      platform: src.platform, source_public_id: src.id,
      ...(src.platform === 'other' ? { source_platform_detail: 'snapchat' } : {}),
      source_url_reference: src.url, retrieval_date: null,
      public_access_status: 'public_access_unconfirmed',
      inventoried_at: asOf, source_record_date: sourceRecordDate,
      categories: [], geography: null,
      evidence: { caption: null, description: null, hashtags: [], tagged_accounts: [], location_tag: null, transcript: null, frame_paths: [] },
      answer_spans: [],
      view_eligibility: { full: false, description_hidden: false, location_hidden: false, visual_only: false, text_only: false },
      state: 'candidate', exposure: 'historical_outcomes_already_exposed',
      audit: { evidence_refs: [], legacy_case_ids: [], notes: [], prior_label: null },
    };
    cases.set(src.key, c);
  }
  if (!c.source_url_reference && src.url) c.source_url_reference = src.url;
  c.categories = [...new Set([...c.categories, ...category.filter((x) => sourceContentCategories.has(x))])];
  if (reference && !c.audit.evidence_refs.includes(reference)) c.audit.evidence_refs.push(reference);
  if (legacyCaseId && !c.audit.legacy_case_ids.includes(legacyCaseId)) c.audit.legacy_case_ids.push(legacyCaseId);
  if (note && !c.audit.notes.includes(note)) c.audit.notes.push(note);
  if (sourceRecordDate && (!c.source_record_date || sourceRecordDate < c.source_record_date)) c.source_record_date = sourceRecordDate;
  for (const field of ['caption', 'description', 'location_tag', 'transcript']) {
    if (!c.evidence[field] && evidence[field]) c.evidence[field] = evidence[field];
  }
  for (const field of ['hashtags', 'tagged_accounts']) {
    c.evidence[field] = [...new Set([...c.evidence[field], ...(evidence[field] ?? [])])];
  }
  if (priorLabel && !c.audit.prior_label) c.audit.prior_label = priorLabel;
}

const existingInputs = read('artifacts/recognition-optimization-2026-10-08/dataset-v2/inputs.json').cases;
const existingLabels = new Map(read('artifacts/recognition-optimization-2026-10-08/dataset-v2/labels.json').cases.map((x) => [x.caseId, x]));
for (const row of existingInputs) {
  if (row.kind !== 'real') { ignored.push({ reference: 'dataset-v2/inputs.json', legacyCaseId: row.caseId, reason: 'constructed_control' }); continue; }
  const label = existingLabels.get(row.caseId);
  add({
    url: row.sourceUrl, reference: `artifacts/recognition-optimization-2026-10-08/dataset-v2/inputs.json#${row.caseId}`,
    legacyCaseId: row.caseId, category: row.categories ?? [],
    priorLabel: label ? { class: label.label, source: `artifacts/recognition-optimization-2026-10-08/dataset-v2/labels.json#${row.caseId}`, expected_places: label.expectedPlaces ?? [], provenance: label.provenance ?? [], notes: label.notes ?? null } : null,
    note: 'Prior benchmark outcome exposed; label requires independent revalidation before gold promotion.',
  });
}

const goldRows = read('artifacts/share-gold-labeling-labeled.json');
for (let i = 0; i < goldRows.length; i++) {
  const row = goldRows[i];
  add({ url: row.url, reference: `artifacts/share-gold-labeling-labeled.json#${i}`, category: ['founder_metadata'],
    evidence: { caption: row.title ?? null, description: row.description ?? null,
      tagged_accounts: (row.detected_handles ?? '').split(',').map((x) => x.trim()).filter(Boolean) },
    note: 'Retained extraction snapshot; title may wrap the caption. Masking must be reviewed manually.',
  });
}

const media = read('scripts/mediaRegressionCorpus.json');
for (const row of media.entries) {
  add({ url: row.url, reference: `scripts/mediaRegressionCorpus.json#${row.id}`, legacyCaseId: row.id,
    category: [row.expected?.contentCategory, row.groundTruth?.hasIdentifiablePlace === false ? 'negative_candidate' : null].filter(Boolean),
    sourceRecordDate: row.addedDate ?? null,
    note: 'Ground-truth prose in source corpus is provenance for review, not inference evidence.',
  });
}

const phase2 = read('scripts/phase2-gold-set.json');
for (const row of phase2) add({ url: row.url, reference: `scripts/phase2-gold-set.json#${row.id}`, legacyCaseId: row.id, category: [row.kind] });

const tutorials = read('scripts/tutorialFixtureManifest.json');
for (const row of tutorials.fixtures) add({ url: row.sourceUrl, reference: `scripts/tutorialFixtureManifest.json#${row.sourceCorpusId}`, legacyCaseId: row.sourceCorpusId,
  category: ['tutorial_candidate'], note: 'Tutorial expected place is an inherited assertion; source health and exact label need review.' });

for (const f of ['FOUNDER_12_VIDEO_BURST_AUTO_DEEP_REGRESSION_2026-09-05.json', 'RECENT_FOUNDER_4_VIDEO_REGRESSION_2026-09-05.json']) {
  const rows = read(`artifacts/recognition/${f}`).cases;
  for (const row of rows) add({ givenIdentity: row.canonical_source_identity, reference: `artifacts/recognition/${f}#${row.case_id}`,
    legacyCaseId: row.case_id, category: ['founder_burst'], note: 'Routing/model result is not a ground-truth label.' });
}

// This run preserved the actual public source URL for all 16 founder cases.
// Its predictions/decisions are intentionally ignored.
const founderRun = 'artifacts/automatic-deep-recognition/runs/automatic-deep-auto_deep_candidate-2026-09-06T00-32-59-381Z/results.json';
for (const row of read(founderRun).observations) {
  if (!['FOUNDER_12', 'FOUNDER_4'].includes(row.suite)) continue;
  add({ url: row.sourceUrl, reference: `${founderRun}#${row.caseId}`, legacyCaseId: row.caseId,
    category: ['founder_burst'], sourceRecordDate: '2026-09-06', note: 'Used only to recover the source URL; model result is not a label.' });
}

// Extract only literal social URLs from typed regression fixtures. Their
// candidate expectations are useful review leads, not independent truth.
const fixturePath = 'scripts/shareRegressionFixtures.ts';
const fixtureBytes = fs.readFileSync(path.join(root, fixturePath));
sourceFiles.set(fixturePath, { sha256: sha(fixtureBytes), bytes: fixtureBytes.length });
for (const url of fixtureBytes.toString('utf8').match(/https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/(?:\?[^'\s]*)?/g) ?? []) {
  add({ url, reference: fixturePath, category: ['regression_fixture'], note: 'Fixture expectation is not independent ground truth.' });
}

// Corrections are local, privacy-restricted review leads. No user identifier,
// raw URL tracking parameter, job ID, or event ID is committed. A WRONG_PLACE
// action disproves one particular save for that user's intent; it does not
// independently identify the correct place or establish a complete video set.
const correctionPath = path.join(root, '.tmp/gold-db/production-correction-events.json');
const correctionRows = fs.existsSync(correctionPath) ? JSON.parse(fs.readFileSync(correctionPath, 'utf8').replace(/^\uFEFF/, '')).rows : [];
const developmentCorrectionPath = path.join(root, '.tmp/gold-db/development-correction-events.json');
const developmentCorrectionRows = fs.existsSync(developmentCorrectionPath) ? JSON.parse(fs.readFileSync(developmentCorrectionPath, 'utf8').replace(/^\uFEFF/, '')).rows : [];

const userActionPath = path.join(root, '.tmp/gold-db/production-user-result-actions.json');
const userActionRows = fs.existsSync(userActionPath) ? JSON.parse(fs.readFileSync(userActionPath, 'utf8').replace(/^\uFEFF/, '')).rows : [];

const sorted = [...cases.values()].sort((a, b) => a.case_id.localeCompare(b.case_id));
for (const c of sorted) {
  c.categories.sort(); c.audit.evidence_refs.sort(); c.audit.legacy_case_ids.sort();
  c.view_eligibility.text_only = Boolean(c.evidence.caption || c.evidence.description || c.evidence.transcript);
}
const privateLabels = sorted.map((c) => ({
  case_id: c.case_id, label_class: 'UNVERIFIED', expected_places: [], complete_set_established: false,
  provenance: [], confidence: 'unverified',
  review: { decision: 'needs_more_research', reviewer: null, reviewed_at: null, independent: false }, place_group_ids: [],
  audit: { prior_label: c.audit.prior_label, legacy_case_ids: c.audit.legacy_case_ids, evidence_refs: c.audit.evidence_refs,
    correction_events: correctionRows.filter((r) => identity(r.source_url, r.identity_key)?.key === `${c.platform}:${c.source_public_id}`).map((r) => ({
      event_type: r.event_type, action: r.action, event_at: r.event_at, feedback_revision: r.feedback_revision,
      previous_google_place_id: r.previous_google_place_id, previous_place_name: r.previous_place_name,
      replacement_google_place_id: r.replacement_google_place_id, replacement_place_name: r.replacement_place_name,
    })),
    user_actions: userActionRows.filter((r) => identity(r.source_url, r.recognition_identity_key)?.key === `${c.platform}:${c.source_public_id}`).map((r) => ({
      event_at: r.event_at, origin: r.origin, outcome: r.outcome, result_role: r.result_role,
      google_place_id: r.google_place_id, place_name: r.place_name, undo_action: r.undo_action,
    })),
    why_unverified: 'Historic label, result, or user action not freshly adjudicated for this gold dataset.' },
}));
const manifest = sorted.map((c) => {
  const { audit, ...safe } = c;
  return safe;
});
const mapping = sorted.map((c) => ({ case_id: c.case_id, source_group_id: c.source_group_id, platform: c.platform,
  source_public_id: c.source_public_id, source_url_reference: c.source_url_reference,
  legacy_case_ids: c.audit.legacy_case_ids, evidence_refs: c.audit.evidence_refs,
  prior_label_reference: c.audit.prior_label?.source ?? null }));
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(privateOut, { recursive: true });
const jsonl = (rows) => rows.map((x) => JSON.stringify(x)).join('\n') + '\n';
fs.writeFileSync(path.join(out, 'historical_social_candidates.jsonl'), jsonl(manifest));
fs.writeFileSync(path.join(out, 'legacy_source_mapping.jsonl'), jsonl(mapping));
fs.writeFileSync(path.join(privateOut, 'candidate_labels_unreviewed_private.jsonl'), jsonl(privateLabels));

// Production user-submitted sources can be private even if their URL looks
// like an ordinary social permalink. Keep them in a local review queue only.
const restrictedActionSources = new Map();
for (const row of correctionRows.concat(userActionRows)) {
  const src = identity(row.source_url, row.identity_key ?? row.recognition_identity_key);
  if (!src) continue;
  if (!restrictedActionSources.has(src.key)) restrictedActionSources.set(src.key, {
    platform: src.platform, source_public_id: src.id, source_url_reference: src.url,
    in_curated_candidate_manifest: cases.has(src.key), status: 'public_access_unconfirmed', events: [],
  });
  restrictedActionSources.get(src.key).events.push({ event_type: row.event_type ?? 'result_action',
    action: row.action ?? row.outcome, event_at: row.event_at,
    prior_place_id: row.previous_google_place_id ?? row.google_place_id ?? null,
    promoted_place_id: row.replacement_google_place_id ?? (row.origin === 'user_confirmed' ? row.google_place_id : null) });
}
fs.writeFileSync(path.join(privateOut, 'restricted_action_source_queue_private.jsonl'), jsonl([...restrictedActionSources.values()]));

// The broader job inventory is a restricted research queue. A submitted URL
// can be private, unavailable, duplicated, or unrelated to an exact place. It
// is never counted as a verified/public benchmark case or committed to Git.
const jobQueues = [];
const jobQueueCounts = {};
for (const environment of ['development', 'production']) {
  const jobPath = path.join(root, `.tmp/gold-db/${environment}-job-source-queue.json`);
  if (!fs.existsSync(jobPath)) continue;
  const rows = JSON.parse(fs.readFileSync(jobPath, 'utf8').replace(/^\uFEFF/, '')).rows;
  jobQueueCounts[environment] = { total_source_rows: rows.length, recognized_content_ids: 0, unresolved_url_shapes: 0, already_in_curated_candidates: 0 };
  for (const row of rows) {
    const src = identity(row.source_url, row.source_key);
    if (!src) { jobQueueCounts[environment].unresolved_url_shapes++; continue; }
    jobQueueCounts[environment].recognized_content_ids++;
    if (cases.has(src.key)) jobQueueCounts[environment].already_in_curated_candidates++;
    jobQueues.push({ environment, platform: src.platform, source_public_id: src.id,
      source_url_reference: src.url, in_curated_candidate_manifest: cases.has(src.key),
      first_job_at: row.first_job_at, latest_job_at: row.latest_job_at,
      job_count: row.job_count, autosave_count_not_truth: row.autosave_count,
      status: 'unverified_source_availability_and_label' });
  }
}
fs.writeFileSync(path.join(privateOut, 'historical_job_source_queue_private.jsonl'), jsonl(jobQueues));
const summary = {
  schema_version: 1, as_of: asOf, source_branch: 'feat/recognition-pareto-optimization',
  inventory_scope: 'historically exposed public social-post references only; availability and labels unverified',
  counts: { prior_v2_total: existingInputs.length, prior_v2_social_sources: existingInputs.filter((x) => identity(x.sourceUrl)).length,
    prior_v2_non_social_or_controls: existingInputs.filter((x) => !identity(x.sourceUrl)).length,
    social_candidates: sorted.length,
    by_platform: Object.fromEntries([...new Set(sorted.map((x) => x.platform))].sort().map((p) => [p, sorted.filter((x) => x.platform === p).length])),
    correction_rows: correctionRows.length,
    correction_distinct_sources: new Set(correctionRows.map((r) => identity(r.source_url, r.identity_key)?.key).filter(Boolean)).size,
    development_correction_rows: developmentCorrectionRows.length,
    user_action_rows: userActionRows.length,
    user_action_distinct_sources: new Set(userActionRows.map((r) => identity(r.source_url, r.recognition_identity_key)?.key).filter(Boolean)).size,
    restricted_action_sources_not_committed: [...restrictedActionSources.keys()].filter((k) => !cases.has(k)).length,
    candidates_with_retained_caption_or_description: sorted.filter((x) => x.evidence.caption || x.evidence.description).length,
    previously_labeled_exact_single: sorted.filter((x) => x.audit.prior_label?.class === 'VERIFIED_EXACT_SINGLE').length,
    // Private research labels are applied in a separate, ignored local file.
    // This source-only inventory never implies that a candidate is benchmark-ready.
    new_gold_verified_in_committed_manifest: 0, ignored: ignored.length },
  restricted_historical_job_queue: jobQueueCounts,
  ignored_reasons: Object.fromEntries([...new Set(ignored.map((x) => x.reason))].sort().map((reason) => [reason, ignored.filter((x) => x.reason === reason).length])),
  sources: Object.fromEntries([...sourceFiles.entries()].sort()),
  output_sha256: { historical_social_candidates: sha(jsonl(manifest)), legacy_source_mapping: sha(jsonl(mapping)), private_label_draft_before_separate_adjudication: sha(jsonl(privateLabels)), restricted_job_queue: sha(jsonl(jobQueues)), restricted_action_queue: sha(jsonl([...restrictedActionSources.values()])) },
};
fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary.counts));
