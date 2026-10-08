import {
  buildSavedPlaceSnapshot,
  readSavedPlaceSnapshot,
  recordSavedPlaceSnapshotEvent,
  removeSavedPlaceSnapshot,
  writeSavedPlaceSnapshot,
  type SavedPlaceSnapshot,
  type SavedPlaceSnapshotRead,
} from './savedPlaceSnapshot';
import {
  isUsableSavedPlaceImage,
  persistSavedPlaceImage,
  removeSavedPlaceImage,
} from './savedPlaceImageStore';
import type {
  PlaceCandidate,
  PlaceRichDetails,
  SavedPlaceGoogleDisplayDetails,
} from '@/services/placesService';
import type { SavedPlaceWithPlace } from '@/types';
import { distinctPlacePhotoUris } from './placePhotos';

export type SavedPlaceHydrationTrigger =
  | 'map_detail'
  | 'saved_library'
  | 'notification'
  | 'history'
  | 'unknown';

export type HydratedSavedPlace = {
  details: PlaceRichDetails;
  source: 'memory' | 'snapshot' | 'google_fallback' | 'durable_fallback';
  snapshot: SavedPlaceSnapshot;
};

type EventName = Parameters<typeof recordSavedPlaceSnapshotEvent>[0];
type EventProperties = Parameters<typeof recordSavedPlaceSnapshotEvent>[1];

export type SavedPlaceHydrationDependencies = {
  readSnapshot: typeof readSavedPlaceSnapshot;
  writeSnapshot: typeof writeSavedPlaceSnapshot;
  fetchGoogle: (placeId: string) => Promise<SavedPlaceGoogleDisplayDetails>;
  record: (eventName: EventName, properties: EventProperties) => void;
  peekRichDetails: (googlePlaceId: string | null | undefined) => PlaceRichDetails | null;
  persistImage?: typeof persistSavedPlaceImage;
  isImageUsable?: typeof isUsableSavedPlaceImage;
};

const productionDependencies: SavedPlaceHydrationDependencies = {
  readSnapshot: readSavedPlaceSnapshot,
  writeSnapshot: writeSavedPlaceSnapshot,
  fetchGoogle: (placeId) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSavedPlaceGoogleDisplayDetails } = require('../services/placesService') as typeof import('../services/placesService');
    return getSavedPlaceGoogleDisplayDetails(placeId, { maxPhotos: 5, maxPhotoWidth: 1000 });
  },
  record: recordSavedPlaceSnapshotEvent,
  peekRichDetails: (googlePlaceId) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { peekCachedPlaceRichDetails } = require('./placeRichDetailsCache') as typeof import('./placeRichDetailsCache');
    return peekCachedPlaceRichDetails(googlePlaceId);
  },
  persistImage: persistSavedPlaceImage,
  isImageUsable: isUsableSavedPlaceImage,
};

type MemoryEntry = {
  googlePlaceId: string | null;
  value: HydratedSavedPlace;
};

const memory = new Map<string, MemoryEntry>();
const inFlight = new Map<string, Promise<HydratedSavedPlace>>();
const progressivePhotoWrites = new Map<string, Promise<void>>();

function memoryKey(userId: string, savedPlaceId: string): string {
  return `${userId}:${savedPlaceId}`;
}

function detailsFromSnapshot(
  saved: SavedPlaceWithPlace,
  snapshot: SavedPlaceSnapshot,
  photoUrls: string[] = [],
): PlaceRichDetails {
  return {
    googlePlaceId: snapshot.googlePlaceId ?? '',
    name: snapshot.placeName || saved.place.name,
    formattedAddress: snapshot.formattedAddress,
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    category: snapshot.category,
    googleMapsUrl: snapshot.googleMapsUrl,
    websiteUrl: null,
    formattedPhoneNumber: null,
    internationalPhoneNumber: null,
    photoUrls,
    openingHours: snapshot.openingHours,
    utcOffsetMinutes: snapshot.utcOffsetMinutes,
  };
}

async function persistPhotoSet(args: {
  userId: string;
  savedPlaceId: string;
  sourceUris: readonly (string | null | undefined)[];
  persistImage: NonNullable<SavedPlaceHydrationDependencies['persistImage']>;
  startIndex?: number;
}): Promise<string[]> {
  const persisted: string[] = [];
  const sources = distinctPlacePhotoUris(args.sourceUris);
  const startIndex = args.startIndex ?? 0;
  // Deliberately sequential: photo 1 wins priority; photos 2-5 are acquired
  // progressively by the save/hydration background task rather than bursting.
  for (let index = 0; index < sources.length; index += 1) {
    const uri = await args.persistImage({
      userId: args.userId,
      savedPlaceId: args.savedPlaceId,
      sourceUri: sources[index],
      index: startIndex + index,
    });
    if (uri) persisted.push(uri);
  }
  return persisted;
}

async function usableLocalPhotos(
  snapshot: SavedPlaceSnapshot,
  isImageUsable: NonNullable<SavedPlaceHydrationDependencies['isImageUsable']>,
): Promise<string[]> {
  const candidates = distinctPlacePhotoUris([
    ...(snapshot.localPhotoUris ?? []),
    snapshot.localImageUri,
  ]);
  const checks = await Promise.all(candidates.map(async (uri) => ({ uri, usable: await isImageUsable(uri) })));
  return checks.filter((entry) => entry.usable).map((entry) => entry.uri);
}

function eventBase(saved: SavedPlaceWithPlace, trigger: SavedPlaceHydrationTrigger) {
  return {
    saved_place_id: saved.id,
    trigger,
    requested_field_group: 'saved_place_display_v1',
    google_operation: 'place_details_legacy',
  };
}

async function recordWrite(
  snapshot: SavedPlaceSnapshot,
  trigger: SavedPlaceHydrationTrigger | 'save' | 'correction',
  dependencies: SavedPlaceHydrationDependencies,
): Promise<boolean> {
  const written = await dependencies.writeSnapshot(snapshot);
  dependencies.record(
    written ? 'saved_place_snapshot_written' : 'saved_place_snapshot_write_failed',
    {
      saved_place_id: snapshot.savedPlaceId,
      trigger,
      source: snapshot.source,
      provider_hydration_complete: snapshot.providerHydrationComplete,
    },
  );
  return written;
}

/**
 * Canonical local-first policy for the saved-place detail surface.
 *
 * The first successfully acquired presentation image is copied into the
 * account-scoped app document directory. Provider URLs remain session-only;
 * normal later opens render the durable local file without provider traffic.
 */
export async function hydrateSavedPlace(
  args: {
    userId: string;
    saved: SavedPlaceWithPlace;
    trigger?: SavedPlaceHydrationTrigger;
    /** Already-retained Nearr/source media that should win before Google recovery. */
    knownImageUri?: string | null;
  },
  dependencies: SavedPlaceHydrationDependencies = productionDependencies,
): Promise<HydratedSavedPlace> {
  const trigger = args.trigger ?? 'unknown';
  const persistImage = dependencies.persistImage
    ?? (dependencies === productionDependencies ? persistSavedPlaceImage : async () => null);
  const isImageUsable = dependencies.isImageUsable
    ?? (dependencies === productionDependencies ? isUsableSavedPlaceImage : async () => false);
  const key = memoryKey(args.userId, args.saved.id);
  const googlePlaceId = args.saved.place.google_place_id?.trim() || null;
  const cached = memory.get(key);
  if (cached && cached.googlePlaceId === googlePlaceId) {
    const localPhotos = await usableLocalPhotos(cached.value.snapshot, isImageUsable);
    if (cached.value.snapshot.localPhotoUris.length === 0 || localPhotos.length > 0) {
      dependencies.record('saved_place_snapshot_hit', {
        ...eventBase(args.saved, trigger),
        storage: 'memory',
        age_ms: 0,
      });
      return {
        ...cached.value,
        source: 'memory',
        // Never replay provider URLs as a substitute for persistence. A local
        // asset is safe across mounts; otherwise the bounded recovery state wins.
        details: detailsFromSnapshot(
          args.saved,
          cached.value.snapshot,
          localPhotos,
        ),
      };
    }
    // The OS/user removed the file after hydration. Drop only process memory;
    // the snapshot path below performs the same one bounded recovery.
    memory.delete(key);
  }

  const existingRequest = inFlight.get(key);
  if (existingRequest) return existingRequest;

  const request = (async (): Promise<HydratedSavedPlace> => {
    const local = await dependencies.readSnapshot({
      userId: args.userId,
      savedPlaceId: args.saved.id,
      googlePlaceId,
      requireProviderHydration: true,
    });
    if (local.status === 'hit') {
      const localPhotos = await usableLocalPhotos(local.snapshot, isImageUsable);
      if (localPhotos.length > 0) {
        const details = detailsFromSnapshot(args.saved, local.snapshot, localPhotos);
        const value: HydratedSavedPlace = { details, source: 'snapshot', snapshot: local.snapshot };
        memory.set(key, { googlePlaceId, value });
        dependencies.record('saved_place_snapshot_hit', {
          ...eventBase(args.saved, trigger),
          storage: 'device',
          age_ms: local.ageMs,
        });
        dependencies.record('saved_place_photo_local_hit', {
          ...eventBase(args.saved, trigger),
          image_source: 'local_file',
        });
        return value;
      }
      const knownImageUri = args.knownImageUri?.trim() || null;
      if (knownImageUri) {
        const localPhotoUris = await persistPhotoSet({
          userId: args.userId, savedPlaceId: args.saved.id,
          sourceUris: [knownImageUri], persistImage,
        });
        const persistedImageUri = localPhotoUris[0] ?? null;
        const snapshot = buildSavedPlaceSnapshot({
          userId: args.userId,
          saved: args.saved,
          openingHours: local.snapshot.openingHours,
          utcOffsetMinutes: local.snapshot.utcOffsetMinutes,
          localImageUri: persistedImageUri,
          localPhotoUris,
          visualRecoveryStatus: persistedImageUri ? 'available' : 'unavailable',
          providerHydrationComplete: true,
          source: 'durable_fallback',
        });
        await recordWrite(snapshot, trigger, dependencies);
        const value: HydratedSavedPlace = {
          details: detailsFromSnapshot(args.saved, snapshot, [persistedImageUri ?? knownImageUri]),
          source: 'snapshot',
          snapshot,
        };
        memory.set(key, { googlePlaceId, value });
        return value;
      }
      if (local.snapshot.visualRecoveryStatus === 'unavailable') {
        const value: HydratedSavedPlace = {
          details: detailsFromSnapshot(args.saved, local.snapshot),
          source: 'snapshot',
          snapshot: local.snapshot,
        };
        memory.set(key, { googlePlaceId, value });
        dependencies.record('saved_place_snapshot_hit', {
          ...eventBase(args.saved, trigger),
          storage: 'device',
          age_ms: local.ageMs,
          visual_status: 'unavailable',
        });
        return value;
      }
    }

    const knownImageUri = args.knownImageUri?.trim() || null;
    if (knownImageUri) {
      const localPhotoUris = await persistPhotoSet({
        userId: args.userId, savedPlaceId: args.saved.id,
        sourceUris: [knownImageUri], persistImage,
      });
      const persistedImageUri = localPhotoUris[0] ?? null;
      const snapshot = buildSavedPlaceSnapshot({
        userId: args.userId,
        saved: args.saved,
        localImageUri: persistedImageUri,
        localPhotoUris,
        visualRecoveryStatus: persistedImageUri ? 'available' : 'unavailable',
        providerHydrationComplete: true,
        source: 'durable_fallback',
      });
      await recordWrite(snapshot, trigger, dependencies);
      const value: HydratedSavedPlace = {
        details: detailsFromSnapshot(args.saved, snapshot, [persistedImageUri ?? knownImageUri]),
        source: 'snapshot',
        snapshot,
      };
      memory.set(key, { googlePlaceId, value });
      return value;
    }

    dependencies.record('saved_place_snapshot_miss', {
      ...eventBase(args.saved, trigger),
      reason: local.status === 'miss' ? local.reason : 'missing_visual_file',
    });

    if (googlePlaceId) {
      dependencies.record('saved_place_google_fallback_started', {
        ...eventBase(args.saved, trigger),
        reason: local.status === 'miss' ? local.reason : 'missing_visual_file',
      });
      try {
        const google = await dependencies.fetchGoogle(googlePlaceId);
        const localPhotoUris = await persistPhotoSet({
          userId: args.userId,
          savedPlaceId: args.saved.id,
          sourceUris: google.photoUrls,
          persistImage,
        });
        const localImageUri = localPhotoUris[0] ?? null;
        const snapshot = buildSavedPlaceSnapshot({
          userId: args.userId,
          saved: args.saved,
          openingHours: google.openingHours,
          utcOffsetMinutes: google.utcOffsetMinutes,
          localImageUri,
          localPhotoUris,
          visualRecoveryStatus: localImageUri ? 'available' : 'unavailable',
          providerHydrationComplete: true,
          source: 'google_fallback',
        });
        await recordWrite(snapshot, trigger, dependencies);
        dependencies.record('saved_place_google_fallback_succeeded', {
          ...eventBase(args.saved, trigger),
          photo_count: google.photoUrls.length,
        });
        if (google.photoUrls.length > 0) {
          dependencies.record('saved_place_photo_google_fallback', {
            ...eventBase(args.saved, trigger),
            photo_count: google.photoUrls.length,
            persistence: localImageUri ? 'local_file' : 'failed_or_unavailable',
          });
        }
        const value: HydratedSavedPlace = {
          details: detailsFromSnapshot(
            args.saved,
            snapshot,
            localPhotoUris.length ? localPhotoUris : google.photoUrls,
          ),
          source: 'google_fallback',
          snapshot,
        };
        memory.set(key, { googlePlaceId, value });
        return value;
      } catch (error) {
        dependencies.record('saved_place_google_fallback_failed', {
          ...eventBase(args.saved, trigger),
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
    }

    // A failed or impossible provider lookup still becomes a complete local
    // presentation. Reopening is not itself a retry signal, so the user gets a
    // deterministic offline-safe detail view instead of a request loop.
    const snapshot = buildSavedPlaceSnapshot({
      userId: args.userId,
      saved: args.saved,
      providerHydrationComplete: true,
      visualRecoveryStatus: 'unavailable',
      source: 'durable_fallback',
    });
    await recordWrite(snapshot, trigger, dependencies);
    const value: HydratedSavedPlace = {
      details: detailsFromSnapshot(args.saved, snapshot),
      source: 'durable_fallback',
      snapshot,
    };
    memory.set(key, { googlePlaceId, value });
    return value;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, request);
  return request;
}

/** Persist the save payload already in hand; never starts a Google request. */
export async function persistSavedPlaceSnapshotAfterSave(
  args: {
    userId: string;
    saved: SavedPlaceWithPlace;
    candidate: PlaceCandidate;
    trigger?: 'save' | 'correction';
  },
  dependencies: Pick<SavedPlaceHydrationDependencies, 'readSnapshot' | 'writeSnapshot' | 'record' | 'peekRichDetails' | 'persistImage' | 'isImageUsable'> = productionDependencies,
): Promise<boolean> {
  const googlePlaceId = args.saved.place.google_place_id?.trim() || null;
  const persistImage = dependencies.persistImage
    ?? (dependencies === productionDependencies ? persistSavedPlaceImage : async () => null);
  const isImageUsable = dependencies.isImageUsable
    ?? (dependencies === productionDependencies ? isUsableSavedPlaceImage : async () => false);
  const existing: SavedPlaceSnapshotRead = await dependencies.readSnapshot({
    userId: args.userId,
    savedPlaceId: args.saved.id,
    googlePlaceId,
  });
  const alreadyRich = dependencies.peekRichDetails(googlePlaceId);
  const prior = existing.status === 'hit' && existing.snapshot.providerHydrationComplete
    ? existing.snapshot
    : null;
  const priorLocalPhotoUris = prior ? await usableLocalPhotos(prior, isImageUsable) : [];
  const availablePhotoUris = distinctPlacePhotoUris([
    ...(args.candidate.photoUrls ?? []),
    args.candidate.photoUrl,
    (args.candidate as PlaceCandidate & { sourceFrameUrl?: string | null }).sourceFrameUrl,
    ...(alreadyRich?.photoUrls ?? []),
  ]);
  const localPhotoUris = priorLocalPhotoUris.length
    ? priorLocalPhotoUris
    : await persistPhotoSet({
        userId: args.userId,
        savedPlaceId: args.saved.id,
        sourceUris: availablePhotoUris.slice(0, 1),
        persistImage,
      });
  const localImageUri = localPhotoUris[0] ?? null;
  const snapshot = buildSavedPlaceSnapshot({
    userId: args.userId,
    saved: args.saved,
    candidate: args.candidate,
    openingHours: alreadyRich?.openingHours ?? prior?.openingHours ?? null,
    utcOffsetMinutes: alreadyRich?.utcOffsetMinutes ?? prior?.utcOffsetMinutes ?? null,
    localImageUri,
    localPhotoUris,
    visualRecoveryStatus: localImageUri
      ? 'available'
      : availablePhotoUris.length ? 'unavailable' : googlePlaceId ? 'not_attempted' : 'unavailable',
    // Name/address/coordinates/category from the durable save payload satisfy
    // the detail UI. Hours are an optional enhancement, not a reason to turn
    // the first post-save open into a Google request.
    providerHydrationComplete: true,
    source: 'save_payload',
  });
  memory.delete(memoryKey(args.userId, args.saved.id));
  const primaryWritten = await recordWrite(
    snapshot,
    args.trigger ?? 'save',
    dependencies as SavedPlaceHydrationDependencies,
  );
  const taskKey = memoryKey(args.userId, args.saved.id);
  if (
    !priorLocalPhotoUris.length
    && availablePhotoUris.length > 1
    && !progressivePhotoWrites.has(taskKey)
  ) {
    const task = (async () => {
      const remaining = await persistPhotoSet({
        userId: args.userId,
        savedPlaceId: args.saved.id,
        sourceUris: availablePhotoUris.slice(1),
        persistImage,
        startIndex: 1,
      });
      if (remaining.length === 0) return;
      const current = await dependencies.readSnapshot({
        userId: args.userId,
        savedPlaceId: args.saved.id,
        googlePlaceId,
      });
      const base = current.status === 'hit' ? current.snapshot : snapshot;
      const completedPhotos = distinctPlacePhotoUris([...localPhotoUris, ...remaining]);
      await recordWrite({
        ...base,
        localImageUri: completedPhotos[0] ?? null,
        localPhotoUris: completedPhotos,
        visualRecoveryStatus: completedPhotos.length ? 'available' : base.visualRecoveryStatus,
        capturedAt: new Date().toISOString(),
      }, args.trigger ?? 'save', dependencies as SavedPlaceHydrationDependencies);
      memory.delete(taskKey);
    })().catch((error) => {
      dependencies.record('saved_place_snapshot_write_failed', {
        saved_place_id: args.saved.id,
        trigger: args.trigger ?? 'save',
        source: 'save_payload',
        progressive_photo_error: error instanceof Error ? error.name : 'unknown',
      });
    }).finally(() => {
      if (progressivePhotoWrites.get(taskKey) === task) progressivePhotoWrites.delete(taskKey);
    });
    progressivePhotoWrites.set(taskKey, task);
  }
  return primaryWritten;
}

export async function invalidateSavedPlaceHydration(
  userId: string,
  savedPlaceId: string,
): Promise<void> {
  memory.delete(memoryKey(userId, savedPlaceId));
  await removeSavedPlaceSnapshot(userId, savedPlaceId);
  await removeSavedPlaceImage(userId, savedPlaceId);
}

/** Remove process-local entries when an account signs out or is deleted. */
export function clearSavedPlaceHydrationMemoryForUser(userId: string | null | undefined): void {
  if (!userId) return;
  const prefix = `${userId}:`;
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

/** Test-only process-restart seam; persisted storage is intentionally kept. */
export function resetSavedPlaceHydrationMemoryForTests(): void {
  memory.clear();
  inFlight.clear();
}

/** Test seam for deterministic proof that photos 2-5 complete off the save path. */
export async function waitForProgressiveSavedPlacePhotosForTests(): Promise<void> {
  await Promise.all([...progressivePhotoWrites.values()]);
}
