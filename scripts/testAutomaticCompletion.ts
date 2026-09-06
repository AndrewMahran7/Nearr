import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isDefensibleSpecificCandidate,
  nativeNearrPlaceId,
  planAutomaticCompletion,
  transitionSoftAlternative,
} from '../lib/automaticCompletion';
import { routeShareJobNotification } from '../lib/shareJobRouting';
import { composeShareCompletionNotification } from '../supabase/functions/process-share-jobs/shareCompletionNotification';
import { evaluateMetadataAutoSave } from '../supabase/functions/process-share-jobs/metadataAutoSaveGate';

const root = path.resolve(__dirname, '..');
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const candidate = (id: string, score = 0.5, over: Record<string, unknown> = {}) => ({
  googlePlaceId: id,
  name: `Place ${id}`,
  formattedAddress: '1 Main St, Los Angeles, CA',
  latitude: 34.05,
  longitude: -118.24,
  types: ['restaurant'],
  matchScore: score,
  reasons: ['meaningful_name_match'],
  ...over,
});

const one = planAutomaticCompletion([candidate('a')]);
assert.equal(one.action, 'save'); // 1
assert.equal(one.action === 'save' && one.primary.googlePlaceId, 'a'); // 2 low/medium confidence still saves
const three = planAutomaticCompletion([candidate('a', .4), candidate('b', .35), candidate('c', .25)]);
assert.equal(three.action === 'save' && three.alternatives.length, 2); // 3
assert.deepEqual(three.action === 'save' && three.alternatives.map((c) => c.googlePlaceId), ['b', 'c']); // 4
assert.equal(planAutomaticCompletion([candidate('city', .9, { types: ['locality'] })]).action, 'escalate'); // 5 broad
assert.equal(planAutomaticCompletion([candidate('generic', .9, { reasons: ['category_only_candidate'] })]).action, 'escalate'); // 6 generic
assert.equal(isDefensibleSpecificCandidate(candidate('restaurant', .9, { reasons: ['candidate_semantic_mismatch'] })), false); // 7 restaurant/park
assert.equal(isDefensibleSpecificCandidate(candidate('cliff-food', .9, { reasons: ['semantic_contradiction'] })), false); // 8 cliff/restaurant
assert.equal(nativeNearrPlaceId('Waimea Bay Jump Rock', 21.6401, -158.065).startsWith('nearr-native:waimea-bay-jump-rock:'), true); // 9
assert.equal(transitionSoftAlternative('secondary_soft_saved', 'promote'), 'secondary_promoted'); // 10
assert.equal(transitionSoftAlternative('secondary_soft_saved', 'remove'), 'secondary_removed'); // 11
assert.equal(transitionSoftAlternative('secondary_promoted', 'remove'), 'secondary_promoted'); // 12 durable terminal state

const metadata = evaluateMetadataAutoSave({
  result: { candidates: [candidate('a', .4), candidate('b', .35), candidate('c', .25)] },
  evidence: { venueNameHints: ['Place a'] },
});
assert.equal(metadata.eligible, true); // 13
assert.equal(metadata.selectedProviderId, 'a'); // 14

for (const searchSuggestion of ['Lake Sorapis', 'Kuzdere Kanyonu']) {
  const resolved = evaluateMetadataAutoSave({
    result: { candidates: [candidate(`provider-${searchSuggestion}`, .41, { name: searchSuggestion })] },
    evidence: { venueNameHints: [searchSuggestion] },
  });
  assert.equal(resolved.eligible, true);
  assert.equal(resolved.selectedProviderId, `provider-${searchSuggestion}`);
}

const notification = composeShareCompletionNotification({
  jobId: 'job-1', status: 'completed', placeName: 'Pont du Diable',
  savedPlaceId: 'saved-1', googlePlaceId: 'google-1', alternativeCount: 2,
});
assert.equal(notification.title, 'Saved Pont du Diable to your map'); // 15
assert.equal(notification.data.alternativeCount, 2); // 16
assert.deepEqual(routeShareJobNotification(notification.data), { kind: 'queue_item', jobId: 'job-1' }); // 17
const singleNotification = composeShareCompletionNotification({
  jobId: 'job-2', status: 'completed', placeName: 'Lake Sorapis',
  savedPlaceId: 'saved-2', googlePlaceId: 'google-2', alternativeCount: 0,
});
assert.deepEqual(routeShareJobNotification(singleNotification.data), {
  kind: 'saved_place', savedPlaceId: 'saved-2', googlePlaceId: 'google-2',
}); // 18

const worker = source('supabase/functions/process-share-jobs/index.ts');
const migration = source('supabase/migrations/20260906000001_automatic_completion_soft_alternatives.sql');
const detail = source('app/share-jobs/[jobId].tsx');
const queue = source('app/share-jobs/index.tsx');
assert.match(worker, /automaticDeepCandidates[\s\S]*nativeNearrPlaceId/); // 19 named lead native save
assert.match(worker, /status: 'completed'[\s\S]*automatic_deep_auto_completion/); // 20 no Search task
assert.match(migration, /secondary_soft_saved/); // 21 durable soft state
assert.match(migration, /promote_share_job_soft_alternative/); // 22 promote
assert.match(migration, /remove_share_job_soft_alternative/); // 23 remove
assert.match(migration, /primary_replaced/); // 24 replace
assert.match(detail, /Keep \/ Save/); // 25 optional keep
assert.match(detail, /Make primary/); // 26 correction
assert.match(detail, /View original post/); // 27 source relationship UI
assert.doesNotMatch(queue, /renderSection\('Needs you'/); // 28
assert.doesNotMatch(queue, /return 'Search needed'/); // 29
assert.match(worker, /__skipPremiumEligibility: true/); // 30 Automatic Deep does not touch Premium
assert.match(source('services/media-worker/src/pipeline/runMediaTask.ts'), /totalModelCostUsd/); // 31 cost telemetry
assert.match(migration, /total_inference_latency_ms/); // 32 latency telemetry
assert.match(source('services/media-worker/src/prompts/placeEvidencePrompt.ts'), /TOP-1 PLAUSIBILITY/); // 33 ranking prompt
assert.match(worker, /legacyMediaCompletion/); // 34 easy Gemini completion path
assert.match(worker, /automaticDeepRecognition/); // 35 hard Sol path remains
assert.match(source('supabase/functions/process-share-link/save.ts'), /SAVE_DEDUPE_DISTANCE_M/); // 36 dedupe preserved
assert.match(worker, /mentionResults\.length > 0/); // 37 multi-place path preserved
assert.match(migration, /candidate_snapshot jsonb/); // 38 unreviewed alternatives persist
assert.match(worker, /caption: sourceMetadata\?\.description/); // 39 source metadata preserved
assert.match(source('services/media-worker/src/premium/premiumCanonicalization.ts'), /providerParent/); // 40 parent remains metadata

console.log('PASS automatic completion contract (44 assertions)');
