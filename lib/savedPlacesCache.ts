/**
 * Saved-places local cache (Stage 0, read-only offline).
 *
 * Scope:
 *   - Persist the result of the last successful `listSavedPlaces()` call
 *     under a per-user AsyncStorage key.
 *   - Surface the cached list when a fresh network fetch fails.
 *   - Provide a typed "offline error" so screens can show a friendly
 *     message instead of a raw Supabase / fetch message when the user
 *     tries to edit / delete while offline.
 *
 * Intentionally out of scope (do NOT add here without a follow-up
 * design pass):
 *   - Offline mutations / outbox / queue.
 *   - Conflict resolution.
 *   - Encryption (cached rows already pass through RLS — we cache exactly
 *     what the user is allowed to see, never their tokens).
 *   - Background re-sync.
 *
 * Cache key format:
 *   - List:        `nearr:savedPlaces:v1:<userId>`
 *   - Sync stamp:  `nearr:savedPlaces:lastSyncedAt:v1:<userId>`
 *
 * Storage format is a JSON blob containing the entire
 * `SavedPlaceWithPlace[]` payload — every field rendered by the
 * list / map / detail screens is already a plain scalar, so we cache
 * the whole row instead of cherry-picking. The `version` field guards
 * against future schema changes; bump it to invalidate every device.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SavedPlaceWithPlace } from '@/types';

const CACHE_VERSION = 1 as const;
const LIST_KEY_PREFIX = `nearr:savedPlaces:v${CACHE_VERSION}:`;
const STAMP_KEY_PREFIX = `nearr:savedPlaces:lastSyncedAt:v${CACHE_VERSION}:`;

export type CachedSavedPlaces = {
  data: SavedPlaceWithPlace[];
  lastSyncedAt: string; // ISO timestamp
};

type Envelope = {
  version: typeof CACHE_VERSION;
  lastSyncedAt: string;
  data: SavedPlaceWithPlace[];
};

function listKey(userId: string): string {
  return `${LIST_KEY_PREFIX}${userId}`;
}

function stampKey(userId: string): string {
  return `${STAMP_KEY_PREFIX}${userId}`;
}

/**
 * Best-effort: detect errors that almost certainly mean "no network".
 *
 * React Native's `fetch` throws a `TypeError` with the message
 * `Network request failed` when the device is offline; Supabase wraps
 * the same shape. We also catch a few common DNS / abort messages.
 *
 * We err on the side of recognising too many things as offline — the
 * worst outcome is showing the friendly "Internet required" alert
 * instead of a Supabase-specific error string, which is fine for a
 * destructive action the user already has to acknowledge.
 */
export function isLikelyOfflineError(err: unknown): boolean {
  if (!err) return false;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (err as { message?: unknown })?.message;
  if (typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('offline') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout')
  );
}

/**
 * Thrown by service mutations when the caller is offline. Screens should
 * catch this and surface `error.message` directly — it is intentionally
 * human-readable.
 */
export class OfflineMutationError extends Error {
  readonly code = 'OFFLINE_MUTATION_BLOCKED';
  constructor(message = 'Internet required to update saved places.') {
    super(message);
    this.name = 'OfflineMutationError';
  }
}

export function isOfflineMutationError(err: unknown): err is OfflineMutationError {
  return err instanceof OfflineMutationError;
}

/** Persist a successful fetch. Silent on failure — caching is best-effort. */
export async function writeSavedPlacesCache(
  userId: string | null | undefined,
  data: SavedPlaceWithPlace[],
): Promise<void> {
  if (!userId) return;
  const lastSyncedAt = new Date().toISOString();
  const envelope: Envelope = { version: CACHE_VERSION, lastSyncedAt, data };
  try {
    await AsyncStorage.multiSet([
      [listKey(userId), JSON.stringify(envelope)],
      [stampKey(userId), lastSyncedAt],
    ]);
    console.log(`[offline] saved_places_cache_write count=${data.length}`);
  } catch (err) {
    console.warn('[offline] saved_places_cache_write_failed', err);
  }
}

/** Read the cache. Returns `null` if missing, corrupt, or wrong version. */
export async function readSavedPlacesCache(
  userId: string | null | undefined,
): Promise<CachedSavedPlaces | null> {
  if (!userId) {
    console.log('[offline] saved_places_cache_miss');
    return null;
  }
  try {
    const raw = await AsyncStorage.getItem(listKey(userId));
    if (!raw) {
      console.log('[offline] saved_places_cache_miss');
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Envelope> | null;
    if (
      !parsed ||
      parsed.version !== CACHE_VERSION ||
      !Array.isArray(parsed.data) ||
      typeof parsed.lastSyncedAt !== 'string'
    ) {
      console.log('[offline] saved_places_cache_miss');
      return null;
    }
    console.log(`[offline] saved_places_cache_read count=${parsed.data.length}`);
    return {
      data: parsed.data as SavedPlaceWithPlace[],
      lastSyncedAt: parsed.lastSyncedAt,
    };
  } catch (err) {
    console.warn('[offline] saved_places_cache_read_failed', err);
    return null;
  }
}

/** Look up one saved place by id from the cache (used by place detail). */
export async function readSavedPlaceFromCache(
  userId: string | null | undefined,
  savedPlaceId: string,
): Promise<SavedPlaceWithPlace | null> {
  const cached = await readSavedPlacesCache(userId);
  if (!cached) return null;
  return cached.data.find((row) => row.id === savedPlaceId) ?? null;
}

/** Drop the cache for a user (e.g. on sign-out). Best-effort. */
export async function clearSavedPlacesCache(
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.multiRemove([listKey(userId), stampKey(userId)]);
  } catch (err) {
    console.warn('[offline] saved_places_cache_clear_failed', err);
  }
}
