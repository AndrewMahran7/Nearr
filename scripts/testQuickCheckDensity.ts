import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  QUICK_CHECK_LAYOUT,
  quickCheckCompactEvidenceFrameWidth,
  quickCheckLayoutAudit,
} from '../lib/quickCheckDensity';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const detail = read('app/share-jobs/[jobId].tsx');
const source = read('components/SourceEvidenceGallery.tsx');
const card = read('components/CandidateConfirmationCard.tsx');
const carousel = read('components/CandidatePhotoCarousel.tsx');
const header = read('components/ShareJobsHeader.tsx');
const rolodex = read('components/PhotoRolodex.tsx');

const pickerStart = detail.indexOf('if (isCandidatePicker)');
const pickerEnd = detail.indexOf('\n  return (', pickerStart + 1);
assert.ok(pickerStart > -1 && pickerEnd > pickerStart, 'Quick Check picker render boundary exists');
const picker = detail.slice(pickerStart, pickerEnd);

// 1-3. Quick Check owns a compact header/source line and no oversized hero.
assert.doesNotMatch(picker, /<VayrinPresentationHeader/);
assert.match(picker, /<ShareJobsHeader[^>]*compact/);
assert.match(header, /headerCompact: \{ paddingTop: Spacing\.xs, paddingBottom: Spacing\.sm \}/);
assert.match(picker, /styles\.quickCheckSourceRow/);
assert.match(picker, /<SourceEvidenceGallery[\s\S]*compact[\s\S]*dense/);
assert.match(source, /sectionDense/);
assert.equal(QUICK_CHECK_LAYOUT.headerHeight, 56);
assert.equal(QUICK_CHECK_LAYOUT.sourceLineHeight, 28);
assert.equal(QUICK_CHECK_LAYOUT.evidenceFrameHeight, 96);
assert.equal(QUICK_CHECK_LAYOUT.evidenceDotsHeight, 14);

// 4. Evidence stays a bounded, horizontally swipeable row at all target widths.
for (const width of [375, 390, 430]) {
  const tileWidth = quickCheckCompactEvidenceFrameWidth(width);
  assert.ok(tileWidth >= 148 && tileWidth <= 160, `${width}pt evidence tile stays bounded`);
  assert.ok(tileWidth * 2 + 8 <= width - 32, `${width}pt keeps two evidence tiles in the viewport`);
}
assert.match(source, /horizontal[\s\S]{0,140}nestedScrollEnabled/);
assert.match(source, /formatCandidateTimestamp/);
assert.match(source, /setViewerIndex\(index\)/);
assert.match(source, /<PhotoRolodexModal/);

// 5-7. Two rows fit modern iPhones; three rows need at most a short scroll.
const devices = [
  { width: 375, deviceHeight: 812, safeAreaBottom: 34 },
  { width: 390, deviceHeight: 844, safeAreaBottom: 34 },
  { width: 430, deviceHeight: 932, safeAreaBottom: 34 },
] as const;
for (const device of devices) {
  const two = quickCheckLayoutAudit({ ...device, candidateCount: 2 });
  const three = quickCheckLayoutAudit({ ...device, candidateCount: 3 });
  const twoLong = quickCheckLayoutAudit({ ...device, candidateCount: 2, longCandidate: true });
  assert.equal(two.requiredScroll, 0, `${device.width}pt shows two normal rows without scrolling`);
  assert.ok(three.requiredScroll <= 68, `${device.width}pt keeps candidate three within a short scroll`);
  assert.equal(twoLong.requiredScroll, 0, `${device.width}pt bounds two long-name rows`);
}
const smallPhone = quickCheckLayoutAudit({ deviceHeight: 667, safeAreaBottom: 21, candidateCount: 2 });
assert.ok(smallPhone.requiredScroll <= 33, 'a 667pt iPhone leaves only a small tail of candidate two below the fold');

// 8. Sticky CTA remains safe-area aware and scroll content clears it.
assert.match(picker, /testID="quick-check-sticky-save-bar"/);
assert.match(picker, /Math\.max\(safeAreaInsets\.bottom, Spacing\.sm\)/);
assert.ok(
  QUICK_CHECK_LAYOUT.scrollBottomPadding
    >= QUICK_CHECK_LAYOUT.stickyTopPadding + QUICK_CHECK_LAYOUT.stickyButtonHeight + 34,
  'scroll content clears the maximum modeled sticky CTA block',
);

// 9-12. Density does not change the image-left/info-right or interaction boundary.
assert.match(card, /compactRow: \{ flexDirection: 'row'/);
assert.ok(card.indexOf('<CandidatePhotoCarousel') < card.indexOf('<View style={styles.compactBody}>'));
assert.match(card, /testID="candidate-selection-control"/);
assert.match(card, /width: 44, height: 44/);
assert.match(card, /Why this match\?/);
assert.match(card, /hitSlop=\{6\}/);
assert.match(carousel, /variant === 'thumbnail'[\s\S]*setViewerIndex\(0\)/);
assert.match(carousel, /items=\{rolodexItems\}/);
assert.match(rolodex, /horizontal[\s\S]{0,240}snapToInterval/);

// 13-15. Text expansion is capped and missing evidence renders no empty placeholder.
assert.match(card, /numberOfLines=\{2\}>\{candidate\.name\}/);
assert.match(card, /numberOfLines=\{2\}>\{compactEvidence\}/);
assert.match(card, /\{compactEvidence \? \([\s\S]*\) : null\}/);
assert.ok(QUICK_CHECK_LAYOUT.candidateLongCardHeight <= 167);
assert.ok(QUICK_CHECK_LAYOUT.whyButtonHeight + 12 >= 44, 'Why control preserves a 44pt effective target');

console.log('PASS Quick Check density, two-row viewport, short three-row scroll, sticky CTA, accessibility, and interaction contracts');
