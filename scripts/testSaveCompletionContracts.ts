import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const detail = read('app/share-jobs/[jobId].tsx');
const queue = read('app/share-jobs/index.tsx');
const legacyQuickCheck = read('app/share.tsx');
const map = read('app/(tabs)/map.tsx');
const layout = read('app/_layout.tsx');

for (const source of [detail, queue, legacyQuickCheck]) {
  assert.match(source, /planSaveCompletionNavigation/, 'manual saves use the shared planner');
  assert.match(source, /executeSaveCompletionNavigation/, 'manual saves use the shared executor');
  assert.match(source, /claimSaveCompletionSignal/, 'manual saves claim cross-surface navigation once');
}
assert.match(queue, /saveResolvedQueueCandidate/);
assert.match(queue, /createdSavedPlaceIds: result\.duplicate \? \[\] : \[result\.savedPlaceId\]/);
const swipeSave = queue.slice(queue.indexOf('async function saveJob'), queue.indexOf('async function dismissCompleted'));
assert.doesNotMatch(swipeSave, /await refresh\(\)/, 'swipe save navigates instead of leaving the queue open');
assert.match(detail, /completeManualSave/, 'Quick Check uses one completion function');
assert.match(map, /shouldExpandSavedPlaceDetails\(placeSource\)/, 'post-save route opens details');
assert.match(layout, /claimSaveCompletionSignal\(\[sjRoute\.savedPlaceId\]\)/, 'notification cannot race a manual completion');

console.log('PASS shared single-save completion, queue teardown, detail open, and notification dedupe contracts');
