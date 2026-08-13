/** Per-user persisted acknowledgements for queue-only visibility. */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'nearr:queueCleared:v1:';
const DISMISSED_KEY_PREFIX = 'nearr:queueDismissed:v1:';
const MAX_IDS = 400;

type DismissalListener = (userId: string, ids: Set<string>) => void;
const dismissalListeners = new Set<DismissalListener>();

/** Keeps simultaneously mounted queue consumers in sync after local removal. */
export function subscribeQueueDismissals(listener: DismissalListener): () => void {
  dismissalListeners.add(listener);
  return () => dismissalListeners.delete(listener);
}

export type QueueIdStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

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
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

export async function readClearedQueueIds(
  userId: string | null,
  storage: QueueIdStorage = AsyncStorage,
): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    return new Set(parseIds(await storage.getItem(keyFor(userId))));
  } catch {
    return new Set();
  }
}

/** Merge completed-result ids in one idempotent storage write. */
export async function addClearedQueueIds(
  userId: string | null,
  ids: readonly string[],
  storage: QueueIdStorage = AsyncStorage,
): Promise<Set<string>> {
  const existing = await readClearedQueueIds(userId, storage);
  if (ids.length === 0) return existing;
  if (!userId) throw new Error('Queue acknowledgement requires a signed-in user.');
  for (const id of ids) if (id) existing.add(id);
  const bounded = [...existing].slice(-MAX_IDS);
  await storage.setItem(keyFor(userId), JSON.stringify(bounded));
  return new Set(bounded);
}

export async function readDismissedQueueIds(
  userId: string | null,
  storage: QueueIdStorage = AsyncStorage,
): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    return new Set(parseIds(await storage.getItem(dismissedKeyFor(userId))));
  } catch {
    return new Set();
  }
}

/** Local inbox dismissal only; never cancels or deletes backend work. */
export async function addDismissedQueueIds(
  userId: string | null,
  ids: readonly string[],
  storage: QueueIdStorage = AsyncStorage,
): Promise<Set<string>> {
  const existing = await readDismissedQueueIds(userId, storage);
  if (ids.length === 0) return existing;
  if (!userId) throw new Error('Queue dismissal requires a signed-in user.');
  for (const id of ids) if (id) existing.add(id);
  const bounded = [...existing].slice(-MAX_IDS);
  await storage.setItem(dismissedKeyFor(userId), JSON.stringify(bounded));
  const committed = new Set(bounded);
  for (const listener of dismissalListeners) listener(userId, new Set(committed));
  return committed;
}

/**
 * Hide immediately, commit once, and restore the exact previous state when
 * persistence fails. This keeps fetch/realtime/restart behavior consistent.
 */
export async function persistQueueIdsOptimistically(args: {
  current: ReadonlySet<string>;
  ids: readonly string[];
  apply: (next: Set<string>) => void;
  persist: (ids: readonly string[]) => Promise<Set<string>>;
}): Promise<Set<string>> {
  const previous = new Set(args.current);
  const optimistic = new Set(previous);
  for (const id of args.ids) if (id) optimistic.add(id);
  args.apply(optimistic);
  try {
    const committed = await args.persist(args.ids);
    args.apply(committed);
    return committed;
  } catch (error) {
    args.apply(previous);
    throw error;
  }
}
