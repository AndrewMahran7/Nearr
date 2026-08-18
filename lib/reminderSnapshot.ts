/**
 * Nearr — durable local reminder snapshot (offline V1).
 *
 * WHY THIS EXISTS
 * ---------------
 * Nearr's nearby reminders were ALREADY fully device-local in two respects:
 *
 *   1. Proximity detection is client-side — either an OS `CLCircularRegion`
 *      ENTER event (`lib/geofencing.ts`) or the background location task
 *      computing distance locally (`checkProximity` in `lib/notifications.ts`).
 *   2. Delivery is a LOCAL notification (`scheduleNotificationAsync`,
 *      `trigger: null`). No push, no Edge Function, no server round-trip.
 *
 * But the DECISION between those two steps was server-dependent: at the
 * moment the boundary was crossed, `maybeNotifyForSavedPlace()` issued four
 * sequential Supabase reads (auth.getUser + the saved place + all enabled
 * saved places + the profile) before it could decide whether to notify.
 * Offline, the very first read failed and the event was silently dropped —
 * the geofence fired, the OS woke the app, and Nearr threw the wake away.
 *
 * This module closes that gap in the narrowest possible way: it persists the
 * exact inputs that decision needs, so the existing engine can answer from
 * disk when the network is gone. It does NOT add a second reminder engine,
 * a second notification owner, or a second relationship store.
 *
 * WHAT IS PERSISTED
 * -----------------
 * Only what the reminder decision consumes:
 *   - the profile master switches / quiet hours / default radius
 *   - the eligible saved places, projected to reminder fields only —
 *     including the resolved `category` (used to pick a category-aware
 *     radius, see `lib/nearbyEligibility.ts`) and the place's
 *     `business_status` (used only to suppress reminders for places that
 *     are reliably closed)
 *   - a small local notification ledger (see below)
 *
 * Deliberately NOT persisted: notes, ai_note, source_url, recognition
 * evidence, captions, transcripts, candidate arrays. Those are product data
 * owned by `lib/savedPlacesCache.ts`; the reminder path has no business
 * reading them, and notification payloads must never carry them.
 *
 * THE LOCAL LEDGER
 * ----------------
 * Cooldowns normally live in `saved_places.last_notified_at` /
 * `notification_count`. Offline those writes fail, so a restart would forget
 * that we already notified and the user could be re-alerted for the same
 * place. `recordLocalNotification()` writes the delivery locally; readers
 * merge it with the server values by taking the MAX of each. Server state
 * stays authoritative — the local value can only ever make the engine more
 * conservative (notify less), never more spammy.
 *
 * Storage keys (the version is part of the key, so an incompatible shape
 * change is a key change and old data is simply never read again):
 *   - Snapshot:    `nearr:reminderSnapshot:v<N>:<userId>`
 *   - Active user: `nearr:reminderSnapshot:activeUser:v<N>`
 *
 * The active-user pointer is what lets a cold, network-less, OS-relaunched
 * process know WHOSE reminders it is holding without calling Supabase auth.
 */

import type { Profile, RadiusUnit } from '@/types';
import type { NearrCategory } from './placeCategory';

/**
 * The slice of AsyncStorage this module uses.
 *
 * Injectable, and resolved LAZILY, so the reminder logic can be exercised in
 * a plain Node test process without pulling in a React Native native module.
 * Production code never passes a store and always gets AsyncStorage.
 */
export type ReminderSnapshotStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
};

let injectedStore: ReminderSnapshotStore | null = null;

/** Test seam. Pass null to restore the real AsyncStorage-backed store. */
export function setReminderSnapshotStore(store: ReminderSnapshotStore | null): void {
  injectedStore = store;
}

function store(): ReminderSnapshotStore {
  if (injectedStore) return injectedStore;
  // Required lazily: importing AsyncStorage at module scope would make this
  // file unloadable outside a React Native runtime.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@react-native-async-storage/async-storage').default as ReminderSnapshotStore;
}

// v3 adds `category` and `place.business_status` to the projected shape
// (category-aware radius + closed suppression). Bumping the version is the
// established way this module handles a shape change: an old v2 snapshot is
// simply never read again, and the next successful sync writes a fresh one.
const SNAPSHOT_VERSION = 3 as const;
const SNAPSHOT_KEY_PREFIX = `nearr:reminderSnapshot:v${SNAPSHOT_VERSION}:`;
const ACTIVE_USER_KEY = `nearr:reminderSnapshot:activeUser:v${SNAPSHOT_VERSION}`;

/**
 * Bound the snapshot so a user with a very large collection cannot grow
 * AsyncStorage without limit. Well above the 20-region iOS cap and above the
 * 100-geofence Android cap, so ranking still has room to work offline.
 */
export const MAX_SNAPSHOT_PLACES = 200;

/**
 * The minimum shape the reminder engine needs from a saved place.
 *
 * `SavedPlaceWithPlace` is structurally assignable to this, so every existing
 * caller keeps working unchanged while the snapshot can supply a much
 * narrower object.
 */
export type ReminderEligiblePlace = {
  id: string;
  place_id: string;
  radius_value: number | null;
  radius_unit: RadiusUnit | null;
  notifications_enabled: boolean;
  last_notified_at: string | null;
  notification_count: number;
  created_at: string;
  /** Canonical Nearr category; drives the category-aware default radius. */
  category?: NearrCategory | null;
  place: {
    id: string;
    google_place_id: string | null;
    name: string;
    formatted_address: string | null;
    latitude: number;
    longitude: number;
    /** Google business_status. Used only to suppress reminders for places that are reliably not actionable. */
    business_status?: string | null;
  };
};

/** The profile fields the reminder decision actually reads. */
export type ReminderProfile = Pick<
  Profile,
  | 'id'
  | 'default_radius_value'
  | 'default_radius_unit'
  | 'notifications_enabled'
  | 'nearby_notifications_enabled'
  | 'quiet_hours_enabled'
  | 'quiet_hours_start'
  | 'quiet_hours_end'
>;

type LedgerEntry = { at: number; count: number };

type Envelope = {
  version: typeof SNAPSHOT_VERSION;
  userId: string;
  syncedAt: string;
  profile: ReminderProfile | null;
  places: ReminderEligiblePlace[];
  /** saved_place_id -> locally observed delivery. See module docblock. */
  ledger: Record<string, LedgerEntry>;
};

export type ReminderSnapshot = {
  userId: string;
  syncedAt: string;
  profile: ReminderProfile | null;
  places: ReminderEligiblePlace[];
};

function snapshotKey(userId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${userId}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validate one persisted place. A malformed entry is SKIPPED, never thrown —
 * a single bad row must not cost the user every other reminder, and must
 * never crash a background task that the OS woke for a boundary crossing.
 *
 * Coordinates are validated to real lat/lng ranges because these values are
 * handed straight to `startGeofencingAsync`, where NaN or out-of-range input
 * can reject the whole region set.
 */
export function isValidReminderPlace(value: unknown): value is ReminderEligiblePlace {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ReminderEligiblePlace>;
  if (typeof row.id !== 'string' || row.id.length === 0) return false;
  if (typeof row.notifications_enabled !== 'boolean') return false;
  const place = row.place as ReminderEligiblePlace['place'] | undefined;
  if (!place || typeof place !== 'object') return false;
  if (typeof place.id !== 'string' || place.id.length === 0) return false;
  if (typeof place.name !== 'string') return false;
  if (!isFiniteNumber(place.latitude) || !isFiniteNumber(place.longitude)) return false;
  if (place.latitude < -90 || place.latitude > 90) return false;
  if (place.longitude < -180 || place.longitude > 180) return false;
  return true;
}

/** Project any richer saved-place row down to the reminder-only fields. */
export function toReminderPlace(row: ReminderEligiblePlace): ReminderEligiblePlace {
  return {
    id: row.id,
    place_id: row.place_id,
    radius_value: row.radius_value ?? null,
    radius_unit: row.radius_unit ?? null,
    notifications_enabled: row.notifications_enabled,
    last_notified_at: row.last_notified_at ?? null,
    notification_count: row.notification_count ?? 0,
    created_at: row.created_at,
    category: row.category ?? null,
    place: {
      id: row.place.id,
      google_place_id: row.place.google_place_id ?? null,
      name: row.place.name,
      formatted_address: row.place.formatted_address ?? null,
      latitude: row.place.latitude,
      longitude: row.place.longitude,
      business_status: row.place.business_status ?? null,
    },
  };
}

function toReminderProfile(profile: Profile | null): ReminderProfile | null {
  if (!profile) return null;
  return {
    id: profile.id,
    default_radius_value: profile.default_radius_value,
    default_radius_unit: profile.default_radius_unit,
    notifications_enabled: profile.notifications_enabled,
    nearby_notifications_enabled: profile.nearby_notifications_enabled,
    quiet_hours_enabled: profile.quiet_hours_enabled,
    quiet_hours_start: profile.quiet_hours_start,
    quiet_hours_end: profile.quiet_hours_end,
  };
}

// ---------------------------------------------------------------------------
// Ledger merge
// ---------------------------------------------------------------------------

/**
 * Fold the local ledger into the persisted rows.
 *
 * Takes the MAX of the server value and the locally observed one for both
 * `last_notified_at` and `notification_count`. That direction is deliberate:
 * a local record can only suppress a notification, never cause an extra one.
 */
export function applyLedger(
  places: ReminderEligiblePlace[],
  ledger: Record<string, LedgerEntry>,
): ReminderEligiblePlace[] {
  if (!ledger || Object.keys(ledger).length === 0) return places;
  return places.map((row) => {
    const entry = ledger[row.id];
    if (!entry) return row;
    const serverAt = row.last_notified_at ? Date.parse(row.last_notified_at) : 0;
    const localAt = isFiniteNumber(entry.at) ? entry.at : 0;
    const mergedAt = Math.max(Number.isFinite(serverAt) ? serverAt : 0, localAt);
    return {
      ...row,
      last_notified_at:
        mergedAt > 0 ? new Date(mergedAt).toISOString() : row.last_notified_at,
      notification_count: Math.max(
        row.notification_count ?? 0,
        isFiniteNumber(entry.count) ? entry.count : 0,
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Active-user pointer
// ---------------------------------------------------------------------------

/**
 * Who this device last held reminders for. Read by background tasks that
 * cannot call Supabase auth (no network, cold OS-relaunched process).
 */
export async function readActiveReminderUserId(): Promise<string | null> {
  try {
    const raw = await store().getItem(ACTIVE_USER_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

async function writeActiveReminderUserId(userId: string): Promise<void> {
  try {
    await store().setItem(ACTIVE_USER_KEY, userId);
  } catch {
    // Best-effort: a failed pointer write only costs offline reminders until
    // the next successful sync. It must never break the sync itself.
  }
}

// ---------------------------------------------------------------------------
// Read / write / clear
// ---------------------------------------------------------------------------

/**
 * Persist the authoritative reminder inputs after a SUCCESSFUL server sync.
 *
 * Only ever called with data the server actually returned. A failed fetch
 * must not reach this function — that is what keeps a transient network
 * error from erasing a good snapshot.
 *
 * The existing ledger is preserved across writes so an offline delivery
 * recorded five minutes ago still suppresses a duplicate after the next
 * successful sync.
 */
export async function writeReminderSnapshot(params: {
  userId: string;
  profile: Profile | null;
  places: ReminderEligiblePlace[];
}): Promise<void> {
  const { userId, profile, places } = params;
  if (!userId) return;
  try {
    const existing = await readEnvelope(userId);
    const valid = places.filter(isValidReminderPlace).slice(0, MAX_SNAPSHOT_PLACES);
    const keep = new Set(valid.map((row) => row.id));
    // Drop ledger entries for places that are no longer eligible, so the
    // ledger cannot grow without bound as places come and go.
    const ledger: Record<string, LedgerEntry> = {};
    for (const [id, entry] of Object.entries(existing?.ledger ?? {})) {
      if (keep.has(id)) ledger[id] = entry;
    }
    const envelope: Envelope = {
      version: SNAPSHOT_VERSION,
      userId,
      syncedAt: new Date().toISOString(),
      profile: toReminderProfile(profile),
      places: valid.map(toReminderPlace),
      ledger,
    };
    await store().setItem(snapshotKey(userId), JSON.stringify(envelope));
    await writeActiveReminderUserId(userId);
    console.log(`[offline] reminder_snapshot_write count=${valid.length}`);
  } catch (err) {
    console.warn('[offline] reminder_snapshot_write_failed', err);
  }
}

async function readEnvelope(userId: string): Promise<Envelope | null> {
  try {
    const raw = await store().getItem(snapshotKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Envelope> | null;
    if (
      !parsed ||
      parsed.version !== SNAPSHOT_VERSION ||
      parsed.userId !== userId ||
      !Array.isArray(parsed.places) ||
      typeof parsed.syncedAt !== 'string'
    ) {
      // Unknown/old/foreign shape — ignore it rather than migrate. The next
      // successful sync rewrites it, and until then the user simply has the
      // pre-existing online behaviour.
      return null;
    }
    const ledger =
      parsed.ledger && typeof parsed.ledger === 'object' && !Array.isArray(parsed.ledger)
        ? (parsed.ledger as Record<string, LedgerEntry>)
        : {};
    return {
      version: SNAPSHOT_VERSION,
      userId,
      syncedAt: parsed.syncedAt,
      profile: (parsed.profile as ReminderProfile | null) ?? null,
      places: parsed.places.filter(isValidReminderPlace),
      ledger,
    };
  } catch (err) {
    // Corrupt JSON must never crash a background task.
    console.warn('[offline] reminder_snapshot_read_failed', err);
    return null;
  }
}

/**
 * Read the snapshot for a user, with the local ledger already folded in.
 * Returns null when absent, corrupt, or written by a different schema.
 */
export async function readReminderSnapshot(
  userId: string | null | undefined,
): Promise<ReminderSnapshot | null> {
  if (!userId) return null;
  const envelope = await readEnvelope(userId);
  if (!envelope) return null;
  return {
    userId: envelope.userId,
    syncedAt: envelope.syncedAt,
    profile: envelope.profile,
    places: applyLedger(envelope.places, envelope.ledger),
  };
}

/**
 * Read the snapshot for whoever this device last synced, without consulting
 * Supabase auth. This is the entry point for the offline notify path.
 */
export async function readActiveReminderSnapshot(): Promise<ReminderSnapshot | null> {
  const userId = await readActiveReminderUserId();
  if (!userId) return null;
  return readReminderSnapshot(userId);
}

/**
 * Record that a notification was actually delivered for these saved places.
 *
 * Called on EVERY successful delivery, online or offline — online the server
 * write is authoritative and this is merely redundant; offline this is the
 * only thing standing between the user and a repeat alert after a restart.
 */
export async function recordLocalNotification(
  savedPlaceIds: string[],
  at: number = Date.now(),
): Promise<void> {
  const ids = savedPlaceIds.filter((id) => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return;
  try {
    const userId = await readActiveReminderUserId();
    if (!userId) return;
    const envelope = await readEnvelope(userId);
    if (!envelope) return;
    const ledger = { ...envelope.ledger };
    for (const id of ids) {
      const prev = ledger[id];
      ledger[id] = {
        at: Math.max(prev?.at ?? 0, at),
        count: (prev?.count ?? 0) + 1,
      };
    }
    // Also fold the increment into the persisted rows so a reader that never
    // re-syncs still sees the raised count.
    const places = envelope.places.map((row) =>
      ids.includes(row.id)
        ? {
            ...row,
            last_notified_at: new Date(at).toISOString(),
            notification_count: (row.notification_count ?? 0) + 1,
          }
        : row,
    );
    const next: Envelope = { ...envelope, places, ledger };
    await store().setItem(snapshotKey(userId), JSON.stringify(next));
  } catch (err) {
    console.warn('[offline] reminder_snapshot_ledger_write_failed', err);
  }
}

/**
 * Drop everything for a user and forget the active pointer.
 *
 * Called on explicit sign-out and on account deletion. After this, an
 * OS-delivered geofence event for that account finds no snapshot and cannot
 * notify — which is exactly the required post-logout behaviour.
 */
export async function clearReminderSnapshot(
  userId: string | null | undefined,
): Promise<void> {
  try {
    const keys = [ACTIVE_USER_KEY];
    if (userId) keys.push(snapshotKey(userId));
    else {
      const active = await readActiveReminderUserId();
      if (active) keys.push(snapshotKey(active));
    }
    await store().multiRemove(keys);
  } catch (err) {
    console.warn('[offline] reminder_snapshot_clear_failed', err);
  }
}
