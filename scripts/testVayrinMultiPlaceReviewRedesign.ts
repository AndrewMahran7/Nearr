import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyBatchSaveOutcomes,
  chooseBatchCandidate,
  dismissBatchRow,
  finishBatchSearch,
  openBatchSearch,
  reconcileMultiPlaceBatch,
  rowCandidate,
  selectedBatchTargets,
} from '../lib/multiPlaceBatch';
import { buildShareJobDetailState } from '../lib/shareJobDetailState';
import { buildVayrinCandidateFixtureJob, getVayrinCandidateFixture } from '../lib/vayrinCandidateFixtures';
import {
  MAX_EVIDENCE_FRAMES_PER_MENTION,
  MAX_VISIBLE_CANDIDATES_PER_MENTION,
  batchActionCounts,
  batchPrimaryActionLabel,
  batchResolutionProgress,
  evidenceFramesForMention,
  visibleMentionCandidates,
} from '../lib/vayrinMultiPlaceReview';
import type { ShareJobMentionSlot, ShareJobResultCandidate } from '../lib/shareJobResult';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const app = read('app/share-jobs/[jobId].tsx');
const card = read('components/MultiPlaceCandidateCard.tsx');
const photos = read('components/CandidatePhotoCarousel.tsx');
const sourceGallery = read('components/SourceEvidenceGallery.tsx');
const saveService = read('services/shareJobCandidateSave.ts');
const enrichment = read('services/savedPlacesService.ts');

function candidate(id: string, name = id): ShareJobResultCandidate {
  return { googlePlaceId: id, name, formattedAddress: `${name}, California`, latitude: 34, longitude: -118, types: ['restaurant'], matchScore: 0.8 };
}

function slot(id: string, candidates: ShareJobResultCandidate[], timestamp = 0): ShareJobMentionSlot {
  return { mentionId: id, displayName: `Mention ${id}`, contextLabel: 'California', primaryVenueName: null, hostVenueName: null, relationshipType: null, outcome: candidates.length === 1 ? 'verified_single' : candidates.length > 1 ? 'ambiguous_candidates' : 'no_match', candidates, sourceTimestamps: [timestamp] };
}

const requiredFixtures = [
  'vayrin-multi-punchbowl-in-n-out', 'vayrin-multi-two-resolved', 'vayrin-multi-three-resolved',
  'vayrin-multi-existing-and-new', 'vayrin-multi-unresolved-two-resolved', 'vayrin-multi-manual-search',
  'vayrin-multi-duplicate-canonical', 'vayrin-multi-three-per-mention', 'vayrin-multi-five-internal',
  'vayrin-multi-missing-image', 'vayrin-multi-long-name', 'vayrin-multi-evidence-frames',
  'vayrin-multi-five-mentions', 'vayrin-multi-chain-context',
];
for (const id of requiredFixtures) assert.ok(getVayrinCandidateFixture(id), `fixture ${id}`);

const fixtureJob = buildVayrinCandidateFixtureJob('vayrin-multi-punchbowl-in-n-out');
const detail = buildShareJobDetailState(fixtureJob);
assert.equal(detail.kind, 'multi');
assert.deepEqual(detail.mentionSlots.map((item) => item.mentionId), ['punchbowl', 'in-n-out']); // 1
let batch = reconcileMultiPlaceBatch({ jobId: fixtureJob.id, slots: detail.mentionSlots });
const punchFrames = evidenceFramesForMention(batch.rows.punchbowl!, detail.evidenceFrames);
const burgerFrames = evidenceFramesForMention(batch.rows['in-n-out']!, detail.evidenceFrames);
assert.deepEqual(punchFrames.map((frame) => frame.timestampSeconds), [0]); // 2
assert.deepEqual(burgerFrames.map((frame) => frame.timestampSeconds), [18]);

const five = buildShareJobDetailState(buildVayrinCandidateFixtureJob('vayrin-multi-five-internal'));
const fiveBatch = reconcileMultiPlaceBatch({ jobId: 'five', slots: five.mentionSlots });
assert.equal(fiveBatch.rows['five-punch']!.candidates.length, 5, 'internal ranking stays intact');
assert.equal(visibleMentionCandidates(fiveBatch.rows['five-punch']!).length, MAX_VISIBLE_CANDIDATES_PER_MENTION); // 3/21
assert.match(card, /<Pressable[\s\S]*onPress=\{onPress\}[\s\S]*accessibilityRole="radio"/); // 4
assert.ok(card.indexOf('</Pressable>') < card.indexOf('<CandidatePhotoCarousel'), 'gallery is not inside the selection responder');

const alternatives = [candidate('a'), candidate('b'), candidate('c')];
batch = reconcileMultiPlaceBatch({ jobId: 'exclusive', slots: [slot('one', alternatives), slot('two', [candidate('two')])] });
batch = chooseBatchCandidate(batch, 'one', alternatives[0]!);
batch = chooseBatchCandidate(batch, 'one', alternatives[2]!);
assert.equal(rowCandidate(batch.rows.one!)?.googlePlaceId, 'c'); // 5
assert.deepEqual(selectedBatchTargets(batch).map((target) => target.logicalPlaceId), ['one', 'two']); // 6

const existing = reconcileMultiPlaceBatch({ jobId: 'existing', slots: [slot('saved', [candidate('saved')]), slot('new', [candidate('new')])], savedByGoogleId: { saved: 'saved-row' } });
const withExisting = chooseBatchCandidate(existing, 'saved', candidate('saved'), 'saved-row');
assert.deepEqual(batchActionCounts(withExisting), { total: 2, newPlaces: 1, sourceAttachments: 1 }); // 7/8
assert.equal(batchPrimaryActionLabel(batchActionCounts(withExisting)), 'Save 1 place · attach 1 source'); // 12
assert.match(saveService, /persistShareJobCandidate/);
assert.match(enrichment, /enrichExistingSavedPlace/);

const dismissed = dismissBatchRow(batch, 'one');
assert.equal(dismissed.rows.one!.userDismissed, true);
assert.equal(dismissed.rows.two!.selectedForSave, true); // 9/11
assert.deepEqual(batchResolutionProgress(dismissed), { resolved: 1, total: 2 });
const reopened = reconcileMultiPlaceBatch({ jobId: 'exclusive', slots: [slot('one', alternatives), slot('two', [candidate('two')])], previous: dismissed });
assert.equal(reopened.rows.one!.userDismissed, true); // 23

let searched = openBatchSearch(dismissed, 'one');
searched = finishBatchSearch(searched, 'one', [candidate('manual')]);
searched = chooseBatchCandidate(searched, 'one', searched.rows.one!.search.candidates[0]!);
assert.equal(rowCandidate(searched.rows.one!)?.googlePlaceId, 'manual');
assert.equal(searched.rows.two!.selectedForSave, true); // 10

const duplicate = reconcileMultiPlaceBatch({ jobId: 'duplicate', slots: [slot('a', [candidate('same')]), slot('b', [candidate('same')])] });
assert.equal(selectedBatchTargets(duplicate).length, 1); // 13
assert.equal(batchPrimaryActionLabel({ total: 0, newPlaces: 0, sourceAttachments: 0 }), 'Save 0 places');
assert.match(app, /batchCounts\.total > 0/); // 22

const frameHeavy = { ...fiveBatch.rows['five-punch']!, sourceTimestamps: [0, 1, 2, 3, 4] };
const frames = Array.from({ length: 5 }, (_, index) => ({ id: `f${index}`, storagePath: null, url: `https:\/\/example.com\/${index}.jpg`, timestampSeconds: index, width: 10, height: 10, relevance: 'candidate_evidence' as const }));
assert.equal(evidenceFramesForMention(frameHeavy, frames).length, MAX_EVIDENCE_FRAMES_PER_MENTION); // 15
assert.match(photos, /MAX_CANDIDATE_PHOTOS = 5/);
assert.match(photos, /initialNumToRender=\{1\}/);
assert.match(sourceGallery, /maxToRenderPerBatch=\{2\}/); // 14
assert.match(app, /initialNumToRender=\{2\}[\s\S]*windowSize=\{3\}/); // 5/10 mention performance

assert.match(app, /persistShareJobCandidate\([\s\S]*sourceUrl,/); // 16
assert.match(card, /numberOfLines=\{3\}/); // 17
assert.match(app, /persistShareJobCandidate/); // 18
assert.match(read('supabase/functions/process-share-jobs/recognitionCache.ts'), /candidate_payload|candidatePayload/); // 19
assert.match(enrichment, /saved_place_sources|source_url|sourceUrl/); // 20
assert.doesNotMatch(app, /Choose the right place/);
assert.match(app, /Search another place/);
assert.match(app, /None of these/);
assert.match(app, /backToQueue/); // 24

const partial = applyBatchSaveOutcomes(searched, [{ logicalPlaceId: 'two', candidateId: 'two', status: 'saved', savedPlaceId: 'saved-two' }]);
assert.equal(partial.rows.one!.selectedForSave, true);
assert.equal(partial.rows.two!.persistence, 'saved');

console.log('PASS Vayrin multi-place evidence-first layout, fixtures, selection, save integrity, and performance contracts');
