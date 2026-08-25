import { createHash } from 'node:crypto';

import { openSession } from './e2e/session';

type Row = Record<string, any>;

const SOCIAL_TYPES = new Set(['instagram', 'tiktok', 'youtube', 'facebook', 'snapchat']);

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function countJsonArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function safeHash(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

async function required<T>(label: string, promise: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await promise;
  if (error || data == null) throw new Error(`${label}: ${error?.message ?? 'no data'}`);
  return data;
}

async function main(): Promise<void> {
  const session = await openSession({ withIdentity: false, withEdgeSecrets: false });
  const admin = session.admin;

  const saved = await required<Row[]>(
    'saved places',
    admin
      .from('saved_places')
      .select('*, place:places(name)')
      .in('source_type', [...SOCIAL_TYPES])
      .order('created_at', { ascending: false })
      .limit(30),
  );
  const physical = saved
    .filter((row) => nonEmpty(row.source_url))
    .filter((row) => !/nearr-e2e|e2ecreator|e2e=/iu.test(String(row.source_url)))
    .slice(0, 5);

  const output: Row[] = [];
  for (const place of physical) {
    const tasks = await required<Row[]>(
      'ai-note tasks',
      admin
        .from('share_media_tasks')
        .select('*')
        .eq('saved_place_id', place.id)
        .eq('task_kind', 'ai_note_enrichment')
        .order('created_at', { ascending: true }),
    );
    const taskIds = tasks.map((row) => row.id);
    const runs = taskIds.length > 0
      ? await required<Row[]>(
          'media runs',
          admin.from('share_media_runs').select('*').in('share_media_task_id', taskIds).order('created_at'),
        )
      : [];
    const results = await required<Row[]>(
      'share results',
      admin
        .from('share_job_place_results')
        .select('*')
        .or(`saved_place_id.eq.${place.id},original_saved_place_id.eq.${place.id},replacement_saved_place_id.eq.${place.id}`)
        .order('created_at', { ascending: false })
        .limit(5),
    );
    const recentUserJobs = await required<Row[]>(
      'recent user share jobs',
      admin
        .from('share_jobs')
        .select('*')
        .eq('user_id', place.user_id)
        .gte('created_at', '2026-08-21T20:00:00Z')
        .order('created_at', { ascending: false }),
    );
    const jobs = recentUserJobs.filter((job) =>
      job.saved_place_id === place.id ||
      job.source_url === place.source_url ||
      job.canonical_url === place.source_url,
    );
    const jobIds = jobs.map((job) => job.id);
    const recognitionTasks = jobIds.length > 0
      ? await required<Row[]>(
          'recognition tasks',
          admin
            .from('share_media_tasks')
            .select('*')
            .in('share_job_id', jobIds)
            .eq('task_kind', 'recognition'),
        )
      : [];
    const duplicates = await required<Row[]>(
      'same-user same-place rows',
      admin
        .from('saved_places')
        .select('id,source_url,created_at,ai_note')
        .eq('user_id', place.user_id)
        .eq('place_id', place.place_id)
        .order('created_at', { ascending: false }),
    );
    const authUser = await admin.auth.admin.getUserById(place.user_id);
    output.push({
      savedPlaceId: place.id,
      userIdentityHash: safeHash(place.user_id),
      userIsEphemeral: (authUser.data.user?.email ?? '').endsWith('@nearr.invalid'),
      sourceHash: safeHash(place.source_url),
      sourcePlatform: place.source_type,
      savedAt: place.created_at,
      updatedAt: place.updated_at,
      aiNoteNonempty: nonEmpty(place.ai_note),
      userNotePresent: nonEmpty(place.notes),
      obligationCreated: tasks.length > 0,
      shareJobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        decision: job.decision,
        createdAt: job.created_at,
      })),
      recognitionTasks: recognitionTasks.map((task) => ({
        id: task.id,
        status: task.status,
        attempts: task.attempts,
        failureCode: task.failure_code,
      })),
      aiNoteTasks: tasks.map((task) => ({
        id: task.id,
        status: task.status,
        progressStage: task.progress_stage,
        attempts: task.attempts,
        maxAttempts: task.max_attempts,
        retryCycles: task.retry_cycles,
        failureCode: task.failure_code,
        outcome: task.ai_note_outcome,
        claimed: Number(task.attempts) > 0 || nonEmpty(task.locked_at),
        lockedAt: task.locked_at,
        lockedUntil: task.locked_until,
        nextAttemptAt: task.next_attempt_at,
        completedAt: task.completed_at,
        model: task.analysis_model,
        modelCalls: task.model_calls,
        inputTokens: task.model_input_tokens,
        outputTokens: task.model_output_tokens,
        thinkingTokens: task.model_thinking_tokens,
        modelLatencyMs: task.model_latency_ms,
        mediaAcquiredOnce: task.media_acquired_once,
        retainedEvidenceCount: countJsonArray(task.evidence_snapshot),
        retainedFramePresent: task.frame_snapshot != null,
        fillerFallbackEnabled: false,
      })),
      mediaRuns: runs.map((run) => ({
        taskId: run.share_media_task_id,
        createdAt: run.created_at,
        modelProvider: run.model_provider,
        warningCount: countJsonArray(run.warnings),
        errorCount: countJsonArray(run.errors),
      })),
      sameUserSamePlaceRows: duplicates.map((row) => ({
        id: row.id,
        sourceHash: safeHash(row.source_url),
        createdAt: row.created_at,
        aiNoteNonempty: nonEmpty(row.ai_note),
      })),
    });
  }

  console.log(JSON.stringify({
    target: session.config.supabaseRef,
    inspected: output.length,
    rows: output,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
