import assert from 'node:assert/strict';

import {
  canonicalFacebookVideoUrl,
  inspectFacebookUrl,
  planFacebookDiscoveredCanonicalUrl,
} from '../lib/shareAgent/facebookUrl';
import { normalizeShareUrl } from '../lib/shareAgent/tiktokUrl';
import { detectPlatform } from '../supabase/functions/process-share-link/platform/detectPlatform';

const VIDEO_ID = '1234567890123456';
const CANONICAL = `https://www.facebook.com/reel/${VIDEO_ID}/`;

const equivalent = [
  `https://www.facebook.com/reel/${VIDEO_ID}/?fbclid=abc&mibextid=xyz`,
  `https://www.facebook.com/reels/${VIDEO_ID}`,
  `https://www.facebook.com/watch/?v=${VIDEO_ID}&fbclid=abc`,
  `https://m.facebook.com/watch/live/?v=${VIDEO_ID}&ref=share`,
  `https://www.facebook.com/video.php?v=${VIDEO_ID}&fref=nf`,
  `https://www.facebook.com/NearrPage/videos/${VIDEO_ID}/?utm_source=share`,
  `https://web.facebook.com/NearrPage/videos/vb.999999/${VIDEO_ID}/`,
];

for (const input of equivalent) {
  const inspected = inspectFacebookUrl(input);
  assert.equal(inspected?.supported, true, input);
  assert.equal(inspected?.contentId, VIDEO_ID, input);
  assert.equal(inspected?.canonicalUrl, CANONICAL, input);
  assert.equal(normalizeShareUrl(input).url, CANONICAL, input);
}

assert.equal(canonicalFacebookVideoUrl('not-an-id'), null);
assert.equal(
  inspectFacebookUrl(`https://www.facebook.com/reel/${VIDEO_ID}9/`)?.canonicalUrl,
  `https://www.facebook.com/reel/${VIDEO_ID}9/`,
  'different videos remain distinct',
);

const short = inspectFacebookUrl('https://fb.watch/abcDEF123/?mibextid=share');
assert.equal(short?.supported, true);
assert.equal(short?.kind, 'short_redirect');
assert.equal(short?.needsRedirectResolution, true);
assert.equal(short?.canonicalUrl, 'https://fb.watch/abcDEF123/');

for (const family of ['r', 'v', 'p']) {
  const share = inspectFacebookUrl(`https://www.facebook.com/share/${family}/abcDEF123/?mibextid=foo`);
  assert.equal(share?.supported, true);
  assert.equal(share?.kind, 'share_redirect');
  assert.equal(share?.needsRedirectResolution, true);
  assert.equal(share?.canonicalUrl, `https://www.facebook.com/share/${family}/abcDEF123/`);
}

const post = inspectFacebookUrl(
  'https://m.facebook.com/nearr/posts/pfbid0abcDEF123456789/?fbclid=tracking',
);
assert.equal(post?.supported, true);
assert.equal(post?.kind, 'post');
assert.equal(post?.creatorOrPage, 'nearr');
assert.equal(
  post?.canonicalUrl,
  'https://www.facebook.com/nearr/posts/pfbid0abcDEF123456789/',
);

const story = inspectFacebookUrl(
  'https://www.facebook.com/story.php?id=100064860875397&story_fbid=1234567890123456&mibextid=x',
);
assert.equal(story?.supported, true);
assert.equal(
  story?.canonicalUrl,
  'https://www.facebook.com/story.php?story_fbid=1234567890123456&id=100064860875397',
);

for (const unsupported of [
  'https://www.facebook.com/',
  'https://www.facebook.com/reels/',
  'https://www.facebook.com/watch/',
  'https://www.facebook.com/NearrPage/',
]) {
  assert.equal(inspectFacebookUrl(unsupported)?.supported, false, unsupported);
}

assert.equal(inspectFacebookUrl('https://evil.example/reel/123456'), null);
assert.equal(detectPlatform('https://notfacebook.com/reel/123456'), 'genericWeb');
assert.equal(detectPlatform(CANONICAL), 'facebook');

assert.deepEqual(
  planFacebookDiscoveredCanonicalUrl(
    'https://fb.watch/abcDEF123/',
    `https://www.facebook.com/NearrPage/videos/${VIDEO_ID}/`,
  ),
  { canonicalUrl: CANONICAL, accepted: true, reason: 'exact_content' },
);
assert.deepEqual(
  planFacebookDiscoveredCanonicalUrl(
    CANONICAL,
    'https://www.facebook.com/reel/9999999999999999/',
  ),
  { canonicalUrl: CANONICAL, accepted: false, reason: 'video_id_mismatch' },
);

console.log(`${equivalent.length + 22} Facebook URL assertions passed.`);
