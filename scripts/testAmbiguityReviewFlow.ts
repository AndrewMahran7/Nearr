import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildCandidateReviewSnapshot,
  decisionForPlausibleCandidates,
  mediaFailureReview,
  persistedCandidateCount,
} from '../supabase/functions/process-share-jobs/ambiguityReview';
import { buildNeedsHelpNotification, planFromResolverDecision } from '../supabase/functions/process-share-jobs/decisionMapping';
import { evaluateMetadataAutoSave } from '../supabase/functions/process-share-jobs/metadataAutoSaveGate';
import { routeShareJobNotification } from '../lib/shareJobRouting';
import { actionableCount, normalizeShareJobCandidates } from '../lib/shareJobsUi';
import { SHARE_REGRESSION_FIXTURES } from './shareRegressionFixtures';

const exactCandidates = [
  {
    googlePlaceId: 'ChIJ-93O_bZkWyoRWSPSBABfQR0',
    name: 'Hellfire Bay',
    formattedAddress: 'Cape Le Grand National Park, Road, Cape Le Grand WA 6450, Australia',
    latitude: -34.0034813,
    longitude: 122.1690916,
    confidenceScore: 0.9426758241011313,
    reasons: ['business_type', 'compact_name_match'],
  },
  {
    googlePlaceId: 'ChIJyTWPMFJlWyoRwSpcv4JumBo',
    name: 'Little Hellfire Bay',
    formattedAddress: 'Coastal Walk Trail, Cape Le Grand WA 6450, Australia',
    latitude: -34.0050469,
    longitude: 122.173361,
    confidenceScore: 0.9426758241011313,
    reasons: ['business_type', 'compact_name_match'],
  },
  {
    googlePlaceId: 'ChIJ8Y8T77BkWyoRF-6wbPoGMJY',
    name: 'Hellfire Bay',
    formattedAddress: 'Hellfire Bay, Australia',
    latitude: -34.0066667,
    longitude: 122.1652778,
    confidenceScore: 0.7564535292304043,
    reasons: ['compact_name_match'],
  },
];

const productionFixture = SHARE_REGRESSION_FIXTURES.find((fixture) =>
  fixture.id === 'instagram-hellfire-bay-ambiguity-job-8aa61cd0'
);
assert.equal(productionFixture?.expectedRawCandidateCount, 3);
assert.deepEqual(productionFixture?.expectedProviderIds, exactCandidates.map((candidate) => candidate.googlePlaceId));

const exact = evaluateMetadataAutoSave({
  result: { decision: 'candidate_picker', candidates: exactCandidates },
  evidence: { venueNameHints: ['Hellfire bay'], isRoundup: false },
});
assert.equal(exact.rawCandidateCount, 3);
assert.deepEqual(exact.plausibleProviderIds, [exactCandidates[0]!.googlePlaceId, exactCandidates[2]!.googlePlaceId]);
assert.deepEqual(exact.rejectedCandidates, [{
  providerId: exactCandidates[1]!.googlePlaceId,
  reason: 'explicit_name_conflict',
}]);
assert.deepEqual(decisionForPlausibleCandidates(exact.plausibleCandidateCount), {
  decision: 'candidate_picker', mode: 'picker', autoSave: false,
});

// The generic three-plausible contract persists and returns every option.
const persistedThree = buildCandidateReviewSnapshot(exactCandidates);
assert.equal(persistedCandidateCount(persistedThree), 3);
assert.equal(normalizeShareJobCandidates(persistedThree).length, 3);
assert.deepEqual(mediaFailureReview(persistedThree), {
  decision: 'candidate_picker', mode: 'picker', autoSave: false,
});

for (const count of [0, 1, 2, 3, 5]) {
  const decision = decisionForPlausibleCandidates(count);
  assert.equal(decision.decision, count === 0 ? 'manual_fallback' : count === 1 ? 'auto_save' : 'candidate_picker');
  if (count >= 2) {
    const notification = buildNeedsHelpNotification({ mode: 'picker', jobId: `job-${count}`, candidateCount: count });
    assert.equal(notification.title, `We found ${count} possible places`);
    assert.equal(notification.body, 'Pick the one you meant and we’ll save it.');
    assert.deepEqual(routeShareJobNotification(notification.data), { kind: 'queue_item', jobId: `job-${count}` });
    assert.equal(notification.data.reviewMode, 'candidate_picker');
  }
}

assert.deepEqual(decisionForPlausibleCandidates(1, true), {
  decision: 'candidate_confirmation', mode: 'single', autoSave: false,
});
assert.equal(buildNeedsHelpNotification({ mode: 'single', jobId: 'blocked' }).title, 'We think we found it');
assert.equal(buildNeedsHelpNotification({ mode: 'manual', jobId: 'none' }).title, 'We couldn’t quite find this one');

const pickerPlan = planFromResolverDecision({
  decision: 'candidate_picker', safeToAutoSave: false, hasPrimaryCandidate: true, candidateCount: 3,
});
assert.equal(pickerPlan.route, 'needs_help');
assert.equal(pickerPlan.route === 'needs_help' ? pickerPlan.mode : null, 'picker');

// Optional visual fields and legacy aliases never discard a core identity.
assert.deepEqual(normalizeShareJobCandidates({ options: [{
  providerId: 'legacy-provider', displayName: 'Legacy Place', address: null,
}]}), [{
  googlePlaceId: 'legacy-provider', name: 'Legacy Place', formattedAddress: null,
  latitude: null, longitude: null, types: [], matchScore: null, aiNote: null,
}]);

// One review row counts once; completion removes it from Needs-you immediately.
assert.equal(actionableCount([{ status: 'needs_help' }]), 1);
assert.equal(actionableCount([{ status: 'completed' }]), 0);

const detailSource = fs.readFileSync(path.join(process.cwd(), 'app/share-jobs/[jobId].tsx'), 'utf8');
assert.match(detailSource, /We found \$\{candidates\.length\} possible places/);
assert.match(detailSource, /Which one did you mean\?/);
assert.match(detailSource, /title="None of these"/);
assert.match(detailSource, /onPress=\{\(\) => void handleSaveStored\(candidate\)\}/);
assert.match(detailSource, /if \(!job \|\| resolvingRef\.current\) return;/, 'the existing once-latch guards candidate saves');
assert.match(detailSource, /await getPlaceDetails\(candidate\.googlePlaceId\)/, 'legacy candidates hydrate by authoritative provider id');

console.log('PASS production Hellfire Bay fixture and 0/1/2/3/5 ambiguity-review contracts');
