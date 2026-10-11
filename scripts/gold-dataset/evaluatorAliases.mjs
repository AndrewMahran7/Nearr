// Truth-side, explicitly enabled name overlay. Never imported by inference code.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countryNorm, norm, placeMatches, sha256 } from './core.mjs';

export const EVALUATOR_VERSION = 'sealed-primary-aliases-physical-anchors-v3';
const hashPattern = /^[a-f0-9]{64}$/;
const fail = (message) => { throw new Error(`evaluator_aliases:${message}`); };
const stable = (x) => JSON.stringify(sortObject(x));
function sortObject(x) {
  if (Array.isArray(x)) return x.map(sortObject);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((key) => [key, sortObject(x[key])]));
  return x;
}
function readBound(file, expected, description) {
  if (!file || !hashPattern.test(expected ?? '')) fail(`missing_${description}_binding`);
  const raw = fs.readFileSync(file);
  if (sha256(raw) !== expected) fail(`${description}_hash_mismatch`);
  return raw.toString('utf8');
}
function jsonl(text) {
  // Do not split Unicode U+2028/U+2029 inside a legitimate creator string.
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}
function keyed(rows, kind) {
  const map = new Map(rows.map((r) => [r.case_id, r]));
  if (map.size !== rows.length || rows.some((r) => !r.case_id)) fail(`invalid_${kind}_ids`);
  return map;
}
function floorAssertions(pred) {
  const values = new Set();
  for (const field of ['name', 'address', 'floor', 'level']) {
    const raw = pred?.[field];
    if (raw == null) continue;
    if (['floor', 'level'].includes(field) && /^-?\d{1,3}$/.test(String(raw))) values.add(Number(raw));
    const text = String(raw).normalize('NFKC').toLowerCase();
    for (const match of text.matchAll(/\b(?:basement\s*|b\s*[- ]?)(\d{1,2})\b/g)) values.add(-Number(match[1]));
    for (const match of text.matchAll(/\b(\d{1,3})(?:st|nd|rd|th)?\s*(?:floor|fl|f)\b/g)) values.add(Number(match[1]));
    for (const match of text.matchAll(/\b(?:floor|level|lvl|fl)\s*(-?\d{1,3})\b/g)) values.add(Number(match[1]));
    if (/\b(?:ground\s+floor|ground\s+level|g\s*\/\s*f)\b/.test(text)) values.add(0);
  }
  return values;
}
function requiredFloor(rule) {
  if (!rule) return null;
  if (rule.kind !== 'floor' || rule.horizontal_coordinates_sufficient !== false || rule.contradictory_floor_reject !== true || rule.independently_returned !== true || !Array.isArray(rule.accepted_values) || !rule.accepted_values.length) fail('unsupported_scope_predicate');
  const values = floorAssertions({ name: rule.accepted_values.join(' ; ') });
  if (values.size !== 1) fail('ambiguous_floor_predicate');
  return [...values][0];
}

function unitAssertions(address) {
  return new Set([...String(address ?? '').normalize('NFKC').toLowerCase().matchAll(/(?:#|\b(?:suite|ste|unit|apt|apartment)\s*)\s*([a-z0-9]+(?:-[a-z0-9]+)?)/g)].map((m) => m[1]));
}

/** Formatting equivalence only. Numeric groups, suite identifiers, street names
 * and postal codes remain significant. No approximate string/address matching.
 */
export function canonicalFullAddress(address, country) {
  if (typeof address !== 'string' || !address.trim()) return null;
  const pieces = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (country && pieces.length > 1 && countryNorm(pieces.at(-1)) === countryNorm(country)) pieces.pop();
  let text = pieces.join(', ').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  text = text.replace(/(?:#|\b(?:suite|ste|unit)\s*)\s*([a-z0-9]+(?:-[a-z0-9]+)?)/g, ' unit $1 ');
  if (countryNorm(country) === countryNorm('Japan')) text = text.replace(/(\d+)\s*-?\s*chome\s*-?\s*(?=\d)/g, '$1-');
  // Preserve digit boundaries: 1-48 is distinct from 14-8. Spaces between letter
  // runs (e.g. Mc Fadden) are presentation only once every other component agrees.
  return (text.match(/\d+|[\p{L}]+/gu) ?? []).reduce((out, token) => {
    if (/^\d+$/.test(token)) return out + '|' + token + '|';
    return out + token;
  }, '');
}

export function exactFullAddressMatch(pred, truth) {
  if (typeof pred?.address !== 'string' || !truth.country || !truth.city) return false;
  for (const key of ['country', 'region', 'city']) {
    if (truth[key] && pred[key] && (key === 'country' ? countryNorm(truth[key]) !== countryNorm(pred[key]) : norm(truth[key]) !== norm(pred[key]))) return false;
  }
  const expectedUnits = unitAssertions(truth.address), predictedUnits = unitAssertions(pred.address);
  if (expectedUnits.size && (expectedUnits.size !== predictedUnits.size || [...expectedUnits].some((u) => !predictedUnits.has(u)))) return false;
  const predicted = canonicalFullAddress(pred.address, truth.country);
  return [truth.address, ...(truth.accepted_addresses ?? [])].some((address) => {
    // A numbered street plus the declared locality must be present in the
    // accepted full address. A plaza/region label is not an address shortcut.
    if (typeof address !== 'string' || !/\d/.test(address) || !norm(address).includes(norm(truth.city))) return false;
    return canonicalFullAddress(address, truth.country) === predicted;
  });
}

/** Load against the ORIGINAL sealed full dataset, even when scoring a shard.
 * Caller must explicitly supply predeclared map/seal hashes. No inferred bindings.
 * Returns a scoreOne sixth-argument context; never edits truth or predictions.
 */
export function loadEvaluatorAliases({ mapPath, expectedMapSha256, sealPath, expectedSealSha256, sourceManifestPath, sourceLabelsPath, sourceSplitsPath }) {
  const map = JSON.parse(readBound(mapPath, expectedMapSha256, 'map'));
  const seal = JSON.parse(readBound(sealPath, expectedSealSha256, 'seal'));
  if (map.schema_version !== 1 || typeof map.evaluator_map_version !== 'string' || map.original_seal_sha256 !== expectedSealSha256 || !Array.isArray(map.entries)) fail('invalid_map_seal_binding');
  const sourceFiles = [
    ['manifest', 'benchmark_manifest_private.jsonl', sourceManifestPath],
    ['labels', 'benchmark_labels_private.jsonl', sourceLabelsPath],
    ['splits', 'benchmark_splits_private.json', sourceSplitsPath],
  ];
  const source = {};
  for (const [kind, key, file] of sourceFiles) {
    const hash = seal[`${kind}_sha256`];
    if (map.canonical_sha256?.[key] !== hash) fail(`map_${kind}_seal_mismatch`);
    source[kind] = readBound(file, hash, `original_${kind}`);
  }
  const records = keyed(jsonl(source.manifest), 'manifest');
  const labels = keyed(jsonl(source.labels), 'label');
  const splits = JSON.parse(source.splits);
  const groupNames = new Map();
  const groupTruth = new Map();
  const groupAnchors = new Map();
  for (const label of labels.values()) for (const place of label.expected_places ?? []) {
    const names = groupNames.get(place.place_group_id) ?? new Set();
    for (const name of [place.name, ...(place.aliases ?? [])]) names.add(name);
    groupNames.set(place.place_group_id, names);
    const truths = groupTruth.get(place.place_group_id) ?? new Set();
    truths.add(stable(place)); groupTruth.set(place.place_group_id, truths);
    if (place.coordinates && records.get(label.case_id)?.state === 'ready') {
      const anchors = groupAnchors.get(place.place_group_id) ?? [];
      if (!anchors.some((a) => stable(a.coordinates) === stable(place.coordinates))) anchors.push(place);
      groupAnchors.set(place.place_group_id, anchors);
    }
  }
  const entries = new Map();
  const evidenceHashes = new Map();
  let additions = 0, disabled = 0, guarded = 0, supplements = 0;
  for (const entry of map.entries) {
    const pg = entry.place_group_id, approved = groupNames.get(pg);
    if (!/^pg_[a-f0-9]{16}$/.test(pg ?? '') || entries.has(pg) || !approved) fail('unknown_or_duplicate_place_group');
    for (const field of ['canonical_names', 'existing_accepted_names', 'cross_record_alias_union']) {
      if (!Array.isArray(entry[field]) || entry[field].some((name) => !approved.has(name))) fail('unapproved_existing_name_union');
    }
    if (!Array.isArray(entry.proposed_additions) || !Array.isArray(entry.conditional_additions)) fail('invalid_additions');
    for (const addition of [...entry.proposed_additions, ...entry.conditional_additions]) {
      if (typeof addition.name !== 'string' || !norm(addition.name) || !Array.isArray(addition.evidence) || !addition.evidence.some((e) => e.observed_name === addition.name)) fail('unproven_alias');
      for (const evidence of addition.evidence) {
        if (!evidence.path || !hashPattern.test(evidence.sha256 ?? '') || !evidence.locator || !evidence.source_url) fail('incomplete_alias_evidence');
        if (evidenceHashes.has(evidence.path) && evidenceHashes.get(evidence.path) !== evidence.sha256) fail('inconsistent_evidence_hash');
        if (!evidenceHashes.has(evidence.path)) readBound(evidence.path, evidence.sha256, 'provenance');
        evidenceHashes.set(evidence.path, evidence.sha256);
      }
    }
    // Conditional additions are intentionally NEVER enabled by this version.
    if (entry.proposed_additions.some((a) => a.condition != null)) fail('conditional_alias_in_active_set');
    const floor = requiredFloor(entry.required_scope_predicate);
    const addresses = entry.proposed_address_additions ?? [];
    if (!Array.isArray(addresses)) fail('invalid_address_additions');
    for (const addition of addresses) {
      if (typeof addition.address !== 'string' || !Array.isArray(addition.evidence) ||
          !addition.evidence.some((e) => e.observed_address === addition.address)) fail('unproven_address');
      for (const e of addition.evidence) {
        if (!e.source_url || !e.locator) fail('incomplete_address_evidence');
        readBound(e.path, e.sha256, 'address_provenance');
        if (evidenceHashes.has(e.path) && evidenceHashes.get(e.path) !== e.sha256) fail('inconsistent_evidence_hash');
        evidenceHashes.set(e.path, e.sha256);
      }
    }
    const anchor = entry.supplemental_coordinate_anchor ?? null;
    if (anchor) {
      if (groupAnchors.has(pg) || anchor.kind !== 'independently_adjudicated_map_feature' ||
          !Number.isFinite(anchor.coordinates?.lat) || !Number.isFinite(anchor.coordinates?.lng) ||
          Math.abs(anchor.coordinates.lat) > 90 || Math.abs(anchor.coordinates.lng) > 180 ||
          !anchor.adjudication || !Array.isArray(anchor.evidence) || !anchor.evidence.length) fail('invalid_supplemental_anchor');
      for (const e of anchor.evidence) {
        if (!e.source_url || !/^\/\d+$/.test(e.locator ?? '')) fail('invalid_anchor_locator');
        const raw = readBound(e.path, e.sha256, 'anchor_provenance');
        if (evidenceHashes.has(e.path) && evidenceHashes.get(e.path) !== e.sha256) fail('inconsistent_evidence_hash');
        evidenceHashes.set(e.path, e.sha256);
        const feature = JSON.parse(raw)[Number(e.locator.slice(1))];
        if (!feature || Number(feature.lat) !== anchor.coordinates.lat || Number(feature.lon) !== anchor.coordinates.lng ||
            feature.osm_id !== e.osm_id || feature.osm_type !== e.osm_type) fail('anchor_feature_mismatch');
      }
      supplements++;
    }
    additions += entry.proposed_additions.length; disabled += entry.conditional_additions.length;
    if (floor !== null) guarded++;
    entries.set(pg, { names: [...new Set([...entry.existing_accepted_names, ...entry.cross_record_alias_union, ...entry.proposed_additions.map((a) => a.name)])], floor, anchor, addresses: addresses.map((a) => a.address) });
  }
  function assertCase(record, label, split) {
    if (stable(records.get(record?.case_id)) !== stable(record) || stable(labels.get(record?.case_id)) !== stable(label) || splits.assignments?.[record?.case_id] !== split) fail('case_differs_from_original_seal');
  }
  function matches(pred, truth) {
    if (!groupTruth.get(truth?.place_group_id)?.has(stable(truth))) fail('truth_differs_from_original_seal');
    const entry = entries.get(truth.place_group_id);
    if (truth.country && pred.country && countryNorm(truth.country) !== countryNorm(pred.country)) return false;
    const units = unitAssertions(truth.address), predictedUnits = unitAssertions(pred.address);
    if (units.size && (units.size !== predictedUnits.size || [...predictedUnits].some((u) => !units.has(u)))) return false;
    if (entry && entry.floor !== null) {
      const floors = floorAssertions(pred);
      // Before every ID, coordinate, address and name path. No truth-filled floor.
      if (!floors.has(entry.floor) || [...floors].some((floor) => floor !== entry.floor)) return false;
    }
    const expanded = { ...truth, aliases: [...new Set([...(truth.aliases ?? []), ...(entry?.names ?? [])])], accepted_addresses: [...(truth.accepted_addresses ?? []), ...(entry?.addresses ?? [])] };
    if (truth.place_id && pred.place_id && truth.place_id.split(':')[0] === pred.place_id.split(':')[0] && truth.place_id !== pred.place_id) return false;
    if (truth.coordinates && pred.coordinates) return placeMatches(pred, expanded);
    if (!truth.coordinates && pred.coordinates) {
      // Only fill absent truth-side anchors. Existing coordinates and radii are
      // immutable; a source-group anchor never comes from a model prediction.
      const anchors = groupAnchors.get(truth.place_group_id) ?? (entry?.anchor ? [entry.anchor] : []);
      if (anchors.length) return anchors.some((anchor) => placeMatches(pred, { ...expanded,
        coordinates: anchor.coordinates, accepted_radius_meters: Math.min(truth.accepted_radius_meters ?? 100, anchor.accepted_radius_meters ?? 100) }));
    }
    if ([expanded.name, ...expanded.aliases].map(norm).includes(norm(pred.name)) && exactFullAddressMatch(pred, expanded)) return true;
    return placeMatches(pred, expanded);
  }
  const metadata = Object.freeze({
    evaluator_version: EVALUATOR_VERSION, evaluator_map_version: map.evaluator_map_version,
    evaluator_map_sha256: expectedMapSha256, original_seal_sha256: expectedSealSha256,
    original_manifest_sha256: seal.manifest_sha256, original_labels_sha256: seal.labels_sha256, original_splits_sha256: seal.splits_sha256,
    evaluator_module_sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    core_sha256: sha256(fs.readFileSync(fileURLToPath(new URL('./core.mjs', import.meta.url)))),
    mapped_place_groups: entries.size, active_proven_aliases: additions, disabled_conditional_aliases: disabled,
    floor_guarded_groups: guarded, verified_provenance_files: evidenceHashes.size,
    supplemental_coordinate_groups: supplements, original_group_anchor_inheritance: true,
    original_reports_preserved: true,
  });
  return Object.freeze({ placeMatches: matches, assertCase, metadata });
}
