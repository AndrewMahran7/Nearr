import assert from 'node:assert/strict';

import { createAsyncValueCache } from '../lib/asyncValueCache';
import { selectPlaceImageUri } from '../lib/placeImageSource';

async function run() {
  assert.equal(selectPlaceImageUri('source.jpg', ['place.jpg'], {}), 'source.jpg');
  assert.equal(
    selectPlaceImageUri('source.jpg', ['place.jpg'], { 'source.jpg': true }),
    'place.jpg',
  );
  assert.equal(
    selectPlaceImageUri(null, ['failed.jpg', 'verified.jpg'], { 'failed.jpg': true }),
    'verified.jpg',
  );
  assert.equal(selectPlaceImageUri(null, ['failed.jpg'], { 'failed.jpg': true }), null);

  let loadCount = 0;
  let release!: (value: string) => void;
  const cached = createAsyncValueCache<string>(
    () => {
      loadCount += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    },
  );
  const first = cached('place-id');
  const second = cached('place-id');
  assert.equal(loadCount, 1, 'concurrent photo requests are deduplicated');
  release('photo.jpg');
  assert.equal(await first, 'photo.jpg');
  assert.equal(await second, 'photo.jpg');
  assert.equal(await cached('place-id'), 'photo.jpg');
  assert.equal(loadCount, 1, 'resolved photo is cached');

  let failureCount = 0;
  const cachedFailure = createAsyncValueCache<string>(async () => {
    failureCount += 1;
    throw new Error('unavailable');
  });
  assert.equal(await cachedFailure('missing'), null);
  assert.equal(await cachedFailure('missing'), null);
  assert.equal(failureCount, 1, 'failed lookup is cached as a fallback result');

  console.log('PASS place image source hierarchy and cache');
}

void run();