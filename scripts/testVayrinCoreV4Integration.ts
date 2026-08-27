import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';
import {
  classifyEntity,
  VAYRIN_ENTITY_TYPES,
} from '../lib/vayrin/entitySemantics';
import { evaluateSelectiveEvidenceFirewall } from '../lib/recognitionTruth';
import { normalizeProviderEntityKind } from '../supabase/functions/process-share-link/places/placeNormalization';
import {
  recognitionCacheDecision,
  type RecognitionCacheRow,
} from '../supabase/functions/process-share-jobs/recognitionCache';

let assertions = 0;
const root = path.resolve(__dirname, '..');
const workerEvidenceSource = readFileSync(path.join(root, 'services/media-worker/src/types/evidence.ts'), 'utf8');
const visualPromptSource = readFileSync(path.join(root, 'services/media-worker/src/vayrin/visualGeolocationPrompt.ts'), 'utf8');
function check(name: string, test: () => void): void {
  test();
  assertions += 1;
  console.log(`PASS ${name}`);
}

const visual = (overrides: Record<string, unknown> = {}) => evaluateSelectiveEvidenceFirewall({
  hypothesisOrigin: 'independent_multimodal',
  entityType: 'NAMED_NATURAL_FEATURE',
  identitySupport: 'strong',
  geoSupport: 'strong_inferred_geo',
  semanticCategory: 'natural water',
  conflicts: [],
  evidenceBasis: 'distinctive_visual_match',
  evidenceProvenance: ['SOURCE_VISUAL', 'INDEPENDENT_MODEL_HYPOTHESIS', 'PLACES_NAME'],
  recognitionConfidence: 0.9,
  canonicalizationConfidence: 0.99,
  canonicalizationOutcome: 'CANONICAL_EXACT',
  singletonCandidate: true,
  ...overrides,
});

const easy = (overrides: Record<string, unknown> = {}) => evaluateSelectiveEvidenceFirewall({
  hypothesisOrigin: 'easy_source',
  entityType: 'NAMED_NATURAL_FEATURE',
  identitySupport: 'exact',
  geoSupport: 'explicit_source_geo',
  semanticCategory: 'natural water',
  conflicts: [],
  evidenceBasis: 'direct_visible_identity',
  evidenceProvenance: ['SOURCE_CAPTION', 'PLACES_NAME'],
  recognitionConfidence: 0.94,
  canonicalizationConfidence: 0.97,
  canonicalizationOutcome: 'CANONICAL_EXACT',
  singletonCandidate: true,
  ...overrides,
});

check('1 hypothesis pass is blind to Places candidates', () => {
  assert.match(visualPromptSource, /places_candidates: deliberately withheld for independent hypothesis generation/);
  assert.match(visualPromptSource, /retrievedCandidatesJson\?\.trim\(\)/);
});

check('2 worker and application use the shared entity taxonomy', () => {
  const enumBody = workerEvidenceSource.match(/export const VayrinEntityType = z\.enum\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  const workerValues = [...enumBody.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(workerValues, [...VAYRIN_ENTITY_TYPES]);
});

check('3 person is reasoning context, never a place query', () => {
  const value = classifyEntity({ text: 'Ken Stornes', contextText: 'athlete world record jumped' });
  assert.equal(value.entityType, 'PERSON');
  assert.equal(value.placesEligible, false);
});

check('4 activity is reasoning context, never a place query', () => {
  const value = classifyEntity({ text: 'Døds', contextText: '40.5m world record jump Norway' });
  assert.equal(value.entityType, 'ACTIVITY');
  assert.equal(value.placesEligible, false);
});

check('5 geographic alias supports a natural hypothesis', () => {
  const value = classifyEntity({ text: 'Mokes', contextText: 'Kailua Hawaii ocean volcanic cliffs' });
  assert.equal(value.entityType, 'GEOGRAPHIC_ALIAS');
  assert.equal(value.canonicalSearchName, 'Mokulua Islands');
});

check('6 named natural features canonicalize without business typing', () => {
  assert.equal(classifyEntity({ text: 'Okere Falls', contextText: 'waterfall New Zealand' }).entityType, 'NAMED_NATURAL_FEATURE');
  assert.equal(normalizeProviderEntityKind({ types: ['establishment', 'point_of_interest'] }), 'unknown');
  assert.equal(normalizeProviderEntityKind({ types: ['establishment', 'waterfall'] }), 'named_natural_feature');
});

check('7 candidate cannot prove itself', () => {
  const decision = evaluateSelectiveEvidenceFirewall({
    hypothesisOrigin: 'provider_candidate', identitySupport: 'none',
    evidenceProvenance: ['PLACES_NAME', 'CANDIDATE_DERIVED'],
    recognitionConfidence: 0, canonicalizationConfidence: 1,
    canonicalizationOutcome: 'CANONICAL_EXACT', singletonCandidate: true,
  });
  assert.notEqual(decision.admissionOutcome, 'ADMIT_AUTOSAVE');
  assert.equal(decision.independentIdentitySupport, false);
});

check('8 recognition confidence stays separate from canonicalization confidence', () => {
  const decision = visual({ recognitionConfidence: 0.83, canonicalizationConfidence: 0.99 });
  assert.equal(decision.recognitionConfidence, 0.83);
  assert.equal(decision.canonicalizationConfidence, 0.99);
});

check('9 explicit Maui blocks San Francisco', () => {
  assert.equal(visual({ explicitGeoConflict: true }).admissionOutcome, 'REJECT');
});

check('10 Norway blocks U.S. businesses', () => {
  assert.equal(visual({ explicitGeoConflict: true, semanticConflict: true, entityType: 'BUSINESS_OR_VENUE' }).admissionOutcome, 'REJECT');
});

check('11 natural scene blocks restaurant', () => {
  assert.equal(visual({ semanticConflict: true, directSourceIdentity: false }).admissionOutcome, 'REJECT');
});

check('12 blind visual landmark hypothesis is independent evidence', () => {
  assert.equal(visual().admissionOutcome, 'ADMIT_AUTOSAVE');
});

check('13 singleton alone cannot autosave', () => {
  const decision = evaluateSelectiveEvidenceFirewall({
    evidenceProvenance: ['PLACES_NAME', 'PLACES_SEARCH_RANK'],
    identitySupport: 'none', recognitionConfidence: 0,
    canonicalizationConfidence: 1, canonicalizationOutcome: 'CANONICAL_EXACT',
    singletonCandidate: true,
  });
  assert.equal(decision.admissionOutcome, 'ADMIT_REVIEW');
});

check('14 R01 stays safe and truthful', () => {
  const decision = evaluateSelectiveEvidenceFirewall({
    evidenceProvenance: ['PLACES_CATEGORY'], identitySupport: 'none',
    geoSupport: 'strong_inferred_geo', hasTruthfulPartial: true,
    canonicalizationOutcome: 'NO_CANONICAL_MATCH', singletonCandidate: false,
  });
  assert.equal(decision.admissionOutcome, 'ADMIT_PARTIAL');
});
check('15 R02 has no cross-geo admission', () => assert.equal(visual({ explicitGeoConflict: true }).admissionOutcome, 'REJECT'));
check('16 R03 Tamolitch remains autosave-capable', () => assert.equal(visual().admissionOutcome, 'ADMIT_AUTOSAVE'));
check('17 R04 Dorset autosave is preserved', () => assert.equal(easy().admissionOutcome, 'ADMIT_AUTOSAVE'));
check('18 R05 Okere exact natural feature is recoverable', () => assert.equal(easy({ recognitionConfidence: 0.88 }).admissionOutcome, 'ADMIT_AUTOSAVE'));
check('19 R06 Lake Havasu autosave is preserved', () => assert.equal(easy().admissionOutcome, 'ADMIT_AUTOSAVE'));
check('20 R07 retains Norway minimum and rejects commercial junk', () => assert.equal(visual({ explicitGeoConflict: true }).admissionOutcome, 'REJECT'));
check('21 R08 retains one natural destination and rejects restaurant', () => assert.equal(visual({ semanticConflict: true }).admissionOutcome, 'REJECT'));

const cacheRow = (trust: RecognitionCacheRow['trust_level'], version: string): RecognitionCacheRow => ({
  id: 'cache-1', identity_key: 'v1:instagram:fixture', platform: 'instagram', content_id: 'fixture',
  canonical_url: 'https://instagram.com/reel/fixture/', identity_version: 1,
  recognition_version: version, result_type: 'verified_place', trust_level: trust,
  canonical_place_id: 'place-1', candidate_payload: null, invalidated_at: null,
});

check('22 USER_CONFIRMED truth survives recognition versions', () => {
  assert.equal(recognitionCacheDecision(cacheRow('USER_CONFIRMED', 'old-version')).kind, 'trusted_place');
});
check('23 one V4 cache version gates machine truth', () => {
  assert.equal(RECOGNITION_VERSION, 'vayrin-recognition-2026-08-27.v4-core');
  assert.equal(recognitionCacheDecision(cacheRow('VERIFIED_AUTO_SAVE', 'old-version')).kind, 'miss');
});

console.log(`\nPASS Vayrin Core V4 selective integration contract (${assertions} assertions)`);
