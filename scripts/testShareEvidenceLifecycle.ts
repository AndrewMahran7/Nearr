import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  deleteOwnedShareJob,
  evidencePathsForOwnedJob,
  type ShareEvidenceJob,
} from '../supabase/functions/_shared/shareEvidenceLifecycle';

const root = process.cwd();
const userId = '10000000-0000-4000-8000-000000000001';
const otherUserId = '20000000-0000-4000-8000-000000000002';
const jobId = '30000000-0000-4000-8000-000000000003';
const taskId = '40000000-0000-4000-8000-000000000004';
const path = (index: number) => `${userId}/${jobId}/${taskId}/${String(index).padStart(2, '0')}-${index}.jpg`;
const payload = {
  evidenceFrames: [0, 1, 2, 3, 4, 5].map((index) => ({ storagePath: path(index) })),
};

async function run() {
  const safe = evidencePathsForOwnedJob(payload, userId, jobId);
  assert.deepEqual(safe, [0, 1, 2, 3, 4].map(path), 'only five exact owned paths survive');
  assert.deepEqual(evidencePathsForOwnedJob({ evidenceFrames: [
    { storagePath: `${otherUserId}/${jobId}/${taskId}/00-0.jpg` },
    { storagePath: `${userId}/../${taskId}/00-0.jpg` },
    { storagePath: `${userId}/${jobId}/${taskId}/../../private.jpg` },
    { storagePath: `${userId}/${jobId}/${taskId}/not-an-image.png` },
  ] }, userId, jobId), [], 'cross-user and traversal paths are rejected');

  const job: ShareEvidenceJob & { queue_archived_at: string | null } = {
    id: jobId, user_id: userId, candidate_payload: payload, queue_archived_at: null,
  };
  const objects = new Set(safe);

  // Queue archive is visibility-only: row, recognition payload, and evidence stay.
  job.queue_archived_at = '2026-08-24T23:30:00.000Z';
  assert.equal(job.id, jobId);
  assert.equal((job.candidate_payload as typeof payload).evidenceFrames.length, 6);
  assert.equal(objects.size, 5);

  let rowExists = true;
  const deleted = await deleteOwnedShareJob({
    callerUserId: userId,
    job,
    removeEvidence: async (paths) => {
      for (const objectPath of paths) objects.delete(objectPath);
      return { data: paths.map((name) => ({ name })), error: null };
    },
    deleteRow: async () => {
      rowExists = false;
      return { error: null };
    },
  });
  assert.equal(deleted.status, 'deleted');
  assert.equal(objects.size, 0, 'legitimate deletion removes evidence');
  assert.equal(rowExists, false, 'legitimate deletion removes job after evidence');

  // A handler retry after the row is gone is a no-op success; the pure deletion
  // boundary also treats already-missing Storage objects as successful.
  let missingRowDeleteCalled = false;
  const missingObjects = await deleteOwnedShareJob({
    callerUserId: userId,
    job,
    removeEvidence: async () => ({ data: [], error: null }),
    deleteRow: async () => {
      missingRowDeleteCalled = true;
      return { error: null };
    },
  });
  assert.equal(missingObjects.status, 'deleted');
  assert.equal(missingRowDeleteCalled, true);

  let deleteCalledAfterFailure = false;
  const partialFailure = await deleteOwnedShareJob({
    callerUserId: userId,
    job,
    removeEvidence: async (paths) => ({ data: paths.slice(0, 2), error: { message: 'storage unavailable' } }),
    deleteRow: async () => {
      deleteCalledAfterFailure = true;
      return { error: null };
    },
  });
  assert.equal(partialFailure.status, 'evidence_cleanup_failed');
  assert.equal(partialFailure.removedEvidenceObjects, 2);
  assert.equal(deleteCalledAfterFailure, false, 'cleanup failure retains the row for retry');

  let crossUserMutation = false;
  const forbidden = await deleteOwnedShareJob({
    callerUserId: otherUserId,
    job,
    removeEvidence: async () => {
      crossUserMutation = true;
      return { error: null };
    },
    deleteRow: async () => {
      crossUserMutation = true;
      return { error: null };
    },
  });
  assert.equal(forbidden.status, 'forbidden');
  assert.equal(crossUserMutation, false);

  const service = readFileSync(join(root, 'services/shareJobsService.ts'), 'utf8');
  const queueUi = readFileSync(join(root, 'app/share-jobs/index.tsx'), 'utf8');
  const detailUi = readFileSync(join(root, 'app/share-jobs/[jobId].tsx'), 'utf8');
  const edge = readFileSync(join(root, 'supabase/functions/delete-share-job/index.ts'), 'utf8');
  const deploy = readFileSync(join(root, 'scripts/deployFunctions.mjs'), 'utf8');
  assert.doesNotMatch(service, /from\('share_jobs'\)\.delete\(/, 'mobile service cannot hard-delete jobs');
  assert.match(queueUi, /archiveQueueJobs/);
  assert.match(detailUi, /archiveShareJob/);
  assert.doesNotMatch(queueUi + detailUi, /deleteShareJob/);
  assert.match(edge, /admin\.auth\.getUser\(token\)/, 'server verifies the bearer identity');
  assert.match(edge, /deleteOwnedShareJob/, 'server uses ordered evidence-aware deletion');
  assert.doesNotMatch(edge, /\.list\(/, 'true deletion never sweeps a bucket prefix');
  assert.doesNotMatch(deploy, /NO_VERIFY_JWT[^;]*delete-share-job/s, 'JWT verification remains enabled');

  console.log('[test] share evidence lifecycle: 20 checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
