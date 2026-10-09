import './testFieldnotesReviewComponents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quickCheckCompactEvidenceFrameWidth } from '../lib/quickCheckDensity';

const read = (p: string) => readFileSync(p, 'utf8');
const detail = read('app/share-jobs/[jobId].tsx');
const source = read('components/SourceEvidenceGallery.tsx');
const card = read('components/CandidateConfirmationCard.tsx');
const pickerStart = detail.indexOf('if (isCandidatePicker)');
const pickerEnd = detail.indexOf('\n  return (', pickerStart + 1);
assert.ok(pickerStart > -1 && pickerEnd > pickerStart);
const picker = detail.slice(pickerStart, pickerEnd);
// The old fixed two-row point budget is intentionally replaced by scrollable,
// content-sized layout and actual long-text/component renders in the import above.
assert.match(picker, /<ShareJobsHeader[^>]*compact/);
assert.match(picker, /<SourceRibbon/);
assert.match(picker, /Is this the place\?/);
assert.match(picker, /sourceEvidence=.*SourceEvidenceGallery/);
assert.match(picker, /Previous possible place/);
assert.match(picker, /Next possible place/);
assert.match(picker, /setPickerSelectedIds\(\[confirmationCandidates\[next\]!.googlePlaceId\]\)/, 'navigation updates the candidate used by Save');
assert.match(picker, /testID="quick-check-sticky-save-bar"/);
assert.match(picker, /Math\.max\(safeAreaInsets\.bottom, Spacing\.sm\)/);
assert.match(picker, /automaticallyAdjustKeyboardInsets/);
assert.match(picker, /disabled=\{busy \|\| \(searchExpanded \? manualSelected\.length : pickerSelected\.length\) === 0\}/);
assert.match(card, /minHeight: 44/);
assert.match(card, /const stacked = width < 360 \|\| fontScale > 1\.25/);
assert.match(card, /stackedPane: \{ flex: 0, width: '100%'/);
for (const width of [320,375,390,430]) {
  const tile = quickCheckCompactEvidenceFrameWidth(width);
  assert.ok(tile >= 124 && tile <= 160);
  assert.ok(tile * 2 + 8 <= width - 32);
}
assert.match(source, /horizontal[\s\S]{0,140}nestedScrollEnabled/);
assert.match(source, /paired[\s\S]*measuredWidth/);
assert.match(source, /formatCandidateTimestamp/);
assert.match(source, /setViewerIndex\(index\)/);
console.log('PASS Fieldnotes Quick Check content-sized density, responsive evidence pair, bounded alternatives, sticky actions, keyboard and selection identity');
