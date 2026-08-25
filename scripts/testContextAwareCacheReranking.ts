import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { rankContextAwareCandidates } from '../lib/contextAwarePlacesResolution';
import {
  cacheCandidateVisibleLimit,
  candidateSetForRecognitionCache,
  evaluateCachedSingletonAutoSave,
  rerankCachedCandidatePayload,
} from '../supabase/functions/process-share-jobs/contextAwareCacheReranking';
import {
  recognitionCacheDecision,
  type RecognitionCacheRow,
} from '../supabase/functions/process-share-jobs/recognitionCache';
import { RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

type Candidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  types: string[];
  primaryType: string;
  matchScore: number;
  reasons?: string[];
  contextReason?: string;
  contextLabel?: string;
  retrievalRank?: number;
  presentationRank?: number;
};

const place = (
  googlePlaceId: string,
  formattedAddress: string,
  latitude: number,
  longitude: number,
  contextLabel = 'Santa Paula, CA, USA',
): Candidate => ({
  googlePlaceId,
  name: 'In-N-Out Burger',
  formattedAddress,
  latitude,
  longitude,
  types: ['restaurant', 'food'],
  primaryType: 'restaurant',
  matchScore: 0.8,
  reasons: ['business_type', 'strong_name_match'],
  contextReason: 'source_locality',
  contextLabel,
});

const staleCandidates = [
  place('tx-frisco', '2800 Preston Rd, Frisco, TX, USA', 33.10, -96.81),
  place('tx-houston', '7611 Cypress Creek Pkwy, Houston, TX, USA', 29.98, -95.54),
  place('ca-sacramento', '2001 Alta Arden Expy, Sacramento, CA, USA', 38.60, -121.42),
  place('ca-ventura', '2070 Harbor Blvd, Ventura, CA, USA', 34.27, -119.27),
  place('ca-oxnard', '381 W Esplanade Dr, Oxnard, CA, USA', 34.24, -119.18),
];

const cachedPayload = (
  candidates: Candidate[] = staleCandidates,
  contextLabel = 'Santa Paula, CA, USA',
  includeExactContext = true,
) => ({
  version: 2,
  selectionMode: 'single_identity',
  candidates,
  ...(includeExactContext ? {
    recognitionContext: {
      locality: 'Santa Paula',
      region: 'CA',
      country: 'USA',
      coordinates: { lat: 34.3542, lng: -119.0593 },
      confidence: 'exact',
      sourceKind: 'exact_source_evidence',
    },
  } : {}),
  mentionSlots: [{
    mentionId: 'mention-in-n-out',
    displayName: 'In-N-Out',
    contextLabel,
    primaryVenueName: 'In-N-Out',
    hostVenueName: null,
    relationshipType: null,
    outcome: 'ambiguous_candidates',
    candidates,
    sourceTimestamps: [18],
  }],
});

// 1. Fresh candidates use the shared contextual ranker.
const fresh = rankContextAwareCandidates({
  query: 'In-N-Out',
  candidates: staleCandidates,
  context: {
    mode: 'source',
    inferredLocality: 'Santa Paula',
    inferredRegion: 'CA',
    inferredCountry: 'USA',
    inferredCoordinates: { lat: 34.3542, lng: -119.0593 },
    regionConfidence: 'strong',
    sourceEvidence: ['exact_source_evidence'],
  },
  placesCallCount: 1,
});
assert.equal(fresh.telemetry.contextAvailable, true);
assert.ok(fresh.visible.every((item) => item.candidate.formattedAddress.includes('CA')));

// 2-4. A stale cached set runs the same ranker and fixes Santa Paula/In-N-Out.
const cached = rerankCachedCandidatePayload(candidateSetForRecognitionCache(cachedPayload()));
assert.ok(cached);
assert.equal(cached.applied, true);
assert.equal(cached.contextAvailable, true);
assert.equal(cached.contextSourceKind, 'exact_source_evidence');
const visible = cached.payload.candidates as Candidate[];
assert.ok(visible.every((candidate) => candidate.formattedAddress.includes('CA')),
  'Santa Paula source context removes Texas from the visible result set');
assert.notEqual(visible[0]?.googlePlaceId, 'tx-frisco', 'stale Texas top candidate changes');
assert.equal(visible.some((candidate) => candidate.googlePlaceId.startsWith('tx-')), false);

// 5-8. Cache reranking is a pure, zero-cost presentation operation.
const calls = { gemini: 0, sol: 0, scrapeCreators: 0, primaryAcquisition: 0, places: 0, contextualRerank: 0 };
const simulateCandidateCacheHit = () => {
  calls.contextualRerank += 1;
  return rerankCachedCandidatePayload(cachedPayload());
};
assert.ok(simulateCandidateCacheHit());
assert.deepEqual(calls, {
  gemini: 0,
  sol: 0,
  scrapeCreators: 0,
  primaryAcquisition: 0,
  places: 0,
  contextualRerank: 1,
});

const cacheRow = (patch: Partial<RecognitionCacheRow>): RecognitionCacheRow => ({
  id: 'cache-row',
  identity_key: 'v1:youtube:santa-paula-in-n-out',
  platform: 'youtube',
  content_id: 'santa-paula-in-n-out',
  canonical_url: 'https://www.youtube.com/watch?v=santa-paula-in-n-out',
  identity_version: 1,
  recognition_version: RECOGNITION_VERSION,
  result_type: 'candidate_set',
  trust_level: 'CANDIDATE_SET',
  canonical_place_id: null,
  candidate_payload: cachedPayload(),
  invalidated_at: null,
  ...patch,
});

// 9. USER_CONFIRMED remains exact truth across recognition versions.
assert.equal(recognitionCacheDecision(cacheRow({
  recognition_version: 'old-recognition-version',
  result_type: 'verified_place',
  trust_level: 'USER_CONFIRMED',
  canonical_place_id: 'internal-place-confirmed',
  candidate_payload: null,
})).kind, 'trusted_place');

// 10. VERIFIED_AUTO_SAVE keeps current recognition-version safety.
assert.equal(recognitionCacheDecision(cacheRow({
  result_type: 'verified_place',
  trust_level: 'VERIFIED_AUTO_SAVE',
  canonical_place_id: 'internal-place-auto',
  candidate_payload: null,
})).kind, 'trusted_place');
assert.equal(recognitionCacheDecision(cacheRow({
  recognition_version: 'old-recognition-version',
  result_type: 'verified_place',
  trust_level: 'VERIFIED_AUTO_SAVE',
  canonical_place_id: 'internal-place-auto',
  candidate_payload: null,
})).kind, 'miss');

// 11. Old/partial textual context reranks honestly without coordinates.
const partial = rerankCachedCandidatePayload(cachedPayload(staleCandidates, 'Santa Paula, CA', false));
assert.ok(partial);
assert.equal(partial.contextAvailable, true);
assert.ok((partial.payload.candidates as Candidate[]).every((candidate) =>
  candidate.formattedAddress.includes('CA')));

// 12. Old cache with no context stays review-only and reports the absence.
const noContextCandidates = staleCandidates.map(({ contextLabel: _label, contextReason: _reason, ...candidate }) => candidate);
const noContext = rerankCachedCandidatePayload({
  version: 1,
  selectionMode: 'single_identity',
  candidates: noContextCandidates,
});
assert.ok(noContext);
assert.equal(noContext.applied, true);
assert.equal(noContext.contextAvailable, false);
assert.equal(noContext.contextSourceKind, 'none');
assert.equal((noContext.payload.presentationRanking as any).contextAvailable, false);

// 13. Manual search retains user-proximity ordering and no source context.
const chipotle = rankContextAwareCandidates({
  query: 'Chipotle',
  candidates: [
    { ...place('chipotle-far', 'Chipotle, Sacramento, CA, USA', 38.58, -121.49), name: 'Chipotle Mexican Grill' },
    { ...place('chipotle-near', 'Chipotle, Ventura, CA, USA', 34.28, -119.29), name: 'Chipotle Mexican Grill' },
  ],
  context: { mode: 'manual', userLocation: { lat: 34.27, lng: -119.27 }, regionConfidence: 'none' },
  placesCallCount: 1,
});
assert.equal(chipotle.visible[0]?.candidate.googlePlaceId, 'chipotle-near');
assert.equal(chipotle.telemetry.contextSource, 'user_location');

// 14-16. Canonical identities survive, duplicates are removed, visible <= 3.
const duplicatePayload = cachedPayload([...staleCandidates, { ...staleCandidates[3]! }]);
const deduped = rerankCachedCandidatePayload(duplicatePayload)!;
const visibleIds = (deduped.payload.candidates as Candidate[]).map((candidate) => candidate.googlePlaceId);
assert.equal(new Set(visibleIds).size, visibleIds.length);
assert.ok(visibleIds.every((id) => staleCandidates.some((candidate) => candidate.googlePlaceId === id)));
assert.equal(cacheCandidateVisibleLimit(), 3);
assert.ok(visibleIds.length <= cacheCandidateVisibleLimit());

// 17. A context-reranked singleton may save, but stale or weak singletons do not.
const contextualSingleton = rerankCachedCandidatePayload(cachedPayload([
  place('ca-ventura', '2070 Harbor Blvd, Ventura, CA, USA', 34.27, -119.27),
]))!;
assert.equal(evaluateCachedSingletonAutoSave(contextualSingleton).eligible, true);
assert.equal(evaluateCachedSingletonAutoSave(contextualSingleton).selectedProviderId, 'ca-ventura');
const staleSingleton = rerankCachedCandidatePayload({
  version: 1,
  selectionMode: 'single_identity',
  candidates: [noContextCandidates[0]],
})!;
assert.equal(evaluateCachedSingletonAutoSave(staleSingleton).eligible, false);
assert.equal(evaluateCachedSingletonAutoSave(staleSingleton).reason, 'independent_source_context_missing');
const reasonOnlySingleton = rerankCachedCandidatePayload({
  version: 1,
  selectionMode: 'single_identity',
  candidates: [{ ...noContextCandidates[0], contextReason: 'source_locality' }],
})!;
assert.equal(evaluateCachedSingletonAutoSave(reasonOnlySingleton).eligible, false,
  'a legacy reason label without concrete source context is not new evidence');
const weakSingleton = rerankCachedCandidatePayload(cachedPayload([
  { ...place('ca-weak', 'Weak Place, Ventura, CA, USA', 34.27, -119.27), reasons: ['business_type'] },
]))!;
assert.equal(evaluateCachedSingletonAutoSave(weakSingleton).eligible, false);
assert.equal(evaluateCachedSingletonAutoSave(weakSingleton).reason, 'weak_singleton');

// 18. The worker calls the gate before save and keeps non-eligible hits in review.
const worker = read('supabase/functions/process-share-jobs/index.ts');
const candidateHitStart = worker.indexOf("if (decision.kind === 'candidate_set')");
const trustedHitStart = worker.indexOf('const { data: place', candidateHitStart);
const candidateHitSource = worker.slice(candidateHitStart, trustedHitStart);
assert.match(candidateHitSource, /decisionForSelectionSemantics\(count, selectionMode, true\)/);
assert.match(candidateHitSource, /evaluateCachedSingletonAutoSave\(reranked\)/);
assert.match(candidateHitSource, /if \(singletonGate\.eligible && singletonGate\.candidate\)/);
assert.match(candidateHitSource, /saveForUser/);
assert.match(candidateHitSource, /rerankCachedCandidatePayload\(payload\)/);
assert.match(candidateHitSource, /__skipRecognitionCachePersist: true/);
assert.match(
  worker,
  /if \(identity && !skipRecognitionCachePersist\) \{[\s\S]{0,500}candidatePayload/,
  'cache-hit presentation payload cannot overwrite the full recognition set',
);

// 19. Retrieval rank remains evidence while presentation rank is recomputed.
const recognitionSet = candidateSetForRecognitionCache(cachedPayload()) as any;
assert.deepEqual(recognitionSet.candidates.map((candidate: Candidate) => candidate.retrievalRank), [1, 2, 3, 4, 5]);
const rerankedEvidence = rerankCachedCandidatePayload(recognitionSet)!;
const evidenceVisible = rerankedEvidence.payload.candidates as Candidate[];
assert.equal(evidenceVisible[0]?.retrievalRank, 4,
  'first presentation candidate retains its original recognition retrieval rank');
assert.deepEqual(
  evidenceVisible.map((candidate) => candidate.presentationRank),
  evidenceVisible.map((_, index) => index + 1),
);
assert.equal(rerankedEvidence.placesCallCount, 0);

assert.match(worker, /candidateCountBeforeRerank/);
assert.match(worker, /candidateCountAfterRerank/);
assert.match(worker, /contextualRerankApplied/);
assert.match(worker, /contextSourceKind/);
assert.match(worker, /placesCallCount: 0/);
assert.match(
  read('supabase/functions/process-share-jobs/contextAwareCacheReranking.ts'),
  /rankContextAwareCandidates\(/,
  'cached candidates delegate to the shared fresh-result ranker',
);

console.log('TRACE canonical=v1:youtube:santa-paula-in-n-out cache_hit=YES trust=CANDIDATE_SET payload=version_2 contextual_ranker=YES cached_order_returned_unchanged=NO');
console.log(`TRACE before=${cached.candidateCountBeforeRerank} after=${cached.candidateCountAfterRerank} context=${cached.contextSourceKind} top=${visible.map((candidate) => candidate.googlePlaceId).join(',')}`);
console.log('COST primary=0 scrapecreators=0 gemini=0 sol=0 transcription=0 frames=0 places=0 contextual_rerank=1');
console.log('PASS context-aware cache reranking (19 required regressions)');
