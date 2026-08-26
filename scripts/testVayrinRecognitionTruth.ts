import assert from 'node:assert/strict';

import { canonicalContentIdentity, RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';
import {
  candidatePoiCategory,
  semanticAutoSaveDecision,
  semanticCategoryCompatibility,
} from '../lib/recognitionTruth';
import {
  recognitionCacheDecisionForUser,
  type RecognitionCacheRow,
  type RecognitionRejection,
} from '../supabase/functions/process-share-jobs/recognitionCache';
import { evaluateMediaAutoSave } from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';
import { evaluateMetadataAutoSave } from '../supabase/functions/process-share-jobs/metadataAutoSaveGate';
import type { VenueMention } from '../supabase/functions/process-share-jobs/mediaMentions';
import type { MentionResult } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';

let count = 0;
function test(name: string, run: () => void): void {
  run();
  count += 1;
  console.log(`PASS ${count}. ${name}`);
}

function compatibility(scene: string | null, candidate: string, confidence = 0.92) {
  return semanticCategoryCompatibility({
    sceneCategory: scene,
    sceneConfidence: confidence,
    categoryEvidenceTags: scene ? ['structured_scene_category'] : [],
    candidateCategory: candidate,
  });
}

function mention(over: Partial<VenueMention> = {}): VenueMention {
  return {
    id: 'm1', displayName: 'Upper McCloud Falls', normalizedName: 'upper mccloud falls',
    distinctiveTokens: ['upper', 'mccloud', 'falls'], category: 'waterfall',
    categoryConfidence: 0.92, categoryEvidenceTags: ['cliff_jumping', 'turquoise_river', 'waterfall'],
    sources: ['frame'], nameEvidenceSources: ['frame'], timestamps: [4], mentionCount: 1,
    repeated: false, confidence: 0.8, geo: { city: 'McCloud', region: 'California', country: 'USA' },
    ...over,
  };
}

function result(primaryType = 'restaurant', over: Partial<MentionResult> = {}): MentionResult {
  const candidate: any = {
    googlePlaceId: 'bad-restaurant', name: 'Upper McCloud Falls',
    formattedAddress: '44 E Camperdown Way, Greenville, SC', latitude: 34.85, longitude: -82.4,
    primaryType, types: [primaryType], businessStatus: 'OPERATIONAL',
  };
  return {
    mentionId: 'm1', displayName: 'Upper McCloud Falls', outcome: 'verified_single', query: 'Upper McCloud Falls',
    candidates: [candidate],
    scoring: [{
      googlePlaceId: candidate.googlePlaceId, name: candidate.name, rawScore: 95,
      normalizedScore: 0.95, reasons: ['compact_name_match', 'distinctive_token_match'],
      rejected: false, rejectionReason: null,
    }],
    ...over,
  };
}

const identity = canonicalContentIdentity('https://www.instagram.com/reel/DcaQb2kM9hO/?igsi=NTc4MTIwNjQ2YQ==')!;
const cacheRow: RecognitionCacheRow = {
  id: 'cache-1', identity_key: identity.key, platform: 'instagram', content_id: identity.contentId,
  canonical_url: identity.canonicalUrl, identity_version: identity.identityVersion,
  recognition_version: RECOGNITION_VERSION, result_type: 'verified_place',
  trust_level: 'VERIFIED_AUTO_SAVE', canonical_place_id: 'place-x',
  candidate_payload: { candidates: [
    { googlePlaceId: 'google-x', name: 'Wrong X' },
    { googlePlaceId: 'google-y', name: 'Alternate Y' },
  ], partial: { category: 'waterfall', region: 'Northern California' } },
  evidence_summary: { sceneCategory: 'waterfall', activity: 'cliff_jumping' },
  invalidated_at: null, confirmed_at: null,
};
const rejection: RecognitionRejection = {
  user_id: 'user-a', identity_key: identity.key, canonical_place_id: 'place-x',
  google_place_id: 'google-x', rejected_at: '2026-08-25T01:00:00Z',
};

test('cliff-jumping video + restaurant candidate -> no weak autosave', () => {
  const r = result();
  const decision = evaluateMediaAutoSave({ mention: mention(), result: r, allResults: [r] });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reasonCodes[0], 'candidate_semantic_mismatch');
});
test('cliff-jumping + park -> compatible', () => assert.equal(compatibility('scenic_spot', 'park').verdict, 'SUPPORTS'));
test('cliff-jumping + swimming hole -> compatible', () => assert.equal(compatibility('scenic_spot', 'sports').verdict, 'SUPPORTS'));
test('food video + restaurant -> compatible', () => assert.equal(compatibility('restaurant', 'restaurant').verdict, 'SUPPORTS'));
test('explicit restaurant tag with independent caption identity overrides a mismatch', () => {
  const d = semanticAutoSaveDecision({
    compatibility: compatibility('scenic_spot', 'restaurant'),
    identityEvidence: { structuredLocationTagExactName: true, explicitCaptionExactName: true },
  });
  assert.deepEqual(d, { allowed: true, overridden: true, reason: 'strong_identity_override' });
});
test('singleton does not bypass semantic gate', () => {
  const r = result();
  assert.equal(r.candidates.length, 1);
  assert.equal(evaluateMediaAutoSave({ mention: mention(), result: r, allResults: [r] }).eligible, false);
});
test('V3-style affirmative CONTRADICTS blocks autosave', () => {
  assert.deepEqual(semanticAutoSaveDecision({
    compatibility: compatibility('waterfall', 'restaurant'), identityEvidence: {},
  }), { allowed: false, overridden: false, reason: 'candidate_semantic_mismatch' });
});
test('UNKNOWN does not become contradiction automatically', () => assert.equal(compatibility(null, 'restaurant').verdict, 'UNKNOWN'));
test('user rejects auto-saved X', () => assert.equal(recognitionCacheDecisionForUser(cacheRow, [rejection]).kind, 'disputed'));
test('same-content cache hit cannot autosave rejected X', () => {
  const d = recognitionCacheDecisionForUser(cacheRow, [rejection]);
  assert.notEqual(d.kind, 'trusted_place');
});
test('cache computation evidence remains reusable', () => {
  const d = recognitionCacheDecisionForUser(cacheRow, [rejection]);
  assert.equal(d.kind === 'disputed' && d.reusableEvidence, true);
});
test('user-confirmed truth still works', () => {
  assert.equal(recognitionCacheDecisionForUser({ ...cacheRow, trust_level: 'USER_CONFIRMED', confirmed_at: '2026-08-26T01:00:00Z' }, [rejection]).kind, 'trusted_place');
});
test('rejection is user-scoped', () => assert.equal(recognitionCacheDecisionForUser(cacheRow, []).kind, 'trusted_place'));
test('one user rejection does not globally delete truth', () => {
  assert.equal(cacheRow.canonical_place_id, 'place-x');
  assert.equal(recognitionCacheDecisionForUser(cacheRow, []).kind, 'trusted_place');
});
test('alternate candidate replaces rejected X in disputed presentation', () => {
  const d = recognitionCacheDecisionForUser(cacheRow, [rejection]);
  assert.equal(d.kind, 'disputed');
  assert.deepEqual((d.candidatePayload as any).candidates.map((c: any) => c.googlePlaceId), ['google-y']);
});
test('no alternatives retains useful partial evidence for fallback', () => {
  const d = recognitionCacheDecisionForUser({
    ...cacheRow, candidate_payload: { candidates: [{ googlePlaceId: 'google-x' }], partial: { category: 'waterfall', region: 'Northern California' } },
  }, [rejection]);
  assert.equal(d.kind, 'disputed');
  assert.deepEqual((d.candidatePayload as any).partial, { category: 'waterfall', region: 'Northern California' });
});
test('content identity variants do not collide with another reel', () => {
  assert.equal(identity.key, 'v1:instagram:DcaQb2kM9hO');
  assert.notEqual(identity.key, canonicalContentIdentity('https://instagram.com/reel/Another123/')!.key);
});
test('source identity is preserved and tracking is stripped', () => {
  assert.equal(identity.canonicalUrl, 'https://www.instagram.com/reel/DcaQb2kM9hO/');
  assert.equal(identity.contentId, 'DcaQb2kM9hO');
});
test('mixed-scene hotel/resort uses dominant structured category', () => {
  const d = semanticCategoryCompatibility({ sceneCategory: 'resort', sceneConfidence: 0.91,
    categoryEvidenceTags: ['pool', 'cliff', 'restaurant', 'room', 'overall_resort'], candidateCategory: 'hotel' });
  assert.equal(d.verdict, 'SUPPORTS');
});
test('correct exact restaurant singleton still autosaves', () => {
  const r = result('restaurant');
  r.candidates[0]!.googlePlaceId = 'exact-restaurant';
  r.candidates[0]!.name = 'Parlor Woodfire';
  r.scoring[0]!.googlePlaceId = 'exact-restaurant';
  r.scoring[0]!.name = 'Parlor Woodfire';
  const m = mention({ displayName: 'Parlor Woodfire', normalizedName: 'parlor woodfire',
    distinctiveTokens: ['parlor', 'woodfire'], category: 'restaurant',
    categoryEvidenceTags: ['restaurant_interior', 'food'], sources: ['caption', 'visible_text'],
    nameEvidenceSources: ['caption', 'visible_text'], repeated: true });
  const d = evaluateMediaAutoSave({ mention: m, result: r, allResults: [r] });
  assert.equal(candidatePoiCategory(r.candidates[0]!), 'restaurant');
  assert.equal(d.eligible, true);
});

// Metadata regression for the exact earliest-stage shape: a verified
// name-only Instagram location tag is review/media evidence, never authority.
const metadataIncident = evaluateMetadataAutoSave({
  result: { candidates: [{ googlePlaceId: 'between-trees', name: 'Between the Trees',
    formattedAddress: '44 E Camperdown Way, Greenville, SC', latitude: 34.85, longitude: -82.4,
    primaryType: 'restaurant', types: ['restaurant'], confidenceScore: 0.94,
    reasons: ['business_type', 'compact_name_match', 'tagged_location_verified'] }] },
  evidence: { taggedLocation: { placeName: 'Between the Trees', provenance: 'instagram_location_tag' },
    venueNameHints: ['Between the Trees'] },
});
assert.equal(metadataIncident.eligible, false);
assert.ok(metadataIncident.explicitConflictFlags.includes('tagged_location_requires_media_verification'));

assert.equal(count, 20);
console.log('PASS exact incident metadata replay: restaurant remains confirmation/media-only');
console.log('PASS Vayrin recognition truth suite (20/20)');
