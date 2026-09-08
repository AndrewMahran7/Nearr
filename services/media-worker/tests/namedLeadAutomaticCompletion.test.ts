import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizePremiumHypothesis } from '../src/premium/premiumCanonicalization.js';
import type { SolDestination } from '../src/solParity/types.js';

const incident: SolDestination = {
  name: 'Nagarkot ZipCoaster', entity_type: 'LANDMARK', city: 'Nagarkot',
  region: 'Bagmati Province', country: 'Nepal', confidence: 'HIGH',
  alternatives: [], supporting_clues: ['spoken named venue'], contradictions: [], web_research_used: false,
};
const actual = {
  googlePlaceId: 'ChIJCcqtRAAF6zkR1HoTXkm6RNc', name: 'Nagarkot Zip Coaster',
  formattedAddress: 'Mahamanjushree Nagarkot 44812, Nepal', latitude: 27.7171758,
  longitude: 85.518039, types: ['establishment', 'point_of_interest', 'tourist_attraction'],
};

test('incident: compound spacing keeps the exact provider identity eligible', async () => {
  let calls = 0;
  const result = await canonicalizePremiumHypothesis({
    hypothesis: incident, apiKey: 'fixture', maxCalls: 1,
    search: async () => { calls += 1; return { ok: true, results: [actual] }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'CANONICAL_EXACT');
  assert.equal(result.selected?.googlePlaceId, actual.googlePlaceId);
});

test('compound normalization does not bypass geography, parent, or ambiguity gates', async () => {
  const wrongGeo = await canonicalizePremiumHypothesis({
    hypothesis: incident, apiKey: 'fixture', maxCalls: 1,
    search: async () => ({ ok: true, results: [{ ...actual, formattedAddress: 'Colorado, US' }] }),
  });
  assert.equal(wrongGeo.selected, null);
  const parent = await canonicalizePremiumHypothesis({
    hypothesis: { ...incident, name: 'ZipCoaster Tower' }, apiKey: 'fixture', maxCalls: 1,
    search: async () => ({ ok: true, results: [{ ...actual, name: 'Nagarkot', types: ['locality'] }] }),
  });
  assert.equal(parent.selected, null);
  const multiple = await canonicalizePremiumHypothesis({
    hypothesis: incident, apiKey: 'fixture', maxCalls: 1,
    search: async () => ({ ok: true, results: [actual, { ...actual, googlePlaceId: 'other' }] }),
  });
  assert.notEqual(multiple.status, 'CANONICAL_SINGLE');
});
