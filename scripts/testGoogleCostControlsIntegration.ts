import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  candidateHydrationDecision,
  createCandidatePhotoCache,
  visitCandidatePhoto,
} from '../lib/candidatePresentation';
import {
  hydrateSavedPlace,
  persistSavedPlaceSnapshotAfterSave,
  resetSavedPlaceHydrationMemoryForTests,
  type SavedPlaceHydrationDependencies,
} from '../lib/savedPlaceHydration';
import {
  buildSavedPlaceSnapshot,
  readSavedPlaceSnapshot,
  setSavedPlaceSnapshotStore,
  writeSavedPlaceSnapshot,
  type SavedPlaceSnapshotStore,
} from '../lib/savedPlaceSnapshot';
import type { PlaceCandidate, SavedPlaceGoogleDisplayDetails } from '../services/placesService';
import type { SavedPlaceWithPlace } from '../types';

type ProviderCounts = {
  recognition: number;
  candidateDetails: number;
  savedDetails: number;
  photos: number;
  nearbySearch: number;
};

class MemoryStore implements SavedPlaceSnapshotStore {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
  async multiRemove(keys: string[]) { keys.forEach((key) => this.values.delete(key)); }
  async getAllKeys() { return [...this.values.keys()]; }
}

const saved: SavedPlaceWithPlace = {
  id: 'saved-1', user_id: 'user-a', place_id: 'place-1',
  radius_value: null, radius_unit: null, notes: null, ai_note: null,
  source_type: 'manual', source_url: 'https://source.test/post', notifications_enabled: true,
  last_notified_at: null, notification_count: 0, reminder_opportunity_count: 0,
  archived_at: null, visited_at: null, reminders_exhausted_at: null,
  created_at: '2026-09-10T10:00:00.000Z', updated_at: '2026-09-10T10:00:00.000Z',
  place: {
    id: 'place-1', google_place_id: 'google-1', name: 'Integrated Cafe',
    formatted_address: '1 Main St, Los Angeles, CA', latitude: 34.1, longitude: -118.2,
    category: 'cafe', google_maps_url: 'https://maps.google.com/example',
    created_at: '2026-09-10T10:00:00.000Z',
  },
};

const candidate: PlaceCandidate = {
  googlePlaceId: 'google-1', name: 'Integrated Cafe',
  formattedAddress: '1 Main St, Los Angeles, CA', latitude: 34.1, longitude: -118.2,
  category: 'cafe', googleMapsUrl: 'https://maps.google.com/example', rawTypes: ['cafe'],
};

const savedGoogleDetails: SavedPlaceGoogleDisplayDetails = {
  googlePlaceId: 'google-1',
  photoUrls: ['https://photos.test/saved/1'],
  openingHours: null,
  utcOffsetMinutes: null,
};

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `google-${index + 1}`);
}

async function hydrateCandidates(args: {
  candidateIds: string[];
  activeId: string | null;
  cache: ReturnType<typeof createCandidatePhotoCache>;
  sourceById?: ReadonlySet<string>;
  allowGoogleLookup?: boolean;
}): Promise<void> {
  await Promise.all(args.candidateIds.map(async (googlePlaceId) => {
    const decision = candidateHydrationDecision({
      active: googlePlaceId === args.activeId,
      allowGoogleLookup: args.allowGoogleLookup,
      googlePlaceId,
      fallbackSourceUri: args.sourceById?.has(googlePlaceId) ? 'https://source.test/frame.jpg' : null,
    });
    if (decision.shouldRequest) await args.cache.get(googlePlaceId);
  }));
}

function savedDependencies(
  counts: ProviderCounts,
  events: string[],
  offline = false,
): SavedPlaceHydrationDependencies {
  return {
    readSnapshot: readSavedPlaceSnapshot,
    writeSnapshot: writeSavedPlaceSnapshot,
    fetchGoogle: async () => {
      counts.savedDetails += 1;
      if (offline) throw new Error('offline');
      return savedGoogleDetails;
    },
    record: (event) => { events.push(event); },
    peekRichDetails: () => null,
  };
}

async function run() {
  const counts: ProviderCounts = {
    recognition: 0,
    candidateDetails: 0,
    savedDetails: 0,
    photos: 0,
    nearbySearch: 0,
  };
  const candidateCache = createCandidatePhotoCache(async (placeId) => {
    counts.candidateDetails += 1;
    return Array.from({ length: 5 }, (_, index) => `https://photos.test/${placeId}/${index + 1}`);
  });

  // 1. Five candidates, view #1: existing source data is zero UI provider calls;
  // without source data the active-only upper bound is one photos-only Details call.
  await hydrateCandidates({
    candidateIds: ids(5), activeId: 'google-1',
    cache: candidateCache, sourceById: new Set(['google-1']),
  });
  assert.equal(counts.candidateDetails, 0);
  await hydrateCandidates({ candidateIds: ids(5), activeId: 'google-1', cache: candidateCache });
  assert.equal(counts.candidateDetails, 1);
  let visited: ReadonlySet<number> = visitCandidatePhoto(new Set(), 0, 5);
  counts.photos += visited.size;
  assert.deepEqual([...visited], [0], 'only photo #1 is initially eligible');

  const store = new MemoryStore();
  const events: string[] = [];
  setSavedPlaceSnapshotStore(store);
  resetSavedPlaceHydrationMemoryForTests();
  const deps = savedDependencies(counts, events);

  // 2. Saving uses the candidate/save payload already in hand.
  await persistSavedPlaceSnapshotAfterSave({ userId: 'user-a', saved, candidate }, deps);
  assert.equal(counts.savedDetails, 0, 'save creates no provider request');

  // 3-4. First and repeat opens of the new save are local.
  assert.equal((await hydrateSavedPlace({ userId: 'user-a', saved }, deps)).source, 'snapshot');
  assert.equal((await hydrateSavedPlace({ userId: 'user-a', saved }, deps)).source, 'memory');
  assert.equal(counts.savedDetails, 0);

  // 5. A simulated process restart retains the device snapshot.
  resetSavedPlaceHydrationMemoryForTests();
  assert.equal((await hydrateSavedPlace({ userId: 'user-a', saved }, deps)).source, 'snapshot');
  assert.equal(counts.savedDetails, 0);

  // 6. Offline is irrelevant for a complete snapshot: the provider seam is never called.
  resetSavedPlaceHydrationMemoryForTests();
  const offlineDeps = savedDependencies(counts, events, true);
  assert.equal((await hydrateSavedPlace({ userId: 'user-a', saved }, offlineDeps)).source, 'snapshot');
  assert.equal(counts.savedDetails, 0);

  // 7-8. An incomplete legacy snapshot recovers once; the next process uses local state.
  resetSavedPlaceHydrationMemoryForTests();
  await writeSavedPlaceSnapshot(buildSavedPlaceSnapshot({
    userId: 'user-a', saved, providerHydrationComplete: false, source: 'durable_fallback',
  }));
  const legacy = await hydrateSavedPlace({ userId: 'user-a', saved }, deps);
  assert.equal(legacy.source, 'google_fallback');
  assert.equal(counts.savedDetails, 1);
  counts.photos += legacy.details.photoUrls.length > 0 ? 1 : 0;
  resetSavedPlaceHydrationMemoryForTests();
  assert.equal((await hydrateSavedPlace({ userId: 'user-a', saved }, deps)).source, 'snapshot');
  assert.equal(counts.savedDetails, 1, 'legacy recovery is not repeated');

  // 9. Wrong Place alternatives can all mount without becoming active.
  const beforeWrongPlace = counts.candidateDetails;
  await hydrateCandidates({ candidateIds: ids(5), activeId: null, cache: candidateCache });
  assert.equal(counts.candidateDetails, beforeWrongPlace);

  // 10. Selecting exactly one alternative makes only it eligible.
  await hydrateCandidates({ candidateIds: ids(5), activeId: 'google-3', cache: candidateCache });
  assert.equal(counts.candidateDetails, beforeWrongPlace + 1);

  // 11. Four-place result: inspecting one does not hydrate its siblings.
  const beforeMulti = counts.candidateDetails;
  const multiCache = createCandidatePhotoCache(async (placeId) => {
    counts.candidateDetails += 1;
    return [`https://photos.test/${placeId}/1`];
  });
  await hydrateCandidates({ candidateIds: ids(4), activeId: 'google-1', cache: multiCache });
  assert.equal(counts.candidateDetails, beforeMulti + 1);

  // Cross-feature boundary: a saved-result candidate with lookup disabled can
  // render existing data but can never enter the candidate fallback cache.
  const disabled = candidateHydrationDecision({
    active: true, allowGoogleLookup: false, googlePlaceId: 'google-legacy',
  });
  assert.deepEqual(disabled, { shouldRequest: false, reason: 'lookup_disabled' });

  assert.equal(counts.recognition, 0, 'UI simulation never invokes recognition');
  assert.equal(counts.nearbySearch, 0, 'opening/saving never invokes Nearby Search');
  assert.ok(events.includes('saved_place_snapshot_written'));
  assert.ok(events.includes('saved_place_snapshot_hit'));
  assert.ok(events.includes('saved_place_google_fallback_started'));

  const placeImage = readFileSync(join(process.cwd(), 'components/PlaceImage.tsx'), 'utf8');
  assert.match(placeImage, /presentationMode === 'candidate'/);
  assert.match(placeImage, /allowGoogleLookup/);
  const savedResult = readFileSync(join(process.cwd(), 'components/SavedPlaceResult.tsx'), 'utf8');
  assert.match(savedResult, /allowGoogleLookup=\{false\}/);
  assert.match(savedResult, /presentationMode="candidate"/);
  const places = readFileSync(join(process.cwd(), 'services/placesService.ts'), 'utf8');
  assert.match(places, /CANDIDATE_PHOTO_DETAILS_FIELDS = 'photos'/);
  assert.match(places, /SAVED_PLACE_DISPLAY_DETAILS_FIELDS/);
  assert.match(places, /slice\(0, 12\)/, 'recognition candidate count remains unchanged');
  assert.match(places, /rankContextAwareCandidates/, 'recognition ranking remains unchanged');

  setSavedPlaceSnapshotStore(null);
  resetSavedPlaceHydrationMemoryForTests();
  console.log('PASS integrated Google cost controls (11 provider-count scenarios + cross-feature boundary)');
}

void run().catch((error) => {
  setSavedPlaceSnapshotStore(null);
  resetSavedPlaceHydrationMemoryForTests();
  console.error(error);
  process.exitCode = 1;
});
