import assert from 'node:assert/strict';

import { buildPlaceShareContent, resolveShareTarget } from '../lib/placeShare';

const place = {
  name: 'Los de Juarez Burritos',
  formatted_address: '1101 W Lincoln Ave, Anaheim, CA 92805, USA',
  google_place_id: 'gp-los-de-juarez',
  google_maps_url: 'https://maps.google.com/?cid=123',
  latitude: 33.83,
  longitude: -117.93,
};

// ---- original Instagram URL takes priority ---------------------------------
{
  const target = resolveShareTarget(place, {
    source_type: 'instagram',
    source_url: 'https://www.instagram.com/reel/DUWyZkfgbT4/',
  });
  assert.equal(target.kind, 'original_post');
  assert.equal(target.url, 'https://www.instagram.com/reel/DUWyZkfgbT4/');
  assert.equal(target.platform, 'instagram');

  const content = buildPlaceShareContent(place, {
    source_type: 'instagram',
    source_url: 'https://www.instagram.com/reel/DUWyZkfgbT4/',
  });
  assert.ok(content.message.includes('instagram.com/reel/DUWyZkfgbT4'), 'shares the post');
  assert.ok(!content.message.includes('maps.google.com'), 'does not fall back to Maps');
}

// ---- original TikTok URL takes priority ------------------------------------
{
  const target = resolveShareTarget(place, {
    source_type: 'tiktok',
    source_url: 'https://www.tiktok.com/@nearr/video/7300000000000000000',
  });
  assert.equal(target.kind, 'original_post');
  assert.equal(target.platform, 'tiktok');
  assert.ok(target.url?.includes('tiktok.com'));
}

// A stored generic link source still beats the provider URL.
{
  const target = resolveShareTarget(place, {
    source_type: 'link',
    source_url: 'https://example.com/a-post',
  });
  assert.equal(target.kind, 'original_post');
  assert.equal(target.url, 'https://example.com/a-post');
}

// ---- Google Maps falls back when source absent ------------------------------
for (const source of [
  { source_type: 'manual' as const, source_url: null },
  { source_type: null, source_url: null },
  { source_type: 'instagram' as const, source_url: '   ' },
  undefined,
]) {
  const target = resolveShareTarget(place, source);
  assert.equal(target.kind, 'provider', `provider fallback for ${JSON.stringify(source)}`);
  assert.ok(target.url?.includes('google'), 'falls back to the public Maps link');
}

// ---- never share temporary media / signed provider URLs --------------------
const unsafeSources = [
  'https://scontent.cdninstagram.com/v/t66.30100-16/abc.mp4?_nc_ht=x&oe=1&signature=zzz',
  'https://v16-webapp.tiktok.com/video/tos/useast/abc/?a=1&signature=deadbeef',
  'https://storage.googleapis.com/nearr-media/tmp/clip.mp4?X-Goog-Signature=abc',
  'https://example.supabase.co/storage/v1/object/sign/media/x.mp4?token=abc',
  'http://insecure.example.com/post',
];
for (const url of unsafeSources) {
  const target = resolveShareTarget(place, { source_type: 'instagram', source_url: url });
  assert.equal(target.kind, 'provider', `must not share ${url}`);
  assert.ok(!target.url?.includes('signature'), 'no signed URL is shared');
  assert.ok(!target.url?.includes('token'), 'no token is shared');
}

// ---- payload never leaks private fields ------------------------------------
{
  const content = buildPlaceShareContent(place, {
    source_type: 'instagram',
    source_url: 'https://www.instagram.com/reel/ABC/',
  });
  assert.ok(content.message.includes('Los de Juarez Burritos'), 'names the place');
  assert.ok(!/notes|reminder|user_id|saved_place/i.test(content.message));
  assert.equal(content.title, 'Los de Juarez Burritos');
}

// A place with no provider URL and no source still returns usable content.
{
  const bare = buildPlaceShareContent({ name: 'Somewhere' });
  assert.equal(bare.title, 'Somewhere');
  assert.ok(bare.message.includes('Somewhere'));
}

console.log('PASS place share prefers the original social post and falls back to Maps safely');
