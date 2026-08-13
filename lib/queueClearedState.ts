/**
 * lib/queueClearedState.ts
 *
 * Local, per-user record of which COMPLETED queue entries the user has cleared
 * from their inbox.
 *
 * This is deliberately a client-side acknowledgement rather than a delete:
 *   - saved places are never touched
 *   - share_job_place_results rows are never mutated
 *   - active/unresolved jobs are never affected
 * Clearing only hides rows the user has already finished with, so the operation
 * is safe, reversible server-side, and idempotent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'nearr:queueCleared:v1:';
const DISMISSED_KEY_PREFIX = 'nearr:queueDismissed:v1:';
const MAX_IDS = 400;

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function dismissedKeyFor(userId: string): string {
  return `${DISMISSED_KEY_PREFIX}${userId}`;
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

export async function readClearedQueueIds(userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    return new Set(parseIds(await AsyncStorage.getItem(keyFor(userId))));
  } catch {
    return new Set();
  }
}

/** Merge newly cleared ids. Idempotent: re-clearing the same ids is a no-op. */
export async function addClearedQueueIds(
  userId: string | null,
  ids: readonly string[],
): Promise<Set<string>> {
  const existing = await readClearedQueueIds(userId);
  if (!userId || ids.length === 0) return existing;
  for (const id of ids) if (id) existing.add(id);
  // Bound growth; the newest ids are the ones that still matter for hiding.
  const bounded = [...existing].slice(-MAX_IDS);
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(bounded));
  } catch {
    // A failed write only means the row reappears next launch — never fatal.
  }
  return new Set(bounded);
}

/** Local-only inbox dismissal. It never calls the backend or cancels work. */
export async function readDismissedQueueIds(userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    return new Set(parseIds(await AsyncStorage.getItem(dismissedKeyFor(userId))));
  } catch {
    return new Set();
  }
}

export async function addDismissedQueueIds(
  userId: string | null,
  ids: readonly string[],
): Promise<Set<string>> {
  const existing = await readDismissedQueueIds(userId);
  if (!userId || ids.length === 0) return existing;
  for (const id of ids) if (id) existing.add(id);
  const bounded = [...existing].slice(-MAX_IDS);
  try {
    await AsyncStorage.setItem(dismissedKeyFor(userId), JSON.stringify(bounded));
  } catch {
    // A failed write only means the active row reappears next launch.
  }
  return new Set(bounded);
}
