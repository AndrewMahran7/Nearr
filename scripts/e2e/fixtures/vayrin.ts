/**
 * scripts/e2e/fixtures/vayrin.ts
 *
 * FIXTURE C — the live model boundary, and the only thing in this suite that
 * can spend money (Parts 12 and 13).
 *
 * WHAT IT PROVES: that on the deployed development worker, a real public video
 * still travels media -> frames -> the real provider -> a structured hypothesis
 * -> the finalizer. It is a SERVICE-BOUNDARY canary, not an intelligence
 * benchmark: the pass condition is that each hop happened and the finalizer
 * accepted a structured payload. Whether the model named the right place is
 * reported, but only as a WARN, because a model that is having a bad day is not
 * a deployment defect and must not block physical QA.
 *
 * WHY THE SOURCE URL IS NOT BAKED IN: every candidate default rots. A social
 * post gets deleted, a long video breaches MEDIA_MAX_DURATION_SECONDS, a
 * Wikimedia file is not on the worker's host allowlist and adding it would mean
 * loosening a production SSRF control to suit a test. Requiring the operator to
 * name the clip keeps the paid path deliberate, which is exactly what Part 12
 * asks for, and keeps the suite from going red for reasons that have nothing to
 * do with Nearr.
 *
 * COST CEILING: the task is inserted with max_attempts = 1, so the claim RPC
 * can hand it to the worker exactly once. There is no retry budget to burn and
 * no way for this fixture to loop.
 */

import { pollUntil, timeoutFor } from '../poll';
import { StageReporter } from '../report';
import { JOB_TERMINAL, StatusTrail, TASK_TERMINAL, type TaskRow } from '../lifecycle';
import { correlationKeyFor, type E2ESession } from '../session';
import { readJob, readTaskForJob } from './shared';

/** Worst case for ONE attempt: transcription, evidence analysis, OCR, Vayrin. */
export const MAX_LIVE_MODEL_CALLS = 4;

export function printLiveModelBanner(sourceUrl: string, model: string): void {
  console.log('');
  console.log('  LIVE MODEL TEST');
  console.log(`  estimated maximum calls : ${MAX_LIVE_MODEL_CALLS} (1 transcription, 1 evidence analysis, 1 OCR, 1 Vayrin visual geolocation)`);
  console.log('  attempts allowed        : 1 (the task is inserted with max_attempts=1, so there is no retry spend)');
  console.log(`  vayrin model            : ${model}`);
  console.log(`  source                  : ${sourceUrl}`);
  console.log('  target                  : Nearr-Dev + the Railway development media-worker');
  console.log('');
}

export type VayrinCanaryOptions = {
  /** Public video URL on a platform the deployed worker has a resolver for. */
  sourceUrl: string;
  /** Platform name the worker's resolvers match on. */
  platform: string;
  /** Optional ground truth. Reported as a WARN when missed, never a FAIL. */
  groundTruth?: string;
};

export function resolveCanaryOptions(): VayrinCanaryOptions | { error: string } {
  const sourceUrl = (process.env.NEARR_E2E_VAYRIN_URL || '').trim();
  if (!sourceUrl) {
    return {
      error:
        'NEARR_E2E_VAYRIN_URL is not set.\n\n' +
        'The live canary is deliberately not given a default URL: any baked-in clip eventually\n' +
        'rots, and a paid test that fails for an unrelated reason is worse than no test.\n\n' +
        'Choose a PUBLIC video that:\n' +
        '  - is on a platform the deployed worker resolves (instagram, tiktok, youtube,\n' +
        '    facebook or snapchat — see services/media-worker/src/resolvers/),\n' +
        '  - is shorter than MEDIA_MAX_DURATION_SECONDS (currently 180s on Nearr-Dev),\n' +
        '  - shows a place that is identifiable visually but NOT named in its metadata.\n\n' +
        'The frozen shipping gate in artifacts/vayrin/shipping-gate-fixtures.json describes the\n' +
        'kind of case this is for (dettifoss_hidden_natural is the canonical one).\n\n' +
        'Then:\n' +
        '  NEARR_E2E_VAYRIN_URL="https://..." NEARR_E2E_VAYRIN_PLATFORM=youtube \\\n' +
        '    NEARR_E2E_VAYRIN_TRUTH="Dettifoss" npm run test:e2e:dev:vayrin-live',
    };
  }
  const platform = (process.env.NEARR_E2E_VAYRIN_PLATFORM || '').trim().toLowerCase();
  if (!platform) {
    return { error: 'NEARR_E2E_VAYRIN_PLATFORM is not set (instagram | tiktok | youtube | facebook | snapchat).' };
  }
  return {
    sourceUrl,
    platform,
    groundTruth: (process.env.NEARR_E2E_VAYRIN_TRUTH || '').trim() || undefined,
  };
}

export async function fixtureVayrinLiveCanary(
  reporter: StageReporter,
  session: E2ESession,
  options: VayrinCanaryOptions,
): Promise<boolean> {
  const name = 'Fixture C — live Vayrin model boundary';
  const identity = session.identity;
  if (!identity) {
    reporter.fail(`${name}: setup`, 0, 'no ephemeral identity for this run');
    return false;
  }

  const correlationKey = correlationKeyFor(session.correlationId, 'vayrin-live');
  const { data: jobInsert, error: jobError } = await session.admin
    .from('share_jobs')
    .insert({
      user_id: identity.userId,
      source_url: options.sourceUrl,
      canonical_url: options.sourceUrl,
      source_platform: options.platform,
      status: 'processing_metadata',
      progress_stage: 'checking_video',
      idempotency_key: correlationKey,
      locked_until: new Date(Date.now() + 30 * 60_000).toISOString(),
    })
    .select('id')
    .single();
  if (jobError || !jobInsert) {
    reporter.fail(`${name}: setup`, 0, `could not create the parent job: ${jobError?.message ?? 'unknown'}`);
    return false;
  }
  const jobId = (jobInsert as { id: string }).id;
  session.trackedJobIds.push(jobId);

  const { data: taskInsert, error: taskError } = await session.admin
    .from('share_media_tasks')
    .insert({
      share_job_id: jobId,
      user_id: identity.userId,
      source_url: options.sourceUrl,
      canonical_url: options.sourceUrl,
      platform: options.platform,
      status: 'queued',
      progress_stage: 'queued',
      // The cost ceiling. One claim, one run, no retry spend.
      max_attempts: 1,
    })
    .select('id')
    .single();
  if (taskError || !taskInsert) {
    reporter.fail(`${name}: setup`, 0, `could not create the media task: ${taskError?.message ?? 'unknown'}`);
    return false;
  }
  const taskId = (taskInsert as { id: string }).id;
  reporter.identify({ jobId, taskId });
  reporter.pass(`${name}: task enqueued`, 0, `task ${taskId} (max_attempts=1)`);

  const trail = new StatusTrail('task');
  const claimed = await pollUntil<TaskRow>(
    async () => {
      const row = await readTaskForJob(session.admin, jobId);
      trail.observe(row?.status);
      return row;
    },
    (row) => row.attempts >= 1 && row.locked_at != null,
    { timeoutMs: timeoutFor('railwayClaim'), intervalMs: 2_000 },
  );
  if (!claimed.ok) {
    reporter.fail(`${name}: Railway claimed the task`, claimed.elapsedMs, 'no claim before the timeout', {
      taskStatusTrail: trail.trail,
      lastObservedTask: claimed.last ?? null,
    });
    return false;
  }
  reporter.pass(`${name}: Railway claimed the task`, claimed.elapsedMs, `attempts=${claimed.value.attempts}`);

  // The model boundary needs the whole acquisition + analysis pipeline, so this
  // waits on the union of the media and model budgets.
  const terminal = await pollUntil<TaskRow>(
    async () => {
      const row = await readTaskForJob(session.admin, jobId);
      trail.observe(row?.status);
      return row;
    },
    (row) => TASK_TERMINAL.has(row.status),
    { timeoutMs: timeoutFor('workerStage') + timeoutFor('finalize'), intervalMs: 3_000 },
  );
  if (!terminal.ok) {
    reporter.fail(
      `${name}: task completed`,
      terminal.elapsedMs,
      'the worker claimed the task but never finished it',
      { taskStatusTrail: trail.trail, lastObservedTask: terminal.last ?? null },
    );
    return false;
  }

  const task = terminal.value;
  if (task.failure_code === 'unsupported_platform' || task.failure_code === 'unsupported_url') {
    reporter.fail(
      `${name}: media acquisition`,
      terminal.elapsedMs,
      `the deployed worker has no enabled resolver for platform "${options.platform}" — set NEARR_E2E_VAYRIN_PLATFORM to a platform whose *_MEDIA_RESOLVER_ENABLED flag is true on Railway`,
      { failure_code: task.failure_code },
    );
    return false;
  }
  if (task.failure_code === 'private_or_unavailable' || task.failure_code === 'duration_too_long' || task.failure_code === 'file_too_large') {
    reporter.fail(
      `${name}: media acquisition`,
      terminal.elapsedMs,
      `the canary SOURCE is unusable (${task.failure_code}), not the pipeline — pick another NEARR_E2E_VAYRIN_URL`,
      { failure_code: task.failure_code, sourceUrl: options.sourceUrl },
    );
    return false;
  }
  reporter.pass(
    `${name}: media acquisition + analysis completed`,
    terminal.elapsedMs,
    `task status=${task.status} failure_code=${task.failure_code ?? 'null'}`,
  );

  // ---- The model boundary itself -----------------------------------------
  // share_media_runs is the worker's own record of the run: how many frames it
  // selected, which providers it invoked, and the structured model output the
  // finalizer was handed. It is the only place that distinguishes "the model
  // was called and answered" from "the model was never reached".
  const { data: runs } = await session.admin
    .from('share_media_runs')
    .select('id,frame_count,model_provider,transcription_provider,model_output,evidence,errors,duration_ms')
    .eq('share_job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1);
  const run = Array.isArray(runs) && runs.length > 0 ? (runs[0] as Record<string, unknown>) : null;

  if (!run) {
    reporter.fail(
      `${name}: model boundary reached`,
      0,
      'no share_media_runs row was written, so the worker never reached the analysis stage',
      { jobId, taskId },
    );
    return false;
  }

  const frameCount = Number(run.frame_count ?? 0);
  if (!Number.isFinite(frameCount) || frameCount <= 0) {
    reporter.fail(`${name}: frames selected`, 0, `frame_count=${String(run.frame_count)}`, {
      errors: run.errors ?? null,
    });
    return false;
  }
  reporter.pass(`${name}: frames selected`, 0, `${frameCount} frame(s) sent to the model adapter`);

  if (!run.model_provider) {
    reporter.fail(`${name}: model adapter invoked`, 0, 'share_media_runs recorded no model_provider', {
      errors: run.errors ?? null,
    });
    return false;
  }
  reporter.pass(
    `${name}: model adapter invoked`,
    0,
    `model_provider=${String(run.model_provider)} transcription=${String(run.transcription_provider ?? 'none')}`,
  );

  if (!run.model_output || typeof run.model_output !== 'object') {
    reporter.fail(`${name}: structured response accepted`, 0, 'no structured model_output was persisted');
    return false;
  }
  reporter.pass(
    `${name}: structured response accepted`,
    0,
    `structured model output persisted (${JSON.stringify(run.model_output).length} bytes), evidence summary present=${!!run.evidence}`,
  );

  // ---- Finalizer ----------------------------------------------------------
  const jobTrail = new StatusTrail('job');
  const finalized = await pollUntil(
    async () => {
      const row = await readJob(session.admin, jobId);
      jobTrail.observe(row?.status);
      return row;
    },
    (row) => JOB_TERMINAL.has(row.status),
    { timeoutMs: timeoutFor('terminal'), intervalMs: 2_000 },
  );
  if (!finalized.ok) {
    reporter.fail(
      `${name}: finalizer received the payload`,
      finalized.elapsedMs,
      'the media task finished but the parent job never moved',
      { jobStatusTrail: jobTrail.trail, lastObservedJob: finalized.last ?? null },
    );
    return false;
  }
  reporter.pass(
    `${name}: finalizer received the payload`,
    finalized.elapsedMs,
    `job status=${finalized.value.status} decision=${finalized.value.decision ?? 'null'}`,
  );

  // ---- Recognition, reported but never blocking ---------------------------
  if (options.groundTruth) {
    const haystack = JSON.stringify({ output: run.model_output, evidence: run.evidence }).toLowerCase();
    const needle = options.groundTruth.toLowerCase().split(',')[0].trim();
    if (needle && haystack.includes(needle)) {
      reporter.pass(`${name}: recognised the ground truth`, 0, `"${options.groundTruth}" appears in the model output`);
    } else {
      reporter.warn(
        `${name}: recognised the ground truth`,
        `"${options.groundTruth}" was NOT in the model output. The service boundary is healthy, so this does not block physical QA — but it is worth a look at the recognition quality.`,
      );
    }
  }

  return true;
}
