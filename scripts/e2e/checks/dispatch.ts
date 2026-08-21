/**
 * scripts/e2e/checks/dispatch.ts
 *
 * PART 5 — proof that an enqueued media task actually reaches Railway.
 *
 * This is the test the suite exists for. The second production failure was not
 * a logic bug: `share_media_tasks` rows were created correctly and then sat
 * there, because the DISPATCH mechanism is deliberately silent when it is not
 * configured. Read supabase/migrations/20260801000002_share_media_worker.sql —
 * `invoke_process_media_tasks()` returns without raising when the Vault secrets
 * `share_media_worker_url` / `share_media_worker_secret` are missing, and
 * swallows every pg_net error, because durability is meant to come from the
 * per-minute pg_cron sweep. If BOTH legs are unconfigured, the queue fills up
 * and nothing anywhere reports a problem.
 *
 * The architecture is HYBRID:
 *   push  — an AFTER INSERT statement trigger fires net.http_post at the
 *           worker's /v1/process-media-tasks for low latency;
 *   pull  — a per-minute pg_cron job calls the same function as the backstop;
 *   claim — the worker then PULLS with claim_media_tasks() (FOR UPDATE SKIP
 *           LOCKED), which is what actually takes ownership.
 *
 * So the only honest proof is empirical: insert a real row, touch nothing else,
 * and watch for the worker to claim it. A claim means the whole chain — trigger
 * or cron, Vault config, worker URL, worker secret, container liveness, claim
 * RPC grants — is intact. Nothing short of that proves it.
 *
 * WHEN IT FAILS, it immediately runs a differential: POST the same invocation
 * the database would have made, directly, from here. If the task is claimed
 * then, the worker is healthy and the DATABASE-side dispatch is broken. If it
 * is still not claimed, the break is on the worker side. That single extra
 * request turns "Railway never claimed the task" into an actionable finding.
 *
 * COST: free. The probe task carries a platform no resolver matches, so the
 * worker claims it, fails `selectResolver` immediately with
 * `unsupported_platform`, and finalizes. No media is downloaded and no model is
 * called — but the claim, the finalize callback, the parent transition and the
 * terminal task state are all real.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { pollUntil, timeoutFor } from '../poll';
import { StageReporter } from '../report';
import {
  StatusTrail,
  TASK_TERMINAL,
  JOB_TERMINAL,
  taskWasClaimed,
  assertWorkerCompletionFinalizedParent,
  type JobRow,
  type TaskRow,
} from '../lifecycle';
import { correlationKeyFor, type E2ESession } from '../session';

/**
 * A platform string no resolver matches, so the worker stops at its very first
 * boundary. Every resolver's `supports()` requires an exact platform name
 * ('instagram' / 'tiktok' / ...), so this can never be picked up by accident,
 * and it can never be produced by `detectPlatform` for a real share.
 */
const PROBE_PLATFORM = 'nearr_e2e_probe';

const TASK_COLUMNS = 'id,share_job_id,status,progress_stage,attempts,locked_at,failure_code';
const JOB_COLUMNS = 'id,status,progress_stage,decision,saved_place_id,failure_reason';

async function readTask(admin: SupabaseClient, taskId: string): Promise<TaskRow | null> {
  const { data } = await admin.from('share_media_tasks').select(TASK_COLUMNS).eq('id', taskId).maybeSingle();
  return (data as TaskRow | null) ?? null;
}

async function readJob(admin: SupabaseClient, jobId: string): Promise<JobRow | null> {
  const { data } = await admin.from('share_jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle();
  return (data as JobRow | null) ?? null;
}

/** The exact request the database's `invoke_process_media_tasks()` makes. */
async function invokeWorkerDirectly(
  baseUrl: string,
  secret: string,
): Promise<{ status: number; body: string } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${baseUrl}/v1/process-media-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ trigger: 'db', limit: 2 }),
      signal: controller.signal,
    });
    return { status: response.status, body: (await response.text().catch(() => '')).slice(0, 500) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function runMediaDispatchProof(
  reporter: StageReporter,
  session: E2ESession,
): Promise<boolean> {
  const { admin, config, correlationId } = session;
  const identity = session.identity;
  if (!identity) {
    reporter.fail('media dispatch proof', 0, 'no ephemeral identity was created for this run');
    return false;
  }

  const correlationKey = correlationKeyFor(correlationId, 'dispatch');
  const probeUrl = `https://dispatch-probe.nearr-e2e.invalid/${correlationId}`;

  // ---- Parent share job ---------------------------------------------------
  // Inserted already PARKED: status processing_metadata (which claim_media_tasks
  // requires of a parent) with a long lease, so the metadata sweep leaves it
  // alone and the ONLY thing that can move this row is the media worker. That
  // isolation is what makes a failure attributable to the dispatch chain.
  const jobStarted = Date.now();
  const parkedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
  const { data: jobInsert, error: jobError } = await admin
    .from('share_jobs')
    .insert({
      user_id: identity.userId,
      source_url: probeUrl,
      canonical_url: probeUrl,
      source_platform: PROBE_PLATFORM,
      status: 'processing_metadata',
      progress_stage: 'checking_video',
      idempotency_key: correlationKey,
      locked_until: parkedUntil,
    })
    .select('id')
    .single();

  if (jobError || !jobInsert) {
    reporter.fail('parent share job created', Date.now() - jobStarted, `insert failed: ${jobError?.message ?? 'unknown'}`);
    return false;
  }
  const jobId = (jobInsert as { id: string }).id;
  session.trackedJobIds.push(jobId);
  reporter.identify({ jobId, userId: identity.userId });
  reporter.pass('parent share job created', Date.now() - jobStarted, `job ${jobId} parked in processing_metadata`);

  // ---- Media task ---------------------------------------------------------
  const taskStarted = Date.now();
  const { data: taskInsert, error: taskError } = await admin
    .from('share_media_tasks')
    .insert({
      share_job_id: jobId,
      user_id: identity.userId,
      source_url: probeUrl,
      canonical_url: probeUrl,
      platform: PROBE_PLATFORM,
      status: 'queued',
      progress_stage: 'queued',
    })
    .select('id')
    .single();

  if (taskError || !taskInsert) {
    reporter.fail(
      'media task inserted',
      Date.now() - taskStarted,
      `insert failed: ${taskError?.message ?? 'unknown'}`,
      { jobId },
    );
    return false;
  }
  const taskId = (taskInsert as { id: string }).id;
  reporter.identify({ taskId });
  reporter.pass(
    'media task inserted',
    Date.now() - taskStarted,
    `task ${taskId} queued — the AFTER INSERT pg_net kick has now fired (or silently no-opped)`,
  );

  // ---- The claim ----------------------------------------------------------
  const taskTrail = new StatusTrail('task');
  const claimTimeout = timeoutFor('railwayClaim');
  const claim = await pollUntil<TaskRow>(
    async () => {
      const row = await readTask(admin, taskId);
      taskTrail.observe(row?.status);
      return row;
    },
    (row) => taskWasClaimed(row),
    { timeoutMs: claimTimeout, intervalMs: 2_000 },
  );

  if (claim.ok) {
    reporter.pass(
      'Railway worker claimed the task',
      claim.elapsedMs,
      `attempts=${claim.value.attempts} status=${claim.value.status} — the pg_net kick or pg_cron sweep reached ${config.workerBaseUrl} and claim_media_tasks() took ownership`,
    );
  } else {
    // ---- Differential -----------------------------------------------------
    const direct = await invokeWorkerDirectly(config.workerBaseUrl, config.workerSecret);
    let verdict: string;
    if ('error' in direct) {
      verdict = `the worker is ALSO unreachable from here (${direct.error}) — the break is on the Railway side, not in the database dispatch`;
    } else if (direct.status !== 200) {
      verdict = `a direct invocation returned ${direct.status} — the break is on the Railway side (worker secret or container), not in the database dispatch`;
    } else {
      const after = await pollUntil<TaskRow>(
        async () => readTask(admin, taskId),
        (row) => taskWasClaimed(row),
        { timeoutMs: 30_000, intervalMs: 2_000 },
      );
      verdict = after.ok
        ? 'a DIRECT invocation from this machine claimed the task immediately, so the worker is healthy and the DATABASE-side dispatch is broken — check the Vault secrets share_media_worker_url / share_media_worker_secret, the share_media_tasks_kick_worker trigger, and the process-media-tasks-sweep pg_cron job in Nearr-Dev'
        : 'even a direct invocation did not produce a claim — the worker is reachable but claim_media_tasks() returned nothing (check the parent job status, next_attempt_at, attempts vs max_attempts, and the service-role grant on claim_media_tasks)';
    }
    reporter.fail(
      'Railway worker claimed the task',
      claim.elapsedMs,
      `no claim within ${Math.round(claimTimeout / 1000)}s; ${verdict}`,
      {
        taskStatusTrail: taskTrail.trail,
        lastObservedTask: claim.last ?? null,
        directInvocation: 'error' in direct ? direct.error : `HTTP ${direct.status} ${direct.body}`,
        workerBaseUrl: config.workerBaseUrl,
      },
    );
    return false;
  }

  // ---- Controlled worker stage -------------------------------------------
  // The probe platform matches no resolver, so `selectResolver` returns null and
  // the pipeline raises `unsupported_platform` before any network call. That is
  // a MANUAL_FALLBACK code, so the worker finalizes with outcome 'unavailable'
  // through the real MEDIA_FINALIZE_SECRET callback rather than retrying.
  const terminal = await pollUntil<TaskRow>(
    async () => {
      const row = await readTask(admin, taskId);
      taskTrail.observe(row?.status);
      return row;
    },
    (row) => TASK_TERMINAL.has(row.status),
    { timeoutMs: timeoutFor('finalize'), intervalMs: 2_000 },
  );

  if (!terminal.ok) {
    reporter.fail(
      'media task reached a terminal state',
      terminal.elapsedMs,
      'the worker claimed the task but never finished it',
      { taskStatusTrail: taskTrail.trail, lastObservedTask: terminal.last ?? null },
    );
    return false;
  }
  reporter.pass(
    'media task reached a terminal state',
    terminal.elapsedMs,
    `status=${terminal.value.status} failure_code=${terminal.value.failure_code ?? 'null'} (expected the controlled unsupported_platform stop)`,
  );

  // ---- Finalization -------------------------------------------------------
  // The parent moving is the proof that the worker's callback into
  // process-share-jobs was ACCEPTED. If MEDIA_FINALIZE_SECRET disagreed across
  // the two services the worker would have marked the task terminal locally and
  // this parent would still be sitting in processing_metadata.
  const jobTrail = new StatusTrail('job');
  const finalized = await pollUntil<JobRow>(
    async () => {
      const row = await readJob(admin, jobId);
      jobTrail.observe(row?.status);
      return row;
    },
    (row) => JOB_TERMINAL.has(row.status),
    { timeoutMs: timeoutFor('terminal'), intervalMs: 2_000 },
  );

  if (!finalized.ok) {
    reporter.fail(
      'parent job finalized by the worker callback',
      finalized.elapsedMs,
      'the media task is terminal but the parent job never moved — the finalize callback into process-share-jobs did not land (check MEDIA_FINALIZE_SECRET on both sides and SHARE_JOBS_FINALIZE_URL on Railway)',
      { jobStatusTrail: jobTrail.trail, lastObservedJob: finalized.last ?? null },
    );
    return false;
  }
  reporter.pass(
    'parent job finalized by the worker callback',
    finalized.elapsedMs,
    `status=${finalized.value.status} decision=${finalized.value.decision ?? 'null'} — the MEDIA_FINALIZE_SECRET callback was accepted by the deployed process-share-jobs`,
  );

  // ---- Lifecycle invariants ----------------------------------------------
  const stranded = assertWorkerCompletionFinalizedParent(terminal.value, finalized.value);
  if (stranded) {
    reporter.fail('job lifecycle invariants', 0, stranded, {
      taskStatusTrail: taskTrail.trail,
      jobStatusTrail: jobTrail.trail,
    });
    return false;
  }
  const violations = [...taskTrail.violations, ...jobTrail.violations];
  if (violations.length > 0) {
    reporter.fail(
      'job lifecycle invariants',
      0,
      `${violations.length} illegal state transition(s) observed`,
      { violations, taskStatusTrail: taskTrail.trail, jobStatusTrail: jobTrail.trail },
    );
    return false;
  }
  reporter.pass(
    'job lifecycle invariants',
    0,
    `task ${taskTrail.trail}; job ${jobTrail.trail}`,
  );

  return true;
}
