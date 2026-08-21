/**
 * scripts/testE2EHarness.ts
 *
 * OFFLINE tests for the Tier 3 harness itself (Part 15).
 *
 * The deployed suite is the thing that will one day be the only reason a broken
 * Nearr-Dev is caught before Andrew's phone catches it. That makes its guards,
 * its configuration contract and its lifecycle assertions load-bearing code,
 * and load-bearing code gets tested — which is why every one of those pieces is
 * a pure function taking injected snapshots.
 *
 * NOTHING here touches the network, Supabase, Railway, or a model. It is safe
 * inside `npm run test:prebuild`, and it deliberately asserts that the DEPLOYED
 * commands are NOT in prebuild.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testE2EHarness.ts
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  EXPECTED_DEV_REF,
  PRODUCTION_REF,
  RAILWAY_PROJECT_ID,
  TargetRefusedError,
  assertDevelopmentRailway,
  assertDevelopmentSupabaseUrl,
  assertDevelopmentWorkerUrl,
  assertRefSourceIntact,
  refFromSupabaseUrl,
} from './e2e/target';
import {
  CROSS_SERVICE_MATCHED,
  EDGE_REQUIRED_PRESENT,
  EDGE_REQUIRED_TRUE,
  WORKER_REQUIRED_TRUE,
  evaluateContract,
  requiredFindings,
  advisoryFindings,
} from './e2e/contract';
import {
  StatusTrail,
  assertCheapPathSkippedMedia,
  assertEnqueuedFallbackHasTask,
  assertNoCreatorNameAutoSave,
  assertResolverIdentifiedAPlace,
  assertTerminalSuccessPersisted,
  assertWorkerCompletionFinalizedParent,
  isKnownJobProgress,
  isKnownTaskProgress,
  savedPlaceIdsOnPayload,
  taskWasClaimed,
  type JobRow,
  type TaskRow,
} from './e2e/lifecycle';
import { DEFAULT_TIMEOUTS, pollUntil, timeoutFor } from './e2e/poll';
import { StageReporter } from './e2e/report';

const REPO_ROOT = path.resolve(__dirname, '..');
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const TRUE_DIGEST = hash('true');

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function refuses(name: string, fn: () => unknown): void {
  try {
    fn();
    check(name, false, 'it returned instead of refusing');
  } catch (err) {
    check(name, err instanceof TargetRefusedError, `threw ${err instanceof Error ? err.name : 'unknown'}`);
  }
}

// ===========================================================================
// 1. Environment identity must fail closed
// ===========================================================================

const refs = assertRefSourceIntact();
check('the production and development refs are readable from devTarget.mjs', !!refs.productionRef && !!refs.devRef);
check('the two refs are distinct', refs.productionRef !== refs.devRef);
check(
  'the guard refuses the same production ref the deployment scripts refuse',
  PRODUCTION_REF === refs.productionRef,
);

check(
  'a development Supabase URL is accepted',
  assertDevelopmentSupabaseUrl(`https://${EXPECTED_DEV_REF}.supabase.co`, 'test') === EXPECTED_DEV_REF,
);
refuses('the PRODUCTION Supabase project is refused', () =>
  assertDevelopmentSupabaseUrl(`https://${PRODUCTION_REF}.supabase.co`, 'test'),
);
refuses('an unrecognised Supabase project is refused', () =>
  assertDevelopmentSupabaseUrl('https://aaaaaaaaaaaaaaaaaaaa.supabase.co', 'test'),
);
refuses('a missing Supabase URL is refused', () => assertDevelopmentSupabaseUrl('', 'test'));
refuses('a non-Supabase URL is refused as ambiguous', () =>
  assertDevelopmentSupabaseUrl('https://example.com', 'test'),
);
check('refFromSupabaseUrl ignores a non-Supabase host', refFromSupabaseUrl('https://example.com') === '');

const devRailway = {
  RAILWAY_ENVIRONMENT_NAME: 'development',
  RAILWAY_SERVICE_NAME: 'media-worker',
  RAILWAY_PROJECT_ID,
  RAILWAY_PUBLIC_DOMAIN: 'media-worker-development.up.railway.app',
};
check(
  'the development Railway lane is accepted',
  assertDevelopmentRailway(devRailway).environment === 'development',
);
refuses('the PRODUCTION Railway environment is refused', () =>
  assertDevelopmentRailway({ ...devRailway, RAILWAY_ENVIRONMENT_NAME: 'production' }),
);
refuses('the PRODUCTION Railway service is refused', () =>
  assertDevelopmentRailway({ ...devRailway, RAILWAY_SERVICE_NAME: 'Nearr' }),
);
refuses('an unrecognised Railway environment is refused', () =>
  assertDevelopmentRailway({ ...devRailway, RAILWAY_ENVIRONMENT_NAME: 'staging' }),
);
refuses('an unrecognised Railway project is refused', () =>
  assertDevelopmentRailway({ ...devRailway, RAILWAY_PROJECT_ID: 'not-the-project' }),
);
refuses('a Railway snapshot with no identity at all is refused', () => assertDevelopmentRailway({}));

check(
  'the development worker URL is accepted',
  assertDevelopmentWorkerUrl(
    'https://media-worker-development.up.railway.app',
    'media-worker-development.up.railway.app',
    'test',
  ) === 'https://media-worker-development.up.railway.app',
);
refuses('a worker URL that does not match the deployment is refused', () =>
  assertDevelopmentWorkerUrl(
    'https://media-worker-production.up.railway.app',
    'media-worker-development.up.railway.app',
    'test',
  ),
);
refuses('a non-HTTPS worker URL is refused', () =>
  assertDevelopmentWorkerUrl('http://media-worker-development.up.railway.app', '', 'test'),
);
refuses('a worker URL on an unknown host with nothing to compare against is refused', () =>
  assertDevelopmentWorkerUrl('https://somewhere-else.example.com', '', 'test'),
);
refuses('a missing worker URL is refused', () => assertDevelopmentWorkerUrl('', '', 'test'));

// ===========================================================================
// 2. The configuration contract catches the two real regressions
// ===========================================================================

function healthyEdge(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const flag of EDGE_REQUIRED_TRUE) out[flag] = TRUE_DIGEST;
  for (const name of EDGE_REQUIRED_PRESENT) out[name] = out[name] ?? hash(`value-of-${name}`);
  return out;
}
function healthyWorker(): Record<string, string> {
  return {
    MEDIA_FALLBACK_ENABLED: 'true',
    INSTAGRAM_MEDIA_RESOLVER_ENABLED: 'true',
    VAYRIN_VISUAL_GEOLOCATION_ENABLED: 'true',
    MEDIA_ANALYSIS_PROVIDER: 'gemini',
    MEDIA_TRANSCRIPTION_PROVIDER: 'openai',
    SUPABASE_URL: 'value-of-SUPABASE_URL',
    SUPABASE_SERVICE_ROLE_KEY: 'value-of-SUPABASE_SERVICE_ROLE_KEY',
    SHARE_MEDIA_WORKER_SECRET: 'value-of-SHARE_MEDIA_WORKER_SECRET',
    MEDIA_FINALIZE_SECRET: 'value-of-MEDIA_FINALIZE_SECRET',
    SHARE_JOBS_FINALIZE_URL: 'value-of-SHARE_JOBS_FINALIZE_URL',
    GEMINI_API_KEY: 'value-of-GEMINI_API_KEY',
    MEDIA_TRANSCRIPTION_API_KEY: 'value-of-MEDIA_TRANSCRIPTION_API_KEY',
  };
}

const healthy = evaluateContract({ edgeDigests: healthyEdge(), workerVars: healthyWorker(), hash });
check(
  'a correctly configured Nearr-Dev produces no required findings',
  requiredFindings(healthy).length === 0,
  requiredFindings(healthy).map((f) => f.id).join(', '),
);

// -- Regression 1: the exact flags that were missing -------------------------
for (const flag of EDGE_REQUIRED_TRUE) {
  const edge = healthyEdge();
  delete edge[flag];
  const findings = requiredFindings(evaluateContract({ edgeDigests: edge, workerVars: healthyWorker(), hash }));
  check(
    `a missing Edge ${flag} is a REQUIRED failure`,
    findings.some((f) => f.id === `edge.flag.${flag}.missing`),
    findings.map((f) => f.id).join(', '),
  );
  check(
    `the ${flag} failure explains the consequence`,
    findings.some((f) => f.id === `edge.flag.${flag}.missing` && /never enqueued|reads it as false/.test(f.message)),
  );
}

const flagSetToFalse = { ...healthyEdge(), MEDIA_FALLBACK_ENABLED: hash('false') };
check(
  'an Edge flag whose value is not the literal "true" is a REQUIRED failure',
  requiredFindings(evaluateContract({ edgeDigests: flagSetToFalse, workerVars: healthyWorker(), hash })).some(
    (f) => f.id === 'edge.flag.MEDIA_FALLBACK_ENABLED.not_true',
  ),
);
check(
  'the flag check never needs a plaintext value (sha256("true") is the whole test)',
  TRUE_DIGEST === 'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b',
);

for (const flag of WORKER_REQUIRED_TRUE) {
  const worker = healthyWorker();
  delete worker[flag];
  const findings = requiredFindings(evaluateContract({ edgeDigests: healthyEdge(), workerVars: worker, hash }));
  check(
    `a missing Railway ${flag} is a REQUIRED failure`,
    findings.some((f) => f.id === `worker.flag.${flag}.missing`),
  );
}

// -- Regression 2 (root cause shape): a cross-service secret mismatch --------
for (const name of CROSS_SERVICE_MATCHED) {
  const worker = { ...healthyWorker(), [name]: 'a-different-value' };
  const findings = requiredFindings(evaluateContract({ edgeDigests: healthyEdge(), workerVars: worker, hash }));
  check(
    `a ${name} mismatch between Edge and Railway is a REQUIRED failure`,
    findings.some((f) => f.id === `cross.${name}.mismatch`),
  );
  check(
    `the ${name} mismatch report contains no secret value`,
    findings.every((f) => !f.message.includes('a-different-value') && !f.remedy.includes('a-different-value')),
  );
}

// The platform-injected Edge service-role key legitimately differs from the
// copy pinned into Railway, so it must be reported WITHOUT failing readiness.
const serviceKeyDrift = evaluateContract({
  edgeDigests: healthyEdge(),
  workerVars: { ...healthyWorker(), SUPABASE_SERVICE_ROLE_KEY: 'a-platform-reissued-key' },
  hash,
});
check(
  'a service-role key difference is reported as advisory drift',
  advisoryFindings(serviceKeyDrift).some((f) => f.id === 'cross.SUPABASE_SERVICE_ROLE_KEY.drift'),
);
check(
  'a service-role key difference does NOT fail readiness (the Edge copy is platform-injected)',
  requiredFindings(serviceKeyDrift).length === 0,
  requiredFindings(serviceKeyDrift).map((f) => f.id).join(', '),
);
check(
  'a SUPABASE_URL mismatch is still required (the two services must address one project)',
  (CROSS_SERVICE_MATCHED as readonly string[]).includes('SUPABASE_URL'),
);

// -- Drift between the two sides --------------------------------------------
const driftWorker = { ...healthyWorker(), TIKTOK_MEDIA_RESOLVER_ENABLED: 'true' };
const drift = evaluateContract({ edgeDigests: healthyEdge(), workerVars: driftWorker, hash });
check(
  'a resolver flag on for the worker but off for the Edge is reported as drift',
  advisoryFindings(drift).some((f) => f.id === 'parity.TIKTOK_MEDIA_RESOLVER_ENABLED'),
);
check(
  'optional-platform drift does not fail the deployment',
  requiredFindings(drift).length === 0,
);
const requiredDrift = evaluateContract({
  edgeDigests: healthyEdge(),
  workerVars: { ...healthyWorker(), INSTAGRAM_MEDIA_RESOLVER_ENABLED: 'false' },
  hash,
});
check(
  'Instagram flag drift IS a required failure',
  requiredFindings(requiredDrift).some((f) => f.id.startsWith('parity.INSTAGRAM') || f.id.startsWith('worker.flag.INSTAGRAM')),
);

// -- Missing worker readiness variables -------------------------------------
const noServiceKey = healthyWorker();
delete noServiceKey.SUPABASE_SERVICE_ROLE_KEY;
check(
  'a missing Railway SUPABASE_SERVICE_ROLE_KEY is a REQUIRED failure',
  requiredFindings(evaluateContract({ edgeDigests: healthyEdge(), workerVars: noServiceKey, hash })).some(
    (f) => f.id === 'worker.var.SUPABASE_SERVICE_ROLE_KEY.absent',
  ),
);
check(
  'a wrong MEDIA_ANALYSIS_PROVIDER is a REQUIRED failure',
  requiredFindings(
    evaluateContract({
      edgeDigests: healthyEdge(),
      workerVars: { ...healthyWorker(), MEDIA_ANALYSIS_PROVIDER: 'heuristic' },
      hash,
    }),
  ).some((f) => f.id === 'worker.var.MEDIA_ANALYSIS_PROVIDER.unexpected'),
);

// ===========================================================================
// 3. Lifecycle assertions
// ===========================================================================

const jobTrail = new StatusTrail('job');
for (const status of ['queued', 'processing_metadata', 'needs_help']) jobTrail.observe(status);
check('a legal job path produces no violations', jobTrail.violations.length === 0, jobTrail.trail);
check('the job trail is human readable', jobTrail.trail === 'queued -> processing_metadata -> needs_help');

const illegalJob = new StatusTrail('job');
illegalJob.observe('completed');
illegalJob.observe('processing_metadata');
check('a terminal job going back to processing is a violation', illegalJob.violations.length === 1);

const legalRetry = new StatusTrail('task');
for (const status of ['queued', 'processing', 'queued', 'processing', 'needs_help']) legalRetry.observe(status);
check('a task retry (processing -> queued) is legal', legalRetry.violations.length === 0, legalRetry.trail);

const illegalTask = new StatusTrail('task');
illegalTask.observe('completed');
illegalTask.observe('queued');
check('a terminal task being requeued is a violation', illegalTask.violations.length === 1);

const unknownStatus = new StatusTrail('job');
unknownStatus.observe('queued');
unknownStatus.observe('processing_video');
check('an undeclared status is a violation', unknownStatus.violations.length === 1);

check('declared job progress stages are recognised', isKnownJobProgress('checking_video') && isKnownJobProgress(null));
check('an undeclared job progress stage is rejected', !isKnownJobProgress('inventing_things'));
check('declared task progress stages are recognised', isKnownTaskProgress('extracting_frames'));
check('an undeclared task progress stage is rejected', !isKnownTaskProgress('extracting_vibes'));

const queuedTask: TaskRow = {
  id: 't1',
  share_job_id: 'j1',
  status: 'queued',
  progress_stage: 'queued',
  attempts: 0,
  locked_at: null,
  failure_code: null,
};
const claimedTask: TaskRow = { ...queuedTask, status: 'processing', attempts: 1, locked_at: new Date().toISOString() };
check('an unclaimed task is not counted as claimed', !taskWasClaimed(queuedTask));
check('a claimed task is recognised by attempts + lease', taskWasClaimed(claimedTask));
check('a missing task is not claimed', !taskWasClaimed(null));

check(
  'media_fallback_enqueued with no media task FAILS',
  assertEnqueuedFallbackHasTask(true, null) !== null,
);
check('media_fallback_enqueued with a media task passes', assertEnqueuedFallbackHasTask(true, queuedTask) === null);
check('no fallback and no task passes', assertEnqueuedFallbackHasTask(false, null) === null);

const stuckParent: JobRow = {
  id: 'j1',
  status: 'processing_metadata',
  progress_stage: 'verifying_place',
  decision: null,
  saved_place_id: null,
};
check(
  'a completed worker with an unfinalized parent FAILS',
  assertWorkerCompletionFinalizedParent({ ...claimedTask, status: 'completed' }, stuckParent) !== null,
);
check(
  'a completed worker with a finalized parent passes',
  assertWorkerCompletionFinalizedParent({ ...claimedTask, status: 'completed' }, { ...stuckParent, status: 'needs_help' }) === null,
);

check(
  'a terminal auto_save with no saved_place_id FAILS',
  assertTerminalSuccessPersisted({ ...stuckParent, status: 'completed', decision: 'auto_save' }) !== null,
);
check(
  'a terminal auto_save with a saved place passes',
  assertTerminalSuccessPersisted({
    ...stuckParent,
    status: 'completed',
    decision: 'auto_save',
    saved_place_id: 'p1',
  }) === null,
);
check(
  'a completed job with no decision at all FAILS',
  assertTerminalSuccessPersisted({ ...stuckParent, status: 'completed' }) !== null,
);

check(
  'creator-name-only evidence that auto-saved FAILS',
  assertNoCreatorNameAutoSave({ ...stuckParent, status: 'completed', decision: 'auto_save' }) !== null,
);
check(
  'creator-name-only evidence that persisted a place FAILS even without auto_save',
  assertNoCreatorNameAutoSave({ ...stuckParent, status: 'completed', decision: 'candidate_confirmation', saved_place_id: 'p1' }) !== null,
);
check(
  'creator-name-only evidence routed to needs_help passes',
  assertNoCreatorNameAutoSave({ ...stuckParent, status: 'needs_help', decision: 'manual_fallback' }) === null,
);

check('the cheap path with no media task passes', assertCheapPathSkippedMedia(null) === null);
check('the cheap path that created a media task FAILS', assertCheapPathSkippedMedia(queuedTask) !== null);

// Every shape the pipeline uses to say "a place was identified". The auto-save
// route leaves candidate_payload.candidates EMPTY because there is nothing left
// to choose between — treating that as a resolver failure would report a
// working deployment as broken, which is exactly what it did on the first run.
check(
  'auto_save with a saved place counts as resolved even with zero candidates',
  assertResolverIdentifiedAPlace(
    { ...stuckParent, status: 'completed', decision: 'auto_save', saved_place_id: 'p1' },
    0,
  ) === null,
);
check(
  'a confirmation route with candidates and no saved place counts as resolved',
  assertResolverIdentifiedAPlace({ ...stuckParent, status: 'needs_help', decision: 'candidate_confirmation' }, 3) === null,
);
check(
  'a multi-place batch that recorded savedPlaceIds counts as resolved',
  assertResolverIdentifiedAPlace(
    { ...stuckParent, status: 'completed', decision: 'auto_save', candidate_payload: { savedPlaceIds: ['p1', 'p2'] } },
    0,
  ) === null,
);
check(
  'no saved place, no candidates and no batch saves FAILS',
  assertResolverIdentifiedAPlace({ ...stuckParent, status: 'needs_help', decision: 'manual_fallback' }, 0) !== null,
);
check(
  'savedPlaceIdsOnPayload ignores a payload without the field',
  savedPlaceIdsOnPayload({ ...stuckParent, candidate_payload: { candidates: [] } }).length === 0,
);

// ===========================================================================
// 4. Polling + timeouts
// ===========================================================================

void (async () => {
  let ticks = 0;
  const found = await pollUntil<number>(
    async () => {
      ticks += 1;
      return ticks;
    },
    (value) => value >= 3,
    { timeoutMs: 5_000, intervalMs: 1 },
  );
  check('pollUntil returns as soon as the predicate holds', found.ok && found.value === 3);

  const timedOut = await pollUntil<string>(
    async () => 'still_queued',
    () => false,
    { timeoutMs: 30, intervalMs: 1 },
  );
  check(
    'a timeout reports the LAST OBSERVED state rather than only the elapsed time',
    !timedOut.ok && timedOut.last === 'still_queued',
  );

  const missing = await pollUntil<string>(
    async () => null,
    () => true,
    { timeoutMs: 30, intervalMs: 1 },
  );
  check('a row that never appears is a timeout with no last value', !missing.ok && missing.last === null);

  // The reported elapsed time must not exceed the budget the failure message
  // quotes, so the sleep is clamped to whatever budget is left.
  const overshoot = await pollUntil<string>(
    async () => 'queued',
    () => false,
    { timeoutMs: 120, intervalMs: 5_000 },
  );
  check(
    'a long poll interval cannot overshoot the stage timeout',
    !overshoot.ok && overshoot.elapsedMs < 1_000,
    `elapsed=${overshoot.elapsedMs}ms for a 120ms budget`,
  );

  check('a stage timeout has a default', timeoutFor('railwayClaim') === DEFAULT_TIMEOUTS.railwayClaim);
  process.env.NEARR_E2E_TIMEOUT_RAILWAYCLAIM_MS = '5000';
  check('a stage timeout is overridable from the environment', timeoutFor('railwayClaim') === 5_000);
  process.env.NEARR_E2E_TIMEOUT_RAILWAYCLAIM_MS = '5';
  check('an implausibly small override is ignored', timeoutFor('railwayClaim') === DEFAULT_TIMEOUTS.railwayClaim);
  delete process.env.NEARR_E2E_TIMEOUT_RAILWAYCLAIM_MS;

  // =========================================================================
  // 5. Reporting
  // =========================================================================

  const reporter = new StageReporter('harness', 'nearr-e2e-selftest');
  reporter.identify({ jobId: 'job-123', taskId: 'task-456' });
  reporter.pass('create-share-job', 12);
  reporter.fail('Railway never claimed task', 30_000, 'no claim within 30s', { lastObservedTask: 'queued' });
  check('the reporter tracks failures', reporter.failures.length === 1);
  check('a run with a failure is not ok', !reporter.ok);
  check(
    'a failure carries the identifiers needed to search the deployed logs',
    JSON.stringify(reporter.failures[0].lastObserved).includes('job-123') &&
      JSON.stringify(reporter.failures[0].lastObserved).includes('task-456'),
  );
  const skipReporter = new StageReporter('harness', 'nearr-e2e-selftest-2');
  skipReporter.pass('a', 1);
  skipReporter.skip('b', 'paid');
  check('a skipped stage does not fail the run', skipReporter.ok);

  // =========================================================================
  // 6. The deployed suite must stay OUT of the deterministic local suite
  // =========================================================================

  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const prebuild = pkg.scripts['test:prebuild'] ?? '';
  for (const command of [
    'test:e2e:dev',
    'test:e2e:dev:config',
    'test:e2e:dev:dispatch',
    'test:e2e:dev:pipeline',
    'test:e2e:dev:safety',
    'test:e2e:dev:vayrin-live',
    'verify:dev:e2e',
  ]) {
    check(`package.json declares ${command}`, typeof pkg.scripts[command] === 'string');
    check(
      `test:prebuild does NOT run ${command}`,
      !new RegExp(`run ${command.replace(/:/g, ':')}(\\s|$|&)`).test(prebuild),
      'prebuild must stay offline and deterministic',
    );
  }
  check(
    'test:prebuild DOES run the offline harness test',
    /run test:e2e:harness(\s|$|&)/.test(prebuild),
  );
  check(
    'the deployed commands all target scripts/e2e/',
    ['test:e2e:dev', 'verify:dev:e2e'].every((name) => (pkg.scripts[name] ?? '').includes('scripts/e2e/')),
  );

  // The harness must never be able to reach production through a stray env var.
  const suiteSources = [
    'scripts/e2e/target.ts',
    'scripts/e2e/config.ts',
    'scripts/e2e/session.ts',
  ].map((file) => readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  check(
    'no E2E module hardcodes the production project ref',
    suiteSources.every((source) => !source.includes(PRODUCTION_REF)),
  );
  check(
    'the Railway environment is hardcoded rather than taken from a flag',
    suiteSources.some((source) => source.includes('EXPECTED_RAILWAY_ENVIRONMENT')) &&
      suiteSources.every((source) => !/--environment['"]?\s*,\s*(argv|process\.env)/.test(source)),
  );

  if (failures) {
    console.error(`\n${failures} E2E harness test(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll E2E harness tests passed.');
})();
