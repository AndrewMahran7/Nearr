import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalize } from './metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sibling = path.dirname(root);
const out = path.join(root, 'artifacts/recognition-optimization-2026-10-08/dataset');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sources = [];
function read(file) {
  const bytes = fs.readFileSync(file);
  sources.push({ path: path.relative(root, file).replaceAll('\\', '/'), sha256: sha(bytes), bytes: bytes.length });
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
function readLines(file) {
  const bytes = fs.readFileSync(file); sources.push({ path: path.relative(root, file).replaceAll('\\', '/'), sha256: sha(bytes), bytes: bytes.length });
  return bytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
}
function canonical(url) {
  const u = new URL(url), instagram = u.pathname.match(/^\/(?:p|reel|reels)\/([^/]+)/);
  if (u.hostname.includes('instagram.com') && instagram) return `instagram:${instagram[1]}`;
  u.search = ''; u.hash = ''; return u.href.replace(/\/$/, '');
}
const inputs = [], labels = [], bySource = new Map();
function add(input, label) {
  const key = input.sourceKeys.join('|');
  if (bySource.has(key)) return bySource.get(key);
  input.kind ??= 'real'; input.split = 'TRAIN_DEVELOPMENT'; input.exposure = 'historical_outcomes_already_exposed';
  input.groupKeys ??= []; input.groupKeys.push(...input.sourceKeys.map((s) => `source:${s}`));
  label.caseId = input.caseId;
  inputs.push(input); labels.push(label); bySource.set(key, { input, label }); return { input, label };
}
const legacy = read(path.join(root, 'artifacts/sol-parity/inference-corpus.json')).cases;
const oldTruth = new Map(read(path.join(root, 'artifacts/sol-parity/ground-truth.json')).cases.map((x) => [x.case_id, x]));
const overlay = new Map(read(path.join(root, 'artifacts/recognition-regression/ground-truth.json')).cases.map((x) => [x.caseId, x]));
for (const c of legacy) {
  const g = oldTruth.get(c.case_id) ?? {}, o = overlay.get(c.case_id) ?? {};
  const aliases = [...new Set([o.canonicalNameOverride, ...(g.accepted_exact_identities ?? []), ...(o.acceptedAliasesOverride ?? g.accepted_aliases ?? [])].filter(Boolean))];
  const verified = o.quality === 'VERIFIED' && aliases.length;
  add({ caseId: c.case_id, sourceKeys: [canonical(c.source_url)], sourceUrl: c.source_url, categories: c.categories, evidenceRefs: [{ path: 'artifacts/sol-parity/inference-corpus.json', caseId: c.case_id }], groupKeys: aliases.length ? [`place:${normalize(aliases[0])}`] : [] },
    { label: verified ? 'VERIFIED_EXACT_SINGLE' : g.multi_place_expectation === 'NONE' && c.case_id !== 'C07' ? 'KNOWN_NEGATIVE' : 'UNVERIFIED', expectedPlaces: verified ? [{ name: aliases[0], aliases, locality: o.requiredLocality ?? null }] : [], proposedPlacesNotGroundTruth: verified ? [] : aliases, previousQuality: o.quality, multiPlaceExpected: g.multi_place_expectation === 'MULTIPLE' ? true : g.multi_place_expectation === 'ONE' ? false : null, completeSetEstablished: g.multi_place_expectation !== 'MULTIPLE' && Boolean(verified), provenance: o.evidenceSources ?? [], acceptedGranularity: verified ? 'exact_physical_place' : 'unestablished', notes: o.notes ?? null });
}
const cliff = read(path.join(root, 'artifacts/cliff-jumping/ground-truth.json')).destinations;
for (const c of cliff) {
  const verified = c.groundTruthStatus === 'VERIFIED_EXACT';
  const input = { caseId: c.caseId, sourceKeys: [canonical(c.sourceUrl)], sourceUrl: c.sourceUrl, categories: ['natural', 'cliff'], evidenceRefs: [{ path: 'artifacts/cliff-jumping/inference-corpus.json', caseId: c.caseId }], groupKeys: [`place:${normalize(c.canonicalName)}`] };
  const label = { label: verified ? 'VERIFIED_EXACT_SINGLE' : 'UNVERIFIED', expectedPlaces: verified ? [{ name: c.canonicalName, aliases: [...new Set([c.canonicalName, ...c.acceptedAliases])], country: c.country }] : [], previousQuality: c.groundTruthStatus, proposedPlacesNotGroundTruth: verified ? [] : [c.canonicalName], country: c.country, region: c.region, multiPlaceExpected: verified ? false : null, completeSetEstablished: verified, provenance: c.evidence, acceptedGranularity: verified ? 'named_physical_feature' : 'unestablished', notes: c.confidenceNotes };
  const existing = bySource.get(input.sourceKeys.join('|'));
  if (existing) {
    existing.input.evidenceRefs.push(...input.evidenceRefs); existing.input.groupKeys.push(...input.groupKeys);
    if (verified) Object.assign(existing.label, label, { caseId: existing.input.caseId });
  } else add(input, label);
}
// Independently founder-reviewed metadata labels supplement (and often duplicate) the media corpus.
const jevRoot = path.join(sibling, 'jev-evaluation-reconciliation');
const jevPath = path.join(jevRoot, 'evaluations/jev-recognition/dataset_manifest.jsonl');
if (fs.existsSync(jevPath)) {
  const jev = readLines(jevPath), gold = read(path.join(root, 'artifacts/share-gold-labeling-labeled.json'));
  for (const c of jev) {
    if (c.evidence_ref.repository_path !== 'artifacts/share-gold-labeling-labeled.json') continue;
    const row = gold[c.evidence_ref.record_index], key = canonical(row.url);
    const labelCategory = c.label_category === 'VERIFIED_EXACT' ? 'VERIFIED_EXACT_SINGLE' : c.label_category;
    const label = { label: labelCategory, expectedPlaces: labelCategory === 'VERIFIED_EXACT_SINGLE' ? [{ name: c.expected_aliases[0], aliases: c.expected_aliases, locality: row.metadata_city || null }] : [], multiPlaceExpected: labelCategory === 'VERIFIED_EXACT_SINGLE' ? false : null, completeSetEstablished: labelCategory === 'VERIFIED_EXACT_SINGLE', provenance: [{ kind: c.label_provenance, reference: `${sources.at(-2).path}#${c.case_id}` }], acceptedGranularity: c.acceptable_granularity, notes: 'Retained founder-reviewed label; former split is exposed and discarded for this generation.' };
    const input = { caseId: c.case_id, sourceKeys: [key], sourceUrl: row.url, categories: ['metadata'], evidenceRefs: [{ path: 'artifacts/share-gold-labeling-labeled.json', recordIndex: c.evidence_ref.record_index, allowedFields: ['title', 'description', 'detected_handles', 'metadata_extracted_address'] }], groupKeys: [row.poster_handle ? `creator:${normalize(row.poster_handle)}` : null, ...(c.expected_aliases.length ? [`place:${normalize(c.expected_aliases[0])}`] : [])].filter(Boolean) };
    const existing = bySource.get(key);
    if (existing) {
      existing.input.evidenceRefs.push(...input.evidenceRefs); existing.input.groupKeys.push(...input.groupKeys);
      if (labelCategory !== 'UNVERIFIED' && existing.label.label === 'UNVERIFIED') Object.assign(existing.label, label, { caseId: existing.input.caseId });
    } else add(input, label);
  }
}
const publicRoot = path.join(sibling, 'sol-vs-terra');
const publicPath = path.join(publicRoot, 'artifacts/model-benchmark/sol-vs-terra/fixture-catalog.json');
if (fs.existsSync(publicPath)) {
  const catalog = read(publicPath), publicSources = new Map(catalog.sources.map((s) => [s.id, s]));
  const regionOnly = new Set(['niagara_falls', 'summersville_lake_cliff_jump', 'twelve_apostles', 'aiglun_rope_jump', 'al_jahlieh_informal_waterfall']);
  for (const c of catalog.cases) {
    const multi = Boolean(c.groundTruth.logicalPlaces), negative = c.groundTruth.noExactAnswerExpected === true;
    const broad = regionOnly.has(c.id);
    add({ caseId: `public-${c.id}`, kind: multi ? 'composite_control' : 'real', sourceKeys: c.sources.map((s) => canonical(publicSources.get(s.sourceId).pageUrl)), categories: c.classes, evidenceRefs: [{ path: path.relative(root, publicPath).replaceAll('\\', '/'), caseId: c.id, allowedFields: ['context', 'sources'] }], groupKeys: c.sources.map((s) => `public-source:${s.sourceId}`).concat(c.groundTruth.acceptedNames.length ? [`place:${normalize(c.groundTruth.acceptedNames[0])}`] : []), sourceLicenses: c.sources.map((s) => ({ source: publicSources.get(s.sourceId).pageUrl, license: publicSources.get(s.sourceId).license })) },
      { label: multi ? 'VERIFIED_MULTI' : negative ? 'KNOWN_NEGATIVE' : broad ? 'VERIFIED_REGION_ONLY' : 'VERIFIED_EXACT_SINGLE', expectedPlaces: multi ? c.groundTruth.logicalPlaces.map((p) => ({ name: p.acceptedNames[0], aliases: p.acceptedNames, timestampsSeconds: p.timestampsSeconds })) : !negative && !broad ? [{ name: c.groundTruth.acceptedNames[0], aliases: c.groundTruth.acceptedNames }] : [], multiPlaceExpected: multi ? true : negative || broad ? null : false, completeSetEstablished: !broad && !negative, acceptedGranularity: multi ? 'two_named_places_in_constructed_frame_composite' : broad ? 'region_or_parent_feature_only' : 'named_physical_feature', provenance: [{ kind: 'retained_public_source_adjudication', reference: `${sources.at(-1).path}#${c.id}`, basis: c.groundTruth.basis }], notes: broad ? 'Original accepted labels include region/parent or component alternatives; excluded from exact-place denominator.' : multi ? 'Constructed montage, not an independently submitted real multi-place post.' : null });
  }
}
// Connected components: media/repost aliases, physical venue and known creator. Unknown
// creator/repost links remain an explicit limitation; no random split conceals it.
const parent = inputs.map((_, i) => i), keyOwner = new Map();
const find = (i) => parent[i] === i ? i : (parent[i] = find(parent[i]));
for (let i = 0; i < inputs.length; i++) for (const key of inputs[i].groupKeys) {
  if (keyOwner.has(key)) parent[find(i)] = find(keyOwner.get(key)); else keyOwner.set(key, i);
}
for (let i = 0; i < inputs.length; i++) inputs[i].group = `group-${sha(inputs.filter((_, j) => find(j) === find(i)).map((x) => x.caseId).sort().join('|')).slice(0, 16)}`;
inputs.sort((a, b) => a.caseId.localeCompare(b.caseId)); labels.sort((a, b) => a.caseId.localeCompare(b.caseId));
function writeOnce(name, content) {
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, name), content, { flag: 'wx' });
}
const inputBytes = JSON.stringify({ schemaVersion: 1, cases: inputs }, null, 2) + '\n';
const labelBytes = JSON.stringify({ schemaVersion: 1, cases: labels }, null, 2) + '\n';
const counts = (xs, key) => Object.fromEntries([...new Set(xs.map((x) => x[key]))].map((v) => [v, xs.filter((x) => x[key] === v).length]));
writeOnce('inputs.json', inputBytes); writeOnce('labels.json', labelBytes);
writeOnce('freeze.json', JSON.stringify({ schemaVersion: 1, experimentGeneration: 1, frozenAt: new Date().toISOString(), inputSha256: sha(inputBytes), labelSha256: sha(labelBytes), counts: { total: inputs.length, kind: counts(inputs, 'kind'), label: counts(labels, 'label'), split: { TRAIN_DEVELOPMENT: inputs.length, CALIBRATION: 0, HELD_OUT_TEST: 0 }, groups: new Set(inputs.map((x) => x.group)).size }, policy: 'All discovered historical outcomes are exposed. Empty calibration and held-out partitions are deliberate; new independently adjudicated media must create a new generation before tuning.', leakageLimits: ['Unknown creator/repost relationships not inferable from retained manifests.', 'All current cases share the development partition; no generalization claim.', 'Source frame SHA manifests exist historically but not complete perceptual cross-source dedup.'], sources }, null, 2) + '\n');
console.log(JSON.stringify({ inputSha256: sha(inputBytes), labelSha256: sha(labelBytes), cases: inputs.length, real: inputs.filter((x) => x.kind === 'real').length, labels: counts(labels, 'label') }));
