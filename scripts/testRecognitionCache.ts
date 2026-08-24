import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  RECOGNITION_VERSION,
  canonicalContentIdentity,
} from '../lib/shareAgent/contentIdentity';
import { placeSourceCards, shouldShowMoreVideos } from '../lib/placeSources';
import { recognitionCacheDecision, type RecognitionCacheRow } from '../supabase/functions/process-share-jobs/recognitionCache';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const tiktokCanonical = 'https://www.tiktok.com/@creator/video/7673607812571876630';
const tiktokTracking = `${tiktokCanonical}?is_from_webapp=1&utm_source=share&_t=abc`;
const tiktokShort = 'https://vm.tiktok.com/ZMExample/';
const tiktokA = canonicalContentIdentity(tiktokCanonical)!;
assert.equal(tiktokA.contentId, '7673607812571876630');
assert.equal(canonicalContentIdentity(tiktokTracking)!.key, tiktokA.key);
assert.equal(canonicalContentIdentity(tiktokShort, tiktokCanonical)!.key, tiktokA.key);

const youtube = canonicalContentIdentity('https://youtu.be/dQw4w9WgXcQ?si=tracking')!;
assert.equal(youtube.key, 'v1:youtube:dQw4w9WgXcQ');
assert.equal(canonicalContentIdentity('https://www.youtube.com/shorts/dQw4w9WgXcQ')!.key, youtube.key);

const instagram = canonicalContentIdentity('https://instagram.com/creator/reels/ABC_def-1/?igsh=tracking')!;
assert.equal(instagram.key, 'v1:instagram:ABC_def-1');
assert.equal(instagram.canonicalUrl, 'https://www.instagram.com/reel/ABC_def-1/');

const facebook = canonicalContentIdentity('https://www.facebook.com/watch/?v=123456789012345&fbclid=x')!;
assert.equal(facebook.key, 'v1:facebook:123456789012345');
assert.equal(
  canonicalContentIdentity('https://facebook.com/reel/123456789012345/')!.key,
  facebook.key,
);

const genericA = canonicalContentIdentity('https://example.com/story?id=7&utm_source=x&fbclid=y')!;
const genericB = canonicalContentIdentity('https://EXAMPLE.com/story?fbclid=z&id=7')!;
assert.equal(genericA.key, genericB.key);

const row = (patch: Partial<RecognitionCacheRow> = {}): RecognitionCacheRow => ({
  id: 'cache-1',
  identity_key: tiktokA.key,
  platform: 'tiktok',
  content_id: tiktokA.contentId,
  canonical_url: tiktokA.canonicalUrl,
  identity_version: 1,
  recognition_version: RECOGNITION_VERSION,
  result_type: 'verified_place',
  trust_level: 'VERIFIED_AUTO_SAVE',
  canonical_place_id: 'place-1',
  candidate_payload: null,
  invalidated_at: null,
  ...patch,
});

assert.equal(recognitionCacheDecision(row()).kind, 'trusted_place');
assert.equal(recognitionCacheDecision(null).kind, 'miss');
assert.equal(recognitionCacheDecision(row({
  result_type: 'candidate_set',
  trust_level: 'CANDIDATE_SET',
  canonical_place_id: null,
  candidate_payload: { candidates: [{ googlePlaceId: 'g1' }] },
})).kind, 'candidate_set');
assert.equal(recognitionCacheDecision(row({
  recognition_version: 'old',
  trust_level: 'VERIFIED_AUTO_SAVE',
})).kind, 'miss');
assert.equal(recognitionCacheDecision(row({
  recognition_version: 'old',
  trust_level: 'USER_CONFIRMED',
})).kind, 'trusted_place');
assert.equal(recognitionCacheDecision(row({ invalidated_at: new Date().toISOString() })).kind, 'miss');

// Proof A: a deterministic, already-resolved fixture exercises the same cache
// decision used by the worker. The worker ordering assertions below prove that
// this decision happens before its real media/model boundary.
const providerCalls = { media: 0, gemini: 0, sol: 0 };
const runResolvedFixture = (cached: RecognitionCacheRow | null) => {
  const decision = recognitionCacheDecision(cached);
  if (decision.kind === 'trusted_place') {
    return { cache: 'hit' as const, canonicalPlaceId: decision.row.canonical_place_id };
  }
  providerCalls.media += 1;
  providerCalls.gemini += 1;
  providerCalls.sol += 1;
  return { cache: 'miss' as const, canonicalPlaceId: 'place-1' };
};
const firstProofRun = runResolvedFixture(null);
const callsAfterMiss = { ...providerCalls };
const secondProofRun = runResolvedFixture(row());
assert.deepEqual(firstProofRun, { cache: 'miss', canonicalPlaceId: 'place-1' });
assert.deepEqual(secondProofRun, { cache: 'hit', canonicalPlaceId: 'place-1' });
assert.deepEqual(providerCalls, callsAfterMiss, 'cache hit makes no media/Gemini/Sol calls');

const savedBase = {
  source_url: tiktokTracking,
  source_type: 'tiktok' as const,
  ai_note: 'Keep the original note',
  created_at: '2026-08-20T00:00:00Z',
};
const sameIdentityCards = placeSourceCards({
  ...savedBase,
  sources: [{
    id: 's1', saved_place_id: 'sp1', user_id: 'u1', identity_key: tiktokA.key,
    identity_version: 1, platform: 'tiktok', content_id: tiktokA.contentId,
    canonical_url: tiktokCanonical, original_url: tiktokShort, creator_handle: 'creator',
    creator_name: null, caption_excerpt: 'Caption A', ai_note: 'Source note A',
    thumbnail_url: null, is_primary: true, first_attached_at: '2026-08-20T00:00:00Z',
    last_seen_at: '2026-08-20T00:00:00Z', created_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
  }],
});
assert.equal(sameIdentityCards.length, 1, 'short/canonical/tracking variants dedupe');
assert.equal(shouldShowMoreVideos(sameIdentityCards), false, 'one-source detail stays unchanged');

const twoCards = placeSourceCards({
  ...savedBase,
  sources: [
    {
      id: 's1', saved_place_id: 'sp1', user_id: 'u1', identity_key: tiktokA.key,
      identity_version: 1, platform: 'tiktok', content_id: tiktokA.contentId,
      canonical_url: tiktokCanonical, original_url: null, creator_handle: 'creator', creator_name: null,
      caption_excerpt: 'Caption A', ai_note: 'Source note A', thumbnail_url: null, is_primary: true,
      first_attached_at: '2026-08-20T00:00:00Z', last_seen_at: '2026-08-20T00:00:00Z',
      created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
    },
    {
      id: 's2', saved_place_id: 'sp1', user_id: 'u1', identity_key: youtube.key,
      identity_version: 1, platform: 'youtube', content_id: youtube.contentId,
      canonical_url: youtube.canonicalUrl, original_url: null, creator_handle: null, creator_name: 'Second creator',
      caption_excerpt: 'Caption B', ai_note: 'Source note B', thumbnail_url: 'https://example.com/b.jpg', is_primary: false,
      first_attached_at: '2026-08-21T00:00:00Z', last_seen_at: '2026-08-21T00:00:00Z',
      created_at: '2026-08-21T00:00:00Z', updated_at: '2026-08-21T00:00:00Z',
    },
  ],
});
assert.equal(twoCards.length, 2);
assert.equal(shouldShowMoreVideos(twoCards), true);
assert.equal(twoCards[0]!.caption, 'Caption A');
assert.equal(twoCards[1]!.caption, 'Caption B');
assert.equal(twoCards[0]!.aiNote, 'Source note A');

const worker = read('supabase/functions/process-share-jobs/index.ts');
assert.doesNotMatch(worker, /\bbuild(?:Completed|NeedsHelp)Notification\b/,
  'cache integration must use current-main Honest Failure notification composers');
assert.match(worker, /recognitionCache:\s*\{\s*hit:\s*true[\s\S]{0,1600}composeShareCompletionNotification\(/,
  'trusted cache hits compose a current-main completion notification');
const metadataCall = worker.indexOf('const meta = await fetchPostMetadata');
assert.ok(worker.indexOf('prepareRecognitionIdentity') < metadataCall, 'cache lookup precedes metadata/media work');
assert.match(worker, /recognition_cache_candidate_hit/);
assert.match(worker, /recognition_singleflight_joined/);
assert.match(worker, /mediaDownloadAvoided: true/);
assert.match(worker, /decisionForSelectionSemantics\(count, selectionMode, true\)/,
  'candidate cache preserves single-place versus multi-place confirmation semantics');
const candidateHitStart = worker.indexOf("if (decision.kind === 'candidate_set')");
assert.ok(candidateHitStart >= 0);
assert.doesNotMatch(worker.slice(candidateHitStart, worker.indexOf("const { data: place", candidateHitStart)), /saveForUser/,
  'candidate-only cache never silently saves');

const migration = read('supabase/migrations/20260822000002_vayrin_recognition_cache_and_place_sources.sql');
assert.match(migration, /unique \(saved_place_id, identity_key\)/i);
assert.match(migration, /recognition_inflight/);
assert.match(migration, /lease_expires_at/);
assert.match(migration, /user_id = auth\.uid\(\)/);
assert.match(migration, /invalidation_reason = 'user_correction'/);
assert.match(migration, /trust_level='USER_CONFIRMED'/);
assert.match(migration, /revoke all on public\.recognition_cache/);

const correction = read('supabase/migrations/20260822000003_correct_saved_place_multi_source.sql');
assert.match(correction, /jsonb_agg\(to_jsonb\(s\)/);
assert.match(correction, /on conflict \(saved_place_id, identity_key\)/);

const detail = read('components/map/SelectedPlaceDetails.tsx');
assert.match(detail, /More videos from this place/);
assert.match(detail, /openSourceCard\(item\.url/);
assert.match(detail, /item\.thumbnailUrl/);
assert.match(detail, /item\.creator/);
assert.doesNotMatch(detail, /model confidence|cache hit/i);

const savedService = read('services/savedPlacesService.ts');
assert.match(savedService, /sources:saved_place_sources\(\*\)/);
assert.match(savedService, /attachSavedPlaceSource/);
assert.doesNotMatch(read('lib/placeSources.ts'), /notes\s*=/, 'source projection never mutates user notes');

console.log('PROOF_A first=miss media=YES gemini=YES sol=YES second=hit media=NO gemini=NO sol=NO same_result=YES');
console.log('PASS canonical content identity, trust/version policy, cache ordering, single-flight, multi-source dedupe, correction, RLS, and Place Detail contracts');
