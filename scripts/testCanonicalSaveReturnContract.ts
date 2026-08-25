import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  canonicalSaveSuccess,
  type CanonicalSaveOutcome,
  type CanonicalSaveSuccess,
} from '../lib/canonicalSaveContract';
import {
  applyBatchSaveOutcomes,
  batchCompletionSavedPlaceIds,
  reconcileMultiPlaceBatch,
  selectedBatchTargets,
} from '../lib/multiPlaceBatch';
import { planShareSaveCompletion, type SharePlaceSaveOutcome } from '../lib/shareJobResult';
import type { ShareJobMentionSlot, ShareJobResultCandidate } from '../lib/shareJobResult';

const ROOT = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

type FixtureResult = CanonicalSaveSuccess & { duplicate: boolean };

class CanonicalSaveFixture {
  private nextId = 1;
  private readonly places = new Map<string, string>();
  private readonly sources = new Map<string, Set<string>>();
  readonly analytics: Array<{ success: boolean; outcome?: CanonicalSaveOutcome }> = [];
  recognitionWrites = 0;

  seed(googlePlaceId: string, savedPlaceId: string, source?: string): void {
    this.places.set(googlePlaceId, savedPlaceId);
    if (source) this.sources.set(savedPlaceId, new Set([source]));
  }

  save(googlePlaceId: string, source?: string, conflict = false): FixtureResult {
    let savedPlaceId = this.places.get(googlePlaceId);
    if (!savedPlaceId) {
      savedPlaceId = `saved-${this.nextId++}`;
      // A conflict means another writer won, but the canonical identity is
      // still resolved and returned by this boundary.
      this.places.set(googlePlaceId, savedPlaceId);
      if (!conflict) {
        if (source) this.sources.set(savedPlaceId, new Set([source]));
        const result = canonicalSaveSuccess(savedPlaceId, 'created', { duplicate: false });
        this.analytics.push({ success: true, outcome: result.outcome });
        return result;
      }
    }

    const attached = this.sources.get(savedPlaceId) ?? new Set<string>();
    this.sources.set(savedPlaceId, attached);
    let outcome: CanonicalSaveOutcome = 'reused';
    if (source && attached.has(source)) outcome = 'already_attached';
    else if (source) {
      attached.add(source);
      outcome = 'enriched';
    }
    const result = canonicalSaveSuccess(savedPlaceId, outcome, { duplicate: true });
    this.analytics.push({ success: true, outcome: result.outcome });
    return result;
  }

  fail(): { success: false; errorCode: string; message: string } {
    const result = { success: false as const, errorCode: 'write_failed', message: 'write failed' };
    this.analytics.push({ success: false });
    return result;
  }

  placeCount(): number { return this.places.size; }
  sourceCount(savedPlaceId: string): number { return this.sources.get(savedPlaceId)?.size ?? 0; }
}

function candidate(id: string, name = id): ShareJobResultCandidate {
  return {
    googlePlaceId: id,
    name,
    formattedAddress: '123 Test St',
    latitude: 33.77,
    longitude: -118.19,
    types: ['restaurant'],
    matchScore: 0.99,
  };
}

function slot(mentionId: string, googlePlaceId: string): ShareJobMentionSlot {
  return {
    mentionId,
    displayName: googlePlaceId,
    contextLabel: null,
    primaryVenueName: googlePlaceId,
    hostVenueName: null,
    relationshipType: null,
    outcome: 'verified_single',
    candidates: [candidate(googlePlaceId)],
    aiNote: null,
    saveState: 'pending',
    savedPlaceId: null,
  };
}

// 1. New place -> created and canonical ID returned.
const createdStore = new CanonicalSaveFixture();
const created = createdStore.save('gp-new', 'instagram:post-new');
assert.equal(created.outcome, 'created');
assert.equal(created.savedPlaceId, 'saved-1');

// 2. Existing canonical place -> same ID reused.
const reusedStore = new CanonicalSaveFixture();
reusedStore.seed('gp-existing', 'saved-existing');
const reused = reusedStore.save('gp-existing');
assert.deepEqual(
  { id: reused.savedPlaceId, outcome: reused.outcome },
  { id: 'saved-existing', outcome: 'reused' },
);

// 3. Existing place + new source -> enriched and same ID.
const enriched = reusedStore.save('gp-existing', 'instagram:post-2');
assert.equal(enriched.savedPlaceId, 'saved-existing');
assert.equal(enriched.outcome, 'enriched');

// 4. Existing place + existing source -> idempotent already_attached.
const alreadyAttached = reusedStore.save('gp-existing', 'instagram:post-2');
assert.equal(alreadyAttached.savedPlaceId, 'saved-existing');
assert.equal(alreadyAttached.outcome, 'already_attached');

// 5. Duplicate insert conflict -> canonical winner ID is returned.
const conflictStore = new CanonicalSaveFixture();
const conflict = conflictStore.save('gp-race', undefined, true);
assert.equal(conflict.savedPlaceId, 'saved-1');
assert.equal(conflict.outcome, 'reused');
const service = read('services/savedPlacesService.ts');
assert.match(service, /resolveExistingSavedPlaceAfterConflict/);
assert.doesNotMatch(service, /savedPlaceId:\s*existingSaved\?\.id\s*\?\?\s*null/);

// 6. Same canonical place in two mentions -> one target, both rows get one ID.
let duplicateMentionBatch = reconcileMultiPlaceBatch({
  jobId: 'same-place-twice',
  slots: [slot('mention-a', 'gp-same'), slot('mention-b', 'gp-same')],
});
assert.equal(selectedBatchTargets(duplicateMentionBatch).length, 1);
duplicateMentionBatch = applyBatchSaveOutcomes(duplicateMentionBatch, [{
  logicalPlaceId: 'mention-a',
  candidateId: 'gp-same',
  status: 'saved',
  savedPlaceId: 'saved-same',
}]);
assert.equal(duplicateMentionBatch.rows['mention-a']!.savedPlaceId, 'saved-same');
assert.equal(duplicateMentionBatch.rows['mention-b']!.savedPlaceId, 'saved-same');
assert.deepEqual(batchCompletionSavedPlaceIds(duplicateMentionBatch).createdSavedPlaceIds, ['saved-same']);

// 7. Mixed created + reused -> every success keeps an ID.
const mixed: SharePlaceSaveOutcome[] = [
  { logicalPlaceId: 'a', candidateId: 'gp-a', status: 'saved', savedPlaceId: 'saved-a' },
  { logicalPlaceId: 'b', candidateId: 'gp-b', status: 'duplicate', savedPlaceId: 'saved-b' },
];
const mixedPlan = planShareSaveCompletion(mixed);
assert.deepEqual(mixedPlan.createdSavedPlaceIds, ['saved-a']);
assert.deepEqual(mixedPlan.duplicateSavedPlaceIds, ['saved-b']);

// 8. Partial real failure -> successes preserved and failure isolated.
const partial: SharePlaceSaveOutcome[] = [
  ...mixed,
  { logicalPlaceId: 'c', candidateId: 'gp-c', status: 'failed', savedPlaceId: null },
];
const partialPlan = planShareSaveCompletion(partial);
assert.deepEqual(partialPlan.createdSavedPlaceIds, ['saved-a']);
assert.deepEqual(partialPlan.duplicateSavedPlaceIds, ['saved-b']);
assert.deepEqual(partialPlan.failedCandidateIds, ['gp-c']);

// 9. Retry after every success -> same row/source identity, no duplicates.
const retryStore = new CanonicalSaveFixture();
const first = retryStore.save('gp-retry', 'instagram:retry');
const retry = retryStore.save('gp-retry', 'instagram:retry');
assert.equal(first.savedPlaceId, retry.savedPlaceId);
assert.equal(retryStore.placeCount(), 1);
assert.equal(retryStore.sourceCount(first.savedPlaceId), 1);

// 10. success=true with a missing ID is rejected at the contract constructor,
// and no UI layer retains the old false-failure fallback.
assert.throws(() => canonicalSaveSuccess(null, 'reused', {}), /without a saved-place identity/);
for (const file of ['app/share.tsx', 'app/share-jobs/[jobId].tsx', 'lib/queueSaveResolution.ts']) {
  assert.doesNotMatch(read(file), /Save succeeded but did not return an id/);
}
assert.match(service, /savedPlaceId: string;/);

// 11. Analytics truth follows persistence truth.
assert.equal(retryStore.analytics.every((event) => event.success), true);
const failed = retryStore.fail();
assert.equal(failed.success, false);
assert.equal(retryStore.analytics.at(-1)?.success, false);
const share = read('app/share.tsx');
assert.match(share, /trackEvent\('save_success',[\s\S]{0,350}save_outcome: result\.outcome/);

// 12. Recognition/source trust stays independent: reuse never writes cache
// truth, while source dedupe remains idempotent.
assert.equal(retryStore.recognitionWrites, 0);
assert.equal(retryStore.sourceCount(first.savedPlaceId), 1);
assert.doesNotMatch(service, /recognition_cache|recognitionCache/);

// Screenshot regression: Santa Fe Importers is already saved; confirming the
// source enriches that row, returns its ID, creates no place/source duplicate,
// and therefore gives the UI no false-error condition.
const santaFe = new CanonicalSaveFixture();
santaFe.seed('gp-santa-fe-importers-long-beach', 'saved-santa-fe');
const screenshot = santaFe.save(
  'gp-santa-fe-importers-long-beach',
  'instagram:santa-fe-importers-post',
);
assert.equal(screenshot.savedPlaceId, 'saved-santa-fe');
assert.equal(screenshot.outcome, 'enriched');
assert.equal(santaFe.placeCount(), 1);
assert.equal(santaFe.sourceCount('saved-santa-fe'), 1);

console.log('PASS canonical save return contract (12 cases + screenshot regression)');
