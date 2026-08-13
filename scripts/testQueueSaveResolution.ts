import assert from 'node:assert/strict';

import { persistThenResolveQueueJob } from '../lib/queueSaveResolution';

async function main() {
  const calls: string[] = [];
  const saved = await persistThenResolveQueueJob({
    jobId: 'owned-job-1',
    persist: async () => {
      calls.push('canonical-save');
      return { savedPlaceId: 'saved-1', duplicate: false };
    },
    resolve: async (jobId, savedPlaceId) => {
      calls.push(`resolve:${jobId}:${savedPlaceId}`);
    },
  });
  assert.deepEqual(saved, { savedPlaceId: 'saved-1', duplicate: false });
  assert.deepEqual(calls, ['canonical-save', 'resolve:owned-job-1:saved-1']);

  let duplicatePersists = 0;
  const duplicate = await persistThenResolveQueueJob({
    jobId: 'owned-job-2',
    persist: async () => {
      duplicatePersists += 1;
      return { savedPlaceId: 'existing-1', duplicate: true };
    },
    resolve: async () => undefined,
  });
  assert.equal(duplicatePersists, 1, 'duplicate handling never retries or double-saves');
  assert.deepEqual(duplicate, { savedPlaceId: 'existing-1', duplicate: true });

  let resolvedAfterFailure = false;
  await assert.rejects(
    persistThenResolveQueueJob({
      jobId: 'owned-job-3',
      persist: async () => { throw new Error('save failed'); },
      resolve: async () => { resolvedAfterFailure = true; },
    }),
    /save failed/,
  );
  assert.equal(resolvedAfterFailure, false, 'save failure leaves the queue item unresolved/recoverable');

  await assert.rejects(
    persistThenResolveQueueJob({
      jobId: 'owned-job-4',
      persist: async () => ({ savedPlaceId: 'saved-4', duplicate: false }),
      resolve: async () => { throw new Error('resolve failed'); },
    }),
    /resolve failed/,
    'resolution failure propagates so the row stays recoverable',
  );
}

void main().then(() => console.log('PASS canonical queue save and resolution orchestration'));
