/**
 * lib/nearbyGroupRouting.ts
 *
 * PURE routing decision for a tapped nearby-reminder notification.
 *
 * The grouped notification payload ALREADY carries the exact group — see
 * lib/notifications.ts, which schedules `data.groupedSavedPlaceIds` alongside
 * `savedPlaceId`. Nothing new needs to be persisted: the identities of the
 * places the user was told about travel with the notification itself.
 *
 * That matters because the group is HISTORICAL. By the time the user taps,
 * they may have moved, minutes may have passed, or a place may be gone. The
 * screen must show what the notification promised, so the group is never
 * reconstructed by re-running a proximity query at tap time.
 */

/** Cap: a notification body only ever names a handful of places. */
export const MAX_GROUPED_PLACES = 10;

export type NearbyReminderRoute =
  | { kind: 'group'; savedPlaceIds: string[] }
  | { kind: 'single'; savedPlaceId: string }
  | { kind: 'map' };

function validId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Clean the payload's id list: drop malformed entries, dedupe, and keep the
 * trigger place first so the primary place leads the list. Order is otherwise
 * the delivery order, which is the order the notification body named them —
 * deterministic, and it needs no location permission to compute.
 */
export function normalizeGroupedSavedPlaceIds(
  raw: unknown,
  primarySavedPlaceId?: string | null,
): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const primary = validId(primarySavedPlaceId);
  const seen = new Set<string>();
  const ids: string[] = [];

  if (primary) {
    seen.add(primary);
    ids.push(primary);
  }
  for (const entry of list) {
    const id = validId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_GROUPED_PLACES) break;
  }
  return ids;
}

/**
 * Where a tapped nearby reminder should go.
 *
 *   2+ distinct places → the grouped browse screen
 *   exactly 1          → the existing single-place opportunity flow
 *   none usable        → the map
 *
 * Old notifications scheduled before grouping carried only `savedPlaceId`;
 * they normalize to a single id and therefore keep their original behavior.
 */
export function routeNearbyReminder(payload: {
  savedPlaceId?: unknown;
  groupedSavedPlaceIds?: unknown;
}): NearbyReminderRoute {
  const ids = normalizeGroupedSavedPlaceIds(
    payload?.groupedSavedPlaceIds,
    validId(payload?.savedPlaceId),
  );
  if (ids.length > 1) return { kind: 'group', savedPlaceIds: ids };
  if (ids.length === 1) return { kind: 'single', savedPlaceId: ids[0]! };
  return { kind: 'map' };
}

/**
 * Compact, JSON-safe transport for the route param. Ids only — never whole
 * saved-place records, coordinates, or provider payloads.
 */
export function encodeGroupedSavedPlaceIds(ids: readonly string[]): string {
  return ids.join(',');
}

export function decodeGroupedSavedPlaceIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return normalizeGroupedSavedPlaceIds(raw);
  if (typeof raw !== 'string') return [];
  return normalizeGroupedSavedPlaceIds(raw.split(','));
}

/** Header copy for however many places actually survived loading. */
export function groupedOpportunityTitle(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return 'Nothing nearby right now';
  if (n === 1) return '1 place nearby';
  return `${n} places nearby`;
}
