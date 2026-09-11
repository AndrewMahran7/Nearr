import type { PlaceOpeningHours } from '@/lib/placeHours';
import type { SavedPlaceWithPlace } from '@/types';
import type { PlaceCandidate } from '@/services/placesService';

export const SAVED_PLACE_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export type SavedPlaceSnapshotSource =
  | 'save_payload'
  | 'google_fallback'
  | 'durable_fallback';

export type SavedPlaceSnapshot = {
  schemaVersion: typeof SAVED_PLACE_SNAPSHOT_SCHEMA_VERSION;
  ownerUserId: string;
  savedPlaceId: string;
  googlePlaceId: string | null;
  placeName: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  googleMapsUrl: string | null;
  openingHours: PlaceOpeningHours | null;
  utcOffsetMinutes: number | null;
  /** Account-scoped file URI for the saved place's normal hero/list image. */
  localImageUri: string | null;
  /**
   * `not_attempted` permits one bounded recovery. `unavailable` prevents an
   * every-open retry loop after a completed no-photo or failed-write attempt.
   */
  visualRecoveryStatus: 'available' | 'not_attempted' | 'unavailable';
  /**
   * False is reserved for a transitional/migrated snapshot that cannot render
   * the current detail UI. Optional provider fields may legitimately be null.
   */
  providerHydrationComplete: boolean;
  capturedAt: string;
  source: SavedPlaceSnapshotSource;
};

export type SavedPlaceSnapshotMissReason =
  | 'missing'
  | 'corrupt'
  | 'schema_mismatch'
  | 'owner_mismatch'
  | 'identity_mismatch'
  | 'incomplete';

export type SavedPlaceSnapshotRead =
  | { status: 'hit'; snapshot: SavedPlaceSnapshot; ageMs: number }
  | { status: 'miss'; reason: SavedPlaceSnapshotMissReason };

export type SavedPlaceSnapshotStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
};

let injectedStore: SavedPlaceSnapshotStore | null = null;
let indexWriteQueue = new Map<string, Promise<void>>();

function storage(): SavedPlaceSnapshotStore {
  if (injectedStore) return injectedStore;
  // Lazy resolution keeps the serializer testable in Node.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@react-native-async-storage/async-storage').default as SavedPlaceSnapshotStore;
}

/** Test seam. Passing null restores the real AsyncStorage adapter. */
export function setSavedPlaceSnapshotStore(store: SavedPlaceSnapshotStore | null): void {
  injectedStore = store;
  indexWriteQueue = new Map();
}

const PREFIX = `nearr:savedPlaceSnapshot:v${SAVED_PLACE_SNAPSHOT_SCHEMA_VERSION}:`;

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function savedPlaceSnapshotKey(userId: string, savedPlaceId: string): string {
  return `${PREFIX}${segment(userId)}:${segment(savedPlaceId)}`;
}

function indexKey(userId: string): string {
  return `${PREFIX}index:${segment(userId)}`;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function validOpeningHours(value: unknown): value is PlaceOpeningHours | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const candidate = value as PlaceOpeningHours;
  return Array.isArray(candidate.periods) && Array.isArray(candidate.weekdayDescriptions);
}

export function isSavedPlaceSnapshot(value: unknown): value is SavedPlaceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedPlaceSnapshot>;
  return candidate.schemaVersion === SAVED_PLACE_SNAPSHOT_SCHEMA_VERSION
    && typeof candidate.ownerUserId === 'string'
    && typeof candidate.savedPlaceId === 'string'
    && nullableString(candidate.googlePlaceId)
    && typeof candidate.placeName === 'string'
    && finiteNumber(candidate.latitude)
    && finiteNumber(candidate.longitude)
    && nullableString(candidate.formattedAddress)
    && nullableString(candidate.category)
    && nullableString(candidate.googleMapsUrl)
    && validOpeningHours(candidate.openingHours)
    && (candidate.utcOffsetMinutes === null || finiteNumber(candidate.utcOffsetMinutes))
    && nullableString(candidate.localImageUri)
    && ['available', 'not_attempted', 'unavailable'].includes(candidate.visualRecoveryStatus ?? '')
    && typeof candidate.providerHydrationComplete === 'boolean'
    && typeof candidate.capturedAt === 'string'
    && ['save_payload', 'google_fallback', 'durable_fallback'].includes(candidate.source ?? '');
}

export function serializeSavedPlaceSnapshot(snapshot: SavedPlaceSnapshot): string {
  if (!isSavedPlaceSnapshot(snapshot)) throw new Error('invalid_saved_place_snapshot');
  return JSON.stringify(snapshot);
}

export function deserializeSavedPlaceSnapshot(raw: string): SavedPlaceSnapshotRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'miss', reason: 'corrupt' };
  }
  if (!parsed || typeof parsed !== 'object') return { status: 'miss', reason: 'corrupt' };
  if ((parsed as { schemaVersion?: unknown }).schemaVersion !== SAVED_PLACE_SNAPSHOT_SCHEMA_VERSION) {
    return { status: 'miss', reason: 'schema_mismatch' };
  }
  if (!isSavedPlaceSnapshot(parsed)) return { status: 'miss', reason: 'corrupt' };
  const captured = Date.parse(parsed.capturedAt);
  return {
    status: 'hit',
    snapshot: parsed,
    ageMs: Number.isFinite(captured) ? Math.max(0, Date.now() - captured) : 0,
  };
}

export async function readSavedPlaceSnapshot(args: {
  userId: string;
  savedPlaceId: string;
  googlePlaceId: string | null;
  requireProviderHydration?: boolean;
}): Promise<SavedPlaceSnapshotRead> {
  let raw: string | null;
  try {
    raw = await storage().getItem(savedPlaceSnapshotKey(args.userId, args.savedPlaceId));
  } catch {
    return { status: 'miss', reason: 'corrupt' };
  }
  if (!raw) return { status: 'miss', reason: 'missing' };
  const decoded = deserializeSavedPlaceSnapshot(raw);
  if (decoded.status === 'miss') return decoded;
  if (decoded.snapshot.ownerUserId !== args.userId) {
    return { status: 'miss', reason: 'owner_mismatch' };
  }
  if (
    decoded.snapshot.savedPlaceId !== args.savedPlaceId
    || decoded.snapshot.googlePlaceId !== args.googlePlaceId
  ) {
    return { status: 'miss', reason: 'identity_mismatch' };
  }
  if (args.requireProviderHydration && !decoded.snapshot.providerHydrationComplete) {
    return { status: 'miss', reason: 'incomplete' };
  }
  return decoded;
}

async function addToIndex(userId: string, key: string): Promise<void> {
  const previous = indexWriteQueue.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const raw = await storage().getItem(indexKey(userId));
    let keys: string[] = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) keys = parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      keys = [];
    }
    if (!keys.includes(key)) keys.push(key);
    await storage().setItem(indexKey(userId), JSON.stringify(keys));
  });
  indexWriteQueue.set(userId, next);
  await next.finally(() => {
    if (indexWriteQueue.get(userId) === next) indexWriteQueue.delete(userId);
  });
}

export async function writeSavedPlaceSnapshot(snapshot: SavedPlaceSnapshot): Promise<boolean> {
  const key = savedPlaceSnapshotKey(snapshot.ownerUserId, snapshot.savedPlaceId);
  try {
    await storage().setItem(key, serializeSavedPlaceSnapshot(snapshot));
    await addToIndex(snapshot.ownerUserId, key);
    return true;
  } catch (error) {
    try {
      await storage().removeItem(key);
    } catch {
      // The original write/index failure is the useful diagnostic.
    }
    console.warn('[saved-place-snapshot] write failed', {
      savedPlaceId: snapshot.savedPlaceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function removeSavedPlaceSnapshot(userId: string, savedPlaceId: string): Promise<void> {
  try {
    await storage().removeItem(savedPlaceSnapshotKey(userId, savedPlaceId));
  } catch {
    // Durable deletion already succeeded; local cleanup is best-effort.
  }
}

export async function clearSavedPlaceSnapshots(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const key = indexKey(userId);
  try {
    const adapter = storage();
    const raw = await adapter.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    const indexedKeys = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
    // Also sweep this user's keys across schema versions when the adapter can
    // enumerate them. That keeps logout/account deletion safe after upgrades.
    const allKeys = adapter.getAllKeys ? await adapter.getAllKeys() : [];
    const encodedOwner = segment(userId);
    const discoveredKeys = allKeys.filter((candidate) => {
      const match = candidate.match(/^nearr:savedPlaceSnapshot:v\d+:([^:]+):/);
      return match?.[1] === encodedOwner;
    });
    await adapter.multiRemove([...new Set([...indexedKeys, ...discoveredKeys, key])]);
  } catch {
    // Sign-out/account deletion continues even if storage is unavailable.
  }
}

export function buildSavedPlaceSnapshot(args: {
  userId: string;
  saved: SavedPlaceWithPlace;
  candidate?: PlaceCandidate | null;
  openingHours?: PlaceOpeningHours | null;
  utcOffsetMinutes?: number | null;
  localImageUri?: string | null;
  visualRecoveryStatus?: SavedPlaceSnapshot['visualRecoveryStatus'];
  providerHydrationComplete: boolean;
  source: SavedPlaceSnapshotSource;
}): SavedPlaceSnapshot {
  const candidate = args.candidate;
  return {
    schemaVersion: SAVED_PLACE_SNAPSHOT_SCHEMA_VERSION,
    ownerUserId: args.userId,
    savedPlaceId: args.saved.id,
    googlePlaceId: args.saved.place.google_place_id?.trim() || null,
    placeName: candidate?.name?.trim() || args.saved.place.name,
    formattedAddress: candidate?.formattedAddress ?? args.saved.place.formatted_address ?? null,
    latitude: finiteNumber(candidate?.latitude) ? candidate.latitude : args.saved.place.latitude,
    longitude: finiteNumber(candidate?.longitude) ? candidate.longitude : args.saved.place.longitude,
    category: candidate?.category ?? args.saved.place.category ?? null,
    googleMapsUrl: candidate?.googleMapsUrl ?? args.saved.place.google_maps_url ?? null,
    openingHours: args.openingHours ?? null,
    utcOffsetMinutes: args.utcOffsetMinutes ?? null,
    localImageUri: args.localImageUri?.trim() || null,
    visualRecoveryStatus: args.visualRecoveryStatus
      ?? (args.localImageUri?.trim() ? 'available' : 'not_attempted'),
    providerHydrationComplete: args.providerHydrationComplete,
    capturedAt: new Date().toISOString(),
    source: args.source,
  };
}

export function recordSavedPlaceSnapshotEvent(
  eventName:
    | 'saved_place_snapshot_hit'
    | 'saved_place_snapshot_miss'
    | 'saved_place_snapshot_written'
    | 'saved_place_snapshot_write_failed'
    | 'saved_place_google_fallback_started'
    | 'saved_place_google_fallback_succeeded'
    | 'saved_place_google_fallback_failed'
    | 'saved_place_photo_local_hit'
    | 'saved_place_photo_google_fallback',
  properties: Record<string, unknown>,
): void {
  // Lazy so the pure storage contract remains executable in Node tests.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { trackEvent } = require('./analytics') as typeof import('./analytics');
  void trackEvent(eventName, {
    schema_version: SAVED_PLACE_SNAPSHOT_SCHEMA_VERSION,
    ...properties,
  });
}
