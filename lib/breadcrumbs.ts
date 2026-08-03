/**
 * lib/breadcrumbs.ts
 *
 * Bounded, persistent, SANITIZED diagnostic breadcrumb recorder. Records the
 * latest ~30 important lifecycle/routing/map/location events so the global
 * error boundary's "Copy diagnostic" can show what led up to a crash WITHOUT
 * requiring macOS Console.
 *
 * Design:
 *   - An in-memory ring buffer is the source of truth for the CURRENT session,
 *     so reading breadcrumbs inside the error boundary is synchronous and safe.
 *   - Every append is ALSO best-effort persisted to AsyncStorage so a crash
 *     that restarts the app still yields the pre-crash trail on next launch.
 *   - Nothing here ever throws. Recording is fire-and-forget.
 *
 * Sanitization: field values are run through sanitizeErrorText and length
 * capped (see breadcrumbsCore). Never pass tokens, signed URLs, captions, or
 * private notes — only ids, routes, states, and classifications.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  appendBreadcrumb,
  formatBreadcrumbs,
  makeBreadcrumb,
  MAX_BREADCRUMBS,
  type Breadcrumb,
  type BreadcrumbEvent,
  type BreadcrumbFields,
} from './breadcrumbsCore';

const KEY = 'nearr:breadcrumbs:v1';

// In-memory ring buffer for the current session (synchronously readable).
let buffer: Breadcrumb[] = [];
let hydrated = false;

/**
 * Load any persisted breadcrumbs from a previous session into memory. Called
 * once at app launch; safe to call more than once (no-op after first success).
 */
export async function hydrateBreadcrumbs(): Promise<void> {
  if (hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        buffer = parsed
          .filter(
            (c): c is Breadcrumb =>
              !!c && typeof c === 'object' && typeof c.event === 'string' && typeof c.t === 'number',
          )
          .slice(-MAX_BREADCRUMBS);
      }
    }
  } catch {
    // ignore — breadcrumbs must never block launch
  } finally {
    hydrated = true;
  }
}

/** Record a sanitized breadcrumb. Never throws; persistence is best-effort. */
export function recordBreadcrumb(event: BreadcrumbEvent, fields: BreadcrumbFields = {}): void {
  try {
    buffer = appendBreadcrumb(buffer, makeBreadcrumb(event, fields));
    // Fire-and-forget persistence (bounded payload, already sanitized).
    void AsyncStorage.setItem(KEY, JSON.stringify(buffer)).catch(() => undefined);
  } catch {
    // never throw
  }
}

/** Synchronously read the current in-memory breadcrumb trail (chronological). */
export function getBreadcrumbs(): Breadcrumb[] {
  return buffer;
}

/** Copy/paste-friendly rendering of the current trail. */
export function renderBreadcrumbs(): string {
  return formatBreadcrumbs(buffer);
}

/** Clear the trail (memory + storage). Best-effort. */
export function clearBreadcrumbs(): void {
  buffer = [];
  void AsyncStorage.removeItem(KEY).catch(() => undefined);
}
