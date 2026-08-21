import assert from 'node:assert/strict';
import {
  buildShareJobCandidatePayload,
  mentionCount,
  normalizeMentionSlots,
  preselectedCandidateIds,
  selectCandidateWithinMention,
  selectedUnsavedCandidates,
  multiPlaceTitle,
  removeSuccessfulSelections,
  saveSelectedLabel,
} from '../lib/shareJobResult';
import {
  buildFivePizzaPreviewJob,
  buildPhase2PreviewJob,
  PHASE2_PREVIEW_FIXTURES,
} from '../lib/phase2Preview';

const candidate = (id: string, name = id) => ({
  googlePlaceId: id,
  name,
  formattedAddress: `${id} Main St`,
  latitude: 33,
  longitude: -117,
  types: ['restaurant'],
  confidenceScore: 0.8,
});

const rawSlots = [
  { mentionId: 'm1', displayName: 'Verified', outcome: 'verified_single', candidates: [candidate('p1')] },
  { mentionId: 'm2', displayName: 'Ambiguous', outcome: 'ambiguous_candidates', candidates: [candidate('p2a'), candidate('p2b')] },
  { mentionId: 'm3', displayName: 'Already saved', outcome: 'verified_single', candidates: [candidate('p3')] },
  { mentionId: 'm4', displayName: 'Missing name', outcome: 'no_match', candidates: [] },
  { mentionId: 'm5', displayName: 'Another verified', outcome: 'verified_single', candidates: [candidate('p5')] },
];

const payload = buildShareJobCandidatePayload(rawSlots.flatMap((slot) => slot.candidates), rawSlots);
assert.equal(payload.version, 2);
assert.equal(payload.selectionMode, 'multi_independent');
assert.equal(mentionCount(payload), 5, 'five logical slots, not candidate rows');
assert.equal(payload.mentionSlots[1]!.candidates.length, 2, 'ambiguous candidates remain grouped');

const slots = normalizeMentionSlots(payload.mentionSlots);
const selected = preselectedCandidateIds(slots, new Set(['p3']));
assert.deepEqual([...selected].sort(), ['p1', 'p5'], 'verified unsaved mentions are preselected');
assert.ok(!selected.has('p2a') && !selected.has('p2b'), 'ambiguous mention is not preselected');
assert.ok(!selected.has('p3'), 'already-saved place is excluded');

const firstChoice = selectCandidateWithinMention(selected, slots[1]!, 'p2a');
const secondChoice = selectCandidateWithinMention(firstChoice, slots[1]!, 'p2b');
assert.ok(!secondChoice.has('p2a') && secondChoice.has('p2b'), 'one choice per ambiguous mention');
assert.ok(secondChoice.has('p1') && secondChoice.has('p5'), 'other mentions remain selected');
assert.equal(selectedUnsavedCandidates(slots, secondChoice, new Set(['p3'])).length, 3);
assert.equal(multiPlaceTitle(5), 'I found 5 places');
assert.equal(saveSelectedLabel(1), 'Save selected (1)');
assert.equal(saveSelectedLabel(3), 'Save selected (3)');
assert.equal(saveSelectedLabel(0), 'Save selected (0)');
assert.deepEqual([...removeSuccessfulSelections(secondChoice, ['p1', 'p2b'])], ['p5']);

const relationship = normalizeMentionSlots([{
  mentionId: 'm1',
  displayName: 'X Eats at Brewery X',
  primaryVenueName: 'X Eats',
  hostVenueName: 'Brewery X',
  relationshipType: 'located_at',
  outcome: 'ambiguous_candidates',
  candidates: [candidate('brewery-x', 'Brewery X')],
}]);
assert.equal(relationship.length, 1);
assert.equal(relationship[0]!.displayName, 'X Eats at Brewery X');
assert.equal(relationship[0]!.outcome, 'ambiguous_candidates');
const leadOnly = normalizeMentionSlots([{
  mentionId: 'm1', displayName: 'Hidden Falls', outcome: 'no_match', candidates: [],
  identityHypotheses: [{
    name: 'Hidden Falls', contextLabel: 'Example County', confidence: 0.63,
    evidenceKind: 'observable', timestamps: [2, 8],
  }],
}]);
assert.deepEqual(leadOnly[0]!.identityHypotheses, [{
  name: 'Hidden Falls', contextLabel: 'Example County', confidence: 0.63,
  evidenceKind: 'observable', timestamps: [2, 8],
}], 'unverified non-Places lead survives in the durable mention slot');
assert.deepEqual(normalizeMentionSlots([{ bad: true }, null, 'x']), [], 'malformed payload never throws');

const preview = buildFivePizzaPreviewJob();
assert.equal(mentionCount(preview.candidate_payload), 5, 'five-pizza preview has exactly five top-level cards');
const previewSlots = normalizeMentionSlots((preview.candidate_payload as { mentionSlots: unknown }).mentionSlots);
assert.equal(previewSlots.filter((slot) => slot.displayName === 'X Eats at Brewery X').length, 1);
assert.equal(previewSlots.find((slot) => slot.hostVenueName === 'Brewery X')?.outcome, 'ambiguous_candidates');

for (const expectedCount of [0, 1, 2, 8]) {
  const fixture = buildPhase2PreviewJob(`phase2-preview-${expectedCount}`);
  assert.equal(mentionCount(fixture.candidate_payload), expectedCount);
  assert.equal(multiPlaceTitle(expectedCount), `I found ${expectedCount} ${expectedCount === 1 ? 'place' : 'places'}`);
}
assert.equal(PHASE2_PREVIEW_FIXTURES.length, 9);
const missingSlots = normalizeMentionSlots(
  (buildPhase2PreviewJob('phase2-preview-missing').candidate_payload as { mentionSlots: unknown }).mentionSlots,
);
assert.equal(preselectedCandidateIds(missingSlots).size, 2, 'missing-coordinate place is visible but not selected');
const overlapSlots = normalizeMentionSlots(
  (buildPhase2PreviewJob('phase2-preview-overlap').candidate_payload as { mentionSlots: unknown }).mentionSlots,
);
assert.equal(overlapSlots.length, 3, 'overlapping coordinates remain independently accessible');

console.log('PASS share-job mention result contract');
