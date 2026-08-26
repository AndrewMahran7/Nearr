import assert from 'node:assert/strict';

import { RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';
import { buildShareJobCandidatePayload } from '../lib/shareJobResult';
import {
  mediaEvidenceAutoSaveEligible,
  type MediaPlaceEvidence,
} from '../supabase/functions/process-share-jobs/mediaEvidence';
import { buildVenueMentions } from '../supabase/functions/process-share-jobs/mediaMentions';
import {
  recognitionCacheDecision,
  type RecognitionCacheRow,
} from '../supabase/functions/process-share-jobs/recognitionCache';

const consolidatedCenote: MediaPlaceEvidence = {
  places: [{
    logicalPlaceId: 'logical-place-1',
    identityEvidenceKind: 'observable',
    hypothesisRank: 0,
    name: 'Cenote 7 Bocas',
    category: 'attraction',
    categoryConfidence: 0.91,
    categoryEvidenceTags: ['natural_water', 'visible_sign'],
    address: null,
    city: 'Puerto Morelos',
    region: 'Quintana Roo',
    country: 'Mexico',
    coordinates: null,
    role: 'primary',
    confidence: 0.92,
    explicitEvidence: [
      { source: 'frame', value: 'Cenote limestone pool and zipline', timestampSeconds: 0 },
      { source: 'frame', value: 'Cenote limestone pool and zipline', timestampSeconds: 1 },
      { source: 'frame', value: 'Underground cenote with bats', timestampSeconds: 10 },
      { source: 'frame', value: 'Underground cave and wood stairs', timestampSeconds: 11 },
      { source: 'visible_text', value: 'CENOTE 7 BOCAS', timestampSeconds: 12 },
    ],
    inferredEvidence: [],
    memoryCue: 'Zipline into the cenote and underground caves',
    memoryCueEvidence: [],
  }],
  partialPlaces: [],
  multipleIntentionalPlaces: false,
  insufficientEvidence: false,
  warnings: ['same_place_moments_consolidated'],
};

const built = buildVenueMentions(consolidatedCenote);
assert.equal(built.mentions.length, 1, 'three visual moments become one resolver slot');
assert.equal(built.mentions[0]!.displayName, 'Cenote 7 Bocas');
assert.deepEqual(built.mentions[0]!.timestamps, [0, 1, 10, 11, 12]);
assert.deepEqual(new Set(built.mentions[0]!.sources), new Set(['frame', 'visible_text']));

let resolverCalls = 0;
const resolved = built.mentions.map((mention) => {
  resolverCalls += 1;
  return {
    mentionId: mention.id,
    displayName: mention.displayName,
    outcome: 'verified_single',
    sourceTimestamps: mention.timestamps,
    candidates: [{
      googlePlaceId: 'ChIJs9lnx0plTo8RWUUKvVa1nt4',
      name: 'Cenote Siete Bocas',
      formattedAddress: 'Quintana Roo, Mexico',
      latitude: 20.918,
      longitude: -86.999,
      types: ['tourist_attraction'],
      matchScore: 0.91,
    }],
  };
});
assert.equal(resolverCalls, 1, 'consolidation does not fan out duplicate Places searches');

const payload = buildShareJobCandidatePayload(
  resolved.flatMap((result) => result.candidates),
  resolved,
);
assert.equal(payload.selectionMode, 'single_identity');
assert.equal(payload.mentionSlots.length, 1);
assert.equal(payload.mentionSlots[0]!.candidates[0]!.googlePlaceId, 'ChIJs9lnx0plTo8RWUUKvVa1nt4');
assert.deepEqual(payload.mentionSlots[0]!.sourceTimestamps, [0, 1, 10, 11, 12]);

const twoPlacePayload = buildShareJobCandidatePayload([], [
  { mentionId: 'm1', displayName: 'Cobalt Kitchen', outcome: 'no_match', candidates: [] },
  { mentionId: 'm2', displayName: 'Moonrise Beach', outcome: 'no_match', candidates: [] },
]);
assert.equal(twoPlacePayload.selectionMode, 'multi_independent');
assert.equal(twoPlacePayload.mentionSlots.length, 2);

assert.equal(mediaEvidenceAutoSaveEligible(consolidatedCenote), false,
  'a grouped natural venue without explicit city+region text remains review-only');

const oldRow = (trust: RecognitionCacheRow['trust_level']): RecognitionCacheRow => ({
  id: 'cache-cenote',
  identity_key: 'v1:instagram:DcetoQJxbt-',
  platform: 'instagram',
  content_id: 'DcetoQJxbt-',
  canonical_url: 'https://www.instagram.com/reel/DcetoQJxbt-/',
  identity_version: 1,
  recognition_version: 'vayrin-recognition-2026-08-25.v2',
  result_type: trust === 'CANDIDATE_SET' ? 'candidate_set' : 'verified_place',
  trust_level: trust,
  canonical_place_id: trust === 'CANDIDATE_SET' ? null : 'place-confirmed',
  candidate_payload: trust === 'CANDIDATE_SET' ? { mentionSlots: [{ mentionId: 'm1' }] } : null,
  invalidated_at: null,
});
assert.equal(recognitionCacheDecision(oldRow('CANDIDATE_SET')).kind, 'miss',
  'old machine candidate sets recompute after grouping-version bump');
assert.equal(recognitionCacheDecision(oldRow('VERIFIED_AUTO_SAVE')).kind, 'miss');
assert.equal(recognitionCacheDecision(oldRow('USER_CONFIRMED')).kind, 'trusted_place',
  'human-confirmed truth survives recognition-version changes');
assert.match(RECOGNITION_VERSION, /same-place-groups/);

console.log('PASS Vayrin same-place moment consolidation boundary');
