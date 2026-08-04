import assert from 'node:assert/strict';
import {
  mapPlacesV1Candidate,
  PLACES_SEARCH_FIELD_MASK,
} from '../supabase/functions/process-share-link/places/googlePlaces';

for (const field of [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.shortFormattedAddress', 'places.location', 'places.primaryType',
  'places.primaryTypeDisplayName', 'places.types', 'places.businessStatus', 'places.photos',
]) assert.ok(PLACES_SEARCH_FIELD_MASK.split(',').includes(field), `requests ${field}`);

const mapped = mapPlacesV1Candidate({
  id: 'google-hotel',
  displayName: { text: 'Nearr Hotel' },
  formattedAddress: '1 Main St, Los Angeles, CA',
  shortFormattedAddress: '1 Main St',
  location: { latitude: 34, longitude: -118 },
  primaryType: 'hotel',
  primaryTypeDisplayName: { text: 'Hotel' },
  types: ['hotel', 'lodging'],
  businessStatus: 'OPERATIONAL',
  photos: [{ name: 'places/google-hotel/photos/1' }],
});
assert.equal(mapped.googlePlaceId, 'google-hotel');
assert.equal(mapped.primaryType, 'hotel');
assert.equal(mapped.googleMapsTypeLabel, 'Hotel');
assert.deepEqual(mapped.types, ['hotel', 'lodging']);
assert.equal(mapped.latitude, 34);

console.log('PASS Google Places v1 field contract');