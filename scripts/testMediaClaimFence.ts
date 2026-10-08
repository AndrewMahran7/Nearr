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
const mediaBody = source.slice(start, source.indexOf('async function ', start + 30));
assert.doesNotMatch(mediaBody, /saveForUser\(/, 'ordinary media save must use transactional claim boundary');
assert.match(source, /rpc\('commit_media_claim_candidate'/);
assert.match(source, /rpc\('write_media_claim_results'/);
assert.match(source, /rpc\('finalize_media_claim_parent'/);
assert.match(source, /committed\.error && !String\(committed\.error\.message\)\.includes\('obsolete_media_claim'\)/,
  'lost terminal commit response must retain authoritative settlement reconciliation');
console.log('PASS media claim callback fence: valid, missing, stale, invalid, terminal; before side effects');
