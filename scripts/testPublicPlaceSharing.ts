import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildNearrPlaceUrl, buildSavedPlaceShareContent } from '../lib/placeShare';

const publicId = '7b98ca4a-52be-4d48-9886-5d95e165b722';
const referralId = 'r_AbCdEfGhIjKlMnOpQrStUvWx';
const canonical = `https://nearrapp.com/p/${publicId}?ref=${referralId}`;

assert.equal(buildNearrPlaceUrl(publicId.toUpperCase(), referralId), canonical);
assert.equal(buildNearrPlaceUrl(publicId, 'saved-place-secret'), `https://nearrapp.com/p/${publicId}`);
assert.equal(buildNearrPlaceUrl('saved-place-secret', referralId), null);

const content = buildSavedPlaceShareContent({
  source_type: 'instagram',
  source_url: 'https://www.instagram.com/reel/OriginalPost/',
  place: {
    id: publicId,
    name: 'Night + Market',
    google_place_id: 'provider-secret',
    formatted_address: 'Private-ish provider payload',
  },
}, referralId);
assert.equal(content.kind, 'nearr_place');
assert.equal(content.url, canonical);
assert.equal(content.message, `Check out Night + Market on Nearr\n${canonical}`);
assert.doesNotMatch(content.message, /instagram|provider-secret|Private-ish/);

const root = process.cwd();
const migration = readFileSync(join(root, 'supabase/migrations/20260905000003_public_place_sharing.sql'), 'utf8');
const referralFix = readFileSync(join(root, 'supabase/migrations/20260905000004_public_place_ref_pgcrypto_schema.sql'), 'utf8');
const edge = readFileSync(join(root, 'supabase/functions/public-place/index.ts'), 'utf8');
const detail = readFileSync(join(root, 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
const publicRoute = readFileSync(join(root, 'app/p/[publicPlaceId].tsx'), 'utf8');
const authRouting = readFileSync(join(root, 'lib/postAuthRouting.ts'), 'utf8');
const account = readFileSync(join(root, 'app/(onboarding)/account.tsx'), 'utf8');
const appConfig = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));

assert.match(migration, /merged_into_place_id uuid/);
assert.match(migration, /durable public-link aliases/);
assert.match(migration, /on conflict \(user_id, place_id\) do nothing/i);
assert.match(migration, /place_saved_from_shared_link/);
assert.match(migration, /revoke all on public\.public_place_shares from public, anon, authenticated/);
assert.match(migration, /place_not_saved_by_sender/);
assert.match(referralFix, /extensions\.gen_random_bytes\(18\)/);

assert.match(edge, /place_link_opened/);
assert.match(edge, /shared_place_viewed/);
assert.match(edge, /shared_place_save_cta/);
assert.match(edge, /referralValid/);
assert.match(edge, /RATE_LIMIT = 90/);
assert.match(edge, /invalid_public_place_id|place_not_found/);
assert.match(edge, /CLOSED_PERMANENTLY/);
const dto = edge.slice(edge.lastIndexOf('return json({'));
for (const forbidden of ['created_by', 'user_id', 'saved_place', 'source_url', 'notes', 'ai_note']) {
  assert.ok(!dto.includes(forbidden), `public DTO excludes ${forbidden}`);
}

assert.match(detail, /createPublicPlaceShare\(saved\.place\.id/);
assert.match(detail, /buildSavedPlaceShareContent\([\s\S]{0,160}referralId/);
assert.match(detail, /Open original/i);
assert.match(publicRoute, /persistSharedPlaceIntent/);
assert.match(publicRoute, /saveSharedPlace/);
assert.match(publicRoute, /View on my map/);
assert.match(publicRoute, /Original video/);
assert.match(authRouting, /pendingSharedPlaceRoute/);
assert.match(account, /Save .*place/i);

assert.deepEqual(appConfig.expo.ios.associatedDomains, ['applinks:nearrapp.com']);
const filters = appConfig.expo.android.intentFilters as Array<Record<string, unknown>>;
assert.ok(filters.some((filter) => filter.autoVerify === true && JSON.stringify(filter).includes('\"pathPrefix\":\"/p/\"')));

console.log('PASS canonical public place links, privacy boundary, merge aliases, auth intent, idempotent save, attribution, and native association config');
