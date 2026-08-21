/**
 * scripts/e2e/lifecycle.ts
 *
 * Reusable assertions over the REAL share-job / media-task state machines.
 *
 * These are pure functions over observed rows, with no I/O, which is what lets
 * `npm run test:e2e:harness` verify the harness itself offline while the
 * deployed suite uses the identical logic against Nearr-Dev.
 *
 * The transitions and status sets below are transcribed from the migrations
 * that define them — supabase/migrations/20260731000001_share_jobs.sql and
 * 20260801000001_share_media_tasks.sql — not from an idealised diagram. Where
 * this file and a migration disagree, the migration is right and this file is
 * the bug.
 */

export const JOB_STATUSES = [
  'queued',
  'processing_metadata',
  'completed',
  'needs_help',
  'failed',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TERMINAL: ReadonlySet<string> = new Set([
  'completed',
  'needs_help',
  'failed',
  'cancelled',
]);

export const TASK_STATUSES = [
  'queued',
  'processing',
  'completed',
  'needs_help',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TERMINAL: ReadonlySet<string> = new Set([
  'completed',
  'needs_help',
  'failed',
  'cancelled',
]);

/**
 * Parent progress stages the pipeline may publish.
 *
 * `queued`/`metadata`/`checking_video`/`manual`/`completed`/`cleanup` are
 * written by `process-share-jobs`; the four `*_media`/`retrieving_media`/
 * `verifying_place` values are the simplified copy the media worker publishes
 * through `db/tasks.ts` TASK_TO_PARENT.
 */
export const JOB_PROGRESS_STAGES: ReadonlySet<string> = new Set([
  'queued',
  'metadata',
  'checking_video',
  'queued_media',
  'retrieving_media',
  'analyzing_media',
  'verifying_place',
  'manual',
  'cleanup',
  'completed',
]);

export const TASK_PROGRESS_STAGES: ReadonlySet<string> = new Set([
  'queued',
  'retrieving_media',
  'inspecting_media',
  'extracting_audio',
  'transcribing_audio',
  'extracting_frames',
  'extracting_visible_text',
  'analyzing_evidence',
  'verifying_place',
  'cleanup',
]);

/** Allowed forward moves. A status may always stay where it is. */
const JOB_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  queued: ['processing_metadata', 'completed', 'needs_help', 'failed', 'cancelled'],
  processing_metadata: ['completed', 'needs_help', 'failed', 'cancelled'],
  completed: [],
  needs_help: ['completed'], // resolve_share_job() lets the user finish it by hand.
  failed: ['completed'], // same manual resolution path.
  cancelled: [],
};

const TASK_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  // requeue_media_task() moves an active task back to 'queued' for a retry.
  queued: ['processing', 'completed', 'needs_help', 'failed', 'cancelled'],
  processing: ['queued', 'completed', 'needs_help', 'failed', 'cancelled'],
  completed: [],
  needs_help: [],
  failed: [],
  cancelled: [],
};

export type TransitionViolation = { from: string; to: string; reason: string };

function checkTransition(
  table: Readonly<Record<string, readonly string[]>>,
  known: ReadonlySet<string>,
  from: string,
  to: string,
): TransitionViolation | null {
  if (!known.has(to)) return { from, to, reason: `"${to}" is not a declared status` };
  if (from === to) return null;
  if (!known.has(from)) return { from, to, reason: `"${from}" is not a declared status` };
  const allowed = table[from] ?? [];
  if (allowed.includes(to)) return null;
  return { from, to, reason: `${from} -> ${to} is not a legal transition` };
}

const JOB_STATUS_SET: ReadonlySet<string> = new Set<string>(JOB_STATUSES);
const TASK_STATUS_SET: ReadonlySet<string> = new Set<string>(TASK_STATUSES);

/**
 * Watch a sequence of observed statuses and report every illegal move.
 *
 * Polling can only ever see a SAMPLE of the real sequence, so a legal move is
 * never proof of correctness — but an ILLEGAL move that was sampled is proof of
 * a defect, which is the direction that matters here.
 */
export class StatusTrail {
  private readonly seen: string[] = [];
  readonly violations: TransitionViolation[] = [];

  constructor(private readonly kind: 'job' | 'task') {}

  observe(status: string | null | undefined): void {
    if (!status) return;
    const previous = this.seen[this.seen.length - 1];
    if (previous === status) return;
    if (previous !== undefined) {
      const violation =
        this.kind === 'job'
          ? checkTransition(JOB_TRANSITIONS, JOB_STATUS_SET, previous, status)
          : checkTransition(TASK_TRANSITIONS, TASK_STATUS_SET, previous, status);
      if (violation) this.violations.push(violation);
    }
    this.seen.push(status);
  }

  get trail(): string {
    return this.seen.join(' -> ') || '(nothing observed)';
  }

  get current(): string | null {
    return this.seen[this.seen.length - 1] ?? null;
  }
}

export function isKnownJobProgress(stage: string | null | undefined): boolean {
  return stage == null || JOB_PROGRESS_STAGES.has(stage);
}

export function isKnownTaskProgress(stage: string | null | undefined): boolean {
  return stage == null || TASK_PROGRESS_STAGES.has(stage);
}

// ---------------------------------------------------------------------------
// Cross-entity invariants (Part 7). Each returns a failure reason, or null.
// ---------------------------------------------------------------------------

export type JobRow = {
  id: string;
  status: string;
  progress_stage: string | null;
  decision: string | null;
  saved_place_id: string | null;
  candidate_payload?: unknown;
  failure_reason?: string | null;
};

export type TaskRow = {
  id: string;
  share_job_id: string;
  status: string;
  progress_stage: string | null;
  attempts: number;
  locked_at: string | null;
  failure_code: string | null;
};

/** "media fallback was chosen, but nothing was enqueued" is a lost job. */
export function assertEnqueuedFallbackHasTask(
  fallbackChosen: boolean,
  task: TaskRow | null,
): string | null {
  if (!fallbackChosen) return null;
  if (task) return null;
  return 'media fallback was selected but no share_media_tasks row exists for the job';
}

/** A claim is the worker having taken ownership: attempts incremented + lease set. */
export function taskWasClaimed(task: TaskRow | null): boolean {
  if (!task) return false;
  return task.attempts >= 1 && task.locked_at != null;
}

/** "the worker finished, but the parent never moved" is a stranded user. */
export function assertWorkerCompletionFinalizedParent(
  task: TaskRow | null,
  job: JobRow | null,
): string | null {
  if (!task || !TASK_TERMINAL.has(task.status)) return null;
  if (!job) return 'media task reached a terminal status but its parent job could not be read';
  if (JOB_TERMINAL.has(job.status)) return null;
  return `media task is terminal (${task.status}) but the parent job is still ${job.status}`;
}

/** A successful terminal result must actually have persisted something. */
export function assertTerminalSuccessPersisted(job: JobRow | null): string | null {
  if (!job) return 'no job row to check';
  if (job.status !== 'completed') return null;
  if (job.decision === 'auto_save') {
    return job.saved_place_id
      ? null
      : 'job completed with decision=auto_save but saved_place_id is null';
  }
  return job.decision ? null : 'job completed but recorded no decision';
}

/**
 * The creator-identity invariant (Part 17).
 *
 * An account name is not evidence that a place is in the video. A share whose
 * only place signal is the creator's own handle must never reach `auto_save`
 * and must never persist a saved place.
 */
export function assertNoCreatorNameAutoSave(job: JobRow | null): string | null {
  if (!job) return 'no job row to check';
  if (job.decision === 'auto_save') {
    return 'creator-name-only evidence produced decision=auto_save';
  }
  if (job.saved_place_id) {
    return `creator-name-only evidence persisted saved_place_id=${job.saved_place_id}`;
  }
  return null;
}

/** The cheap-path cost invariant: obvious metadata must not spend the worker. */
export function assertCheapPathSkippedMedia(task: TaskRow | null): string | null {
  if (!task) return null;
  return `a media task (${task.id}) was created for a share whose metadata already identified the place`;
}

/**
 * "The deterministic resolver identified a place" — across every shape the
 * pipeline actually uses to say so.
 *
 * There is more than one, and assuming a single one is how a green pipeline
 * gets reported as broken: the auto-save route persists the place and records
 * `saved_place_id`, leaving `candidate_payload.candidates` EMPTY because there
 * is nothing left to choose between, while the confirmation and picker routes
 * do the opposite. A multi-place batch records `savedPlaceIds` on the payload
 * instead. Only "no place by any of those measures" is a resolver failure.
 */
export function assertResolverIdentifiedAPlace(
  job: JobRow | null,
  candidates: number,
): string | null {
  if (!job) return 'no job row to check';
  if (job.saved_place_id) return null;
  if (candidates > 0) return null;
  if (savedPlaceIdsOnPayload(job).length > 0) return null;
  return `decision=${job.decision ?? 'null'} status=${job.status}: no saved place, no candidates and no batch saves — obvious place metadata did not resolve`;
}

/** `candidate_payload.savedPlaceIds`, used by the multi-place batch route. */
export function savedPlaceIdsOnPayload(job: JobRow | null): string[] {
  if (!job || !job.candidate_payload || typeof job.candidate_payload !== 'object') return [];
  const values = (job.candidate_payload as Record<string, unknown>).savedPlaceIds;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}
