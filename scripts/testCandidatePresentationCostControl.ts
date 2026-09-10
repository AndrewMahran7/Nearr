import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  activeCandidatePlaceId,
  candidateHydrationDecision,
  createCandidatePhotoCache,
  visitCandidatePhoto,
} from '../lib/candidatePresentation';

const ids = (count: number) => Array.from({ length: count }, (_, index) => 'place-' + (index + 1));

async function hydrateActive(
  candidateIds: string[],
  activeId: string | null,
  cache: ReturnType<typeof createCandidatePhotoCache>,
) {
  await Promise.all(candidateIds.map(async (googlePlaceId) => {
    const decision = candidateHydrationDecision({
      active: googlePlaceId === activeId,
      googlePlaceId,
    });
    if (decision.shouldRequest) await cache.get(googlePlaceId);
  }));
}

async function run() {
  let providerCalls = 0;
  const cache = createCandidatePhotoCache(async (placeId) => {
    providerCalls += 1;
    return ['https://photos.test/' + placeId + '/1'];
  });

  // 1. Five mounted candidates, only #1 active.
  await hydrateActive(ids(5), 'place-1', cache);
  assert.equal(providerCalls, 1, 'inactive candidates #2-#5 make zero provider calls');

  // 2. #1 -> #2 -> #1 reuses the session result.
  await hydrateActive(ids(5), 'place-2', cache);
  await hydrateActive(ids(5), 'place-1', cache);
  assert.equal(providerCalls, 2, 'revisiting candidate #1 does not refetch');

  // 3. Existing photo or source/frame data avoids Details.
  assert.deepEqual(candidateHydrationDecision({
    active: true,
    googlePlaceId: 'existing',
    photoUrls: ['https://photos.test/existing/1'],
  }), { shouldRequest: false, reason: 'existing_photo_data' });
  assert.deepEqual(candidateHydrationDecision({
    active: true,
    googlePlaceId: 'source',
    fallbackSourceUri: 'https://media.test/frame.jpg',
  }), { shouldRequest: false, reason: 'source_media' });

  // 4. Only the active candidate with no useful media gets one minimal request.
  let fallbackCalls = 0;
  const fallbackCache = createCandidatePhotoCache(async () => {
    fallbackCalls += 1;
    return ['photo'];
  });
  await hydrateActive(ids(5), activeCandidatePlaceId(ids(5), []), fallbackCache);
  assert.equal(fallbackCalls, 1);

  // 5. A five-photo carousel initially mounts one photo; explicit navigation
  // adds only the pages actually visited.
  let visited: ReadonlySet<number> = new Set();
  visited = visitCandidatePhoto(visited, 0, 5);
  assert.deepEqual([...visited], [0]);
  visited = visitCandidatePhoto(visited, 1, 5);
  assert.deepEqual([...visited], [0, 1]);
  assert.equal(visited.has(2) || visited.has(3) || visited.has(4), false);

  // 6. Wrong Place alternatives are not active merely because they mount.
  let wrongPlaceCalls = 0;
  const wrongPlaceCache = createCandidatePhotoCache(async () => {
    wrongPlaceCalls += 1;
    return ['photo'];
  });
  await hydrateActive(ids(5), null, wrongPlaceCache);
  assert.equal(wrongPlaceCalls, 0);
  await hydrateActive(ids(5), 'place-3', wrongPlaceCache);
  assert.equal(wrongPlaceCalls, 1);

  // 7. Two surfaces requesting the same active Place ID coalesce in flight.
  let release!: (urls: string[]) => void;
  let concurrentCalls = 0;
  const outcomes: string[] = [];
  const concurrentCache = createCandidatePhotoCache(
    () => {
      concurrentCalls += 1;
      return new Promise<string[]>((resolve) => { release = resolve; });
    },
    (outcome) => outcomes.push(outcome),
  );
  const first = concurrentCache.get('shared');
  const second = concurrentCache.get('shared');
  assert.equal(concurrentCalls, 1);
  assert.deepEqual(outcomes, ['requested', 'deduped']);
  release(['shared-photo']);
  await Promise.all([first, second]);

  // 8. Multi-place siblings remain idle until each one is active.
  let multiCalls = 0;
  const multiCache = createCandidatePhotoCache(async () => {
    multiCalls += 1;
    return ['photo'];
  });
  await hydrateActive(ids(4), 'place-1', multiCache);
  assert.equal(multiCalls, 1);

  // 9. The ticket stays presentation-only: the new service mask is photos,
  // and recognition query/ranking/candidate-count contracts remain present.
  const placesService = readFileSync(join(process.cwd(), 'services/placesService.ts'), 'utf8');
  assert.match(placesService, /CANDIDATE_PHOTO_DETAILS_FIELDS = 'photos'/);
  assert.match(placesService, /slice\(0, 12\)/, 'candidate count is unchanged');
  assert.match(placesService, /rankContextAwareCandidates/, 'recognition ranking remains unchanged');
  assert.doesNotMatch(
    placesService.match(/export async function getCandidatePhotoUrls[\s\S]*?\n}\n/)?.[0] ?? '',
    /\bwebsite\b|\bphone\b|opening_hours|\brating\b|\breviews?\b/,
    'candidate fallback does not request rich fields',
  );

  console.log('PASS candidate presentation cost control (9 deterministic contracts)');
}

void run();
