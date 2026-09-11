import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  candidateHydrationDecision,
  createCandidatePhotoCache,
  visitCandidatePhoto,
} from '../lib/candidatePresentation';
import { allowsPlaceImageLookup } from '../lib/placeImagePolicy';
import {
  hydrateSavedPlace,
  persistSavedPlaceSnapshotAfterSave,
  resetSavedPlaceHydrationMemoryForTests,
  type SavedPlaceHydrationDependencies,
} from '../lib/savedPlaceHydration';
import {
  readSavedPlaceSnapshot,
  setSavedPlaceSnapshotStore,
  writeSavedPlaceSnapshot,
  type SavedPlaceSnapshotStore,
} from '../lib/savedPlaceSnapshot';
import type { PlaceCandidate, SavedPlaceGoogleDisplayDetails } from '../services/placesService';
import type { SavedPlaceWithPlace } from '../types';

class MemoryStore implements SavedPlaceSnapshotStore {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
  async multiRemove(keys: string[]) { keys.forEach((key) => this.values.delete(key)); }
  async getAllKeys() { return [...this.values.keys()]; }
}

const saved: SavedPlaceWithPlace = {
  id: 'saved-visual', user_id: 'owner-a', place_id: 'place-visual',
  radius_value: null, radius_unit: null, notes: null, ai_note: null,
  source_type: 'manual', source_url: null, notifications_enabled: true,
  last_notified_at: null, notification_count: 0, reminder_opportunity_count: 0,
  archived_at: null, visited_at: null, reminders_exhausted_at: null,
  created_at: '2026-09-10T10:00:00.000Z', updated_at: '2026-09-10T10:00:00.000Z',
  place: {
    id: 'place-visual', google_place_id: 'google-visual', name: 'Visual Cafe',
    formatted_address: '1 Main St, Los Angeles, CA', latitude: 34.1, longitude: -118.2,
    category: 'cafe', google_maps_url: 'https://maps.google.com/visual',
    created_at: '2026-09-10T10:00:00.000Z',
  },
};

const candidate: PlaceCandidate = {
  googlePlaceId: 'google-visual', name: 'Visual Cafe',
  formattedAddress: '1 Main St, Los Angeles, CA', latitude: 34.1, longitude: -118.2,
  category: 'cafe', googleMapsUrl: 'https://maps.google.com/visual', rawTypes: ['cafe'],
  photoUrl: 'https://photos.test/search/first',
  photoUrls: ['https://photos.test/search/first', 'https://photos.test/search/second'],
};

async function run() {
  const store = new MemoryStore();
  const files = new Set<string>();
  const localUri = 'file://nearr/saved-place-images/owner-a/saved-visual/hero.jpg';
  let googleDetailsCalls = 0;
  let persistedDownloads = 0;
  const googleDetails: SavedPlaceGoogleDisplayDetails = {
    googlePlaceId: 'google-visual',
    photoUrls: ['https://photos.test/recovered/first', 'https://photos.test/recovered/second'],
    openingHours: null,
    utcOffsetMinutes: null,
  };
  const deps: SavedPlaceHydrationDependencies = {
    readSnapshot: readSavedPlaceSnapshot,
    writeSnapshot: writeSavedPlaceSnapshot,
    fetchGoogle: async () => { googleDetailsCalls += 1; return googleDetails; },
    record: () => undefined,
    peekRichDetails: () => null,
    persistImage: async ({ sourceUri }) => {
      if (!sourceUri) return null;
      persistedDownloads += 1;
      files.add(localUri);
      return localUri;
    },
    isImageUsable: async (uri) => files.has(uri ?? ''),
  };
  setSavedPlaceSnapshotStore(store);
  resetSavedPlaceHydrationMemoryForTests();

  // 1, 4-6: save-time known imagery becomes the one local source consumed by
  // list, selected-card, marker, and full-detail surfaces with no Details call.
  await persistSavedPlaceSnapshotAfterSave({ userId: 'owner-a', saved, candidate }, deps);
  assert.equal(persistedDownloads, 1);
  const first = await hydrateSavedPlace({ userId: 'owner-a', saved }, deps);
  assert.equal(first.source, 'snapshot');
  assert.deepEqual(first.details.photoUrls, [localUri]);
  assert.equal(googleDetailsCalls, 0);

  // 2 and 15: a simulated process restart still uses the local hero and makes
  // zero provider calls across repeated list/detail/map consumers.
  resetSavedPlaceHydrationMemoryForTests();
  const restarted = await hydrateSavedPlace({ userId: 'owner-a', saved }, deps);
  assert.deepEqual(restarted.details.photoUrls, [localUri]);
  await hydrateSavedPlace({ userId: 'owner-a', saved }, deps);
  assert.equal(googleDetailsCalls, 0);

  // 3: a stale snapshot whose file is missing gets one bounded recovery; the
  // recovered local image survives the next process and does not loop.
  files.delete(localUri);
  const recovered = await hydrateSavedPlace({ userId: 'owner-a', saved }, deps);
  assert.equal(googleDetailsCalls, 1);
  assert.equal(recovered.details.photoUrls[0], localUri);
  resetSavedPlaceHydrationMemoryForTests();
  assert.equal((await hydrateSavedPlace({ userId: 'owner-a', saved }, deps)).details.photoUrls[0], localUri);
  assert.equal(googleDetailsCalls, 1);

  // Retained Nearr/source imagery outranks provider recovery for a legacy save.
  const sourceBackedSaved = { ...saved, id: 'saved-source-backed' };
  resetSavedPlaceHydrationMemoryForTests();
  const sourceBacked = await hydrateSavedPlace({
    userId: 'owner-a',
    saved: sourceBackedSaved,
    knownImageUri: 'https://source.test/retained-thumbnail.jpg',
  }, deps);
  assert.equal(sourceBacked.details.photoUrls[0], localUri);
  assert.equal(googleDetailsCalls, 1, 'retained source media must avoid Google recovery');

  // 7-9: known manual-search metadata is renderable without hydration; exactly
  // one active missing result is eligible while offscreen siblings are not.
  assert.deepEqual(candidateHydrationDecision({
    active: true, googlePlaceId: 'manual-1', photoUrls: ['https://photos.test/manual'],
  }), { shouldRequest: false, reason: 'existing_photo_data' });
  assert.equal(allowsPlaceImageLookup('active_manual_search', true), true);
  assert.equal(allowsPlaceImageLookup('offscreen_manual_search', true), false);

  // 10-11: five recognition candidates, view #1. Only #1 performs the single
  // photos-only fallback; #2-#5 remain zero-request.
  let candidateDetailsCalls = 0;
  const cache = createCandidatePhotoCache(async (placeId) => {
    candidateDetailsCalls += 1;
    return [`https://photos.test/${placeId}/1`];
  });
  const ids = ['candidate-1', 'candidate-2', 'candidate-3', 'candidate-4', 'candidate-5'];
  await Promise.all(ids.map(async (id, index) => {
    const decision = candidateHydrationDecision({ active: index === 0, googlePlaceId: id });
    if (decision.shouldRequest) await cache.get(id);
  }));
  assert.equal(candidateDetailsCalls, 1);

  // 12-13: photo #1 is initially eligible. Later pages become eligible only
  // after the user visits that index.
  let visited: ReadonlySet<number> = visitCandidatePhoto(new Set(), 0, 5);
  assert.deepEqual([...visited], [0]);
  visited = visitCandidatePhoto(visited, 2, 5);
  assert.deepEqual([...visited], [0, 2]);

  // 14 plus source-level render contracts for the actual UI surfaces.
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
  const browse = read('components/SavedPlaceBrowseCard.tsx');
  assert.match(browse, /hydrateSavedPlace/);
  assert.match(browse, /initialPhotoUrls=\{savedImageUri/);
  const detail = read('components/map/SelectedPlaceDetails.tsx');
  assert.match(detail, /const heroUri = videoHero\?\.uri \?\? sourceHeroUri/);
  assert.match(detail, /prefetchAdjacent=\{false\}[\s\S]{0,80}loadOnlyVisited/);
  const marker = read('components/map/NearrMapMarker.tsx');
  assert.match(marker, /hydrateSavedPlace/);
  const map = read('app/(tabs)/map.tsx');
  assert.match(map, /initialPhotoUrls=\{\[selectedImageUri\]\}/);
  const manual = read('components/map/MapPlaceSearchDropdown.tsx');
  assert.match(manual, /initialPhotoUrls=\{place\.photoUrls/);
  assert.match(manual, /presentationActive=\{index === 0\}/);
  const placeImage = read('components/PlaceImage.tsx');
  assert.match(placeImage, /const candidatePhotoUrls = knownImageryVisible \? placePhotoUrls : \[\]/);
  assert.match(placeImage, /acquirePlacePresentationImage\(remoteResolvedUri\)/);
  const wrongPlace = read('components/map/WrongPlaceSheet.tsx');
  assert.match(wrongPlace, /presentationActive=\{activePhotoPlaceId === candidate\.googlePlaceId\}/);
  assert.match(wrongPlace, /setActivePhotoPlaceId\(candidate\.googlePlaceId\)/);

  setSavedPlaceSnapshotStore(null);
  resetSavedPlaceHydrationMemoryForTests();
  console.log('PASS Google cost-control UX regression contracts (15 visual + cost scenarios; monetization is the dedicated contract suite)');
}

void run().catch((error) => {
  setSavedPlaceSnapshotStore(null);
  resetSavedPlaceHydrationMemoryForTests();
  console.error(error);
  process.exitCode = 1;
});
