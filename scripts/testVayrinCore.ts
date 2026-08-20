import assert from 'node:assert/strict';

import {
  classifyHypothesis,
  compareGeography,
  rankHypotheses,
  specificEvidenceOutranksContext,
  type GeographicEvidence,
} from '../lib/vayrin/geoEvidence';
import { mapVayrinResult } from '../lib/vayrin/productMapping';

const metadataLa: GeographicEvidence = {
  source: 'metadata', specificity: 'city', city: 'Los Angeles', region: 'California',
  country: 'United States', confidence: 0.95,
};
const placeInLa: GeographicEvidence = {
  source: 'visual', specificity: 'place', name: 'A Specific Beach', city: 'Los Angeles',
  region: 'California', country: 'United States', confidence: 0.82,
};
assert.equal(compareGeography(metadataLa, placeInLa).verdict, 'compatible');

const countryMetadata: GeographicEvidence = {
  source: 'metadata', specificity: 'country', country: 'Indonesia', confidence: 0.9,
};
const placeInCountry: GeographicEvidence = {
  source: 'visual', specificity: 'place', name: 'Atuh Beach', country: 'Indonesia', confidence: 0.8,
};
assert.equal(compareGeography(countryMetadata, placeInCountry).verdict, 'compatible');

const paris: GeographicEvidence = {
  source: 'visual', specificity: 'place', name: 'Eiffel Tower', city: 'Paris',
  country: 'France', confidence: 0.9,
};
assert.equal(compareGeography(metadataLa, paris).verdict, 'contradicted');

const specific = {
  evidence: placeInLa, verified: true, supportingClueCount: 2,
  contextComparison: compareGeography(placeInLa, metadataLa),
};
const coarse = { evidence: metadataLa, verified: true, supportingClueCount: 2 };
assert.equal(classifyHypothesis(specific), 'strong');
assert.equal(rankHypotheses([coarse, specific])[0], specific);
assert.equal(specificEvidenceOutranksContext(specific, metadataLa), true);

assert.deepEqual(mapVayrinResult({ primaryStrengths: ['strong'], distinctPlaceCount: 1 }), {
  decision: 'auto_save', autoSaveEligible: true, reason: 'strong_single_verified',
});
assert.equal(mapVayrinResult({ primaryStrengths: ['likely', 'lead'], distinctPlaceCount: 1 }).decision, 'candidate_picker');
assert.equal(mapVayrinResult({ primaryStrengths: ['strong'], distinctPlaceCount: 3 }).decision, 'multi_candidate_confirmation');
assert.equal(mapVayrinResult({ primaryStrengths: ['coarse_only'], distinctPlaceCount: 1 }).decision, 'candidate_confirmation');
assert.equal(mapVayrinResult({ primaryStrengths: [], distinctPlaceCount: 0 }).decision, 'manual_fallback');

console.log('Vayrin core evidence tests passed.');
