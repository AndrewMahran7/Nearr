export const PLACE_NOTIFICATION_DEDUPE_STORAGE_KEY =
  'nearr:place-notification-dedupe:v1';

export const PLACE_NOTIFICATION_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export const PLACE_NOTIFICATION_DEDUPE_RETENTION_MS =
  7 * 24 * 60 * 60 * 1000;

const PLACE_NOTIFICATION_DEDUPE_MAX_ENTRIES = 500;

export type PlaceNotificationDedupeStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type PlaceNotificationGateParams = {
  savedPlaceId: string | null | undefined;
  triggerType: string;
  now: number;
  cooldownMs?: number;
  dedupeAcrossTriggers?: boolean;
};

export type PlaceNotificationGateResult =
  | {
      status: 'allow';
      dedupeKeys: string[];
      savedPlaceId: string;
      triggerType: string;
    }
  | {
      status: 'skipped_duplicate';
      dedupeKey: string;
      ageMs: number;
      savedPlaceId: string;
      triggerType: string;
    }
  | {
      status: 'skipped_disabled';
      reason: 'missing_saved_place_id';
      triggerType: string;
    }
  | {
      status: 'failed';
      reason: 'storage_read_failed' | 'storage_parse_failed' | 'storage_write_failed';
      triggerType: string;
      savedPlaceId?: string;
    };

type StoreMap = Record<string, number>;

export function buildPlaceReminderDedupeKey(
  savedPlaceId: string,
  triggerType: string,
): string {
  return `place-reminder:${savedPlaceId}:${triggerType}`;
}

function buildAnyTriggerDedupeKey(savedPlaceId: string): string {
  return `place-reminder:${savedPlaceId}:any`;
}

function parseStore(raw: string | null): StoreMap {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid_store_shape');
  }
  const map: StoreMap = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('invalid_store_shape');
    }
    map[key] = value;
  }
  return map;
}

function pruneStore(map: StoreMap, now: number, retentionMs: number): StoreMap {
  const next: StoreMap = {};
  for (const [key, ts] of Object.entries(map)) {
    if (!Number.isFinite(ts)) continue;
    if (ts > now) continue;
    if (now - ts > retentionMs) continue;
    next[key] = ts;
  }

  const entries = Object.entries(next);
  if (entries.length <= PLACE_NOTIFICATION_DEDUPE_MAX_ENTRIES) {
    return next;
  }

  entries.sort((left, right) => right[1] - left[1]);
  const trimmed: StoreMap = {};
  for (const [key, ts] of entries.slice(0, PLACE_NOTIFICATION_DEDUPE_MAX_ENTRIES)) {
    trimmed[key] = ts;
  }
  return trimmed;
}

type GateOptions = {
  storageKey?: string;
  retentionMs?: number;
  defaultCooldownMs?: number;
};

export function createPlaceNotificationDedupeGate(
  store: PlaceNotificationDedupeStore,
  options: GateOptions = {},
): {
  checkAndRecord(params: PlaceNotificationGateParams): Promise<PlaceNotificationGateResult>;
  rollback(savedPlaceId: string, triggerType: string): Promise<boolean>;
  snapshotForTests(now: number): Promise<StoreMap>;
} {
  const storageKey =
    options.storageKey ?? PLACE_NOTIFICATION_DEDUPE_STORAGE_KEY;
  const retentionMs =
    options.retentionMs ?? PLACE_NOTIFICATION_DEDUPE_RETENTION_MS;
  const defaultCooldownMs =
    options.defaultCooldownMs ?? PLACE_NOTIFICATION_DEDUPE_WINDOW_MS;

  let cachedStore: StoreMap | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();

  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T;
    let error: unknown;
    mutationQueue = mutationQueue.then(async () => {
      try {
        result = await fn();
      } catch (e) {
        error = e;
      }
    });
    await mutationQueue;
    if (error) throw error;
    return result;
  }

  async function readStoreMap(): Promise<StoreMap> {
    if (cachedStore) return cachedStore;
    const raw = await store.getItem(storageKey);
    const parsed = parseStore(raw);
    cachedStore = parsed;
    return cachedStore;
  }

  async function writeStoreMap(next: StoreMap): Promise<void> {
    await store.setItem(storageKey, JSON.stringify(next));
    cachedStore = next;
  }

  async function checkAndRecord(
    params: PlaceNotificationGateParams,
  ): Promise<PlaceNotificationGateResult> {
    const triggerType = params.triggerType;
    const savedPlaceId = params.savedPlaceId?.trim();
    if (!savedPlaceId) {
      return {
        status: 'skipped_disabled',
        reason: 'missing_saved_place_id',
        triggerType,
      };
    }

    const now = params.now;
    const cooldownMs = params.cooldownMs ?? defaultCooldownMs;
    const dedupeAcrossTriggers = params.dedupeAcrossTriggers ?? true;

    const triggerKey = buildPlaceReminderDedupeKey(savedPlaceId, triggerType);
    const anyKey = buildAnyTriggerDedupeKey(savedPlaceId);
    const dedupeKeys = dedupeAcrossTriggers ? [triggerKey, anyKey] : [triggerKey];

    return withLock(async () => {
      let storeMap: StoreMap;
      try {
        storeMap = pruneStore(await readStoreMap(), now, retentionMs);
      } catch (error) {
        return {
          status: 'failed',
          reason:
            error instanceof Error && error.message === 'invalid_store_shape'
              ? 'storage_parse_failed'
              : 'storage_read_failed',
          triggerType,
          savedPlaceId,
        };
      }

      for (const dedupeKey of dedupeKeys) {
        const lastSentAt = storeMap[dedupeKey] ?? 0;
        const ageMs = now - lastSentAt;
        if (lastSentAt > 0 && ageMs < cooldownMs) {
          return {
            status: 'skipped_duplicate',
            dedupeKey,
            ageMs,
            savedPlaceId,
            triggerType,
          };
        }
      }

      for (const dedupeKey of dedupeKeys) {
        storeMap[dedupeKey] = now;
      }

      const next = pruneStore(storeMap, now, retentionMs);
      try {
        await writeStoreMap(next);
      } catch {
        return {
          status: 'failed',
          reason: 'storage_write_failed',
          triggerType,
          savedPlaceId,
        };
      }

      return {
        status: 'allow',
        dedupeKeys,
        savedPlaceId,
        triggerType,
      };
    });
  }

  async function rollback(savedPlaceId: string, triggerType: string): Promise<boolean> {
    if (!savedPlaceId) return false;
    return withLock(async () => {
      let storeMap: StoreMap;
      try {
        storeMap = await readStoreMap();
      } catch {
        return false;
      }

      const triggerKey = buildPlaceReminderDedupeKey(savedPlaceId, triggerType);
      const anyKey = buildAnyTriggerDedupeKey(savedPlaceId);
      delete storeMap[triggerKey];
      delete storeMap[anyKey];

      try {
        await writeStoreMap(pruneStore(storeMap, Date.now(), retentionMs));
        return true;
      } catch {
        return false;
      }
    });
  }

  async function snapshotForTests(now: number): Promise<StoreMap> {
    return withLock(async () => {
      const map = pruneStore(await readStoreMap(), now, retentionMs);
      return { ...map };
    });
  }

  return {
    checkAndRecord,
    rollback,
    snapshotForTests,
  };
}