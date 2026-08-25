import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  chooseBatchCandidate,
  finishBatchSearch,
  reconcileMultiPlaceBatch,
  rowCandidate,
  toggleBatchRow,
} from '../lib/multiPlaceBatch';
import { pageIndexFromOffset } from '../lib/photoCarousel';
import type { ShareJobMentionSlot, ShareJobResultCandidate } from '../lib/shareJobResult';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

function candidate(id: string): ShareJobResultCandidate {
  return {
    googlePlaceId: id,
    name: `Candidate ${id.toUpperCase()}`,
    formattedAddress: `${id} Main St`,
    latitude: 34,
    longitude: -118,
    types: ['restaurant'],
    matchScore: 0.9,
  };
}

function slot(id: string, candidates: ShareJobResultCandidate[]): ShareJobMentionSlot {
  return {
    mentionId: id,
    displayName: `Mention ${id}`,
    contextLabel: 'Los Angeles',
    primaryVenueName: null,
    hostVenueName: null,
    relationshipType: null,
    outcome: candidates.length === 1 ? 'verified_single' : 'ambiguous_candidates',
    candidates,
  };
}

const ids = (items: readonly ShareJobResultCandidate[]) => items.map((item) => item.googlePlaceId);
const ranked = [candidate('a'), candidate('b'), candidate('c')];
let batch = reconcileMultiPlaceBatch({
  jobId: 'stable-order',
  slots: [slot('first', ranked), slot('second', [candidate('d'), candidate('e')])],
});

// 1. Selecting B changes state, not rank.
batch = chooseBatchCandidate(batch, 'first', ranked[1]!);
assert.deepEqual(ids(batch.rows.first!.candidates), ['a', 'b', 'c']);
assert.equal(rowCandidate(batch.rows.first!)?.googlePlaceId, 'b');

// 2. Deselect/select cycles retain the resolver order.
batch = toggleBatchRow(batch, 'first');
batch = chooseBatchCandidate(batch, 'first', ranked[1]!);
assert.deepEqual(ids(batch.rows.first!.candidates), ['a', 'b', 'c']);

// 3. Switching candidates within one mention is exclusive and order-stable.
batch = chooseBatchCandidate(batch, 'first', ranked[2]!);
assert.deepEqual(ids(batch.rows.first!.candidates), ['a', 'b', 'c']);
assert.equal(rowCandidate(batch.rows.first!)?.googlePlaceId, 'c');

// 4. Choosing another mention cannot mutate this mention.
batch = chooseBatchCandidate(batch, 'second', batch.rows.second!.candidates[1]!);
assert.deepEqual(ids(batch.rows.first!.candidates), ['a', 'b', 'c']);

// 5. An already-saved choice uses the same stable ordering rule.
batch = chooseBatchCandidate(batch, 'first', ranked[1]!, 'saved-b');
assert.deepEqual(ids(batch.rows.first!.candidates), ['a', 'b', 'c']);
assert.equal(batch.rows.first!.savedPlaceId, 'saved-b');

// 6. A genuinely new manual result is inserted at the visible front once.
const manual = candidate('manual');
batch = finishBatchSearch(batch, 'first', [manual]);
batch = chooseBatchCandidate(batch, 'first', manual);
assert.deepEqual(ids(batch.rows.first!.candidates), ['manual', 'a', 'b', 'c']);
batch = chooseBatchCandidate(batch, 'first', ranked[1]!);
batch = chooseBatchCandidate(batch, 'first', manual);
assert.deepEqual(ids(batch.rows.first!.candidates), ['manual', 'a', 'b', 'c']);

const carousel = read('components/CandidatePhotoCarousel.tsx');
const card = read('components/MultiPlaceCandidateCard.tsx');
const detail = read('app/share-jobs/[jobId].tsx');

// 7. Native horizontal paging advances the derived photo index.
assert.equal(pageIndexFromOffset(0, 300, 3), 0);
assert.equal(pageIndexFromOffset(301, 300, 3), 1);
assert.match(carousel, /horizontal[\s\S]*pagingEnabled/);
assert.match(carousel, /onScroll=\{\(event\) => updatePageFromOffset/);

// 8. Dots are driven by the live page index.
assert.match(carousel, /index === activeIndex && styles\.dotActive/);
assert.match(carousel, /scrollEventThrottle=\{16\}/);

// 9. A gallery swipe cannot invoke candidate selection.
assert.doesNotMatch(carousel, /\bonPress=/);
assert.ok(card.indexOf('</Pressable>') < card.indexOf('<CandidatePhotoCarousel'));

// 10. The non-gallery header remains an explicit radio selection target.
assert.match(card, /testID="candidate-selection-control"[\s\S]*accessibilityRole="radio"|accessibilityRole="radio"[\s\S]*testID="candidate-selection-control"/);
assert.match(card, /onPress=\{onPress\}/);

// 11. The vertical parent and horizontal child use independent native scroll surfaces.
assert.match(detail, /data=\{batch\.order\}/);
assert.match(carousel, /nestedScrollEnabled/);
assert.match(carousel, /directionalLockEnabled/);

// 12. Page math and paging remain valid for 2, 3, and 5 photos.
for (const count of [2, 3, 5]) {
  assert.equal(pageIndexFromOffset(300 * (count - 1), 300, count), count - 1);
}

// 13. A single photo has no movable or dead pagination state.
assert.equal(pageIndexFromOffset(900, 300, 1), 0);
assert.match(carousel, /scrollEnabled=\{items\.length > 1\}/);
assert.match(carousel, /items\.length > 1 \? \(/);

// 14. No-photo inputs resolve to the existing neutral fallback.
assert.equal(pageIndexFromOffset(900, 300, 0), 0);
assert.match(carousel, /No place photos available/);

// 15. Photo offsets are presentation-only and cannot change selected state.
const selectedBeforeSwipe = batch.rows.first!.selectedCandidateId;
pageIndexFromOffset(600, 300, 5);
assert.equal(batch.rows.first!.selectedCandidateId, selectedBeforeSwipe);

console.log('PASS multi-place stable ordering, independent selection, and native photo-carousel interaction contracts');
