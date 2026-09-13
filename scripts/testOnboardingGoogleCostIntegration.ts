import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { candidateHydrationDecision } from '../lib/candidatePresentation';
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
import {
  shouldPreserveOnboardingV2ProductRoute,
  shouldNavigateOnboarding,
} from '../lib/onboardingV2RoutingCore';
import type { PlaceCandidate, SavedPlaceGoogleDisplayDetails } from '../services/placesService';
import type { SavedPlaceWithPlace } from '../types';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

class MemoryStore implements SavedPlaceSnapshotStore {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
  async multiRemove(keys: string[]) { keys.forEach((key) => this.values.delete(key)); }
  async getAllKeys() { return [...this.values.keys()]; }
}

function saved(id: string): SavedPlaceWithPlace {
  return {
    id,
    user_id: 'integration-owner',
    place_id: `place-${id}`,
    radius_value: null,
    radius_unit: null,
    notes: null,
    ai_note: null,
    source_type: 'manual',
    source_url: null,
    notifications_enabled: true,
    last_notified_at: null,
    notification_count: 0,
    reminder_opportunity_count: 0,
    archived_at: null,
    visited_at: null,
    reminders_exhausted_at: null,
    created_at: '2026-09-12T12:00:00.000Z',
    updated_at: '2026-09-12T12:00:00.000Z',
    place: {
      id: `place-${id}`,
      google_place_id: `google-${id}`,
      name: 'Integrated Cafe',
      formatted_address: '1 Main St, Los Angeles, CA',
      latitude: 34.1,
      longitude: -118.2,
      category: 'cafe',
      google_maps_url: null,
      created_at: '2026-09-12T12:00:00.000Z',
    },
  };
}

function candidate(id: string): PlaceCandidate {
  return {
    googlePlaceId: `google-${id}`,
    name: 'Integrated Cafe',
    formattedAddress: '1 Main St, Los Angeles, CA',
    latitude: 34.1,
    longitude: -118.2,
    category: 'cafe',
    googleMapsUrl: null,
    photoUrls: [`https://photos.test/${id}/first`],
    photoUrl: `https://photos.test/${id}/first`,
  };
}

async function main() {
  const layout = read('app/_layout.tsx');
  assert.match(layout, /shouldPreserveOnboardingV2ProductRoute/);
  assert.equal(shouldPreserveOnboardingV2ProductRoute({
    currentRoute: '/share-jobs/job-1', stage: 'first_independent_share_returned',
  }), true);
  assert.equal(shouldNavigateOnboarding({
    currentRoute: '/(onboarding)', expectedRoute: '/(tabs)/map',
    pendingNavigation: { from: '/(onboarding)', to: '/(tabs)/map' },
  }), false);
  console.log('PASS 1 onboarding navigation loads and retains the latest route-ownership guards');

  const localDemo = read('components/onboarding/demo/FindingSavingCard.tsx');
  assert.doesNotMatch(localDemo, /fetch\(|supabase|createShareJob|processShareLink/);
  assert.match(localDemo, /It does NOT call the extraction backend/);
  console.log('PASS 2 hardcoded onboarding demonstration remains backend-independent');

  const suspension = JSON.parse(read('config/development-monetization-suspension.json'));
  assert.deepEqual(suspension.client, {
    EXPO_PUBLIC_MONETIZATION_ENABLED: false,
    EXPO_PUBLIC_PREMIUM_REQUESTS_ENABLED: false,
    EXPO_PUBLIC_TOKEN_MONETIZATION_ENABLED: false,
  });
  assert.equal(suspension.status, 'suspended');
  console.log('PASS 3 zero-token Development share configuration remains suspended');

  const extension = read('ShareExtension.tsx');
  const queue = read('app/share-jobs/index.tsx');
  assert.match(extension, /submitShareJobWithRecovery/);
  assert.match(extension, /durable_job_accepted/);
  assert.doesNotMatch(extension, /purchase_required|token pack|RevenueCat/i);
  assert.match(queue, /recordOnboardingV2RouteDiagnostic\('screen_mounted'/);
  console.log('PASS 4 durable share acceptance still routes through the diagnosed queue/result flow');

  const store = new MemoryStore();
  const files = new Set<string>();
  let googleCalls = 0;
  const deps: SavedPlaceHydrationDependencies = {
    readSnapshot: readSavedPlaceSnapshot,
    writeSnapshot: writeSavedPlaceSnapshot,
    fetchGoogle: async (placeId): Promise<SavedPlaceGoogleDisplayDetails> => {
      googleCalls += 1;
      return { googlePlaceId: placeId, photoUrls: [], openingHours: null, utcOffsetMinutes: null };
    },
    record: () => undefined,
    peekRichDetails: () => null,
    persistImage: async ({ savedPlaceId, sourceUri }) => {
      if (!sourceUri) return null;
      const uri = `file://documents/nearr/saved-place-images/integration-owner/${savedPlaceId}/hero.jpg`;
      files.add(uri);
      return uri;
    },
    isImageUsable: async (uri) => files.has(uri ?? ''),
  };
  setSavedPlaceSnapshotStore(store);
  resetSavedPlaceHydrationMemoryForTests();

  const recognized = saved('recognized');
  await persistSavedPlaceSnapshotAfterSave({
    userId: recognized.user_id, saved: recognized, candidate: candidate('recognized'),
  }, deps);
  const firstOpen = await hydrateSavedPlace({ userId: recognized.user_id, saved: recognized }, deps);
  assert.match(firstOpen.details.photoUrls[0] ?? '', /^file:\/\//);
  assert.equal(googleCalls, 0);
  console.log('PASS 5 recognized save writes a visual snapshot without an extra Google request');

  resetSavedPlaceHydrationMemoryForTests();
  const restartOpen = await hydrateSavedPlace({ userId: recognized.user_id, saved: recognized }, deps);
  assert.match(restartOpen.details.photoUrls[0] ?? '', /^file:\/\//);
  assert.equal(googleCalls, 0);
  console.log('PASS 6 restart uses persisted imagery with zero provider hydration');

  assert.equal(allowsPlaceImageLookup('active_manual_search', true), true);
  assert.equal(allowsPlaceImageLookup('offscreen_manual_search', true), false);
  assert.equal(candidateHydrationDecision({
    active: true, googlePlaceId: 'manual', photoUrls: ['https://photos.test/manual'],
  }).shouldRequest, false);
  console.log('PASS 7 manual search reuses visible imagery and suppresses offscreen fan-out');

  const decisions = Array.from({ length: 5 }, (_, index) => candidateHydrationDecision({
    active: index === 0, googlePlaceId: `candidate-${index + 1}`,
  }));
  assert.equal(decisions.filter((decision) => decision.shouldRequest).length, 1);
  console.log('PASS 8 five recognition candidates permit only the active visual fallback');

  const wrongPlace = read('components/map/WrongPlaceSheet.tsx');
  assert.match(wrongPlace, /hydrationPolicy=\{activePhotoPlaceId === candidate\.googlePlaceId/);
  assert.match(wrongPlace, /setActivePhotoPlaceId\(candidate\.googlePlaceId\)/);
  console.log('PASS 9 Wrong Place alternatives remain lazy until selected');

  const multiPlace = read('components/MultiPlaceCandidateCard.tsx');
  assert.match(multiPlace, /active=\{selected\}/);
  assert.match(multiPlace, /trigger: 'multi_place'/);
  console.log('PASS 10 multi-place hydration follows only the inspected selection');

  const tutorial = saved('tutorial');
  const tutorialOpen = await hydrateSavedPlace({
    userId: tutorial.user_id,
    saved: tutorial,
    knownImageUri: 'https://retained-source.test/tutorial-frame.jpg',
  }, deps);
  assert.match(tutorialOpen.details.photoUrls[0] ?? '', /^file:\/\//);
  assert.equal(googleCalls, 0);
  console.log('PASS 11 onboarding/source-backed places do not become legacy Google fallbacks');

  const savedPlacesService = read('services/savedPlacesService.ts');
  assert.match(savedPlacesService, /persistSavedPlaceSnapshotAfterSave/);
  assert.match(read('app/share-jobs/[jobId].tsx'), /presentationContext=\{\{[\s\S]{0,120}trigger: 'recognition_result'/);
  console.log('PASS 12 latest share-result save path retains snapshot persistence and active imagery context');

  const detail = read('app/share-jobs/[jobId].tsx');
  assert.doesNotMatch(detail, /requestPremiumRecognition|setPendingPremiumRequestJobId|\/monetization/);
  assert.equal(suspension.safety.preserveBalances, true);
  assert.equal(suspension.safety.preserveLedgerAndPurchaseHistory, true);
  console.log('PASS 13 integrated Development QA performs no token reserve or consume path');

  assert.equal(suspension.scope.appEnvironment, 'development');
  assert.equal(suspension.scope.backendEnvironment, 'development');
  assert.equal(suspension.safety.productionBypassAllowed, false);
  assert.equal(suspension.safety.productionProjectRef, 'rlqvxdwtetxsqxhqztkw');
  console.log('PASS 14 suspension cannot activate as a Production bypass');

  setSavedPlaceSnapshotStore(null);
  resetSavedPlaceHydrationMemoryForTests();
  console.log('\nPASS combined onboarding + Google cost-control integration contract (14 cases)');
}

void main().catch((error) => {
  setSavedPlaceSnapshotStore(null);
  resetSavedPlaceHydrationMemoryForTests();
  console.error(error);
  process.exitCode = 1;
});
