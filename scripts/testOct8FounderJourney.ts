import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { placeCapabilities } from '../lib/placeCapabilities';
import { requireRealSavedPlaceId } from '../lib/savedPlaceIdentity';
import { nearbyPlacesForLocation } from '../lib/nearbyPlaces';
import { shouldPresentNotificationInForeground } from '../lib/notificationForegroundPolicy';
import { authoritativeShareJobNotification } from '../lib/shareJobNotificationAuthority';
import {
  hydrateSavedPlace,
  persistSavedPlaceSnapshotAfterSave,
  resetSavedPlaceHydrationMemoryForTests,
  waitForProgressiveSavedPlacePhotosForTests,
  type SavedPlaceHydrationDependencies,
} from '../lib/savedPlaceHydration';
import {
  readSavedPlaceSnapshot,
  setSavedPlaceSnapshotStore,
  writeSavedPlaceSnapshot,
  type SavedPlaceSnapshotStore,
} from '../lib/savedPlaceSnapshot';
import { shareJobCandidateToPlaceCandidate } from '../lib/shareJobCandidateConversion';
import type { ShareJobCandidate } from '../services/shareJobsService';
import { OFFLINE_ONBOARDING_FIXTURES } from '../onboarding/fixtures/offlineOnboardingFixtures';
import type { SavedPlaceWithPlace } from '../types';

class MemoryStore implements SavedPlaceSnapshotStore {
  values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
  async multiRemove(keys: string[]) { keys.forEach((key) => this.values.delete(key)); }
  async getAllKeys() { return [...this.values.keys()]; }
}

const timestamp = '2026-10-08T20:00:00.000Z';
const realSaved: SavedPlaceWithPlace = {
  id: '619d591d-3da2-4c25-91de-f7db63af2265',
  user_id: 'founder-qa',
  place_id: 'fcb4f639-ea31-4261-a047-5c8ce2b82966',
  radius_value: 1,
  radius_unit: 'miles',
  notes: null,
  source_type: 'instagram',
  source_url: 'https://www.instagram.com/p/qa-example/',
  notifications_enabled: true,
  last_notified_at: null,
  notification_count: 0,
  reminder_opportunity_count: 0,
  archived_at: null,
  visited_at: null,
  reminders_exhausted_at: null,
  category: 'restaurant',
  created_at: timestamp,
  updated_at: timestamp,
  place: {
    id: 'fcb4f639-ea31-4261-a047-5c8ce2b82966',
    google_place_id: 'ChIJ-qa-2nd-floor',
    name: '2nd Floor',
    formatted_address: 'QA address',
    latitude: 34.006,
    longitude: -118,
    category: 'restaurant',
    google_maps_url: 'https://maps.google.com/?q=2nd+Floor',
    created_at: timestamp,
  },
};

const candidate: ShareJobCandidate = {
  googlePlaceId: realSaved.place.google_place_id!,
  name: realSaved.place.name,
  formattedAddress: realSaved.place.formatted_address,
  latitude: realSaved.place.latitude,
  longitude: realSaved.place.longitude,
  types: ['restaurant'],
  primaryType: 'restaurant',
  primaryTypeDisplayName: 'Restaurant',
  googleMapsTypeLabel: 'Restaurant',
  shortFormattedAddress: 'QA address',
  businessStatus: 'OPERATIONAL',
  matchScore: 0.97,
  aiNote: null,
  photoUrl: 'https://photos.test/2nd-floor/1',
  photoUrls: Array.from({ length: 5 }, (_, index) => `https://photos.test/2nd-floor/${index + 1}`),
  sourceFrameUrl: 'https://source.test/2nd-floor-frame.jpg',
  sourceTimestamps: [2],
  contextReason: null,
  contextLabel: null,
  distanceKm: null,
  localityMatch: true,
  wideningTierKm: null,
  evidence: [],
  reasons: [],
  matchStrength: 'high',
  discoveryOnly: false,
};

async function run() {
  const stages: string[] = [];
  const madYolks = OFFLINE_ONBOARDING_FIXTURES.find((fixture) => fixture.assetKey === 'mad_yolks');
  assert.ok(madYolks);
  stages.push('fresh Food onboarding');
  assert.equal(madYolks.place.category, 'restaurant');

  const tutorialId = `onboarding-scripted-save:${madYolks.id}`;
  const tutorialCapabilities = placeCapabilities({
    id: tutorialId,
    source_url: madYolks.provenance.sourceUrl,
    place: { id: madYolks.place.id, google_place_id: madYolks.place.id },
  });
  stages.push('Mad Yolks scripted save and action audit');
  assert.equal(tutorialCapabilities.canOpenDirections, true);
  assert.equal(tutorialCapabilities.canWatchSource, true);
  assert.equal(tutorialCapabilities.canShare, true);
  assert.equal(tutorialCapabilities.canEdit || tutorialCapabilities.canSetReminder || tutorialCapabilities.canDelete, false);
  assert.throws(() => requireRealSavedPlaceId(tutorialId, 'journey'));

  stages.push('real practice review and save');
  const placeCandidate = shareJobCandidateToPlaceCandidate(candidate);
  assert.equal(placeCandidate.photoUrls?.length, 5, 'Quick Check -> save preserves five known photos');

  const store = new MemoryStore();
  const files = new Set<string>();
  const dependencies: SavedPlaceHydrationDependencies = {
    readSnapshot: readSavedPlaceSnapshot,
    writeSnapshot: writeSavedPlaceSnapshot,
    fetchGoogle: async () => { throw new Error('unexpected_provider_call'); },
    record: () => undefined,
    peekRichDetails: () => null,
    persistImage: async ({ savedPlaceId, sourceUri, index = 0 }) => {
      if (!sourceUri) return null;
      const uri = `file://qa/${savedPlaceId}/${index === 0 ? 'hero' : `photo-${index + 1}`}.jpg`;
      files.add(uri);
      return uri;
    },
    isImageUsable: async (uri) => files.has(uri ?? ''),
  };
  setSavedPlaceSnapshotStore(store);
  await persistSavedPlaceSnapshotAfterSave({
    userId: realSaved.user_id,
    saved: realSaved,
    candidate: placeCandidate,
  }, dependencies);
  await waitForProgressiveSavedPlacePhotosForTests();
  resetSavedPlaceHydrationMemoryForTests();
  const gallery = await hydrateSavedPlace({ userId: realSaved.user_id, saved: realSaved }, dependencies);
  stages.push('saved gallery and restart');
  assert.equal(gallery.details.photoUrls.length, 5);
  assert.equal(gallery.source, 'snapshot');

  stages.push('map and Nearby now');
  const far = {
    ...realSaved,
    id: '5a827f45-353f-43d1-9d49-80762f665405',
    place: { ...realSaved.place, id: 'cc961a92-d9aa-420b-81d6-4274093ddfe3', latitude: 40.7128, longitude: -74.006 },
  };
  assert.deepEqual(nearbyPlacesForLocation([far, realSaved], { latitude: 34, longitude: -118 }).map((row) => row.id), [realSaved.id]);

  stages.push('manual search and fresh Instagram share');
  const queue = fs.readFileSync(path.resolve(__dirname, '../app/share-jobs/index.tsx'), 'utf8');
  assert.doesNotMatch(queue, /Development previews/);
  assert.match(queue, /fallbackSourceUri=\{firstCandidate\?\.sourceFrameUrl\}/);

  stages.push('recognition, save, and notification decision');
  const notificationPayload = {
    title: 'Saved 2nd Floor to your map',
    body: 'Open Nearr to view your new find.',
    data: { type: 'share_job_completed', jobId: 'job-qa' },
  };
  assert.ok(authoritativeShareJobNotification({
    id: 'job-qa', user_id: 'founder-qa', status: 'completed',
    notification_status: 'sending', notification_payload: notificationPayload,
  }));
  assert.equal(shouldPresentNotificationInForeground({
    appState: 'active', pathname: '/share-jobs/job-qa', data: notificationPayload.data,
  }), false);
  assert.equal(shouldPresentNotificationInForeground({
    appState: 'background', pathname: '/share-jobs/job-qa', data: notificationPayload.data,
  }), true);

  setSavedPlaceSnapshotStore(null);
  resetSavedPlaceHydrationMemoryForTests();
  console.log(`PASS Oct 8 founder journey: ${stages.join(' -> ')}`);
}

void run().catch((error) => {
  setSavedPlaceSnapshotStore(null);
  resetSavedPlaceHydrationMemoryForTests();
  console.error(error);
  process.exitCode = 1;
});
