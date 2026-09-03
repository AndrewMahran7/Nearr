/**
 * lib/queueInbox.ts
 *
 * PURE inbox policy for the share-job queue: section membership, which rows may
 * be cleared, and which swipe actions each row supports.
 *
 * Safety rules encoded here (the screens must not re-derive them):
 *   - "Clear completed" only ever touches rows the user has finished with. It
 *     never targets a saved place, an actively processing job, or anything that
 *     still needs the user.
 *   - A processing row can never be saved early, and a row without a resolved
 *     candidate can never be saved.
 *   - Dismissing a row removes it from the QUEUE. It never deletes the
 *     underlying saved place.
 *
 * No React Native imports and no I/O so it is unit-testable from ts-node.
 */

export type QueueRowStatus =
  | 'awaiting_purchase'
  | 'queued'
  | 'processing_metadata'
  | 'needs_help'
  | 'failed'
  | 'completed'
  | 'cancelled';

export type QueueRow = {
  id: string;
  status: QueueRowStatus | string;
  /** True when the row already has a resolved provider candidate to save. */
  hasResolvedCandidate?: boolean;
  /** True only when the single candidate has a provider id and coordinates. */
  candidateIsPersistable?: boolean;
  candidateCount?: number;
  decision?: string | null;
  needsHelpReason?: string | null;
  /** Set when this row's place is already on the user's map. */
  savedPlaceId?: string | null;
};

export type QueueSectionKey = 'working' | 'needs_you' | 'recently_completed';

export const QUEUE_SECTION_TITLES: Readonly<Record<QueueSectionKey, string>> = {
  working: 'Working',
  needs_you: 'Needs you',
  recently_completed: 'Recently completed',
};

const PROCESSING = new Set(['queued', 'processing_metadata']);
const NEEDS_YOU = new Set(['awaiting_purchase', 'needs_help', 'failed']);

export function isProcessingRow(row: QueueRow): boolean {
  return PROCESSING.has(row.status);
}

export function isNeedsYouRow(row: QueueRow): boolean {
  return NEEDS_YOU.has(row.status);
}

/** Section for a queue row, or null when it should not be listed at all. */
export function queueSectionFor(row: QueueRow): QueueSectionKey | null {
  if (isProcessingRow(row)) return 'working';
  if (isNeedsYouRow(row)) return 'needs_you';
  if (row.status === 'completed') return 'recently_completed';
  return null; // cancelled / unknown terminal
}

export type QueueSection<T> = { key: QueueSectionKey; title: string; rows: T[] };

/**
 * Group rows into the three inbox sections, preserving input order within each
 * section and dropping rows that do not belong in the queue.
 */
export function buildQueueSections<T extends QueueRow>(rows: readonly T[]): QueueSection<T>[] {
  const buckets: Record<QueueSectionKey, T[]> = {
    working: [],
    needs_you: [],
    recently_completed: [],
  };
  for (const row of rows) {
    const key = queueSectionFor(row);
    if (key) buckets[key].push(row);
  }
  return (['working', 'needs_you', 'recently_completed'] as const)
    .map((key) => ({ key, title: QUEUE_SECTION_TITLES[key], rows: buckets[key] }))
    .filter((section) => section.rows.length > 0);
}

// ---------------------------------------------------------------------------
// Clear completed
// ---------------------------------------------------------------------------

/**
 * A row is clearable only when the user is genuinely done with it: a terminal
 * completed job, or a recent automatic save the user has already seen. Active
 * work and anything awaiting the user are never eligible.
 */
export function isClearableRow(row: QueueRow): boolean {
  return row.status === 'completed';
}

/** Ids eligible for "Clear completed". Deduped and stable in input order. */
export function clearableRowIds(rows: readonly QueueRow[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id || seen.has(id) || !isClearableRow(row)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** The action is hidden entirely when nothing is eligible. */
export function canClearCompleted(rows: readonly QueueRow[]): boolean {
  return clearableRowIds(rows).length > 0;
}

export function clearCompletedLabel(count: number): string {
  return count === 1 ? 'Clear 1 completed' : `Clear ${count} completed`;
}

/**
 * Applying a clear is idempotent: re-running it with the same ids yields the
 * same remaining list, and ids that are not clearable are never removed.
 */
export function applyClearCompleted<T extends QueueRow>(
  rows: readonly T[],
  clearedIds: readonly string[],
): T[] {
  const cleared = new Set(clearedIds);
  return rows.filter((row) => !(cleared.has(row.id) && isClearableRow(row)));
}

// ---------------------------------------------------------------------------
// Swipe actions
// ---------------------------------------------------------------------------

export type QueueSwipeAction = 'save' | 'dismiss';

export type QueueSwipeAvailability = {
  /** Swipe right → accept the resolved candidate. */
  save: boolean;
  /** Swipe left → remove the row from the queue (never the saved place). */
  dismiss: boolean;
  /** Why save is unavailable, for the accessible action list. */
  saveBlockedReason:
    | 'processing'
    | 'no_candidate'
    | 'ambiguous'
    | 'manual_fallback'
    | 'failed'
    | 'already_saved'
    | null;
};

/**
 * Swipe availability for one row. Every value here must also be exposed as a
 * regular button/accessibility action — swipe is never the only way to act.
 */
export function queueSwipeAvailability(row: QueueRow): QueueSwipeAvailability {
  if (isProcessingRow(row)) {
    // Active backend work: the row may be dismissed from the inbox, but it can
    // never be "saved" before the worker has resolved anything.
    return { save: false, dismiss: true, saveBlockedReason: 'processing' };
  }
  if (row.savedPlaceId) {
    return { save: false, dismiss: true, saveBlockedReason: 'already_saved' };
  }
  if (row.status === 'completed') {
    return { save: false, dismiss: true, saveBlockedReason: 'already_saved' };
  }
  if (row.status === 'failed') {
    return { save: false, dismiss: true, saveBlockedReason: 'failed' };
  }
  if (
    row.decision === 'manual_fallback' ||
    row.needsHelpReason === 'manual_search' ||
    row.needsHelpReason === 'metadata_unavailable'
  ) {
    return { save: false, dismiss: true, saveBlockedReason: 'manual_fallback' };
  }
  if (
    row.decision === 'multi_candidate_confirmation' ||
    row.decision === 'candidate_picker' ||
    row.needsHelpReason === 'multiple_candidates' ||
    (row.candidateCount ?? 0) > 1
  ) {
    return { save: false, dismiss: true, saveBlockedReason: 'ambiguous' };
  }
  if (
    row.status !== 'needs_help' ||
    row.decision !== 'candidate_confirmation' ||
    !row.hasResolvedCandidate ||
    !row.candidateIsPersistable
  ) {
    return { save: false, dismiss: true, saveBlockedReason: 'no_candidate' };
  }
  return { save: true, dismiss: true, saveBlockedReason: null };
}

/** Accessible action list mirroring the swipe gestures for VoiceOver users. */
export function queueAccessibilityActions(
  row: QueueRow,
): { name: QueueSwipeAction; label: string }[] {
  const availability = queueSwipeAvailability(row);
  const actions: { name: QueueSwipeAction; label: string }[] = [];
  if (availability.save) actions.push({ name: 'save', label: 'Save to my map' });
  if (availability.dismiss) actions.push({ name: 'dismiss', label: 'Remove from queue' });
  return actions;
}

/** Width of the native action panel and release threshold used by Swipeable. */
export const QUEUE_ACTION_WIDTH = 88;
export const QUEUE_SWIPE_OPEN_THRESHOLD = 52;
/** Retained for policy tests and backwards-compatible callers. */
export const QUEUE_SWIPE_THRESHOLD = QUEUE_SWIPE_OPEN_THRESHOLD;

export function swipeActionFor(
  dx: number,
  availability: QueueSwipeAvailability,
): QueueSwipeAction | null {
  if (dx <= -QUEUE_SWIPE_THRESHOLD && availability.dismiss) return 'dismiss';
  if (dx >= QUEUE_SWIPE_THRESHOLD && availability.save) return 'save';
  return null;
}

export const QUEUE_EMPTY_COPY = {
  title: 'Nothing waiting',
  body: 'Places you share will show up here while Nearr works on them.',
} as const;

/** True once no section has any row — the genuine empty state. */
export function isInboxEmpty(rows: readonly QueueRow[]): boolean {
  return buildQueueSections(rows).length === 0;
}

/** Persisted dismissal always wins over fetch/realtime payloads. */
export function filterDismissedQueueRows<T extends { id: string }>(
  rows: readonly T[],
  dismissedIds: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !dismissedIds.has(row.id));
}

// ---------------------------------------------------------------------------
// Authoritative active queue model
// ---------------------------------------------------------------------------

type ActiveQueueInput = QueueRow & {
  updated_at?: unknown;
  queue_archived_at?: string | null;
};

function timestamp(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

/**
 * The single normalized dataset used by both the Queue sheet and its Map
 * badge. It removes malformed/duplicate/terminal rows and applies persisted
 * dismissal before either surface counts or renders anything.
 */
export function normalizeActiveQueueRows<T extends ActiveQueueInput>(
  rows: readonly T[] | null | undefined,
  dismissedIds: ReadonlySet<string> = new Set(),
): T[] {
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, T>();
  const order: string[] = [];
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (
      !id ||
      dismissedIds.has(id) ||
      row.queue_archived_at != null ||
      (!isProcessingRow(row) && !isNeedsYouRow(row))
    ) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, row);
      order.push(id);
      continue;
    }
    const existingTime = timestamp(existing.updated_at);
    const incomingTime = timestamp(row.updated_at);
    if (!Number.isFinite(existingTime) || !Number.isFinite(incomingTime) || incomingTime >= existingTime) {
      byId.set(id, row);
    }
  }
  return order.map((id) => byId.get(id)!);
}

/** Working + Needs-you rows in the authoritative normalized model. */
export function activeQueueCount<T extends ActiveQueueInput>(
  rows: readonly T[] | null | undefined,
  dismissedIds: ReadonlySet<string> = new Set(),
): number {
  return normalizeActiveQueueRows(rows, dismissedIds).length;
}
