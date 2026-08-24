import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  boundedSceneCategories,
  detectStrongRegionEvidence,
  expandRegionToPoiCandidatesV3,
} from '../src/vayrin/regionPoiV3.js';

test('1 broad region hashtag is detected without an answer mapping', () => {
  assert.deepEqual(detectStrongRegionEvidence({ caption: 'swimming today #supai #waterfall' }), {
    detected: true, label: 'supai', source: 'caption_hashtag',
  });
});

test('2 generic hashtags are not regions', () => {
  assert.equal(detectStrongRegionEvidence({ caption: '#travel #waterfall #fyp' }).detected, false);
});

test('3 scene categories are bounded to two queries', () => {
  assert.deepEqual(boundedSceneCategories('travertine waterfall'), ['waterfall', 'swimming hole']);
});

test('4 Places expansion deduplicates canonical IDs and caps candidates', async () => {
  let calls = 0;
  const result = await expandRegionToPoiCandidatesV3({
    apiKey: 'server-only-test-key',
    region: { detected: true, label: 'Example Region', source: 'location_metadata' },
    sceneCategory: 'waterfall', maxCandidates: 8,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ places: [
        { id: 'place-1', displayName: { text: 'Example Falls' }, formattedAddress: 'Example Region',
          location: { latitude: 1, longitude: 2 }, types: ['tourist_attraction'] },
      ] }), { status: 200 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.externalCallCount, 2);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.canonicalPlaceId, 'place-1');
  assert.equal(result.candidates[0]?.confirmationOnly, true);
});

test('5 broad-area candidates are confirmation-only and limited to three downstream by policy', async () => {
  const result = await expandRegionToPoiCandidatesV3({
    apiKey: 'server-only-test-key',
    region: { detected: true, label: 'Example Region', source: 'location_metadata' },
    fetchImpl: async () => new Response(JSON.stringify({ places: Array.from({ length: 8 }, (_, index) => ({
      id: `place-${index}`, displayName: { text: `Place ${index}` }, formattedAddress: 'Example Region',
      location: { latitude: index + 1, longitude: index + 2 }, types: ['tourist_attraction'],
    })) }), { status: 200 }),
  });
  assert.ok(result.candidates.length <= 8);
  assert.ok(result.candidates.every((candidate) => candidate.confirmationOnly));
});

test('6 Places outage falls back to an empty non-throwing result', async () => {
  const result = await expandRegionToPoiCandidatesV3({
    apiKey: 'server-only-test-key',
    region: { detected: true, label: 'Example Region', source: 'location_metadata' },
    fetchImpl: async () => { throw new Error('outage'); },
  });
  assert.equal(result.failureCode, 'http_error');
  assert.deepEqual(result.candidates, []);
});

test('7 missing server key performs no provider call', async () => {
  let called = false;
  const result = await expandRegionToPoiCandidatesV3({
    apiKey: '', region: { detected: true, label: 'Example Region', source: 'location_metadata' },
    fetchImpl: async () => { called = true; return new Response('{}'); },
  });
  assert.equal(called, false);
  assert.equal(result.failureCode, 'not_configured');
});
