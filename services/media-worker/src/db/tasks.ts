// services/media-worker/src/db/tasks.ts
//
// Media-task DB operations (service role). The claim RPC is the atomic,
// race-safe pull; everything else is guarded status/progress bookkeeping.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkerConfig } from '../config/env.js';
import type { MediaTask, ProgressStage } from '../types/media.js';
import { log } from '../util/logger.js';

/**
 * Never lease more work than this process can start immediately. A lease is
 * ownership, not prefetch: claiming beyond maxConcurrency hides queued work
 * from other replicas and burns lease time before processing begins.
 */
export function effectiveClaimLimit(
  cfg: Pick<WorkerConfig, 'claimBatchSize' | 'maxConcurrency'>,
): number {
  return Math.max(1, Math.min(cfg.claimBatchSize, cfg.maxConcurrency));
}

/** Simplified, user-facing parent progress copy keys (see docs/MEDIA_FALLBACK).
 *  The mobile client maps these to friendly strings; the worker never exposes
 *  ffmpeg/OCR/model internals to the client. */
export type ParentProgress =
  | 'queued_media'
  | 'retrieving_media'
  | 'analyzing_media'
  | 'verifying_place';

const TASK_TO_PARENT: Record<ProgressStage, ParentProgress> = {
  queued: 'queued_media',
  retrieving_media: 'retrieving_media',
  inspecting_media: 'analyzing_media',
  extracting_audio: 'analyzing_media',
  transcribing_audio: 'analyzing_media',
  extracting_frames: 'analyzing_media',
  extracting_visible_text: 'analyzing_media',
  analyzing_evidence: 'analyzing_media',
  verifying_place: 'verifying_place',
  cleanup: 'verifying_place',
};

export async function claimMediaTasks(
  client: SupabaseClient,
  cfg: WorkerConfig,
): Promise<MediaTask[]> {
  const { data, error } = await client.rpc('claim_media_tasks', {
    p_limit: effectiveClaimLimit(cfg),
    p_lock_seconds: cfg.claimLockSeconds,
  });
  if (error) {
    log.error('claim_failed', { msg: error.message });
    return [];
  }
  return Array.isArray(data) ? (data as MediaTask[]) : [];
}

/** Update the detailed task progress AND the simplified parent progress (the
 *  latter guarded so we never overwrite a parent that already went terminal). */
export async function setProgress(
  client: SupabaseClient,
  task: MediaTask,
  stage: ProgressStage,
): Promise<void> {
  await client.from('share_media_tasks').update({ progress_stage: stage }).eq('id', task.id);
  if (task.share_job_id) {
    await client
      .from('share_jobs')
      .update({ progress_stage: TASK_TO_PARENT[stage] })
      .eq('id', task.share_job_id)
      .eq('status', 'processing_metadata');
  }
}

export async function setTaskStatus(
  client: SupabaseClient,
  taskId: string,
  status: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await client.from('share_media_tasks').update({ status, ...patch }).eq('id', taskId);
}

/** Requeue for retry with a bounded backoff (atomic via requeue_media_task).
 *  The claim RPC skips tasks whose next_attempt_at is still in the future, so
 *  pg_cron never hot-loops on a failing task. Attempts are NOT incremented here
 *  (that happens exactly once per claim). */
export async function requeueTask(
  client: SupabaseClient,
  taskId: string,
  backoffSeconds: number,
  failureCode: string,
): Promise<void> {
  const { error } = await client.rpc('requeue_media_task', {
    p_task_id: taskId,
    p_backoff_seconds: backoffSeconds,
    p_failure_code: failureCode,
  });
  if (error) {
    log.warn('requeue_failed', { taskId, msg: error.message });
    // Best-effort fallback so a transient RPC error can't strand the task in
    // 'processing' (it becomes reclaimable once its lease expires).
    await client
      .from('share_media_tasks')
      .update({ status: 'queued', locked_until: null, failure_code: failureCode })
      .eq('id', taskId);
  }
}

/** Best-effort cleanup of tasks that exhausted their retry budget. */
export async function expireExhaustedTasks(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('expire_media_tasks', { p_limit: 25 });
  if (error) {
    log.warn('expire_failed', { msg: error.message });
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}
