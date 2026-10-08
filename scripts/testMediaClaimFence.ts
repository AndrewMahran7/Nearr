import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateMediaClaimFence } from '../supabase/functions/process-share-jobs/mediaClaimFence';
const task = { status: 'processing', attempts: 2, locked_at: '2026-10-08T18:00:00.123Z' };
const claim = { attempt: 2, lockedAt: task.locked_at };
assert.equal(evaluateMediaClaimFence(task, claim).allowed, true);
for (const presented of [undefined, null, {}, { ...claim, attempt: 1 }, { ...claim, lockedAt: '2026-10-08T18:05:00Z' }, { ...claim, attempt: '2' }, { ...claim, lockedAt: 'invalid' }]) {
  assert.equal(evaluateMediaClaimFence(task, presented).allowed, false);
}
for (const status of ['queued', 'completed', 'failed', 'needs_help', 'cancelled']) {
  assert.equal(evaluateMediaClaimFence({ ...task, status }, claim).allowed, false);
}
const source = readFileSync('supabase/functions/process-share-jobs/index.ts', 'utf8');
const start = source.indexOf('async function finalizeMediaTask(');
assert.ok(source.indexOf('evaluateMediaClaimFence(task, body.claim)', start) < source.indexOf('// Parent derived', start));
assert.ok(source.indexOf('evaluateMediaClaimFence(task, body.claim)', start) < source.indexOf('parseMediaEvidence(body.evidence)', start));
console.log('PASS media claim callback fence: valid, missing, stale, invalid, terminal; before side effects');
