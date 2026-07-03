/**
 * scripts/testTiktokUrl.ts
 *
 * Pure-unit assertions for the TikTok / share URL normalizer in
 * lib/shareAgent/tiktokUrl.ts. Covers Phase 2 (URL normalization) of the
 * TikTok-share fix: canonical stability, tracking-param stripping,
 * short-link classification, Instagram non-regression, and malformed
 * input safety. Redirect FOLLOWING (short → canonical) is a network
 * concern handled server-side and is NOT exercised here.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testTiktokUrl.ts
 */

import {
  normalizeShareUrl,
  isTikTokUrl,
  isTikTokShortLink,
  buildTikTokOEmbedUrl,
} from '../lib/shareAgent/tiktokUrl';

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
// A. Canonical TikTok URL — tracking stripped, canonical preserved
// ---------------------------------------------------------------------------
{
  const r = normalizeShareUrl(
    'https://www.tiktok.com/@user/video/7212345678901234567?is_from_webapp=1&sender_device=pc&_r=1&_t=abc',
  );
  check('A1 canonical platform=tiktok', r.platform === 'tiktok', r.platform);
  check(
    'A2 canonical url tracking stripped',
    r.url === 'https://www.tiktok.com/@user/video/7212345678901234567',
    r.url,
  );
  check('A3 canonical not a short link', r.isShortLink === false);
  check('A4 canonical wasModified', r.wasModified === true);
}
{
  // Already-clean canonical URL is stable (idempotent, no spurious change).
  const clean = 'https://www.tiktok.com/@user/video/7212345678901234567';
  const r = normalizeShareUrl(clean);
  check('A5 clean canonical idempotent', r.url === clean, r.url);
  check('A6 clean canonical wasModified=false', r.wasModified === false);
}

// ---------------------------------------------------------------------------
// B. vm.tiktok.com short link — classified as short link (redirect-resolve)
// ---------------------------------------------------------------------------
{
  const r = normalizeShareUrl('https://vm.tiktok.com/ZMabc123/');
  check('B1 vm platform=tiktok', r.platform === 'tiktok', r.platform);
  check('B2 vm isShortLink=true', r.isShortLink === true);
  check('B3 isTikTokShortLink helper', isTikTokShortLink('https://vm.tiktok.com/ZMabc123/'));
}

// ---------------------------------------------------------------------------
// C. vt.tiktok.com short link — classified as short link
// ---------------------------------------------------------------------------
{
  const r = normalizeShareUrl('https://vt.tiktok.com/ZSabc123/?_t=xyz&_r=1');
  check('C1 vt platform=tiktok', r.platform === 'tiktok', r.platform);
  check('C2 vt isShortLink=true', r.isShortLink === true);
  check(
    'C3 vt tracking stripped but path kept',
    r.url === 'https://vt.tiktok.com/ZSabc123/',
    r.url,
  );
}

// tiktok.com/t/<code> is also a short form.
{
  const r = normalizeShareUrl('https://www.tiktok.com/t/ZTabc123/');
  check('C4 /t/ path isShortLink=true', r.isShortLink === true, r.url);
}

// ---------------------------------------------------------------------------
// H. Host casing + m.tiktok.com normalized; helpers
// ---------------------------------------------------------------------------
{
  const r = normalizeShareUrl('https://M.TikTok.com/@user/video/7212345678901234567');
  check('H1 host lowercased', r.host === 'm.tiktok.com', r.host ?? 'null');
  check('H2 isTikTokUrl helper', isTikTokUrl('https://www.tiktok.com/@u/video/1'));
  check(
    'H3 oembed url built + encoded',
    buildTikTokOEmbedUrl('https://www.tiktok.com/@u/video/1') ===
      'https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40u%2Fvideo%2F1',
    buildTikTokOEmbedUrl('https://www.tiktok.com/@u/video/1'),
  );
}

// ---------------------------------------------------------------------------
// I. Instagram non-regression — platform detected, only tracking stripped
// ---------------------------------------------------------------------------
{
  const r = normalizeShareUrl('https://www.instagram.com/p/Cabc123/?igshid=xyz&utm_source=ig_web');
  check('I1 instagram platform', r.platform === 'instagram', r.platform);
  check(
    'I2 instagram tracking stripped, path kept',
    r.url === 'https://www.instagram.com/p/Cabc123/',
    r.url,
  );
  check('I3 instagram not short link', r.isShortLink === false);
}

// ---------------------------------------------------------------------------
// Malformed / non-URL input never throws and is returned verbatim
// ---------------------------------------------------------------------------
{
  const r = normalizeShareUrl('not a url at all');
  check('M1 malformed platform=unknown', r.platform === 'unknown', r.platform);
  check('M2 malformed url passthrough', r.url === 'not a url at all', r.url);
  check('M3 malformed host=null', r.host === null);
}
{
  const r = normalizeShareUrl('');
  check('M4 empty input safe', r.url === '' && r.platform === 'unknown');
}
{
  const r = normalizeShareUrl('javascript:alert(1)');
  check('M5 non-http scheme rejected as unknown', r.platform === 'unknown', r.platform);
}

// Generic link: utm_* stripped, other params kept.
{
  const r = normalizeShareUrl('https://example.com/page?utm_source=x&keep=1');
  check(
    'G1 generic utm stripped, keep preserved',
    r.url === 'https://example.com/page?keep=1',
    r.url,
  );
  check('G2 generic platform=other', r.platform === 'other', r.platform);
}

// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  console.log('All TikTok URL normalization assertions passed.');
}
