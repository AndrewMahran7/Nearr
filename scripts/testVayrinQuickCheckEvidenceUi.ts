import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONFIDENCE_INTERPRETATION,
  CONFIDENCE_SOURCE,
  candidateMatchLabel,
  candidateMatchStrength,
  candidateMatchedFramesLabel,
  candidateSaveLabel,
  candidateWhyMatchLines,
  confirmationMode,
  isBroadCandidate,
  quickCheckEvidenceFrameWidth,
  toggleCandidateSelection,
  visibleCandidateShortlist,
  type CandidateConfirmationPlace,
} from '../lib/vayrinCandidateConfirmation';
import {
  buildVayrinCandidateFixtureJob,
  getVayrinCandidateFixture,
  VAYRIN_CANDIDATE_FIXTURES,
} from '../lib/vayrinCandidateFixtures';
import { buildShareJobDetailState } from '../lib/shareJobDetailState';
import { evidenceFramesFromPayload, normalizeEvidenceFrames } from '../lib/shareJobResult';
import {
  cleanupShareEvidenceFrames,
  evidenceFrameStoragePaths,
  SIGNED_URL_TTL_SECONDS,
} from '../lib/shareEvidenceFrameLifecycle';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const asyncDetail = read('app/share-jobs/[jobId].tsx');
const syncShare = read('app/share.tsx');
const sourceGallery = read('components/SourceEvidenceGallery.tsx');
const candidateCarousel = read('components/CandidatePhotoCarousel.tsx');
const card = read('components/CandidateConfirmationCard.tsx');
const worker = read('services/media-worker/src/pipeline/persistEvidenceFrames.ts');
const shareJobsService = read('services/shareJobsService.ts');
const migration = read('supabase/migrations/20260824225520_vayrin_quick_check_evidence_frames.sql');

const exact = (id: string, score: number | null = 0.8): CandidateConfirmationPlace => ({
  googlePlaceId: id,
  name: `Place ${id}`,
  formattedAddress: 'San Diego, California',
  types: ['point_of_interest'],
  matchScore: score,
});

// 1–3. Actual analyzed evidence frames, timestamps, carousel and fullscreen.
const sunsetJob = buildVayrinCandidateFixtureJob('vayrin-confirm-five-photos');
const sunsetDetail = buildShareJobDetailState(sunsetJob);
assert.equal(sunsetDetail.evidenceFrames.length, 4);
assert.deepEqual(sunsetDetail.evidenceFrames.map((frame) => frame.timestampSeconds), [1, 4, 9, 14]);
assert.match(sourceGallery, /horizontal/);
assert.match(sourceGallery, /snapToInterval/);
assert.match(sourceGallery, /setViewerIndex/);
assert.match(sourceGallery, /Modal visible=/);
assert.match(sourceGallery, /formatCandidateTimestamp/);
assert.deepEqual([375, 390, 430].map(quickCheckEvidenceFrameWidth), [327, 342, 382]);
assert.ok([375, 390, 430].every((width) => quickCheckEvidenceFrameWidth(width) <= width - 48));

// 4–5. Multiple candidate photos, lazy hydration, and hard request bounds.
assert.equal(getVayrinCandidateFixture('vayrin-confirm-five-photos')?.candidates[0]?.photoUrls?.length, 5);
assert.equal(getVayrinCandidateFixture('vayrin-confirm-one-photo')?.candidates[0]?.photoUrls?.length, 1);
assert.match(candidateCarousel, /MAX_CANDIDATE_PHOTOS = 5/);
assert.match(candidateCarousel, /index <= hydratedThrough/);
assert.match(candidateCarousel, /getCachedPlaceRichDetails/);
assert.match(candidateCarousel, /PHOTO_RESOLUTION_TIMEOUT_MS/);

// 6–8. Confidence is supported, qualitative, and never presented as probability.
assert.equal(candidateMatchStrength(exact('missing', null)), null);
assert.equal(candidateMatchLabel(exact('high', 0.82)), 'High match');
assert.equal(candidateMatchLabel(exact('medium', 0.61)), 'Medium match');
assert.equal(candidateMatchLabel(exact('low', 0.41)), 'Low match');
assert.equal(candidateMatchLabel({ ...exact('qualitative', null), matchStrength: 'medium' }), 'Medium match');
assert.equal(CONFIDENCE_SOURCE, 'resolver_normalized_evidence_strength');
assert.match(CONFIDENCE_INTERPRETATION, /not a probability/);
assert.doesNotMatch(card, /\{[^}]*matchScore[^}]*\}%|confidence.*%/i);

// 9. Expansion is bounded plain-language evidence, not raw reasoning.
const evidenceCandidate: CandidateConfirmationPlace = {
  ...exact('evidence', 0.84),
  matchedFrameTimestamps: [1, 4, 9],
  analyzedFrameCount: 4,
  reasons: ['strong_name_match', 'state_match'],
  evidenceItems: [{ source: 'visible_text', timestampSeconds: 1 }],
};
assert.equal(candidateMatchedFramesLabel(evidenceCandidate), 'Matched frames: 3 of 4');
assert.ok(candidateWhyMatchLines(evidenceCandidate, 'San Diego, CA').length <= 4);
assert.match(card, /Why this match\?/);
assert.match(card, /accessibilityState=\{\{ expanded \}\}/);
assert.doesNotMatch(card, /chain.of.thought|prompt|system message/i);

// 10–15. Cap, whole-card toggle, deselection, multi-select, labels, canonical dedupe.
assert.equal(visibleCandidateShortlist([exact('1'), exact('2'), exact('3'), exact('4')]).length, 3);
assert.deepEqual(toggleCandidateSelection([], 'a', 'multiple'), ['a']);
assert.deepEqual(toggleCandidateSelection(['a'], 'a', 'multiple'), []);
assert.deepEqual(toggleCandidateSelection(['a'], 'b', 'multiple'), ['a', 'b']);
assert.equal(candidateSaveLabel(0), 'Select a place to save');
assert.equal(candidateSaveLabel(1), 'Save this place');
assert.equal(candidateSaveLabel(2), 'Save 2 places');
assert.equal(visibleCandidateShortlist([exact('same'), { ...exact('same'), name: 'Duplicate alias' }]).length, 1);
assert.match(card, /accessibilityRole=\{selectionRole\}/);
assert.match(card, /onPress=\{onPress\}/);

// 16–17. Single candidate and broad-area modes remain explicit.
assert.equal(confirmationMode([exact('single')]), 'single');
const supai = getVayrinCandidateFixture('vayrin-confirm-supai')!.candidates[0]!;
assert.equal(isBroadCandidate(supai), true);
assert.match(card, /AREA MATCH/);
assert.match(card, /narrowed the video to this area/);
assert.match(asyncDetail, /See places in this area/);

// 18–20. Raw text cannot save/no-op; original post remains a secondary action.
const rawDetail = buildShareJobDetailState(buildVayrinCandidateFixtureJob('vayrin-confirm-raw-waterfall'));
assert.equal(rawDetail.kind, 'manual');
assert.equal(rawDetail.candidates.length, 0);
assert.match(asyncDetail, /runManualSearch/);
assert.match(asyncDetail, /vayrin_raw_name_resolution_failure/);
assert.match(asyncDetail, /View original post/);
assert.match(syncShare, /View original post/);

// 21–23. Durable refs survive serialization; missing imagery/frames are honest.
const serialized = JSON.parse(JSON.stringify(sunsetJob.candidate_payload));
assert.deepEqual(evidenceFramesFromPayload(serialized).map((frame) => frame.timestampSeconds), [1, 4, 9, 14]);
assert.equal(normalizeEvidenceFrames([{ id: 'bad', timestampSeconds: 1 }]).length, 0);
assert.match(candidateCarousel, /Place photos unavailable/);
assert.equal(buildShareJobDetailState(buildVayrinCandidateFixtureJob('vayrin-confirm-missing-frames')).evidenceFrames.length, 0);
assert.match(sourceGallery, /Analyzed frames weren’t retained/);

// 24–25. No dead end and safe-area-aware persistent CTA.
assert.match(asyncDetail, /Search for the place/);
assert.match(asyncDetail, /None of these|Not this place/);
assert.match(asyncDetail, /stickySaveBar/);
assert.match(asyncDetail, /Math\.max\(safeAreaInsets\.bottom, Spacing\.sm\)/);

// Deterministic fixture matrix and bounded durable storage contract.
for (const id of [
  'vayrin-confirm-stari-most', 'vayrin-confirm-san-diego', 'vayrin-confirm-three',
  'vayrin-confirm-five-internal', 'vayrin-confirm-five-photos', 'vayrin-confirm-one-photo',
  'vayrin-confirm-neutral', 'vayrin-confirm-sunset-three', 'vayrin-confirm-low-confidence',
  'vayrin-confirm-qualitative-only', 'vayrin-confirm-multi-place', 'vayrin-confirm-supai',
  'vayrin-confirm-raw-waterfall', 'vayrin-confirm-duplicate', 'vayrin-confirm-long-name',
  'vayrin-confirm-missing-frames',
]) assert.ok(VAYRIN_CANDIDATE_FIXTURES.some((fixture) => fixture.id === id), id);
assert.match(worker, /MAX_RETAINED_EVIDENCE_FRAMES = 5/);
assert.match(worker, /selectedTimestampsSeconds|vayrinSelectedTimestamps/);
assert.match(migration, /public, file_size_limit[\s\S]*false/);
assert.match(migration, /owners read share evidence/);
assert.match(migration, /owners delete share evidence/);
assert.match(migration, /bucket_id = 'share-evidence'/);
assert.match(migration, /sj\.user_id = auth\.uid\(\)/);
assert.equal(SIGNED_URL_TTL_SECONDS, 3600);

// Lifecycle: job scoping blocks cross-job/traversal references, missing
// objects remain idempotent, and partial failures are returned to the caller.
const lifecyclePayload = {
  evidenceFrames: [
    { storagePath: 'user-1/job-1/task-1/00-1000.jpg' },
    { storagePath: 'user-1/job-2/task-1/00-1000.jpg' },
    { storagePath: 'user-1/job-1/../secret.jpg' },
  ],
};
assert.deepEqual(evidenceFrameStoragePaths(lifecyclePayload, 'job-1'), ['user-1/job-1/task-1/00-1000.jpg']);
async function verifyLifecycleCleanup(): Promise<void> {
  const cleanupSuccess = await cleanupShareEvidenceFrames(lifecyclePayload, 'job-1', async () => ({ data: [] }));
  assert.equal(cleanupSuccess.status, 'success');
  assert.equal(cleanupSuccess.attempted, 1);
  const cleanupFailure = await cleanupShareEvidenceFrames(lifecyclePayload, 'job-1', async () => ({
    data: [], error: { message: 'partial storage outage' },
  }));
  assert.equal(cleanupFailure.status, 'failed');
assert.match(cleanupFailure.errorMessage ?? '', /partial storage outage/);
  assert.match(shareJobsService, /evidence cleanup failed[\s\S]*throw new Error\('Could not remove all retained evidence/);
  assert.match(shareJobsService, /evidence cleanup snapshot failed[\s\S]*throw new Error\('Could not verify evidence cleanup/);
}

void verifyLifecycleCleanup().then(() => {
  console.log('PASS Vayrin Quick Check evidence-first frames, galleries, truthful confidence, evidence, selection, fixtures, persistence, lifecycle, and safe-area CTA');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
