/**
 * lib/shareJobRouting.ts
 *
 * PURE (no React Native / Deno globals, no I/O) share-job queue-visibility +
 * notification-routing policy. Shared by the queue hook, the queue screen, the
 * per-job detail route, and the root notification handler so the badge, the
 * screen, the deep-link target, and every notification AGREE — and so none of
 * them can throw on a terminal / stale / malformed job.
 *
 * Status classification (matches the DB CHECK enum on share_jobs.status):
 *   A active processing   → queued, processing_metadata
 *   B awaiting user action → needs_help
 *   C terminal successful  → completed          (incl. "already saved")
 *   D terminal dismissed   → cancelled
 *   E terminal failed      → failed             (still ACTIONABLE: manual search / retry)
 *
 * Unit-tested from Node (scripts/testShareJobRouting.ts).
 */

export type ShareJobStatus =
  | 'queued'
  | 'processing_metadata'
  | 'needs_help'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** A — still being worked by the durable worker. */
export const PROCESSING_STATUSES = ['queued', 'processing_metadata'] as const;

/**
 * Statuses that belong in the active queue: still processing, OR waiting for the
 * user (needs_help), OR a failure the user can still resolve by hand (failed →
 * an explicit search/retry action, never an endless spinner). Terminal success
 * (completed / already-saved) and dismissal (cancelled) are hidden immediately.
 */
export const QUEUE_VISIBLE_STATUSES = [
  'queued',
  'processing_metadata',
  'needs_help',
  'failed',
] as const;

/** C / D — terminal outcomes that must never appear in the active queue. */
export const TERMINAL_HIDDEN_STATUSES = ['completed', 'cancelled'] as const;

export function isProcessingStatus(status: string | null | undefined): boolean {
  return (PROCESSING_STATUSES as readonly string[]).includes(status ?? '');
}

export function isQueueVisibleStatus(status: string | null | undefined): boolean {
  return (QUEUE_VISIBLE_STATUSES as readonly string[]).includes(status ?? '');
}

export function isTerminalHiddenStatus(status: string | null | undefined): boolean {
  return (TERMINAL_HIDDEN_STATUSES as readonly string[]).includes(status ?? '');
}

/**
 * The map/home badge counts visible jobs that need a user action: a decision
 * (needs_help) or a recoverable failure that can be resolved by manual search.
 * Completed, accepted, denied, cancelled, already-saved, and processing jobs
 * never count, so the badge and the queue's actionable section agree.
 */
export function badgeCountsStatus(status: string | null | undefined): boolean {
  return status === 'needs_help' || status === 'failed';
}

/** Defensive client filter: drop any terminal/unknown job, keyed by nothing but
 *  status, so a delayed realtime insert of a resolved job can never re-add it. */
export function filterQueueVisible<T extends { status: string }>(jobs: T[]): T[] {
  return jobs.filter((j) => isQueueVisibleStatus(j.status));
}

// ---------------------------------------------------------------------------
// Detail-route classification. The per-job screen renders candidate/save
// controls ONLY for `actionable`; every other mode is a safe, control-free
// view (or a redirect), so opening a stale/terminal job can never render an
// interactive control for a job that can no longer be resolved.
// ---------------------------------------------------------------------------

export type ShareJobDetailMode =
  | 'processing' // queued / processing_metadata → live status, no controls
  | 'actionable' // needs_help / failed → candidate / search controls
  | 'completed' // terminal success → offer the saved place
  | 'dismissed' // cancelled / unknown terminal → safe "no longer in your queue"
  | 'missing'; // no job (deleted / other user / not found / load failed)

export function classifyShareJobDetail(
  job: { status: string } | null | undefined,
): ShareJobDetailMode {
  if (!job || typeof job.status !== 'string') return 'missing';
  switch (job.status) {
    case 'queued':
    case 'processing_metadata':
      return 'processing';
    case 'needs_help':
    case 'failed':
      return 'actionable';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'dismissed';
    default:
      // Unknown / future terminal status → treat as dismissed (never render
      // controls, never throw).
      return 'dismissed';
  }
}

// ---------------------------------------------------------------------------
// Notification + queue-card routing. One typed decision, outcome-aware, never
// throws. `data.type` / `data.outcome` are the server contract; a client is
// never trusted to supply a raw route.
// ---------------------------------------------------------------------------

export type ShareJobNotificationType = 'share_job_completed' | 'share_job_needs_help';

export type ShareJobRoute =
  | { kind: 'saved_place'; savedPlaceId: string; googlePlaceId?: string }
  | { kind: 'saved_group'; savedPlaceIds: string[] }
  | { kind: 'queue_item'; jobId: string }
  | { kind: 'queue_root' }
  | { kind: 'map' };

/** A newly opened queue item replaces the current route only when another
 * share-job detail is already presented. Queue -> detail must still push so
 * Back returns to the queue. */
export function shouldReplaceShareJobDetail(pathname: string | null | undefined): boolean {
  return /^\/share-jobs\/[^/]+\/?$/.test(pathname ?? '');
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(str).filter((id): id is string => !!id))].slice(0, 50);
}

/**
 * Decide where a tapped share-job NOTIFICATION should go, from the payload
 * alone. Returns `null` when the payload is NOT a share-job notification (so the
 * caller falls through to its other handlers). NEVER throws.
 *
 *   completed / already_saved → the existing saved place (map detail); never a
 *     queue item. Falls back to the map when no saved-place id is present.
 *   needs_help                → the queue item (the detail route itself
 *     redirects safely if that job has since become terminal or missing).
 *   share-job type but unusable → the queue root (safe).
 *
 * Backward compatible: old payloads without `outcome` still route by `type`.
 */
export function routeShareJobNotification(
  data: Record<string, unknown> | null | undefined,
): ShareJobRoute | null {
  const type = str(data?.type);
  if (type !== 'share_job_completed' && type !== 'share_job_needs_help') {
    return null; // not a share-job notification
  }

  const jobId = str(data?.jobId);
  const savedPlaceId = str(data?.savedPlaceId);
  const savedPlaceIds = ids(data?.savedPlaceIds);
  const googlePlaceId = str(data?.googlePlaceId);
  const outcome = str(data?.outcome);

  // Terminal success (incl. already-saved) → the saved place, not the queue.
  if (type === 'share_job_completed' || outcome === 'completed' || outcome === 'already_saved') {
    if (savedPlaceIds.length > 1) return { kind: 'saved_group', savedPlaceIds };
    if (savedPlaceId) {
      // `googlePlaceId` (when the server includes it) is a stable fallback so
      // the map can still open the existing place if the saved_places row id
      // can't be resolved. Omitted from the route object when absent so older
      // payloads route byte-identically.
      return googlePlaceId
        ? { kind: 'saved_place', savedPlaceId, googlePlaceId }
        : { kind: 'saved_place', savedPlaceId };
    }
    return { kind: 'map' };
  }

  // Awaiting user action → the queue item.
  if (type === 'share_job_needs_help') {
    if (jobId) return { kind: 'queue_item', jobId };
    return { kind: 'queue_root' };
  }

  return { kind: 'queue_root' };
}

/**
 * Decide where tapping a QUEUE CARD (a full job row) should go. Terminal
 * success → the saved place; dismissed / unknown → the queue root (no-op);
 * processing / actionable → the per-job detail route. NEVER throws.
 */
export function routeShareJobCard(
  job: { id: string; status: string; saved_place_id?: string | null } | null | undefined,
): ShareJobRoute {
  const mode = classifyShareJobDetail(job);
  switch (mode) {
    case 'completed': {
      const sp = str(job?.saved_place_id);
      return sp ? { kind: 'saved_place', savedPlaceId: sp } : { kind: 'map' };
    }
    case 'processing':
    case 'actionable':
      return job?.id ? { kind: 'queue_item', jobId: job.id } : { kind: 'queue_root' };
    case 'dismissed':
    case 'missing':
    default:
      return { kind: 'queue_root' };
  }
}
