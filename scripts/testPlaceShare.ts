/**
 * scripts/testPlaceShare.ts
 *
 * Unit tests for lib/placeShare.ts — the ordinary place-share payload builder.
 * The most important guarantee is the security one: the outgoing payload must
 * NOT contain any private field (notes, user id, saved_place id, source URL,
 * reminder settings, analytics).
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testPlaceShare.ts
 */

import { buildPlaceShareContent, type ShareablePlace } from '../lib/placeShare';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---- happy path ------------------------------------------------------------
const full = buildPlaceShareContent({
  name: 'Blue Bottle Coffee',
  formatted_address: '66 Mint St, San Francisco, CA 94103',
  google_place_id: 'ChIJ-abc123',
  latitude: 37.7825,
  longitude: -122.4066,
});
check('title is the place name', full.title === 'Blue Bottle Coffee');
check('message includes name', full.message.includes('Blue Bottle Coffee'));
check('message includes address', full.message.includes('66 Mint St'));
check('message includes a google maps link', /https:\/\/www\.google\.com\/maps/.test(full.message));
check('url is a public google maps link', !!full.url && full.url.startsWith('https://www.google.com/maps'));
check('public place id may appear in the maps link', full.url!.includes('ChIJ-abc123'));

// ---- SECURITY: no private fields leak -------------------------------------
// Simulate a caller that (wrongly) carries extra private fields. The builder's
// typed surface only reads public fields, so none of these can appear. We cast
// through `unknown` to model an over-broad object at the call site.
const pollutedInput = {
  name: 'Secret Spot',
  formatted_address: '1 Private Way',
  google_place_id: 'ChIJ-secret',
  latitude: 1,
  longitude: 2,
  notes: 'my private note about this place',
  user_id: 'user-uuid-1234',
  saved_place_id: 'saved-uuid-5678',
  source_url: 'https://instagram.com/p/private',
} as unknown as ShareablePlace;
const withPrivate = buildPlaceShareContent(pollutedInput);
const serialized = JSON.stringify(withPrivate).toLowerCase();
check('no private note in payload', !serialized.includes('private note'));
check('no user id in payload', !serialized.includes('user-uuid-1234'));
check('no saved_place id in payload', !serialized.includes('saved-uuid-5678'));
check('no source url in payload', !serialized.includes('instagram.com'));

// ---- defensive: missing fields --------------------------------------------
const nameless = buildPlaceShareContent({ name: null, formatted_address: null });
check('nameless place falls back to a generic title', nameless.title === 'A place');
check('nameless place still produces a message', nameless.message.length > 0);

const addressOnly = buildPlaceShareContent({
  name: 'Corner Store',
  formatted_address: '',
  latitude: 40.0,
  longitude: -73.0,
});
check('empty address is omitted (no blank line)', !addressOnly.message.includes('\n\n'));
check('coords still yield a maps link', !!addressOnly.url);

if (failures > 0) {
  console.error(`\n${failures} place-share test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll place-share tests passed.');
