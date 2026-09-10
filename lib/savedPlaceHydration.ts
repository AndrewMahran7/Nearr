import {
  buildSavedPlaceSnapshot,
  readSavedPlaceSnapshot,
  recordSavedPlaceSnapshotEvent,
  removeSavedPlaceSnapshot,
  writeSavedPlaceSnapshot,
  type SavedPlaceSnapshot,
  type SavedPlaceSnapshotRead,
} from './savedPlaceSnapshot';
import type {
  PlaceCandidate,
  PlaceRichDetails,
  SavedPlaceGoogleDisplayDetails,
} from '@/services/placesService';
import type { SavedPlaceWithPlace } from '@/types';

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
};

type MemoryEntry = {
  googlePlaceId: string | null;
  value: HydratedSavedPlace;
};

const memory = new Map<string, MemoryEntry>();
const inFlight = new Map<string, Promise<HydratedSavedPlace>>();

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
 * Google photo URLs are intentionally session-only. Google's Places policy
 * forbids persisting photo names, URIs, or bytes, so a disk snapshot hit may
 * render source media or the neutral hero instead of recontacting Google.
 */
export async function hydrateSavedPlace(
  args: {
    userId: string;
    saved: SavedPlaceWithPlace;
    trigger?: SavedPlaceHydrationTrigger;
  },
  dependencies: SavedPlaceHydrationDependencies = productionDependencies,
): Promise<HydratedSavedPlace> {
  const trigger = args.trigger ?? 'unknown';
  const key = memoryKey(args.userId, args.saved.id);
  const googlePlaceId = args.saved.place.google_place_id?.trim() || null;
  const cached = memory.get(key);
  if (cached && cached.googlePlaceId === googlePlaceId) {
    dependencies.record('saved_place_snapshot_hit', {
      ...eventBase(args.saved, trigger),
      storage: 'memory',
      age_ms: 0,
    });
    // Provider photo URLs are usable only on the fallback response that
    // supplied them. Do not replay them on another open: an Image mount could
    // become another Place Photos request if the framework cache was evicted.
    return {
      ...cached.value,
      source: 'memory',
      details: { ...cached.value.details, photoUrls: [] },
    };
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
      const details = detailsFromSnapshot(args.saved, local.snapshot);
      const value: HydratedSavedPlace = { details, source: 'snapshot', snapshot: local.snapshot };
      memory.set(key, { googlePlaceId, value });
      dependencies.record('saved_place_snapshot_hit', {
        ...eventBase(args.saved, trigger),
        storage: 'device',
        age_ms: local.ageMs,
      });
      return value;
    }

    dependencies.record('saved_place_snapshot_miss', {
      ...eventBase(args.saved, trigger),
      reason: local.reason,
    });

    if (googlePlaceId) {
      dependencies.record('saved_place_google_fallback_started', {
        ...eventBase(args.saved, trigger),
        reason: local.reason,
      });
      try {
        const google = await dependencies.fetchGoogle(googlePlaceId);
        const snapshot = buildSavedPlaceSnapshot({
          userId: args.userId,
          saved: args.saved,
          openingHours: google.openingHours,
          utcOffsetMinutes: google.utcOffsetMinutes,
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
            persistence: 'session_only_policy_restriction',
          });
        }
        const value: HydratedSavedPlace = {
          details: detailsFromSnapshot(args.saved, snapshot, google.photoUrls),
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
  dependencies: Pick<SavedPlaceHydrationDependencies, 'readSnapshot' | 'writeSnapshot' | 'record' | 'peekRichDetails'> = productionDependencies,
): Promise<boolean> {
  const googlePlaceId = args.saved.place.google_place_id?.trim() || null;
  const existing: SavedPlaceSnapshotRead = await dependencies.readSnapshot({
    userId: args.userId,
    savedPlaceId: args.saved.id,
    googlePlaceId,
  });
  const alreadyRich = dependencies.peekRichDetails(googlePlaceId);
  const prior = existing.status === 'hit' && existing.snapshot.providerHydrationComplete
    ? existing.snapshot
    : null;
  const snapshot = buildSavedPlaceSnapshot({
    userId: args.userId,
    saved: args.saved,
    candidate: args.candidate,
    openingHours: alreadyRich?.openingHours ?? prior?.openingHours ?? null,
    utcOffsetMinutes: alreadyRich?.utcOffsetMinutes ?? prior?.utcOffsetMinutes ?? null,
    // Name/address/coordinates/category from the durable save payload satisfy
    // the detail UI. Hours are an optional enhancement, not a reason to turn
    // the first post-save open into a Google request.
    providerHydrationComplete: true,
    source: 'save_payload',
  });
  memory.delete(memoryKey(args.userId, args.saved.id));
  return recordWrite(snapshot, args.trigger ?? 'save', dependencies as SavedPlaceHydrationDependencies);
}

export async function invalidateSavedPlaceHydration(
  userId: string,
  savedPlaceId: string,
): Promise<void> {
  memory.delete(memoryKey(userId, savedPlaceId));
  await removeSavedPlaceSnapshot(userId, savedPlaceId);
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
