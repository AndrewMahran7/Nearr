/**
 * lib/breadcrumbsCore.ts
 *
 * PURE, dependency-free ring-buffer logic for the sanitized diagnostic
 * breadcrumb trail. Extracted from lib/breadcrumbs.ts so the bounded-size /
 * ordering / sanitization behaviour can be unit-tested from ts-node WITHOUT
 * React Native / AsyncStorage.
 *
 * A breadcrumb records ONLY safe, low-cardinality fields (see BreadcrumbFields)
 * — never tokens, credentials, full provider responses, private notes, or
 * signed media URLs. Callers are responsible for not passing secrets; the
 * `sanitizeBreadcrumbFields` helper below additionally strips anything that
 * looks like a token/JWT/URL-credential from string field values as a
 * defence-in-depth measure.
 */

import { sanitizeErrorText } from './sanitizeError';

/** The maximum number of breadcrumbs retained in the ring buffer. */
export const MAX_BREADCRUMBS = 30;

/**
 * The set of important events we record. Kept as a string union so the event
 * name is a stable, low-cardinality tag (safe to persist / copy).
 */
export type BreadcrumbEvent =
  | 'app_launch'
  | 'appstate_change'
  | 'root_layout_ready'
  | 'initial_url_received'
  | 'warm_url_received'
  | 'notification_received'
  | 'notification_tapped'
  | 'notification_dedupe'
  | 'notification_route_applied'
  | 'intended_route'
  | 'actual_navigation'
  | 'queue_item_opened'
  | 'candidate_loaded'
  | 'save_started'
  | 'save_response'
  | 'already_saved_response'
  | 'share_job_terminal_update'
  | 'queue_realtime_event'
  | 'map_mounted'
  | 'map_unmounted'
  | 'saved_places_fetch_started'
  | 'saved_places_fetch_completed'
  | 'saved_places_fetch_failed'
  | 'location_watcher_started'
  | 'location_reading_accepted'
  | 'location_reading_rejected'
  | 'location_watcher_stopped'
  | 'error_boundary_triggered';

/**
 * The only field NAMES a breadcrumb may carry. Constraining the shape keeps
 * accidental PII/secret leakage out of the diagnostic (no free-form `data`).
 */
export type BreadcrumbFields = {
  route?: string | null;
  jobId?: string | null;
  savedPlaceId?: string | null;
  notificationId?: string | null;
  appState?: string | null;
  result?: string | null; // classification, e.g. 'accepted' | 'rejected' | 'duplicate'
  errorName?: string | null;
  errorMessage?: string | null; // sanitized
};

export type Breadcrumb = BreadcrumbFields & {
  t: number; // epoch ms
  event: BreadcrumbEvent;
};

const FIELD_MAX_LEN = 120;

/** Strip token/JWT/credential-ish content from a single field value. */
function sanitizeField(value: unknown): string | null {
  if (value == null) return null;
  const raw = typeof value === 'string' ? value : String(value);
  if (!raw) return null;
  return sanitizeErrorText(raw).slice(0, FIELD_MAX_LEN);
}

/** Sanitize all provided fields; drops keys whose value resolves to null. */
export function sanitizeBreadcrumbFields(fields: BreadcrumbFields): BreadcrumbFields {
  const out: BreadcrumbFields = {};
  const keys: (keyof BreadcrumbFields)[] = [
    'route',
    'jobId',
    'savedPlaceId',
    'notificationId',
    'appState',
    'result',
    'errorName',
    'errorMessage',
  ];
  for (const key of keys) {
    const cleaned = sanitizeField(fields[key]);
    if (cleaned != null) out[key] = cleaned;
  }
  return out;
}

/** Build a sanitized breadcrumb record with a timestamp. */
export function makeBreadcrumb(
  event: BreadcrumbEvent,
  fields: BreadcrumbFields = {},
  now: number = Date.now(),
): Breadcrumb {
  return { t: now, event, ...sanitizeBreadcrumbFields(fields) };
}

/**
 * Append a breadcrumb to the buffer and return a NEW bounded array (newest
 * LAST — chronological order). The oldest entries are dropped once the buffer
 * exceeds MAX_BREADCRUMBS. Pure: does not mutate `buffer`.
 */
export function appendBreadcrumb(buffer: Breadcrumb[], crumb: Breadcrumb): Breadcrumb[] {
  const next = [...buffer, crumb];
  if (next.length <= MAX_BREADCRUMBS) return next;
  return next.slice(next.length - MAX_BREADCRUMBS);
}

/** One-line rendering of a breadcrumb (chronological copy/paste). */
export function formatBreadcrumb(crumb: Breadcrumb): string {
  const parts: string[] = [new Date(crumb.t).toISOString(), crumb.event];
  const fieldOrder: (keyof BreadcrumbFields)[] = [
    'route',
    'jobId',
    'savedPlaceId',
    'notificationId',
    'appState',
    'result',
    'errorName',
    'errorMessage',
  ];
  for (const key of fieldOrder) {
    const v = crumb[key];
    if (v != null) parts.push(`${key}=${v}`);
  }
  return parts.join(' ');
}

/** Render the whole trail (chronological) for the Copy diagnostic block. */
export function formatBreadcrumbs(buffer: Breadcrumb[]): string {
  if (buffer.length === 0) return '(no breadcrumbs)';
  return buffer.map(formatBreadcrumb).join('\n');
}
