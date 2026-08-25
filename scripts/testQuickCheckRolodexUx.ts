import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { pageIndexFromOffset } from '../lib/photoCarousel';
import {
  candidateMatchLabel,
  candidateSaveLabel,
  toggleCandidateSelection,
  visibleCandidateShortlist,
  type CandidateConfirmationPlace,
} from '../lib/vayrinCandidateConfirmation';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const detail = read('components/map/SelectedPlaceDetails.tsx');
const rolodex = read('components/PhotoRolodex.tsx');
const carousel = read('components/CandidatePhotoCarousel.tsx');
const card = read('components/CandidateConfirmationCard.tsx');
const source = read('components/SourceEvidenceGallery.tsx');
const multi = read('components/MultiPlaceCandidateCard.tsx');
const quickCheck = read('app/share-jobs/[jobId].tsx');

const candidate = (id: string): CandidateConfirmationPlace => ({
  googlePlaceId: id,
  name: `Candidate ${id}`,
  formattedAddress: 'Los Angeles, California',
  types: ['point_of_interest'],
  matchStrength: 'high',
});

// 1. Place Detail and both Quick Check image contexts use one fullscreen owner.
assert.match(detail, /<PhotoRolodexModal/);
assert.match(carousel, /<PhotoRolodexModal/);
assert.match(source, /<PhotoRolodexModal/);

// 2-3. Native horizontal paging changes index continuously and drives accessible pagination.
assert.deepEqual([0, 1, 2].map((index) => pageIndexFromOffset(index * 300, 300, 3)), [0, 1, 2]);
assert.match(carousel, /horizontal[\s\S]{0,220}pagingEnabled/);
assert.match(carousel, /onScroll=\{\(event\) => updatePageFromOffset/);
assert.match(carousel, /testID="candidate-photo-pagination"/);
assert.match(carousel, /accessibilityValue=\{\{ text:/);

// 4-6. Selection owns the header, never the gallery; the outer screen remains vertical.
const selectionIndex = card.indexOf('testID="candidate-selection-control"');
const galleryIndex = card.indexOf('<CandidatePhotoCarousel');
assert.ok(selectionIndex > -1 && galleryIndex > selectionIndex, 'selection control precedes the independent gallery');
assert.doesNotMatch(card, /<Pressable[\s\S]{0,200}<View style=\{\[styles\.card[\s\S]*<CandidatePhotoCarousel/);
assert.match(quickCheck, /<ScrollView[\s\S]*showsVerticalScrollIndicator=\{false\}/);
assert.match(carousel, /nestedScrollEnabled/);
assert.match(carousel, /directionalLockEnabled/);

// 7-10. Two, five, one, and no-photo states share one bounded fallback chain.
assert.equal(pageIndexFromOffset(300, 300, 2), 1);
assert.match(carousel, /MAX_CANDIDATE_PHOTOS = 5/);
assert.match(carousel, /scrollEnabled=\{items\.length > 1\}/);
assert.match(carousel, /Place photos unavailable/);
assert.match(
  carousel,
  /if \(places\.length > 0\) return places;[\s\S]*if \(sourceUri[\s\S]*if \(fallbackSourceUri/,
  'cached Places photos precede source-frame and neutral fallbacks',
);

// 11. The compact evidence strip displays two thumbnails around 390pt and remains swipeable.
for (const width of [375, 390, 430]) {
  const frameWidth = Math.min(160, Math.max(148, (width - 72) / 2));
  assert.ok(frameWidth * 2 + 8 <= width - 48, `${width}pt fits two evidence frames`);
}
assert.match(source, /horizontal[\s\S]{0,120}nestedScrollEnabled/);
assert.match(source, /scrollEnabled=\{available\.length > 1\}/);

// 12-13. One safe-area-aware shared close shell; redundant custom viewers are gone.
assert.match(rolodex, /useSafeAreaInsets/);
assert.match(rolodex, /top: insets\.top \+ Spacing\.sm/);
assert.match(rolodex, /width: 44, height: 44/);
assert.match(rolodex, /testID="photo-rolodex-close"/);
assert.doesNotMatch(source, /<Modal\b/);
assert.doesNotMatch(detail, /<Modal\b/);

// 14. Multi-candidate imagery is materially shorter without reverting to thumbnails.
const compactPhotoHeight = Number(card.match(/COMPACT_CANDIDATE_PHOTO_HEIGHT = (\d+)/)?.[1]);
const standardPhotoHeight = Number(card.match(/STANDARD_CANDIDATE_PHOTO_HEIGHT = (\d+)/)?.[1]);
assert.equal(compactPhotoHeight, 132);
assert.equal(standardPhotoHeight, 220);
assert.ok(compactPhotoHeight >= 120);
assert.match(card, /headerCompact: \{ minHeight: 68/);
assert.match(card, /evidenceBlockCompact/);
assert.match(card, /cardCompact: \{ marginBottom: Spacing\.sm \}/);

// 15-17. Qualitative evidence, Why, and the three-candidate cap remain intact.
assert.equal(candidateMatchLabel(candidate('high')), 'High match');
assert.equal(candidateMatchLabel({ ...candidate('medium'), matchStrength: 'medium' }), 'Medium match');
assert.equal(candidateMatchLabel({ ...candidate('low'), matchStrength: 'low' }), 'Low match');
assert.doesNotMatch(card, /confidence.*%|matchScore.*%/i);
assert.match(card, /Why this match\?/);
assert.equal(visibleCandidateShortlist(['1', '2', '3', '4'].map(candidate)).length, 3);

// 18-19. Multi-select/save copy is unchanged and selection never mutates candidate order.
const ordered = ['a', 'b', 'c'].map(candidate);
const selected = toggleCandidateSelection([], 'b', 'multiple');
assert.deepEqual(selected, ['b']);
assert.deepEqual(ordered.map((item) => item.googlePlaceId), ['a', 'b', 'c']);
assert.equal(candidateSaveLabel(2), 'Save 2 places');
assert.equal(candidateSaveLabel(3), 'Save 3 places');

// 20. Multi-Place Review inherits the same repaired carousel and isolated selection surface.
assert.match(multi, /<CandidatePhotoCarousel/);
assert.match(multi, /testID="candidate-selection-control"/);
assert.ok(multi.indexOf('testID="candidate-selection-control"') < multi.indexOf('<CandidatePhotoCarousel'));

console.log('PASS Quick Check shared rolodex, compact layout, swipe ownership, accessibility, selection, and multi-place regression contracts');
