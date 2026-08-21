/**
 * services/shareJobsService.ts
 *
 * Client data access for the async share-job queue (source of truth).
 *
 * All reads/writes go through the user's RLS-scoped Supabase session, so a
 * user can only ever see or mutate their own jobs. Creation is NOT here — jobs
 * are created by the authenticated `create-share-job` Edge Function (see
 * lib/shareJobClient.ts) so there is no anonymous/orphan path.
 */

import { supabase } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import { logDebug } from '@/lib/logger';
import { QUEUE_VISIBLE_STATUSES } from '@/lib/shareJobRouting';
import type {
  ShareJobCandidatePayload,
  ShareJobResultCandidate,
} from '@/lib/shareJobResult';
import type { SavedPlaceWithPlace } from '@/types';
import type { ShareFailureCategory } from '@/lib/shareFailurePresentation';

export type ShareJobStatus =
  | 'queued'
  | 'processing_metadata'
  | 'completed'
  | 'needs_help'
  | 'failed'
  | 'cancelled';

export type ShareJobDecision =
  | 'auto_save'
  | 'candidate_confirmation'
  | 'candidate_picker'
  | 'multi_candidate_confirmation'
  | 'manual_fallback'
  | 'failed'
  | null;

export type ShareJobCandidate = ShareJobResultCandidate;

export type ShareJob = {
  id: string;
  user_id: string;
  source_url: string;
  canonical_url: string | null;
  source_platform: string | null;
  status: ShareJobStatus;
  progress_stage: string | null;
  decision: ShareJobDecision;
  saved_place_id: string | null;
  candidate_payload: ShareJobCandidatePayload | { candidates: ShareJobCandidate[] } | null;
  extraction_payload: Record<string, unknown> | null;
  suggested_query: string | null;
  needs_help_reason: string | null;
  failure_reason: string | null;
  failure_category: ShareFailureCategory | null;
  failure_code: string | null;
  analysis_attempted: boolean;
  notification_status:
    | 'pending'
    | 'sending'
    | 'submitted'
    | 'retryable_failed'
    | 'permanently_failed'
    | null;
  notification_attempts: number;
  notification_last_attempt_at: string | null;
  notification_ticket_ids: Array<{ ticketId: string; tokenId: string }> | null;
  notification_error_code: string | null;
  notification_submitted_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type RecentAutoSave = {
  resultId: string;
  savedPlaceId: string;
  finalizedAt: string;
  confidenceScore: number | null;
  savedPlace: SavedPlaceWithPlace;
};

export type UndoAutoSaveResult = {
  undone: boolean;
  alreadyUndone: boolean;
  shareJobId: string;
  removedSavedPlaceId: string;
  replacementSavedPlaceId: string | null;
  undoneAt: string;
};

const JOB_COLUMNS =
  'id, user_id, source_url, canonical_url, source_platform, status, progress_stage, decision, saved_place_id, candidate_payload, extraction_payload, suggested_query, needs_help_reason, failure_reason, failure_category, failure_code, analysis_attempted, notification_status, notification_attempts, notification_last_attempt_at, notification_ticket_ids, notification_error_code, notification_submitted_at, created_at, updated_at, completed_at';

/** List the current user's active/actionable jobs, newest first.
 *
 * The queue is the source of truth for WORK IN PROGRESS: only jobs that are
 * still processing, awaiting the user, or a recoverable failure are returned.
 * Terminal outcomes (completed / already-saved, cancelled) are excluded at the
 * query so a resolved job disappears from the queue immediately. */
export async function listShareJobs(limit = 100): Promise<ShareJob[]> {
  if (isDemoMode() || isMapPreviewMode()) return [];
  const { data, error } = await supabase
    .from('share_jobs')
    .select(JOB_COLUMNS)
    .in('status', QUEUE_VISIBLE_STATUSES as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    logDebug('share-jobs', `list failed: ${error.message}`);
    throw new Error(error.message);
  }
  return (data ?? []) as ShareJob[];
}

const RECENT_AUTO_SAVE_COLUMNS =
  'id, saved_place_id, finalized_at, confidence_score, saved_place:saved_places!share_job_place_results_saved_place_id_fkey(*, place:places(*))';

function normalizeRecentAutoSave(row: any): RecentAutoSave | null {
  const savedPlace = Array.isArray(row?.saved_place) ? row.saved_place[0] : row?.saved_place;
  if (!row?.id || !row?.saved_place_id || !row?.finalized_at || !savedPlace?.place) return null;
  return {
    resultId: row.id,
    savedPlaceId: row.saved_place_id,
    finalizedAt: row.finalized_at,
    confidenceScore: typeof row.confidence_score === 'number' ? row.confidence_score : null,
    savedPlace: savedPlace as SavedPlaceWithPlace,
  };
}

/** Newly-created automatic saves only. Reused existing places are excluded. */
export async function listRecentAutoSaves(limit = 20): Promise<RecentAutoSave[]> {
  if (isDemoMode() || isMapPreviewMode()) return [];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('share_job_place_results')
    .select(RECENT_AUTO_SAVE_COLUMNS)
    .eq('origin', 'automatic')
    .eq('outcome', 'auto_saved')
    .gte('finalized_at', since)
    .order('finalized_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeRecentAutoSave).filter((row): row is RecentAutoSave => !!row);
}

export async function getRecentAutoSave(resultId: string): Promise<RecentAutoSave | null> {
  if (isDemoMode() || isMapPreviewMode()) return null;
  const { data, error } = await supabase
    .from('share_job_place_results')
    .select(RECENT_AUTO_SAVE_COLUMNS)
    .eq('id', resultId)
    .eq('origin', 'automatic')
    .eq('outcome', 'auto_saved')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeRecentAutoSave(data);
}

export async function undoAutoSavedPlace(
  savedPlaceId: string,
  replacementSavedPlaceId: string | null = null,
): Promise<UndoAutoSaveResult> {
  if (isDemoMode() || isMapPreviewMode()) throw new Error('Undo is unavailable in preview mode.');
  const action = replacementSavedPlaceId ? 'corrected' : 'removed';
  const { data, error } = await supabase.rpc('undo_auto_saved_place', {
    p_saved_place_id: savedPlaceId,
    p_action: action,
    p_replacement_saved_place_id: replacementSavedPlaceId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Undo did not return a result.');
  return {
    undone: row.undone === true,
    alreadyUndone: row.already_undone === true,
    shareJobId: row.share_job_id,
    removedSavedPlaceId: row.removed_saved_place_id,
    replacementSavedPlaceId: row.replacement_saved_place_id ?? null,
    undoneAt: row.undone_at,
  };
}

/** Fetch a single job by id (RLS scopes to owner). */
export async function getShareJob(jobId: string): Promise<ShareJob | null> {
  if (isDemoMode() || isMapPreviewMode()) return null;
  const { data, error } = await supabase
    .from('share_jobs')
    .select(JOB_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();
  if (error) {
    logDebug('share-jobs', `get failed: ${error.message}`);
    throw new Error(error.message);
  }
  return (data as ShareJob) ?? null;
}

/**
 * Mark a needs_help job resolved after the user confirmed/saved a place.
 * Transactional guard: only transitions a job that is still needs_help, so a
 * concurrent worker/notification can't clobber it. Never touches saved_places.
 */
export async function markShareJobResolved(
  jobId: string,
  savedPlaceId: string,
): Promise<void> {
  if (isDemoMode() || isMapPreviewMode()) return;
  const { data, error } = await supabase.rpc('resolve_share_job', {
    p_job_id: jobId,
    p_saved_place_id: savedPlaceId,
  });
  if (error) {
    logDebug('share-jobs', `resolve failed: ${error.message}`);
    throw new Error(error.message);
  }
  if (data !== true) {
    throw new Error('Job can no longer be resolved. Refresh and try again.');
  }
}

/**
 * Delete a job from the queue. This removes ONLY the job row — the FK to
 * saved_places is ON DELETE SET NULL on the job side, so a saved place is
 * never deleted by removing its originating job.
 */
export async function deleteShareJob(jobId: string): Promise<void> {
  if (isDemoMode() || isMapPreviewMode()) return;
  const { error } = await supabase.from('share_jobs').delete().eq('id', jobId);
  if (error) {
    logDebug('share-jobs', `delete failed: ${error.message}`);
    throw new Error(error.message);
  }
}

/** Cancel an in-flight job so it stops processing and leaves the queue. */
export async function cancelShareJob(jobId: string): Promise<void> {
  if (isDemoMode() || isMapPreviewMode()) return;
  const { data, error } = await supabase.rpc('cancel_share_job', {
    p_job_id: jobId,
  });
  if (error) {
    logDebug('share-jobs', `cancel failed: ${error.message}`);
    throw new Error(error.message);
  }
  if (data !== true) {
    throw new Error('Job is no longer cancelable. Refresh and try again.');
  }
}

/**
 * Re-queue a failed job. Only valid for jobs with NO saved_place_id (so retry
 * can never double-save; the worker's source_url dedupe is a second guard).
 */
export async function retryShareJob(jobId: string): Promise<void> {
  if (isDemoMode() || isMapPreviewMode()) return;
  const { data, error } = await supabase.rpc('retry_share_job', {
    p_job_id: jobId,
  });
  if (error) {
    logDebug('share-jobs', `retry failed: ${error.message}`);
    throw new Error(error.message);
  }
  if (data !== true) {
    throw new Error('Job is not retryable. Refresh and try again.');
  }
}
