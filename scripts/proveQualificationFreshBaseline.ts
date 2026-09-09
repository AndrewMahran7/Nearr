import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { pollUntil } from './e2e/poll';
import { openSession } from './e2e/session';

const TARGET_REF = 'qnfxnmvxpjzfydgudtvs';
const SOURCE_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const TERMINAL = new Set(['completed', 'needs_help', 'failed', 'cancelled']);

type Created = { jobId?: string; duplicate?: boolean; recognitionRunMode?: string; error?: string };

async function main(): Promise<void> {
  const session = await openSession({
    withIdentity: true,
    appMetadata: {
      account_class: 'dedicated_dev_test',
      purpose: 'onb2_tutorial_qualification',
    },
  });
  assert.equal(session.config.supabaseRef, TARGET_REF);
  assert.ok(session.identity);
  const endpoint = `${session.config.supabaseUrl}/functions/v1/create-share-job`;

  try {
    const submissions: Array<{ jobId: string; requestId: string }> = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const requestId = `baseline-qualification-${attempt}-${randomUUID()}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.identity!.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: SOURCE_URL,
          clientRequestId: requestId,
          qualificationMode: 'fresh_media',
        }),
      });
      const created = await response.json() as Created;
      if (!response.ok || !created.jobId) {
        throw new Error(`qualification submit ${attempt} failed: ${response.status}:${created.error ?? 'invalid_response'}`);
      }
      assert.equal(created.duplicate, false);
      assert.equal(created.recognitionRunMode, 'fresh_media');
      submissions.push({ jobId: created.jobId, requestId });
      session.trackedJobIds.push(created.jobId);
    }
    assert.equal(new Set(submissions.map((row) => row.jobId)).size, 3);

    const jobs = await Promise.all(submissions.map(async ({ jobId }) => {
      const terminal = await pollUntil<Record<string, any>>(
        async () => {
          const { data, error } = await session.admin.from('share_jobs')
            .select('id,status,decision,recognition_run_mode,extraction_payload')
            .eq('id', jobId).single();
          if (error) throw error;
          return data;
        },
        (job) => TERMINAL.has(String(job.status)),
        { timeoutMs: 12 * 60_000, intervalMs: 3_000 },
      );
      assert.ok(terminal.ok, `qualification job ${jobId} timed out`);
      return terminal.value;
    }));

    const [{ data: tasks, error: tasksError }, { data: runs, error: runsError }] = await Promise.all([
      session.admin.from('share_media_tasks')
        .select('id,share_job_id,status,model_calls,media_acquired_once')
        .in('share_job_id', submissions.map((row) => row.jobId)),
      session.admin.from('share_media_runs')
        .select('id,share_job_id,model_provider,model_calls,frame_count,transcript_segment_count,ocr_segment_count')
        .in('share_job_id', submissions.map((row) => row.jobId)),
    ]);
    if (tasksError ?? runsError) throw tasksError ?? runsError;

    assert.equal(new Set(tasks?.map((row) => row.id)).size, 3);
    assert.equal(new Set(runs?.map((row) => row.id)).size, 3);
    for (const submission of submissions) {
      assert.equal(tasks?.filter((row) => row.share_job_id === submission.jobId).length, 1);
      assert.equal(runs?.filter((row) => row.share_job_id === submission.jobId).length, 1);
    }
    for (const job of jobs) {
      assert.equal(job.recognition_run_mode, 'qualification_fresh');
      assert.equal(job.extraction_payload?.recognitionCache?.cacheReadUsed, false);
      assert.equal(job.extraction_payload?.recognitionCache?.qualificationFresh, true);
    }

    const proof = {
      source: 'youtube_no_place_control',
      jobs: jobs.map((job) => ({ id: job.id, status: job.status, decision: job.decision })),
      mediaTaskIds: tasks?.map((row) => row.id),
      mediaRunIds: runs?.map((row) => row.id),
      cacheReadUsed: jobs.map((job) => job.extraction_payload?.recognitionCache?.cacheReadUsed),
      qualificationFresh: jobs.map((job) => job.extraction_payload?.recognitionCache?.qualificationFresh),
      mediaAcquired: tasks?.map((row) => row.media_acquired_once),
      mediaEvidence: runs?.map((row) => ({
        frames: Number(row.frame_count ?? 0),
        transcriptSegments: Number(row.transcript_segment_count ?? 0),
        ocrSegments: Number(row.ocr_segment_count ?? 0),
      })),
      taskModelCalls: tasks?.map((row) => Number(row.model_calls ?? 0)),
      runModelCalls: runs?.map((row) => Number(row.model_calls ?? 0)),
      modelProviders: runs?.map((row) => row.model_provider),
    };
    console.log(`QUALIFICATION_FRESH_BASELINE_DIAGNOSTICS ${JSON.stringify(proof)}`);

    assert.ok(runs?.every((row) =>
      Number(row.frame_count ?? 0) > 0 ||
      Number(row.transcript_segment_count ?? 0) > 0 ||
      Number(row.ocr_segment_count ?? 0) > 0
    ), 'every run must contain acquired media evidence');
    assert.ok(runs?.every((row) => typeof row.model_provider === 'string' && row.model_provider.length > 0),
      'every run must persist the configured model provider');

    console.log(`QUALIFICATION_FRESH_BASELINE ${JSON.stringify(proof)}`);
  } finally {
    const cleanup = await session.cleanup();
    console.log(`QUALIFICATION_FRESH_BASELINE_CLEANUP ${JSON.stringify({
      userDeleted: cleanup.userDeleted,
      diagnosticsDeleted: cleanup.diagnosticsDeleted,
      evidenceObjectsDeleted: cleanup.evidenceObjectsDeleted,
      errors: cleanup.errors,
    })}`);
    if (!cleanup.userDeleted || cleanup.errors.length > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
