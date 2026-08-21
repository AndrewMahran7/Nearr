/**
 * scripts/testPlatformUrlClassification.ts
 *
 * Pure-unit assertions for cross-platform share-URL classification:
 *   - `detectPlatform` / `legacySourceFor`
 *     (supabase/functions/process-share-link/platform/detectPlatform.ts)
 *   - `normalizeShareUrl` / `classifyShareUrlPlatform`
 *     (lib/shareAgent/tiktokUrl.ts)
 *
 * Covers the URL families from the cross-platform media-evidence expansion:
 * Instagram, TikTok, YouTube (incl. Shorts + youtu.be), Facebook (incl.
 * fb.watch), and Snapchat (Spotlight recognized; non-Spotlight/private forms
 * are NOT claimed as media-supported — see testSnapchatSpotlightScope below
 * and services/media-worker/tests/snapchatResolver.test.ts for the resolver-
 * level enforcement). TikTok's own normalization suite already lives in
 * scripts/testTiktokUrl.ts and is not duplicated here.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testPlatformUrlClassification.ts
 */

import { detectPlatform, legacySourceFor } from '../supabase/functions/process-share-link/platform/detectPlatform';
import { normalizeShareUrl, classifyShareUrlPlatform } from '../lib/shareAgent/tiktokUrl';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Instagram — non-regression
// ---------------------------------------------------------------------------
check('Instagram reel detected', detectPlatform('https://www.instagram.com/reel/Cabc123XYZ/') === 'instagram');
check('Instagram post detected', detectPlatform('https://instagram.com/p/Cabc123XYZ/') === 'instagram');
check('Instagram legacySource=instagram', legacySourceFor('instagram') === 'instagram');
{
  const r = normalizeShareUrl('https://www.instagram.com/reel/Cabc123XYZ/?igsh=abc123&utm_source=ig');
  check('Instagram classify=instagram', classifyShareUrlPlatform(r.host) === 'instagram');
  check('Instagram tracking stripped, path kept', r.url === 'https://www.instagram.com/reel/Cabc123XYZ/', r.url);
}

// ---------------------------------------------------------------------------
// TikTok — platform detection (normalization itself covered by testTiktokUrl.ts)
// ---------------------------------------------------------------------------
check('TikTok full URL detected', detectPlatform('https://www.tiktok.com/@user/video/7212345678901234567') === 'tiktok');
check('TikTok vm short link detected', detectPlatform('https://vm.tiktok.com/ZMabcdefg/') === 'tiktok');
check('TikTok vt short link detected', detectPlatform('https://vt.tiktok.com/ZMabcdefg/') === 'tiktok');
check('TikTok suffix spoof rejected', detectPlatform('https://eviltiktok.com/@user/video/1') === 'genericWeb');
check('TikTok in query text does not classify host', detectPlatform('https://example.com/?next=tiktok.com') === 'genericWeb');
check('TikTok legacySource=tiktok', legacySourceFor('tiktok') === 'tiktok');

// ---------------------------------------------------------------------------
// YouTube — /shorts/, youtu.be, /watch?v=, tracking params
// ---------------------------------------------------------------------------
check('YouTube /shorts/ detected', detectPlatform('https://www.youtube.com/shorts/dQw4w9WgXcQ') === 'youtube');
check('YouTube youtu.be detected', detectPlatform('https://youtu.be/dQw4w9WgXcQ') === 'youtube');
check('YouTube /watch?v= detected', detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'youtube');
check('YouTube legacySource=youtube', legacySourceFor('youtube') === 'youtube');
{
  const shorts = normalizeShareUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
  check('YouTube classify=youtube (shorts)', classifyShareUrlPlatform(shorts.host) === 'youtube');
  const short = normalizeShareUrl('https://youtu.be/dQw4w9WgXcQ');
  check('YouTube classify=youtube (youtu.be)', classifyShareUrlPlatform(short.host) === 'youtube');
  // Harmless share-tracking param (`si`) is already in the generic strip
  // list; the video id (`v`) is never touched.
  const tracked = normalizeShareUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123XYZ');
  check(
    'YouTube si= tracking stripped, v kept',
    tracked.url === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    tracked.url,
  );
}

// ---------------------------------------------------------------------------
// Facebook — /reel/, /.../videos/, fb.watch
// ---------------------------------------------------------------------------
check('Facebook /reel/ detected', detectPlatform('https://www.facebook.com/reel/1234567890123456/') === 'facebook');
check(
  'Facebook /.../videos/ detected',
  detectPlatform('https://www.facebook.com/SomePage/videos/1234567890123456/') === 'facebook',
);
check('Facebook fb.watch detected', detectPlatform('https://fb.watch/abcDEF123/') === 'facebook');
check('Facebook legacySource=facebook', legacySourceFor('facebook') === 'facebook');
{
  const r = normalizeShareUrl('https://www.facebook.com/reel/1234567890123456/?fbclid=abc&mibextid=xyz');
  check('Facebook classify=facebook', classifyShareUrlPlatform(r.host) === 'facebook');
  check(
    'Facebook tracking stripped, path kept',
    r.url === 'https://www.facebook.com/reel/1234567890123456/',
    r.url,
  );
}

// ---------------------------------------------------------------------------
// Snapchat — Spotlight recognized; non-Spotlight forms are classified but
// NOT claimed as media-supported (that gate lives in SnapchatMediaResolver's
// supports(), not here — see snapchatResolver.test.ts).
// ---------------------------------------------------------------------------
check(
  'Snapchat Spotlight detected',
  detectPlatform('https://www.snapchat.com/spotlight/W7_abc123XYZ') === 'snapchat',
);
check('Snapchat legacySource=snapchat', legacySourceFor('snapchat') === 'snapchat');
{
  const r = normalizeShareUrl('https://www.snapchat.com/spotlight/W7_abc123XYZ');
  check('Snapchat classify=snapchat', classifyShareUrlPlatform(r.host) === 'snapchat');
}
// A non-Spotlight Snapchat URL (profile / story) is still honestly labeled
// "snapchat" for source provenance — it is the resolver's supports() gate,
// not URL classification, that restricts media acquisition to `/spotlight/`.
check(
  'Snapchat profile URL still classified snapchat (media-support gate is separate)',
  detectPlatform('https://www.snapchat.com/add/someuser') === 'snapchat',
);

// ---------------------------------------------------------------------------
// Unsupported / malformed — deterministic, never silently misclassified
// ---------------------------------------------------------------------------
check('Unknown host falls to genericWeb', detectPlatform('https://example.com/some/page') === 'genericWeb');
check('Empty string is unknown', detectPlatform('') === 'unknown');
check('genericWeb legacySource=link', legacySourceFor('genericWeb') === 'link');
check('twitter legacySource=link (no dedicated source_type)', legacySourceFor('twitter') === 'link');

// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  console.log('All platform URL classification assertions passed.');
}
