import assert from 'node:assert/strict';
import {
  mapPlacesLegacyCandidate,
  mapPlacesV1Candidate,
  PLACES_SEARCH_FIELD_MASK,
  searchPlaces,
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

const legacyMapped = mapPlacesLegacyCandidate({
  place_id: 'google-observatory',
  name: 'Griffith Observatory',
  formatted_address: '2800 E Observatory Rd, Los Angeles, CA',
  geometry: { location: { lat: 34.1184, lng: -118.3004 } },
  types: ['tourist_attraction', 'museum'],
  business_status: 'OPERATIONAL',
  photos: [{ photo_reference: 'legacy-photo-reference' }],
});
assert.equal(legacyMapped.googlePlaceId, 'google-observatory');
assert.equal(legacyMapped.primaryType, undefined, 'legacy types must not masquerade as Places API (New) primaryType');
assert.deepEqual(legacyMapped.types, ['tourist_attraction', 'museum']);
assert.equal(legacyMapped.businessStatus, 'OPERATIONAL');
assert.equal(legacyMapped.photos?.[0]?.name, 'legacy-photo-reference');

const originalFetch = globalThis.fetch;
const requests: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  requests.push(url);
  if (url.includes('places.googleapis.com/v1/places:searchText')) {
    return new Response(JSON.stringify({
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }],
      },
    }), { status: 403, headers: { 'content-type': 'application/json' } });
  }
  assert.match(url, /maps\.googleapis\.com\/maps\/api\/place\/textsearch\/json/);
  return new Response(JSON.stringify({
    status: 'OK',
    results: [{
      place_id: 'legacy-fallback-place',
      name: 'Fallback Place',
      formatted_address: '1 Main St, Los Angeles, CA',
      geometry: { location: { lat: 34, lng: -118 } },
      types: ['restaurant', 'food'],
      business_status: 'OPERATIONAL',
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

async function main(): Promise<void> {
  try {
    const fallback = await searchPlaces('Fallback Place', 'test-key');
    assert.equal(fallback.ok, true);
    assert.equal(fallback.ok ? fallback.results[0]?.googlePlaceId : null, 'legacy-fallback-place');
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('PASS Google Places v1 restricted-key fallback and field contracts');
}

void main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exit(1);
});
