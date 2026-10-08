import type { SupabaseClient } from '@supabase/supabase-js';
import { MediaError, type MediaTask } from '../types/media.js';
import { log } from '../util/logger.js';

export type TaskClaim = { attempt: number; lockedAt: string };
export class ObsoleteTaskClaimError extends MediaError {
  constructor(readonly reason: string) { super('cancelled', `obsolete_task_claim:${reason}`); }
}
export function taskClaim(task: Pick<MediaTask, 'attempts' | 'locked_at'>): TaskClaim {
  if (!Number.isSafeInteger(task.attempts) || task.attempts < 1 ||
      typeof task.locked_at !== 'string' || !Number.isFinite(Date.parse(task.locked_at))) {
    throw new ObsoleteTaskClaimError('missing_claim_identity');
  }
  return { attempt: task.attempts, lockedAt: task.locked_at };
}
export function sameTaskClaim(task: Pick<MediaTask, 'attempts' | 'locked_at'>, row: any): boolean {
  const claim = taskClaim(task);
  return !!row && row.status === 'processing' && row.attempts === claim.attempt &&
    typeof row.locked_at === 'string' && Date.parse(row.locked_at) === Date.parse(claim.lockedAt);
}
/** Filter every task write with the lease identity; a stale worker cannot
 * change the next attempt's progress, status, retry schedule or evidence. */
export function guardTaskClaim(query: any, task: MediaTask): any {
  const claim = taskClaim(task);
  return query.eq('id', task.id).eq('status', 'processing')
    .eq('attempts', claim.attempt).eq('locked_at', claim.lockedAt);
}
export async function assertTaskClaim(client: SupabaseClient, task: MediaTask): Promise<any> {
  const { data, error } = await client.from('share_media_tasks')
    .select('id,status,attempts,locked_at,source_url,target_place_id,saved_place_id')
    .eq('id', task.id).maybeSingle();
  if (error) throw new MediaError('provider_unavailable', 'task_claim_lookup_failed');
  if (!data || !sameTaskClaim(task, data) || data.source_url !== task.source_url ||
      (data.target_place_id ?? null) !== (task.target_place_id ?? null) ||
      (data.saved_place_id ?? null) !== (task.saved_place_id ?? null)) {
    throw new ObsoleteTaskClaimError('superseded_or_terminal');
  }
  return data;
}
export type ParentClaimSnapshot = { status: string; savedPlaceId: string | null; attempts: number };
export function parentClaimStillCurrent(initial: ParentClaimSnapshot, current: ParentClaimSnapshot): boolean {
  return initial.status === current.status && initial.savedPlaceId === current.savedPlaceId &&
    initial.attempts === current.attempts &&
    (current.status === 'processing_metadata' || (current.status === 'completed' && !!current.savedPlaceId));
}
/** Cooperative in-flight cancellation. Initial and stage checks fail closed;
 * transient heartbeat read failures preserve work and are retried next tick.
 * Completing supplemental enrichment preserves the initial saved-place target. */
export function monitorTaskClaim(args: {
  client: SupabaseClient; task: MediaTask; controller: AbortController; intervalMs?: number;
}): { check: () => Promise<void>; stop: () => Promise<void>; obsoleteReason: () => string | null } {
  let initialParent: ParentClaimSnapshot | null = null;
  let obsolete: string | null = null;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const check = async () => {
    if (obsolete) throw new ObsoleteTaskClaimError(obsolete);
    await assertTaskClaim(args.client, args.task);
    if (!args.task.share_job_id || args.task.task_kind === 'ai_note_enrichment' || args.task.task_kind === 'recognition_revalidation') return;
    const { data, error } = await args.client.from('share_jobs')
      .select('status,saved_place_id,attempts').eq('id', args.task.share_job_id).maybeSingle();
    if (error) throw new MediaError('provider_unavailable', 'parent_claim_lookup_failed');
    const current: ParentClaimSnapshot = { status: data?.status ?? 'missing', savedPlaceId: data?.saved_place_id ?? null, attempts: data?.attempts ?? 0 };
    initialParent ??= current;
    if (!parentClaimStillCurrent(initialParent, current)) throw new ObsoleteTaskClaimError('parent_superseded_or_terminal');
  };
  const guardedCheck = async () => {
    try { await check(); }
    catch (error) {
      if (error instanceof ObsoleteTaskClaimError) {
        obsolete = error.reason;
        args.controller.abort(error);
      }
      throw error;
    }
  };
  const timer = setInterval(() => {
    if (stopped || inFlight || args.controller.signal.aborted) return;
    inFlight = guardedCheck().catch((error) => {
      if (!(error instanceof ObsoleteTaskClaimError)) log.warn('task_claim_monitor_unavailable', { taskId: args.task.id });
    }).finally(() => { inFlight = null; });
  }, args.intervalMs ?? 5_000);
  timer.unref();
  return { check: guardedCheck, obsoleteReason: () => obsolete, stop: async () => { stopped = true; clearInterval(timer); await inFlight; } };
}
