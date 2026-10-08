import assert from 'node:assert/strict';
import test from 'node:test';
import { monitorTaskClaim, taskClaim, sameTaskClaim, guardTaskClaim, parentClaimStillCurrent, ObsoleteTaskClaimError } from '../src/db/taskClaim.js';
import { requeueTask, setProgress, setTaskStatus } from '../src/db/tasks.js';
import { verifyPlaceEvidence } from '../src/pipeline/verifyPlaceEvidence.js';
import type { MediaTask } from '../src/types/media.js';

const task = { id: 'task', attempts: 2, locked_at: '2026-10-08T18:00:00.123Z', status: 'processing', task_kind: 'recognition', share_job_id: 'job', source_url: 'https://example.test/video', saved_place_id: null, target_place_id: null } as MediaTask;
function clientMock() {
  const state = {
    task: { ...task }, parent: { status: 'processing_metadata', saved_place_id: null as string | null, attempts: 1 },
    writes: [] as { table: string; patch: any; filters: [string, unknown][] }[],
  };
  const client: any = { from(table: string) {
    let patch: any = null; const filters: [string, unknown][] = [];
    const query: any = {
      select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      update(value: any) { patch = value; return query; },
      async maybeSingle() { return result(); },
      then(resolve: (v: any) => unknown, reject: (v: any) => unknown) { return Promise.resolve(result()).then(resolve, reject); },
    };
    function result() {
      const row = table === 'share_media_tasks' ? state.task : state.parent;
      const matched = filters.every(([key, value]) => key === 'id' || (row as any)[key] === value);
      if (patch && matched) { state.writes.push({ table, patch, filters }); Object.assign(row, patch); }
      return { data: matched ? { ...row } : null, error: null };
    }
    return query;
  } };
  return { state, client };
}
test('attempt plus locked timestamp fences retries and reset attempt cycles', () => {
  assert.deepEqual(taskClaim(task), { attempt: 2, lockedAt: task.locked_at });
  assert.equal(sameTaskClaim(task, task), true);
  assert.equal(sameTaskClaim(task, { ...task, attempts: 3 }), false);
  assert.equal(sameTaskClaim(task, { ...task, locked_at: '2026-10-08T18:05:00Z' }), false);
  assert.equal(sameTaskClaim(task, { ...task, status: 'queued' }), false);
  assert.throws(() => taskClaim({ attempts: 1, locked_at: null }), ObsoleteTaskClaimError);
});
test('all task write predicates carry both claim fields', () => {
  const predicates: any[] = [];
  const q: any = { eq(k: string, v: unknown) { predicates.push([k, v]); return q; } };
  guardTaskClaim(q, task);
  assert.deepEqual(predicates, [['id', task.id], ['status', 'processing'], ['attempts', 2], ['locked_at', task.locked_at]]);
});
test('stale progress, requeue and failure cannot mutate a newer claim', async () => {
  const { client, state } = clientMock(); state.task.attempts = 3;
  await assert.rejects(setProgress(client, task, 'analyzing_evidence'), ObsoleteTaskClaimError);
  await requeueTask(client, task, 30, 'download_failed');
  await setTaskStatus(client, task, 'failed');
  assert.equal(state.writes.length, 0);
  assert.equal(state.task.status, 'processing');
});
test('current claim can progress and schedule its own retry exactly once', async () => {
  const { client, state } = clientMock();
  await setProgress(client, task, 'analyzing_evidence');
  await requeueTask(client, task, 30, 'download_failed');
  assert.equal(state.task.status, 'queued');
  await setTaskStatus(client, task, 'failed');
  assert.equal(state.task.status, 'queued');
});
test('parent choices, failures, review and new attempts cancel; supplemental target survives', () => {
  const first = { status: 'processing_metadata', savedPlaceId: null, attempts: 1 };
  for (const status of ['completed', 'needs_help', 'failed', 'cancelled']) {
    assert.equal(parentClaimStillCurrent(first, { ...first, status }), false);
  }
  assert.equal(parentClaimStillCurrent(first, { ...first, attempts: 2 }), false);
  const supplemental = { status: 'completed', savedPlaceId: 'saved', attempts: 1 };
  assert.equal(parentClaimStillCurrent(supplemental, supplemental), true);
  assert.equal(parentClaimStillCurrent(supplemental, { ...supplemental, savedPlaceId: 'replacement' }), false);
});
test('monitor aborts in-flight provider when parent is superseded', async () => {
  const { client, state } = clientMock(); const controller = new AbortController();
  const monitor = monitorTaskClaim({ client, task, controller, intervalMs: 10 });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await monitor.check();
    const aborted = new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    state.parent.status = 'needs_help';
    await Promise.race([aborted, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('no abort')), 1000); })]);
    assert.equal(monitor.obsoleteReason(), 'parent_superseded_or_terminal');
    await assert.rejects(monitor.check(), ObsoleteTaskClaimError);
  } finally { clearTimeout(timeout); await monitor.stop(); }
});
test('callback carries original claim token when provider completes later', async () => {
  let sent: any;
  await verifyPlaceEvidence({ finalizeUrl: 'https://example.test/finalize', mediaFinalizeSecret: 'test' } as any,
    { taskId: task.id, claim: taskClaim(task), outcome: 'failed', analysisAttempted: false, signal: new AbortController().signal },
    (async (_url, init) => { sent = JSON.parse(String(init?.body)); return new Response('{}'); }) as typeof fetch);
  assert.deepEqual(sent.claim, { attempt: 2, lockedAt: task.locked_at });
});
