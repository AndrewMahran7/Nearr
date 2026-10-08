import assert from 'node:assert/strict';

import {
  MAX_PLACE_PHOTOS,
  distinctPlacePhotoUris,
  placePhotoSet,
} from '../lib/placePhotos';

const five = Array.from({ length: 5 }, (_, index) => `https://photos.test/place-${index + 1}.jpg`);
const inventory = placePhotoSet({ photos: five, source: 'candidate' });
assert.equal(inventory.photos.length, MAX_PLACE_PHOTOS);
assert.equal(inventory.primary, five[0]);
assert.deepEqual(inventory.photos, five, 'stable provider/search ordering is preserved');

const one = placePhotoSet({ photos: [five[0]], source: 'provider' });
assert.equal(one.photos.length, 1, 'one real image remains an honest 1/1 gallery');

const deduped = distinctPlacePhotoUris([
  'https://maps.googleapis.com/maps/api/place/photo?photo_reference=abc&maxwidth=400',
  'https://maps.googleapis.com/maps/api/place/photo?maxwidth=1000&photo_reference=abc',
  five[1],
  five[1],
  ...five.slice(2),
  'https://photos.test/ignored-sixth.jpg',
]);
assert.equal(deduped.length, 5);
assert.equal(deduped[0].includes('maxwidth=400'), true, 'first usable representation wins');
assert.equal(deduped.filter((uri) => uri.includes('photo_reference=abc')).length, 1);
assert.deepEqual(deduped.slice(1), five.slice(1), 'dedupe does not reorder distinct photos');

console.log('PASS canonical up-to-five photo inventory, stable ordering, provider-reference dedupe, and honest 1/1');
