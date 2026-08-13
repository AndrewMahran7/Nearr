import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildSavedPlaceShareContent,
  getSavedPlaceShareTarget,
  type SavedPlaceShareContext,
} from '../lib/placeShare';
import { planWrongPlaceCorrection, type CorrectionContext } from '../lib/wrongPlaceCorrection';

const place = {
  name: 'Los de Juarez Burritos',
  formatted_address: '1101 W Lincoln Ave, Anaheim, CA 92805, USA',
  google_place_id: 'gp-los-de-juarez',
  google_maps_url: 'https://www.google.com/maps/place/?q=Los+de+Juarez',
  latitude: 33.83,
  longitude: -117.93,
};

function saved(sourceUrl: string | null, sourceType = 'link'): SavedPlaceShareContext {
  return { source_type: sourceType, source_url: sourceUrl, place };
}

// Social originals beat a provider URL and normalize only safe tracking.
for (const [raw, expected, platform] of [
  ['https://www.instagram.com/reel/DUWyZkfgbT4/?igsh=secret&utm_source=share', 'https://www.instagram.com/reel/DUWyZkfgbT4/', 'instagram'],
  ['https://instagram.com/p/ABC123/?utm_medium=copy_link', 'https://instagram.com/p/ABC123/', 'instagram'],
  ['https://www.tiktok.com/@nearr/video/7300000000000000000?is_from_webapp=1&_t=abc', 'https://www.tiktok.com/@nearr/video/7300000000000000000', 'tiktok'],
  ['https://youtu.be/Video123?si=tracking', 'https://youtu.be/Video123', 'youtube'],
  ['https://x.com/nearr/status/1234567890?s=20', 'https://x.com/nearr/status/1234567890', 'twitter'],
] as const) {
  const target = getSavedPlaceShareTarget(saved(raw));
  assert.equal(target.kind, 'original_post', raw);
  assert.equal(target.platform, platform);
  assert.equal(target.url, expected);
  assert.ok(!target.url?.includes('google.com/maps'));
}

// A safe durable non-social page still beats Maps; ordinary tracking is removed.
{
  const target = getSavedPlaceShareTarget(saved('https://example.com/best-burritos?utm_source=ig&article=5'));
  assert.equal(target.kind, 'original_source');
  assert.equal(target.url, 'https://example.com/best-burritos?article=5');
}

// Temporary, credentialed, internal, worker, storage, API, and local URLs never leave the app.
const unsafeSources = [
  'https://scontent.cdninstagram.com/v/t66/clip.mp4?signature=zzz',
  'https://v16-webapp.tiktok.com/video/tos/useast/clip.mp4',
  'https://storage.googleapis.com/nearr-media/clip.mp4?X-Goog-Signature=abc',
  'https://project.supabase.co/storage/v1/object/sign/media/clip?token=abc',
  'https://media-worker-production.up.railway.app/fetch?id=1',
  'https://example.com/api/video/123',
  'https://api.example.com/place/123',
  'https://example.com/post?access_token=secret',
  'https://example.com/post?api_key=secret',
  'https://example.com/post?Expires=9999999999',
  'https://localhost:3000/post',
  'https://127.0.0.1/post',
  'http://www.instagram.com/reel/ABC/',
];
for (const sourceUrl of unsafeSources) {
  const target = getSavedPlaceShareTarget(saved(sourceUrl, 'instagram'));
  assert.equal(target.kind, 'provider', sourceUrl);
  assert.equal(target.url, place.google_maps_url);
}

// Invalid social profiles/endpoints are not downgraded into generic originals.
for (const sourceUrl of [
  'https://www.instagram.com/some-profile/',
  'https://www.tiktok.com/api/item/detail?id=1',
  'https://www.youtube.com/oembed?url=secret',
]) {
  assert.equal(getSavedPlaceShareTarget(saved(sourceUrl)).kind, 'provider');
}

// Missing source uses a validated provider URL, then coordinates when the stored URL is unsafe.
assert.equal(getSavedPlaceShareTarget(saved(null, 'manual')).url, place.google_maps_url);
assert.equal(
  getSavedPlaceShareTarget({
    source_type: 'manual', source_url: null,
    place: { ...place, google_maps_url: 'https://maps.google.com/?cid=123' },
  }).url,
  'https://maps.google.com/?cid=123',
);
{
  const target = getSavedPlaceShareTarget({
    source_type: 'manual',
    source_url: null,
    place: { ...place, google_maps_url: 'https://evil.example/maps?token=secret' },
  });
  assert.equal(target.kind, 'provider');
  assert.ok(target.url?.startsWith('https://www.google.com/maps/search/'));
  assert.ok(target.url?.includes('query_place_id=gp-los-de-juarez'));
}
assert.equal(
  getSavedPlaceShareTarget({ source_url: null, place: { name: null, formatted_address: null } }).kind,
  'unavailable',
);

// Correcting provider identity preserves the source selected by the resolver.
{
  const correction: CorrectionContext = {
    savedPlaceId: 'sp-1', ownerUserId: 'user-a', actingUserId: 'user-a', currentGooglePlaceId: 'wrong',
    userNote: null, sourceType: 'instagram', sourceUrl: 'https://www.instagram.com/reel/Original/',
    ruleVersion: null, aiNote: null, previousCategory: null, notificationsEnabled: false,
    radiusValue: null, radiusUnit: null, createdAt: '2026-08-01T00:00:00.000Z',
  };
  const plan = planWrongPlaceCorrection(correction, {
    googlePlaceId: 'correct', name: place.name, formattedAddress: place.formatted_address,
    latitude: place.latitude, longitude: place.longitude,
  });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    const target = getSavedPlaceShareTarget({
      source_type: plan.preserved.sourceType,
      source_url: plan.preserved.sourceUrl,
      place: { ...place, google_place_id: plan.replacement.googlePlaceId },
    });
    assert.equal(target.url, 'https://www.instagram.com/reel/Original/');
  }
}

// Auto-save and each logical multi-place row resolve from their own persisted source context.
const autoSaved = saved('https://www.tiktok.com/@food/video/7300000000000000001', 'tiktok');
assert.equal(getSavedPlaceShareTarget(autoSaved).platform, 'tiktok');
const multiRows = [
  saved('https://www.instagram.com/p/PostForRowOne/', 'instagram'),
  { ...saved('https://www.tiktok.com/@food/video/7300000000000000002', 'tiktok'), place: { ...place, google_place_id: 'row-two' } },
];
assert.equal(getSavedPlaceShareTarget(multiRows[0]!).url, 'https://www.instagram.com/p/PostForRowOne/');
assert.equal(getSavedPlaceShareTarget(multiRows[1]!).url, 'https://www.tiktok.com/@food/video/7300000000000000002');

// Production integration: one resolver, URL passed to native Share, no share-time rediscovery.
const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
const worker = readFileSync(join(process.cwd(), 'supabase/functions/process-share-jobs/index.ts'), 'utf8');
assert.match(detail, /buildSavedPlaceShareContent\(saved\)/);
assert.match(detail, /url: content\.url/);
assert.doesNotMatch(detail.slice(detail.indexOf('async function sharePlace'), detail.indexOf('async function handleSave')), /getShareJob|supabase|fetch\(/);
assert.match(worker, /p_source_url: canonicalUrl/, 'Phase 2 auto-save persists its original public source');

const content = buildSavedPlaceShareContent(saved('https://www.instagram.com/p/Public/'));
assert.ok(!/note|confidence|job|transcript|prompt|location/i.test(content.message));

console.log('PASS saved-place source priority, normalization, safety, correction, auto-save, and multi-place isolation');
