import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const queue = read('app/share-jobs/index.tsx');
const swipe = read('components/SwipeableRow.tsx');
const candidateSave = read('services/shareJobCandidateSave.ts');
const detail = read('app/share-jobs/[jobId].tsx');

assert.match(swipe, /react-native-gesture-handler\/Swipeable/);
assert.doesNotMatch(swipe, /PanResponder/, 'the JS-thread gesture implementation is gone');
assert.match(swipe, /friction=\{1\.65\}/);
assert.match(swipe, /leftThreshold=\{QUEUE_SWIPE_OPEN_THRESHOLD\}/);
assert.match(swipe, /rightThreshold=\{QUEUE_SWIPE_OPEN_THRESHOLD\}/);
assert.match(swipe, /overshootLeft=\{false\}/);
assert.match(swipe, /useNativeAnimations/);
assert.match(swipe, /onSwipeableWillOpen/);
assert.match(swipe, /coordinator\.open/);
assert.match(swipe, /accessibilityActions:/);
assert.match(swipe, /onAccessibilityAction:/);
assert.match(swipe, /minWidth: 64/);
assert.match(swipe, /minHeight: 64/);

assert.match(queue, /onScrollBeginDrag=\{\(\) => swipeCoordinator\.closeActive\(\)\}/);
assert.match(queue, /rowId=\{`completed:/, 'completed rows expose Remove');
assert.match(queue, /clearCompletedButton/);
assert.match(queue, /minHeight: 44/);
assert.match(queue, /saveResolvedQueueCandidate\(job, candidate\)/);
assert.doesNotMatch(queue, /cancelShareJob/, 'Remove never cancels backend work');
assert.match(queue, /archiveQueueJobs\(\[job\.id\]\)/, 'Remove persists durable server archival');
assert.match(queue, /addDismissedQueueIds/, 'Remove also keeps the local view synchronized');
assert.match(queue, /setDismissedIds\(previous\)/, 'failed dismissal restores exact prior state');

assert.match(candidateSave, /persistShareJobCandidate/);
assert.match(candidateSave, /sourceType: shareJobSourceType/);
assert.match(candidateSave, /sourceUrl: args\.sourceUrl/);
assert.match(candidateSave, /radiusValue: null/);
assert.match(candidateSave, /persistThenResolveQueueJob/);
assert.match(detail, /persistShareJobCandidate/, 'detail and swipe save share the authoritative mutation');

console.log('PASS queue native gesture, accessibility, dismissal, and canonical save contracts');
