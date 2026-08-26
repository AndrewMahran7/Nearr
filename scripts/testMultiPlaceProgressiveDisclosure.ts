import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  chooseBatchCandidate,
  dismissBatchRow,
  finishBatchSearch,
  reconcileMultiPlaceBatch,
  rowCandidate,
  selectedBatchTargets,
} from '../lib/multiPlaceBatch';
import {
  estimatedDisclosureContentHeight,
  initialExpandedMentionId,
  mentionSummaryStatus,
  MULTI_PLACE_DISCLOSURE_LAYOUT,
  visibleMentionCandidates,
} from '../lib/vayrinMultiPlaceReview';
import { getVayrinCandidateFixture } from '../lib/vayrinCandidateFixtures';
import type { ShareJobMentionSlot, ShareJobResultCandidate } from '../lib/shareJobResult';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const detailSource = read('app/share-jobs/[jobId].tsx');
const candidateSource = read('components/CandidateConfirmationCard.tsx');
const evidenceSource = read('components/SourceEvidenceGallery.tsx');

function fixtureBatch(id: string) {
  const fixture = getVayrinCandidateFixture(id);
  assert.ok(fixture?.mentionSlots, `fixture ${id} has mention slots`);
  return reconcileMultiPlaceBatch({ jobId: id, slots: fixture.mentionSlots });
}

function candidate(id: string): ShareJobResultCandidate {
  return {
    googlePlaceId: id,
    name: `Candidate ${id}`,
    formattedAddress: `${id} Main St`,
    latitude: 34,
    longitude: -118,
    types: ['restaurant'],
    matchScore: 0.8,
  };
}

function slot(id: string, candidates: ShareJobResultCandidate[], extra: Partial<ShareJobMentionSlot> = {}): ShareJobMentionSlot {
  return {
    mentionId: id,
    displayName: `Mention ${id}`,
    contextLabel: null,
    primaryVenueName: null,
    hostVenueName: null,
    relationshipType: null,
    outcome: candidates.length === 1 ? 'verified_single' : candidates.length > 1 ? 'ambiguous_candidates' : 'no_match',
    candidates,
    ...extra,
  };
}

// 1–2. Exactly the first unresolved mention opens, and the UI owns one scalar disclosure id.
const unresolved = fixtureBatch('vayrin-multi-disclosure-three-unresolved');
assert.equal(initialExpandedMentionId(unresolved), 'disclosure-three-a');
assert.match(detailSource, /setExpandedMentionId\(\(current\) => current === logicalPlaceId \? null : logicalPlaceId\)/);
assert.doesNotMatch(detailSource, /expandedMentionIds|Set<string>.*expanded/i);

// 3–4. Disclosure is presentation-only: selection and the global footer targets survive collapse.
const firstChoice = unresolved.rows['disclosure-three-a']!.candidates[1]!;
const selected = chooseBatchCandidate(unresolved, 'disclosure-three-a', firstChoice);
assert.equal(rowCandidate(selected.rows['disclosure-three-a']!)?.googlePlaceId, firstChoice.googlePlaceId);
assert.equal(selectedBatchTargets(selected).length, 1);
assert.match(detailSource, /batchCounts = batch \? batchActionCounts\(batch\)/);

// 5–6. Resolved and already-saved summaries remain truthful and compact.
const persisted = reconcileMultiPlaceBatch({
  jobId: 'persisted',
  slots: [slot('saved', [candidate('saved')], { saveState: 'already_saved', savedPlaceId: 'saved-row' })],
});
assert.equal(mentionSummaryStatus(persisted.rows.saved!), 'Already saved · source attached');
assert.equal(initialExpandedMentionId(persisted), null);
assert.equal(mentionSummaryStatus(selected.rows['disclosure-three-a']!), 'Selected');

// 7. None of these changes one row and preserves every sibling.
const dismissed = dismissBatchRow(selected, 'disclosure-three-b');
assert.equal(mentionSummaryStatus(dismissed.rows['disclosure-three-b']!), 'No place selected');
assert.equal(rowCandidate(dismissed.rows['disclosure-three-a']!)?.googlePlaceId, firstChoice.googlePlaceId);
assert.equal(dismissed.rows['disclosure-three-c']!.userDismissed, false);

// 8. Manual search returns to its owning mention without disturbing another selection.
let searched = finishBatchSearch(dismissed, 'disclosure-three-b', [candidate('manual-return')]);
searched = chooseBatchCandidate(searched, 'disclosure-three-b', searched.rows['disclosure-three-b']!.search.candidates[0]!);
assert.equal(rowCandidate(searched.rows['disclosure-three-b']!)?.googlePlaceId, 'manual-return');
assert.equal(rowCandidate(searched.rows['disclosure-three-a']!)?.googlePlaceId, firstChoice.googlePlaceId);

// 9–10. Expanded rows reuse the shared compact row; collapsed rows mount no galleries.
assert.match(detailSource, /<CandidateConfirmationCard[\s\S]*compact[\s\S]*selectionRole="radio"/);
assert.match(candidateSource, /testID="compact-candidate-row"/);
assert.match(candidateSource, /variant="thumbnail"/);
assert.match(candidateSource, /PhotoRolodex|CandidatePhotoCarousel/);
const rowRenderer = detailSource.slice(detailSource.indexOf('function renderBatchRow'), detailSource.indexOf('if (loading)'));
assert.match(rowRenderer, /const visibleCandidates = expanded \? visibleMentionCandidates\(row\) : \[\]/);
assert.match(rowRenderer, /expanded \? \([\s\S]*SourceEvidenceGallery[\s\S]*CandidateConfirmationCard|expanded \? \([\s\S]*renderBatchCandidateChoice/);
assert.match(evidenceSource, /frameWidth = preview[\s\S]*\? 112/);
assert.match(evidenceSource, /preview \? 92/);

// 11–12. A 2/3-place overview plus one expanded decision stays near one 844pt viewport.
const viewportHeight = 844;
const twoHeight = estimatedDisclosureContentHeight({ mentionCount: 2, expandedCandidateCount: 3, hasEvidence: true, footerVisible: true });
const threeHeight = estimatedDisclosureContentHeight({ mentionCount: 3, expandedCandidateCount: 3, hasEvidence: true, footerVisible: true });
assert.ok(twoHeight <= viewportHeight * 1.15, `2-place budget ${twoHeight}`);
assert.ok(threeHeight <= viewportHeight * 1.25, `3-place budget ${threeHeight}`);
const oldThreeHeight = 96 + 3 * (110 + 170 + 3 * 220 + 88) + 72;
assert.ok(threeHeight < oldThreeHeight * 0.4, `${threeHeight} is under 40% of ${oldThreeHeight}`);

// 13–15. Five/ten keyed rows retain stable server IDs and order while candidate display stays capped.
for (const [id, count] of [['vayrin-multi-five-mentions', 5], ['vayrin-multi-ten-mentions', 10]] as const) {
  const batch = fixtureBatch(id);
  assert.equal(batch.order.length, count);
  assert.equal(new Set(batch.order).size, count);
  assert.deepEqual(batch.order, getVayrinCandidateFixture(id)!.mentionSlots!.map((item) => item.mentionId));
}
assert.equal(visibleMentionCandidates(unresolved.rows['disclosure-three-a']!).length, 3);
assert.match(detailSource, /data=\{batch\.order\}/);
assert.match(detailSource, /keyExtractor=\{\(id\) => id\}/);

// 16. Summary disclosure, thumbnails, local actions, and footer all expose accessible controls.
assert.match(rowRenderer, /accessibilityLabel=\{`Place \$\{index \+ 1\} of \$\{total\}/);
assert.match(rowRenderer, /accessibilityState=\{\{ expanded \}\}/);
assert.match(rowRenderer, /accessibilityLabel=\{`Search another place for/);
assert.match(rowRenderer, /accessibilityLabel=\{`None of these for/);
assert.ok(MULTI_PLACE_DISCLOSURE_LAYOUT.collapsedMentionMinHeight >= 44);
assert.match(candidateSource, /width: 44, height: 44/);
assert.match(evidenceSource, /accessibilityRole="imagebutton"/);
assert.match(detailSource, /accessibilityLabel=\{`\$\{batchPrimaryActionLabel\(batchCounts\)\} from this review`\}/);

// Focused deterministic fixture inventory requested by the ticket.
const fixtureCoverage = {
  twoUnresolved: 'vayrin-multi-disclosure-two-unresolved',
  threeUnresolved: 'vayrin-multi-disclosure-three-unresolved',
  firstResolvedSecondUnresolved: 'vayrin-multi-disclosure-first-resolved',
  alreadySavedAndNew: 'vayrin-multi-existing-and-new',
  selectedAndUnresolved: 'vayrin-multi-unresolved-two-resolved',
  noneOfThese: 'vayrin-multi-disclosure-two-unresolved',
  manualSearchReturn: 'vayrin-multi-manual-search',
  mixedSaveAttach: 'vayrin-multi-existing-and-new',
  fiveMentions: 'vayrin-multi-five-mentions',
  tenMentions: 'vayrin-multi-ten-mentions',
  longLabels: 'vayrin-multi-long-name',
  noSourceFrame: 'vayrin-multi-no-source-frame',
  oneCandidate: 'vayrin-multi-two-resolved',
  threeCandidates: 'vayrin-multi-three-per-mention',
} as const;
for (const id of Object.values(fixtureCoverage)) assert.ok(getVayrinCandidateFixture(id), `fixture ${id} exists`);

console.log(`PASS multi-place progressive disclosure (${twoHeight}pt two-place, ${threeHeight}pt three-place, collapsed hydration 0)`);
