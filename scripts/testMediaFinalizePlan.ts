/**
 * scripts/testMediaFinalizePlan.ts
 *
 * Unit tests for the pure media finalize decision logic
 * (supabase/functions/process-share-jobs/mediaFinalizePlan.ts). No Deno/IO.
 *
 * Covers the mission's finalizer cases: terminal task (duplicate/replay),
 * already-terminal / cancelled parent, malformed evidence, insufficient
 * evidence, retryable vs permanent worker failure, safe auto-save, the
 * auto-save-eligibility downgrade, and confirmation / manual routing.
 *
 * Run: npx ts-node -P scripts/tsconfig.json scripts/testMediaFinalizePlan.ts
 */

import {
  authorizeServiceRoleBearer,
  authorizeWorkerSecret,
  constantTimeEqual,
  extractBearerToken,
  planPreResolve,
  planPostResolve,
  isTerminalTaskStatus,
} from '../supabase/functions/process-share-jobs/mediaFinalizePlan';

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function pre(over: Partial<Parameters<typeof planPreResolve>[0]> = {}) {
  return planPreResolve({
    taskStatus: 'processing',
    parentStatus: 'processing_metadata',
    outcome: 'evidence',
    evidenceParseOk: true,
    renderedPlaces: 1,
    ...over,
  });
}

// ---- Terminal task = idempotent no-op (duplicate / replayed callback) ------
for (const s of ['completed', 'needs_help', 'failed', 'cancelled']) {
  check(`isTerminalTaskStatus ${s}`, isTerminalTaskStatus(s));
  const p = pre({ taskStatus: s });
  check(`terminal task ${s} => idempotent_task_terminal`, p.action === 'idempotent_task_terminal');
}
check('processing task is not terminal', !isTerminalTaskStatus('processing'));
check('queued task is not terminal', !isTerminalTaskStatus('queued'));

// ---- Parent already terminal => never revive -------------------------------
for (const s of ['cancelled', 'completed', 'needs_help', 'failed']) {
  const p = pre({ parentStatus: s });
  check(`parent ${s} => parent_already_terminal`, p.action === 'parent_already_terminal', JSON.stringify(p));
}

// ---- Worker outcomes -------------------------------------------------------
{
  const p = pre({ outcome: 'unavailable' });
  check('outcome unavailable => manual_fallback needs_help', p.action === 'manual_fallback' && (p as any).taskTerminalStatus === 'needs_help');
}
{
  const p = pre({ outcome: 'insufficient_evidence' });
  check(
    'retrieved media with no place evidence => insufficient_evidence',
    p.action === 'manual_fallback' &&
      (p as any).failureCode === 'insufficient_evidence' &&
      (p as any).taskTerminalStatus === 'needs_help',
  );
}
{
  const p = pre({ outcome: 'failed' });
  check('outcome failed => manual_fallback failed', p.action === 'manual_fallback' && (p as any).taskTerminalStatus === 'failed');
}
{
  const p = pre({ outcome: 'evidence', evidenceParseOk: false });
  check('malformed evidence => manual_fallback', p.action === 'manual_fallback' && (p as any).failureCode === 'evidence_parse_failed');
}
{
  const p = pre({ outcome: 'evidence', evidenceParseOk: true, renderedPlaces: 0 });
  check('insufficient evidence (0 rendered) => manual_fallback', p.action === 'manual_fallback' && (p as any).failureCode === 'insufficient_evidence');
}
{
  const p = pre({ outcome: 'evidence', evidenceParseOk: true, renderedPlaces: 2 });
  check('valid evidence => resolve', p.action === 'resolve');
}

// ---- Ordering: a terminal task wins even with an odd outcome ----------------
{
  const p = pre({ taskStatus: 'failed', outcome: 'evidence', renderedPlaces: 3 });
  check('terminal-task guard precedes everything', p.action === 'idempotent_task_terminal');
}
{
  // parent-terminal beats a would-be resolve
  const p = pre({ parentStatus: 'cancelled', outcome: 'evidence', renderedPlaces: 3 });
  check('parent-terminal guard precedes resolve', p.action === 'parent_already_terminal');
}

// ---- planPostResolve -------------------------------------------------------
{
  const p = planPostResolve({ route: 'auto_save', needsHelpMode: 'manual', autoSaveEligible: true });
  check('auto_save + eligible => auto_save', p.action === 'auto_save');
}
{
  const p = planPostResolve({ route: 'auto_save', needsHelpMode: 'manual', autoSaveEligible: false });
  check('auto_save + NOT eligible => needs_help single (downgraded)', p.action === 'needs_help' && p.mode === 'single' && p.downgraded === true);
}
for (const mode of ['single', 'multi', 'manual'] as const) {
  const p = planPostResolve({ route: 'needs_help', needsHelpMode: mode, autoSaveEligible: false });
  check(`needs_help ${mode} passthrough`, p.action === 'needs_help' && p.mode === mode && p.downgraded === false);
}

// ---- Callback authentication (service-role bearer, EXACT match) ------------
// The Deno request handler shares this exact function. These fail if production
// auth is ever weakened (prefix match, empty-key accept, scheme slip).
{
  const KEY = 'service-role-key-abc123';
  check('auth: exact bearer authorizes', authorizeServiceRoleBearer(`Bearer ${KEY}`, KEY) === true);
  check('auth: case-insensitive scheme authorizes', authorizeServiceRoleBearer(`bearer ${KEY}`, KEY) === true);
  check('auth: wrong token rejected', authorizeServiceRoleBearer('Bearer wrong', KEY) === false);
  check('auth: token prefix rejected', authorizeServiceRoleBearer(`Bearer ${KEY.slice(0, -1)}`, KEY) === false);
  check('auth: token superstring rejected', authorizeServiceRoleBearer(`Bearer ${KEY}x`, KEY) === false);
  check('auth: missing header rejected', authorizeServiceRoleBearer(null, KEY) === false);
  check('auth: empty header rejected', authorizeServiceRoleBearer('', KEY) === false);
  check('auth: non-bearer scheme rejected', authorizeServiceRoleBearer(`Basic ${KEY}`, KEY) === false);
  check('auth: bearer without token rejected', authorizeServiceRoleBearer('Bearer ', KEY) === false);
  check('auth: empty service key fails closed', authorizeServiceRoleBearer('Bearer anything', '') === false);
  check('auth: raw token without scheme rejected', authorizeServiceRoleBearer(KEY, KEY) === false);
  check('extractBearerToken parses token', extractBearerToken(`Bearer ${KEY}`) === KEY);
  check('extractBearerToken trims token', extractBearerToken('Bearer   spaced  ') === 'spaced');
  check('extractBearerToken non-bearer => empty', extractBearerToken('Basic xyz') === '');
}

// ---- Dedicated scheduler-secret authentication (constant-time) -------------
// The private worker endpoint's PRIMARY auth. Independent of the service-role
// key so a key rotation cannot break the scheduler. These fail if the check is
// ever weakened (prefix/superstring accept, empty-secret accept, length slip).
{
  const SECRET = 'wrk_9f3c1e7a5b2d4c8e6f0a1b2c3d4e5f60718293a4b5c6d7e8f9';
  check('worker: exact secret authorizes', authorizeWorkerSecret(SECRET, SECRET) === true);
  check('worker: wrong secret rejected', authorizeWorkerSecret('wrong', SECRET) === false);
  check('worker: prefix rejected', authorizeWorkerSecret(SECRET.slice(0, -1), SECRET) === false);
  check('worker: superstring rejected', authorizeWorkerSecret(`${SECRET}x`, SECRET) === false);
  check('worker: empty presented rejected', authorizeWorkerSecret('', SECRET) === false);
  check('worker: null presented rejected', authorizeWorkerSecret(null, SECRET) === false);
  check('worker: empty expected fails closed', authorizeWorkerSecret(SECRET, '') === false);
  check('worker: null expected fails closed', authorizeWorkerSecret(SECRET, null) === false);
  check('ct: equal strings match', constantTimeEqual(SECRET, SECRET) === true);
  check('ct: different-length mismatch', constantTimeEqual('abc', 'abcd') === false);
  check('ct: same-length one-char diff mismatch', constantTimeEqual('abcd', 'abce') === false);
  check('ct: both empty match', constantTimeEqual('', '') === true);
}

console.log(failures === 0 ? '\nALL MEDIA FINALIZE PLAN TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
