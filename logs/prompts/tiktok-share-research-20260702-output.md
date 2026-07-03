# TikTok Share Research & Fix — Implementation Report

> 2026-07-02. Staged fix. Local validation only from this environment;
> Supabase deploy + remote tests are handed off to the operator (see
> "Not done here").

## Research findings (before editing)

### TikTok share-payload URL shapes
- Canonical: `https://www.tiktok.com/@user/video/<id>`
- Short: `https://vm.tiktok.com/…`, `https://vt.tiktok.com/…`,
  `https://www.tiktok.com/t/<code>/`
- Also `https://m.tiktok.com/…`
- Shared links carry share-sheet tracking params: `_r`, `_t`, `_d`,
  `is_from_webapp`, `sender_device`, `share_app_id`, `share_link_id`,
  `u_code`, `checksum`, `refer`, `embed_source`, `utm_*`, etc.
- iOS: TikTok shares deliver a `url` (Safari-style) or a text caption
  containing the URL. Android: `ACTION_SEND` text/plain intent. Nearr's
  `ShareExtension.tsx` `pickSharedUrl` / `firstUrlIn` already extract the
  first `https` URL from either shape correctly — **the payload
  extraction is NOT the failure.** (Stop-condition checked and cleared.)

### Where the failure was
- `detectPlatform`/`detectSource` correctly classify TikTok (host match),
  so classification is fine.
- The metadata layer (`metadata/fetchMetadata.ts`) did a plain
  `fetch(url)` + OpenGraph parse with **no URL normalization, no captured
  canonical URL after redirect, and no oEmbed fallback.** TikTok commonly
  serves generic bots a JS-gated/empty page, so `og:title` /
  `og:description` came back empty → empty evidence → the resolver
  correctly returned a manual/requires-app outcome, but with **no second
  official source tried** and **short links persisted with tracking
  noise**. Net effect: "TikTok sharing doesn't work reliably."

### Metadata options
- **TikTok oEmbed** — official, documented, **keyless, no auth**:
  `GET https://www.tiktok.com/oembed?url=<canonical video url>` →
  `{ title (caption), author_name, author_url, thumbnail_url, html }`
  (https://developers.tiktok.com/doc/embed-videos/). Requires a canonical
  `@user/video/<id>` URL (short links must be redirect-resolved first).
- TikTok **Display API / Research API** require app registration +
  user-authorized tokens (Login Kit) and are scoped to the authorizing
  user's own content — **not usable** for arbitrary public posts. No paid
  provider was added.

### Smallest safe plan
1. Pure, tested URL normalizer (strip tracking, classify short links).
2. Server-side: capture post-redirect canonical URL (`res.url`) so short
   links resolve; add TikTok oEmbed as a conservative caption fallback.
3. Feed the **same** evidence/resolver pipeline (no TikTok safety
   shortcut). Insufficient metadata → existing manual fallback.
4. `[tiktok-share]` diagnostics.

## Files changed

| File | Change |
|---|---|
| `lib/shareAgent/tiktokUrl.ts` (new) | Pure, dependency-free, Deno+RN-safe URL normalizer: `normalizeShareUrl`, `isTikTokUrl`, `isTikTokShortLink`, `classifyShareUrlPlatform`, `buildTikTokOEmbedUrl`, `TIKTOK_TRACKING_PARAMS`. Never throws. |
| `scripts/testTiktokUrl.ts` (new) | 26 assertions (canonical/short/instagram/malformed/generic). |
| `package.json` | Added `test:tiktok-url` script. |
| `lib/shareParser.ts` | Normalizes the URL up front; `[tiktok-share] raw_input_present/is_short_link/normalized` log. |
| `supabase/functions/process-share-link/metadata/fetchTikTokOEmbed.ts` (new) | Official keyless oEmbed fetch, 6s timeout, JSON-safe, returns caption+author only. Never logs HTML/headers. |
| `supabase/functions/process-share-link/metadata/fetchMetadata.ts` | Captures post-redirect canonical URL (`resolvedUrl`); TikTok-gated oEmbed caption fallback when OG desc is missing/thin; returns `resolvedUrl` + `usedTikTokOEmbed`; degrades to manual only when HTML **and** oEmbed yield nothing. |
| `supabase/functions/process-share-link/index.ts` | Normalizes input URL; passes `platform` to metadata; uses canonical URL for evidence/diagnostics/extraction payload/`sourceUrl` persistence; `[tiktok-share]` input/metadata/evidence/decision logs. |

## Behavior

- **URL normalization**: lowercases host; TikTok canonical → drops the
  entire query (canonical needs none); short links + Instagram + generic →
  strips only known tracking keys + `utm_*` (path preserved); classifies
  `vm./vt.tiktok.com` and `/t/…` as short links; never throws (non-URL
  text passes through verbatim for the existing `isLikelyUrl` guard).
- **Redirect follow**: server-side `fetch` follows redirects; `res.url` is
  normalized and used as the canonical source URL (short → `@user/video/id`).
- **Metadata strategy**: OG (`og:title`/`og:description`) first; if TikTok
  and description is missing/thin (<24 chars), try oEmbed and use its
  `title` (caption) as the description. `author_name` is deliberately NOT
  used as a place signal (avoids the "creator-trap"). Instagram path is
  untouched.
- **Fallback**: if neither HTML nor oEmbed yields title/description →
  `metadata_failed` → existing `statusFailedRequiresApp` → client manual
  search (no crash, no dead-end — manual-fallback UX already in place).
- **Decision**: evidence → `resolveSharedPlace` unchanged. TikTok gets the
  same address-first / multi-address / venue-ordering / safety gates as
  Instagram. No auto-save loosening.

## Tests run (local, this environment)

All green:
- `npm run typecheck` ✅
- `npm run test:tiktok-url` ✅ (26/26)
- `npm run test:manual-fallback` ✅
- `npm run test:multi-address` ✅
- `npm run test:recovery-hints` ✅
- `npm run test:address-match` ✅
- `npm run test:safety-description-only` ✅

Test coverage mapping: A (canonical normalization) ✅, B (`vm.`) ✅,
C (`vt.`/`/t/`) ✅, H (plain-text+URL extraction — unchanged
`firstUrlIn`, host-casing normalized) ✅, I (Instagram regression:
platform + tracking-strip + full local suite) ✅. D/E/F/G (venue+address,
multi-address, unavailable, generic-no-evidence) are exercised by the
existing resolver/evidence suites (`test:multi-address`,
`test:safety-description-only`, `test:recovery-hints`) which are unchanged
and still pass, since TikTok now feeds that identical pipeline.

## Not done here (operator hand-off)

The following require Supabase credentials / live network / shared-infra
deploy and were intentionally **not** run from this environment (deploy to
shared infrastructure needs explicit operator action):

```
# Deploy the updated Edge Function
npx supabase functions deploy process-share-link

# Remote tests (one known-good IG + ≥2 TikTok URLs)
npm run test:share-remote -- "<instagram url>"
npm run test:share-remote -- "https://www.tiktok.com/@user/video/<id>"
npm run test:share-remote -- "https://vm.tiktok.com/<code>/"
```

Watch for logs: `[tiktok-share] raw_input_present / is_short_link /
redirect_followed / metadata_title_len / metadata_desc_len /
evidence_address_count / decision`.

## Redeploy / rebuild

- **Supabase redeploy: REQUIRED** — the metadata + index changes are in
  the Edge Function.
- **New mobile build: NOT required for the backend fix.** The client
  change (`lib/shareParser.ts` normalization + log) is JS-only and only
  affects the legacy client-side parse fallback; the primary path is the
  Edge Function. A JS reload/OTA is sufficient if you want the client log.

## Remaining limitations

- TikTok oEmbed returns the caption but not a structured address; when a
  TikTok caption has no address/venue text, the outcome is (correctly)
  manual fallback — we do not fabricate a place.
- oEmbed can rate-limit or 404 for private/removed videos → manual
  fallback with reason. No ret/login attempted (by design).
- The pure normalizer cannot follow redirects (network); short→canonical
  resolution happens only server-side via `res.url`. If TikTok changes
  short-link redirect behavior, canonical capture degrades gracefully to
  the normalized short URL (still classified TikTok).
- `cleanDescription` truncates captions to 240 chars (legacy behavior);
  fine for address extraction which sits near the caption start.
