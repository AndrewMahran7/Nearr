/**
 * scripts/e2e/fixtures/shared.ts
 *
 * Submission + observation helpers shared by every pipeline fixture.
 *
 * Submission goes through the DEPLOYED `create-share-job` Edge Function with a
 * real user access token — the same call the iOS Share Extension makes — rather
 * than inserting a row. Inserting would skip URL validation, platform
 * detection, normalisation and idempotency, which are four of the things this
 * tier is supposed to be covering.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { pollUntil, timeoutFor } from '../poll';
import { StatusTrail, type JobRow, type TaskRow } from '../lifecycle';
import { correlationKeyFor, type E2ESession } from '../session';

export const JOB_COLUMNS =
  'id,status,progress_stage,decision,saved_place_id,candidate_payload,extraction_payload,failure_reason,needs_help_reason,suggested_query';
export const TASK_COLUMNS = 'id,share_job_id,status,progress_stage,attempts,locked_at,failure_code';

export async function readJob(admin: SupabaseClient, jobId: string): Promise<JobRow | null> {
  const { data } = await admin.from('share_jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle();
  return (data as JobRow | null) ?? null;
}

export async function readTaskForJob(admin: SupabaseClient, jobId: string): Promise<TaskRow | null> {
  const { data } = await admin
    .from('share_media_tasks')
    .select(TASK_COLUMNS)
    .eq('share_job_id', jobId)
    .maybeSingle();
  return (data as TaskRow | null) ?? null;
}

export type SubmitResult =
  | { ok: true; jobId: string; status: string; duplicate: boolean; elapsedMs: number }
  | { ok: false; detail: string; elapsedMs: number };

/** Submit through the deployed create-share-job, exactly as the app does. */
export async function submitShareJob(
  session: E2ESession,
  fixture: string,
  url: string,
): Promise<SubmitResult> {
  const identity = session.identity;
  if (!identity) return { ok: false, detail: 'no ephemeral identity for this run', elapsedMs: 0 };

  const endpoint = `${session.config.supabaseUrl}/functions/v1/create-share-job`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor('createJob'));
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${identity.accessToken}`,
        apikey: session.config.anonKey,
      },
      // clientRequestId becomes share_jobs.idempotency_key — the correlation id.
      body: JSON.stringify({ url, clientRequestId: correlationKeyFor(session.correlationId, fixture) }),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    if (response.status !== 200) {
      return {
        ok: false,
        detail: `create-share-job returned ${response.status}: ${text.slice(0, 300)}`,
        elapsedMs: Date.now() - startedAt,
      };
    }
    const body = JSON.parse(text) as { jobId?: string; status?: string; duplicate?: boolean };
    if (!body.jobId) {
      return { ok: false, detail: 'create-share-job returned no jobId', elapsedMs: Date.now() - startedAt };
    }
    session.trackedJobIds.push(body.jobId);
    return {
      ok: true,
      jobId: body.jobId,
      status: body.status ?? 'unknown',
      duplicate: !!body.duplicate,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      detail: `create-share-job unreachable: ${err instanceof Error ? err.message : String(err)}`,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Wait for `process-share-jobs` to take the job off 'queued'. */
export async function awaitEdgeClaim(
  admin: SupabaseClient,
  jobId: string,
  trail: StatusTrail,
): ReturnType<typeof pollUntil<JobRow>> {
  return pollUntil<JobRow>(
    async () => {
      const row = await readJob(admin, jobId);
      trail.observe(row?.status);
      return row;
    },
    (row) => row.status !== 'queued',
    { timeoutMs: timeoutFor('edgeClaim'), intervalMs: 2_000 },
  );
}

/** Wait for a terminal parent status. */
export async function awaitJobTerminal(
  admin: SupabaseClient,
  jobId: string,
  trail: StatusTrail,
  terminal: ReadonlySet<string>,
  timeoutMs: number,
): ReturnType<typeof pollUntil<JobRow>> {
  return pollUntil<JobRow>(
    async () => {
      const row = await readJob(admin, jobId);
      trail.observe(row?.status);
      return row;
    },
    (row) => terminal.has(row.status),
    { timeoutMs, intervalMs: 2_000 },
  );
}

/**
 * Wait for a media task to appear for a job.
 *
 * A null result is NOT an error here: several fixtures assert the opposite —
 * that no task was ever created — so the caller decides what absence means.
 */
export async function awaitMediaTask(
  admin: SupabaseClient,
  jobId: string,
  timeoutMs = timeoutFor('mediaTask'),
): Promise<TaskRow | null> {
  const outcome = await pollUntil<TaskRow>(
    async () => readTaskForJob(admin, jobId),
    () => true,
    { timeoutMs, intervalMs: 2_000 },
  );
  return outcome.ok ? outcome.value : null;
}

/** Count candidates in the persisted payload without depending on its shape. */
export function candidateCount(job: JobRow | null): number {
  if (!job || !job.candidate_payload || typeof job.candidate_payload !== 'object') return 0;
  const payload = job.candidate_payload as Record<string, unknown>;
  for (const key of ['candidates', 'places', 'results']) {
    const value = payload[key];
    if (Array.isArray(value)) return value.length;
  }
  return payload.primary || payload.googlePlaceId || payload.google_place_id ? 1 : 0;
}
