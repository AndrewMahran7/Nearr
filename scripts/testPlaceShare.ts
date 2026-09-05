import assert from 'node:assert/strict';

import { buildSavedPlaceShareContent } from '../lib/placeShare';

const providerPlace = {
  id: '7b98ca4a-52be-4d48-9886-5d95e165b722',
  name: 'Blue Bottle Coffee',
  formatted_address: '66 Mint St, San Francisco, CA 94103',
  google_place_id: 'ChIJ-abc123',
  google_maps_url: null,
  latitude: 37.7825,
  longitude: -122.4066,
};

const manual = buildSavedPlaceShareContent({
  source_type: 'manual',
  source_url: null,
  place: providerPlace,
});
assert.equal(manual.title, 'Blue Bottle Coffee');
assert.equal(manual.kind, 'nearr_place');
assert.equal(manual.url, 'https://nearrapp.com/p/7b98ca4a-52be-4d48-9886-5d95e165b722');
assert.ok(manual.message.includes('Blue Bottle Coffee'));
assert.ok(manual.message.includes('https://nearrapp.com/p/7b98ca4a-52be-4d48-9886-5d95e165b722'));
assert.ok(!manual.message.includes('ChIJ-abc123'));
assert.ok(!manual.message.includes('66 Mint St'), 'payload stays minimal');

const polluted = buildSavedPlaceShareContent({
  source_type: 'instagram',
  source_url: 'https://www.instagram.com/p/PublicPost/',
  place: {
    ...providerPlace,
    notes: 'private note',
    ai_note: 'private AI note',
    user_id: 'user-secret',
    saved_place_id: 'saved-secret',
    confidence: 0.99,
  } as typeof providerPlace,
} as Parameters<typeof buildSavedPlaceShareContent>[0]);
const serialized = JSON.stringify(polluted).toLowerCase();
for (const secret of ['private note', 'private ai note', 'user-secret', 'saved-secret', 'confidence']) {
  assert.ok(!serialized.includes(secret), `${secret} is private`);
}

const unavailable = buildSavedPlaceShareContent({
  source_type: null,
  source_url: null,
  place: { name: null, formatted_address: null },
});
assert.equal(unavailable.kind, 'unavailable');
assert.equal(unavailable.url, null);

console.log('PASS canonical Nearr share payload, privacy, and unavailable state');
