import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildNativePlaceSharePayload,
  buildSavedPlaceShareContent,
} from '../lib/placeShare';

const publicId = '7b98ca4a-52be-4d48-9886-5d95e165b722';
const referralId = 'r_AbCdEfGhIjKlMnOpQrStUvWx';
const canonicalUrl = `https://nearrapp.com/p/${publicId}?ref=${referralId}`;
const exactMessage = 'Mirador es Vedrà 📍\nFound this on Nearr — tap to see it and save it to your map.';

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

const providerPlace = {
  id: publicId,
  name: 'Mirador es Vedrà',
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
}, referralId);
assert.equal(manual.title, 'Mirador es Vedrà');
assert.equal(manual.kind, 'nearr_place');
assert.equal(manual.url, canonicalUrl);
assert.equal(manual.message, exactMessage);
assert.ok(manual.message.includes('Mirador es Vedrà'), 'canonical display name and diacritics survive');
assert.ok(manual.message.includes('📍'));
assert.ok(manual.message.includes('Found this on Nearr — tap to see it and save it to your map.'));
assert.ok(!manual.message.includes(canonicalUrl), 'message does not duplicate the URL attachment');
assert.doesNotMatch(manual.message, /https?:\/\//);
assert.ok(!manual.message.includes('ChIJ-abc123'));
assert.ok(!manual.message.includes('66 Mint St'), 'payload stays minimal');

const iosPayload = buildNativePlaceSharePayload(manual, 'ios');
assert.deepEqual(iosPayload, { title: 'Mirador es Vedrà', message: exactMessage, url: canonicalUrl });
assert.equal(occurrences(JSON.stringify(iosPayload), canonicalUrl), 1, 'iOS payload contains one URL');
assert.equal(occurrences(JSON.stringify(iosPayload), 'ref='), 1, 'iOS payload contains one referral');

const androidPayload = buildNativePlaceSharePayload(manual, 'android');
assert.equal(androidPayload.url, undefined, 'Android does not rely on the unsupported URL attachment');
assert.equal(androidPayload.message, `${exactMessage}\n\n${canonicalUrl}`);
assert.equal(occurrences(JSON.stringify(androidPayload), canonicalUrl), 1, 'Android payload contains one URL');
assert.equal(occurrences(JSON.stringify(androidPayload), 'ref='), 1, 'Android payload contains one referral');

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
} as Parameters<typeof buildSavedPlaceShareContent>[0], referralId);
const serialized = JSON.stringify(polluted).toLowerCase();
for (const secret of ['private note', 'private ai note', 'user-secret', 'saved-secret', 'confidence']) {
  assert.ok(!serialized.includes(secret), `${secret} is private`);
}
assert.equal(polluted.url, canonicalUrl, 'a source social URL never replaces the canonical Nearr URL');
assert.ok(!serialized.includes('instagram.com'));

const withoutReferral = buildSavedPlaceShareContent({
  source_type: 'manual',
  source_url: null,
  place: providerPlace,
});
assert.equal(withoutReferral.url, `https://nearrapp.com/p/${publicId}`);
assert.equal(occurrences(JSON.stringify(buildNativePlaceSharePayload(withoutReferral, 'ios')), withoutReferral.url), 1);

const unavailable = buildSavedPlaceShareContent({
  source_type: null,
  source_url: null,
  place: { name: null, formatted_address: null },
});
assert.equal(unavailable.kind, 'unavailable');
assert.equal(unavailable.url, null);

const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
const shareAction = detail.slice(detail.indexOf('async function sharePlace'), detail.indexOf('async function handleSave'));
assert.equal(occurrences(shareAction, 'createPublicPlaceShare('), 1, 'one share action creates one referral/share row');
assert.equal(occurrences(shareAction, "trackEvent('place_shared'"), 1, 'one share action emits place_shared once');
assert.match(shareAction, /buildNativePlaceSharePayload\(content, Platform\.OS\)/);

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260905000003_public_place_sharing.sql'),
  'utf8',
);
const createShareFunction = migration.slice(
  migration.indexOf('create or replace function public.create_public_place_share'),
  migration.indexOf('revoke all on function public.create_public_place_share'),
);
assert.equal(occurrences(createShareFunction, 'insert into public.public_place_shares'), 1);
assert.equal(occurrences(createShareFunction, "'place_link_created'"), 1, 'place_link_created remains exactly once');

console.log('PASS clean single-link iOS and Android place-share payload, referral, privacy, and one-action contracts');
