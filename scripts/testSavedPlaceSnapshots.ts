import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  SAVED_PLACE_SNAPSHOT_SCHEMA_VERSION,
  buildSavedPlaceSnapshot,
  clearSavedPlaceSnapshots,
  deserializeSavedPlaceSnapshot,
  readSavedPlaceSnapshot,
  savedPlaceSnapshotKey,
  savedPlacePhotoKind,
  serializeSavedPlaceSnapshot,
  setSavedPlaceSnapshotStore,
  writeSavedPlaceSnapshot,
  type SavedPlaceSnapshotStore,
} from '../lib/savedPlaceSnapshot';
import {
  hydrateSavedPlace,
  persistSavedPlaceSnapshotAfterSave,
  resetSavedPlaceHydrationMemoryForTests,
  waitForProgressiveSavedPlacePhotosForTests,
  type SavedPlaceHydrationDependencies,
} from '../lib/savedPlaceHydration';
import type { PlaceCandidate, SavedPlaceGoogleDisplayDetails } from '../services/placesService';
import type { SavedPlaceWithPlace } from '../types';

class MemoryStore implements SavedPlaceSnapshotStore {
  readonly values = new Map<string, string>();
  failWrites = false;

  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('disk_full');
    this.values.set(key, value);
  }
  async removeItem(key: string) { this.values.delete(key); }
  async multiRemove(keys: string[]) { keys.forEach((key) => this.values.delete(key)); }
  async getAllKeys() { return [...this.values.keys()]; }
}

const saved: SavedPlaceWithPlace = {
  id: 'saved-1', user_id: 'user-a', place_id: 'place-1',
  radius_value: null, radius_unit: null, notes: null, ai_note: null,
  source_type: 'manual', source_url: null, notifications_enabled: true,
  last_notified_at: null, notification_count: 0, reminder_opportunity_count: 0,
  archived_at: null, visited_at: null, reminders_exhausted_at: null,
  created_at: '2026-09-10T10:00:00.000Z', updated_at: '2026-09-10T10:00:00.000Z',
  place: {
    id: 'place-1', google_place_id: 'google-1', name: 'Saved Cafe',
    formatted_address: '1 Main St, Los Angeles, CA', latitude: 34.1, longitude: -118.2,
    category: 'cafe', google_maps_url: 'https://maps.google.com/example',
    created_at: '2026-09-10T10:00:00.000Z',
  },
};

const candidate: PlaceCandidate = {
  googlePlaceId: 'google-1', name: 'Saved Cafe',
  formattedAddress: '1 Main St, Los Angeles, CA', latitude: 34.1, longitude: -118.2,
  category: 'cafe', googleMapsUrl: 'https://maps.google.com/example', rawTypes: ['cafe'],
  photoUrl: 'https://photos.test/already-acquired.jpg',
  photoUrls: Array.from({ length: 5 }, (_, index) => `https://photos.test/acquired-${index + 1}.jpg`),
};

const googleDetails: SavedPlaceGoogleDisplayDetails = {
  googlePlaceId: 'google-1',
  photoUrls: Array.from(
    { length: 5 },
    (_, index) => `https://maps.googleapis.com/maps/api/place/photo?photo_reference=secret-${index + 1}`,
  ),
  openingHours: {
    periods: [{ open: { day: 1, time: '0900' }, close: { day: 1, time: '1700' } }],
    weekdayDescriptions: ['Monday: 9:00 AM – 5:00 PM'],
  },
  utcOffsetMinutes: -420,
};

const localAssets = new Set<string>();

function dependencies(
  store: MemoryStore,
  fetchGoogle: () => Promise<SavedPlaceGoogleDisplayDetails>,
  secondaryGate?: Promise<void>,
) {
  const events: string[] = [];
  const deps: SavedPlaceHydrationDependencies = {
    readSnapshot: readSavedPlaceSnapshot,
    writeSnapshot: writeSavedPlaceSnapshot,
    fetchGoogle: async () => fetchGoogle(),
    record: (event) => { events.push(event); },
    peekRichDetails: () => null,
    persistImage: async ({ savedPlaceId, sourceUri, index = 0 }) => {
      if (!sourceUri) return null;
      if (index > 0 && secondaryGate) await secondaryGate;
      const filename = index === 0 ? 'hero.jpg' : `photo-${index + 1}.jpg`;
      const uri = `file://saved-place-images/${savedPlaceId}/${filename}`;
      localAssets.add(uri);
      return uri;
    },
    isImageUsable: async (uri) => localAssets.has(uri ?? ''),
  };
  return { deps, events };
}

async function run() {
  const placesServiceSource = fs.readFileSync(
    path.resolve(__dirname, '../services/placesService.ts'),
    'utf8',
  );
  const fallbackMask = placesServiceSource.match(
    /export const SAVED_PLACE_DISPLAY_DETAILS_FIELDS = \[([\s\S]*?)\]\.join\(','\);/,
  )?.[1] ?? '';
  const fallbackFields = [...fallbackMask.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(fallbackFields, ['photos', 'opening_hours', 'utc_offset']);
  for (const excluded of [
    'place_id', 'name', 'formatted_address', 'geometry/location', 'types', 'url',
    'website', 'formatted_phone_number', 'international_phone_number',
  ]) {
    assert.equal(fallbackFields.includes(excluded), false, `fallback excludes ${excluded}`);
  }

  const store = new MemoryStore();
  setSavedPlaceSnapshotStore(store);
  resetSavedPlaceHydrationMemoryForTests();

  const snapshot = buildSavedPlaceSnapshot({
    userId: 'user-a', saved, candidate,
    providerHydrationComplete: false, source: 'save_payload',
  });
  const encoded = serializeSavedPlaceSnapshot(snapshot);
  const decoded = deserializeSavedPlaceSnapshot(encoded);
  assert.equal(decoded.status, 'hit');
  assert.equal(decoded.status === 'hit' && decoded.snapshot.schemaVersion, SAVED_PLACE_SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(deserializeSavedPlaceSnapshot('{broken'), { status: 'miss', reason: 'corrupt' });
  assert.deepEqual(
    deserializeSavedPlaceSnapshot(JSON.stringify({ ...snapshot, schemaVersion: 0 })),
    { status: 'miss', reason: 'schema_mismatch' },
  );

  let googleCalls = 0;
  let releaseSecondary!: () => void;
  const secondaryGate = new Promise<void>((resolve) => { releaseSecondary = resolve; });
  const first = dependencies(store, async () => {
    googleCalls += 1;
    return googleDetails;
  }, secondaryGate);
  const persisted = await persistSavedPlaceSnapshotAfterSave(
    { userId: 'user-a', saved, candidate },
    first.deps,
  );
  assert.equal(persisted, true, 'save-path snapshot write succeeds without provider I/O');
  assert.equal(googleCalls, 0, 'saving never makes an extra Google request');

  const firstOpen = await hydrateSavedPlace(
    { userId: 'user-a', saved, trigger: 'map_detail' },
    first.deps,
  );
  assert.equal(googleCalls, 0, 'first open after save is satisfied by the save payload');
  assert.equal(firstOpen.source, 'snapshot');
  assert.equal(firstOpen.details.photoUrls.length, 1, 'primary photo is available before background gallery acquisition');
  assert.equal(firstOpen.details.photoUrls[0], 'file://saved-place-images/saved-1/hero.jpg');

  releaseSecondary();
  await waitForProgressiveSavedPlacePhotosForTests();
  resetSavedPlaceHydrationMemoryForTests();
  const galleryOpen = await hydrateSavedPlace(
    { userId: 'user-a', saved, trigger: 'map_detail' },
    first.deps,
  );
  assert.equal(galleryOpen.details.photoUrls.length, 5);
  assert.equal(galleryOpen.details.photoUrls[4], 'file://saved-place-images/saved-1/photo-5.jpg');

  const repeatedOpen = await hydrateSavedPlace({ userId: 'user-a', saved, trigger: 'map_detail' }, first.deps);
  assert.equal(googleCalls, 0, 'repeated open in one process makes zero Google requests');
  assert.equal(repeatedOpen.details.photoUrls.length, 5);

  resetSavedPlaceHydrationMemoryForTests();
  const afterRestart = await hydrateSavedPlace(
    { userId: 'user-a', saved, trigger: 'map_detail' },
    first.deps,
  );
  assert.equal(googleCalls, 0, 'app restart plus reopen uses persisted snapshot');
  assert.equal(afterRestart.source, 'snapshot');
  assert.equal(afterRestart.details.photoUrls.length, 5, 'all five photos survive app restart');
  assert.ok(first.events.includes('saved_place_snapshot_hit'));
  assert.equal(savedPlacePhotoKind(afterRestart.snapshot, afterRestart.details.photoUrls[0]), 'destination', 'photo provenance survives progressive persistence and restart');

  // Existing v3 source-only snapshots remain readable without clearing the
  // cache, another provider fetch, or inventing destination-photo evidence.
  const sourceSnapshot = buildSavedPlaceSnapshot({
    userId: 'user-a', saved, localPhotoUris: ['file://source-only.jpg'],
    providerHydrationComplete: true, source: 'durable_fallback',
  });
  localAssets.add('file://source-only.jpg');
  await writeSavedPlaceSnapshot(sourceSnapshot);
  resetSavedPlaceHydrationMemoryForTests();
  const sourceOnly = await hydrateSavedPlace({ userId: 'user-a', saved }, first.deps);
  assert.equal(savedPlacePhotoKind(sourceOnly.snapshot, sourceOnly.details.photoUrls[0]), 'source');
  assert.equal(googleCalls, 0, 'legacy source snapshot does not cause new Google traffic');
  assert.equal(savedPlacePhotoKind({ ...sourceSnapshot, source: 'save_payload' }, 'file://source-only.jpg'), 'unknown', 'ambiguous legacy save is not labeled destination');

  const cachedDestination = {
    ...first.deps,
    peekRichDetails: () => ({
      googlePlaceId: 'google-1', name: saved.place.name, formattedAddress: saved.place.formatted_address,
      latitude: saved.place.latitude, longitude: saved.place.longitude, category: 'cafe', googleMapsUrl: null,
      websiteUrl: null, formattedPhoneNumber: null, internationalPhoneNumber: null,
      openingHours: null, utcOffsetMinutes: null, photoUrls: ['https://photos.test/cached-destination.jpg'],
    }),
  };
  const upgraded = await hydrateSavedPlace({ userId: 'user-a', saved, knownImageUri: 'https://posts.test/source.jpg' }, cachedDestination);
  assert.equal(savedPlacePhotoKind(upgraded.snapshot, upgraded.details.photoUrls[0]), 'destination', 'already acquired destination replaces source-only snapshot, including a memory hit');
  assert.equal(googleCalls, 0, 'destination preference consumes cached metadata only');
  resetSavedPlaceHydrationMemoryForTests();
  const upgradedRestart = await hydrateSavedPlace({ userId: 'user-a', saved }, first.deps);
  assert.equal(savedPlacePhotoKind(upgradedRestart.snapshot, upgradedRestart.details.photoUrls[0]), 'destination');

  // Photo promotion must retain the hours already acquired with those photos.
  // Marking a metadata-empty snapshot hydrated would otherwise lose these
  // details permanently, because subsequent opens correctly avoid refetches.
  await clearSavedPlaceSnapshots('user-a');
  resetSavedPlaceHydrationMemoryForTests();
  const cachedDestinationWithHours = {
    ...cachedDestination,
    peekRichDetails: () => ({
      ...cachedDestination.peekRichDetails(),
      openingHours: googleDetails.openingHours,
      utcOffsetMinutes: googleDetails.utcOffsetMinutes,
    }),
  };
  const cacheOnlyHydration = await hydrateSavedPlace({ userId: 'user-a', saved }, cachedDestinationWithHours);
  assert.deepEqual(cacheOnlyHydration.details.openingHours, googleDetails.openingHours, 'cached destination hydration retains existing provider hours');
  assert.equal(cacheOnlyHydration.details.utcOffsetMinutes, googleDetails.utcOffsetMinutes, 'cached destination hydration retains UTC offset');
  resetSavedPlaceHydrationMemoryForTests();
  const cacheOnlyRestart = await hydrateSavedPlace({ userId: 'user-a', saved }, first.deps);
  assert.deepEqual(cacheOnlyRestart.details.openingHours, googleDetails.openingHours, 'retained hours survive restart');
  assert.equal(cacheOnlyRestart.details.utcOffsetMinutes, googleDetails.utcOffsetMinutes);
  assert.equal(googleCalls, 0, 'preserving cached metadata never adds a provider request');

  await writeSavedPlaceSnapshot({ ...sourceSnapshot, openingHours: googleDetails.openingHours, utcOffsetMinutes: 0 });
  resetSavedPlaceHydrationMemoryForTests();
  const sourceMetadataUpgrade = await hydrateSavedPlace({ userId: 'user-a', saved }, cachedDestination);
  assert.deepEqual(sourceMetadataUpgrade.details.openingHours, googleDetails.openingHours, 'source snapshot hours survive when the cached photo has no hours');
  assert.equal(sourceMetadataUpgrade.details.utcOffsetMinutes, 0, 'zero UTC offset is preserved');

  // A candidate source frame is persisted for provenance but never relabeled
  // just because it also appeared in the legacy first-photo field.
  await clearSavedPlaceSnapshots('user-a');
  resetSavedPlaceHydrationMemoryForTests();
  const sourceCandidate = { ...candidate, photoUrls: [], photoUrl: 'https://posts.test/frame.jpg', sourceFrameUrl: 'https://posts.test/frame.jpg' };
  await persistSavedPlaceSnapshotAfterSave({ userId: 'user-a', saved, candidate: sourceCandidate }, first.deps);
  const sourceSaved = await hydrateSavedPlace({ userId: 'user-a', saved }, first.deps);
  assert.equal(sourceSaved.details.photoUrls.length, 1);
  assert.equal(savedPlacePhotoKind(sourceSaved.snapshot, sourceSaved.details.photoUrls[0]), 'source');
  assert.equal(googleCalls, 0);

  for (const count of [0, 1, 2, 5]) {
    await clearSavedPlaceSnapshots('user-a');
    resetSavedPlaceHydrationMemoryForTests();
    const photos = candidate.photoUrls!.slice(0, count);
    const photoCaseSaved = count === 0 ? { ...saved, place: { ...saved.place, google_place_id: null } } : saved;
    await persistSavedPlaceSnapshotAfterSave({ userId: 'user-a', saved: photoCaseSaved, candidate: { ...candidate, photoUrls: photos, photoUrl: photos[0] ?? null } }, first.deps);
    await waitForProgressiveSavedPlacePhotosForTests();
    resetSavedPlaceHydrationMemoryForTests();
    const reopened = await hydrateSavedPlace({ userId: 'user-a', saved: photoCaseSaved }, first.deps);
    assert.equal(reopened.details.photoUrls.length, count, `${count} actual photos stay ${count} after restart`);
    assert.ok(reopened.details.photoUrls.every((uri) => savedPlacePhotoKind(reopened.snapshot, uri) === 'destination'));
  }
  assert.equal(googleCalls, 0, '0/1/2/5-photo saves preserve the no-extra-provider-request contract');
  localAssets.clear();
  resetSavedPlaceHydrationMemoryForTests();
  let missingImageRecoveryCalls = 0;
  const missingImageDependencies = dependencies(store, async () => {
    missingImageRecoveryCalls++;
    return { ...googleDetails, photoUrls: [] };
  });
  const missingImage = await hydrateSavedPlace({ userId: 'user-a', saved }, missingImageDependencies.deps);
  assert.equal(missingImage.details.photoUrls.length, 0, 'removed local files cannot inflate a usable gallery count');
  resetSavedPlaceHydrationMemoryForTests();
  await hydrateSavedPlace({ userId: 'user-a', saved }, missingImageDependencies.deps);
  assert.equal(missingImageRecoveryCalls, 1, 'missing-image recovery remains bounded after restart');

  // A legacy/transitional incomplete snapshot gets exactly one minimal
  // provider fallback and persists the recovered first image locally.
  resetSavedPlaceHydrationMemoryForTests();
  await writeSavedPlaceSnapshot({ ...snapshot, providerHydrationComplete: false });
  const legacy = dependencies(store, async () => {
    googleCalls += 1;
    return googleDetails;
  });
  const legacyOpen = await hydrateSavedPlace(
    { userId: 'user-a', saved, trigger: 'map_detail' },
    legacy.deps,
  );
  assert.equal(googleCalls, 1, 'incomplete legacy snapshot performs one fallback');
  assert.equal(legacyOpen.source, 'google_fallback');
  assert.equal(legacyOpen.details.photoUrls[0], 'file://saved-place-images/saved-1/hero.jpg');
  assert.equal(legacyOpen.details.photoUrls.length, 5, 'provider recovery persists the complete bounded gallery');
  const rawAfterFallback = store.values.get(savedPlaceSnapshotKey('user-a', saved.id)) ?? '';
  assert.doesNotMatch(rawAfterFallback, /photo_reference|maps\/api\/place\/photo/, 'Google photo URI is never persisted');
  assert.match(rawAfterFallback, /file:\/\/saved-place-images\/saved-1\/hero\.jpg/);
  assert.ok(legacy.events.includes('saved_place_snapshot_miss'));
  assert.ok(legacy.events.includes('saved_place_google_fallback_started'));
  assert.ok(legacy.events.includes('saved_place_google_fallback_succeeded'));
  assert.ok(legacy.events.includes('saved_place_photo_google_fallback'));
  resetSavedPlaceHydrationMemoryForTests();
  const recoveredReopen = await hydrateSavedPlace(
    { userId: 'user-a', saved, trigger: 'map_detail' },
    legacy.deps,
  );
  assert.equal(googleCalls, 1, 'recovered local image prevents an every-open refetch loop');
  assert.equal(recoveredReopen.details.photoUrls[0], 'file://saved-place-images/saved-1/hero.jpg');
  assert.equal(recoveredReopen.details.photoUrls.length, 5, 'recovered gallery survives process restart');

  resetSavedPlaceHydrationMemoryForTests();
  const otherUser = await readSavedPlaceSnapshot({
    userId: 'user-b', savedPlaceId: saved.id, googlePlaceId: 'google-1', requireProviderHydration: true,
  });
  assert.deepEqual(otherUser, { status: 'miss', reason: 'missing' }, 'snapshot keys are account-isolated');

  const corruptKey = savedPlaceSnapshotKey('user-a', 'saved-corrupt');
  store.values.set(corruptKey, '{nope');
  const corrupt = await readSavedPlaceSnapshot({
    userId: 'user-a', savedPlaceId: 'saved-corrupt', googlePlaceId: 'google-1',
  });
  assert.deepEqual(corrupt, { status: 'miss', reason: 'corrupt' });

  const failedStore = new MemoryStore();
  failedStore.failWrites = true;
  setSavedPlaceSnapshotStore(failedStore);
  assert.equal(await writeSavedPlaceSnapshot(snapshot), false, 'disk failure is non-fatal');

  const fallbackStore = new MemoryStore();
  setSavedPlaceSnapshotStore(fallbackStore);
  resetSavedPlaceHydrationMemoryForTests();
  let failedGoogleCalls = 0;
  const failed = dependencies(fallbackStore, async () => {
    failedGoogleCalls += 1;
    throw new Error('offline');
  });
  const degraded = await hydrateSavedPlace(
    { userId: 'user-a', saved, trigger: 'map_detail' },
    failed.deps,
  );
  assert.equal(degraded.source, 'durable_fallback');
  assert.equal(degraded.details.name, saved.place.name);
  resetSavedPlaceHydrationMemoryForTests();
  const degradedReopen = await hydrateSavedPlace(
    { userId: 'user-a', saved, trigger: 'map_detail' },
    failed.deps,
  );
  assert.equal(degradedReopen.source, 'snapshot');
  assert.equal(failedGoogleCalls, 1, 'a failed fallback does not become an every-open retry loop');
  assert.ok(failed.events.includes('saved_place_google_fallback_failed'));

  await writeSavedPlaceSnapshot({
    ...snapshot,
    ownerUserId: 'user-b',
    savedPlaceId: 'saved-b',
    providerHydrationComplete: true,
  });
  await clearSavedPlaceSnapshots('user-a');
  assert.equal(
    fallbackStore.values.get(savedPlaceSnapshotKey('user-a', saved.id)),
    undefined,
    'logout cleanup removes the user namespace',
  );
  assert.ok(
    fallbackStore.values.has(savedPlaceSnapshotKey('user-b', 'saved-b')),
    'logout cleanup never removes another account namespace',
  );

  setSavedPlaceSnapshotStore(null);
  resetSavedPlaceHydrationMemoryForTests();
  console.log('PASS saved-place snapshot serialization, isolation, local-first hydration, fallback, photos, restart, and failure safety');
}

void run().catch((error) => {
  setSavedPlaceSnapshotStore(null);
  console.error(error);
  process.exitCode = 1;
});
