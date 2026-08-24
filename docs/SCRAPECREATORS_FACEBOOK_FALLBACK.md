# ScrapeCreators Facebook fallback

Status: implementation and deterministic tests pass; production promotion is blocked on replenishing the authorized development provider credits and completing Nearr-Dev end-to-end proofs. No production deployment was performed.

## Current Facebook acquisition ladder

1. `create-share-job` and `process-share-jobs` classify Facebook hosts and reject unsupported profile/home URLs.
2. `lib/shareAgent/facebookUrl.ts` strips tracking parameters and normalizes numeric reel, watch, video, story, post, mobile, and shared URL forms. Opaque `fb.watch` and `/share/{r,v,p}/` tokens remain exact and are marked for server resolution.
3. Metadata fetch follows the public URL and rejects Facebook login/unavailable shells.
4. `FacebookFallbackMediaResolver` resolves opaque links through Facebook's bounded public Video Plugin and establishes the strongest available canonical numeric video ID.
5. A future recognition-cache lookup seam runs after canonical identity and before acquisition. Current `main` has no worker cache wiring.
6. Primary acquisition uses `FacebookMediaResolver` and the shared yt-dlp probe/download path.
7. If primary returns usable, ffprobe-validated video, processing continues and ScrapeCreators is not invoked.
8. If primary throws any acquisition `MediaError`, the task is not cancelled, and a canonical numeric Facebook video ID exists, one ScrapeCreators fallback is attempted.
9. Provider identity must exactly match the expected numeric video ID before any CDN download.
10. Direct `fbcdn.net` media is downloaded through the existing HTTPS, DNS, SSRF, redirect, byte, timeout, content-type, and ffprobe gates.
11. The existing platform-neutral transcript, frames, OCR, Gemini/Vayrin, Places, finalizer, honest-failure, and cleanup paths continue unchanged.

Primary provider/tool: `facebook/yt-dlp`.

Primary identity: numeric Facebook video ID extracted from canonical input, yt-dlp `id`, and yt-dlp `webpage_url`; conflicting values fail with `identity_mismatch`.

Primary failure classes include `authentication_required`, `private_or_unavailable`, `provider_changed`, `download_timeout`, `download_failed`, `provider_unavailable`, `provider_rate_limited`, `missing_video`, `invalid_media`, `file_too_large`, `duration_too_long`, `ssrf_blocked`, `redirect_limit`, and `identity_mismatch`. Cancellation never starts a paid call.

Retry behavior: the primary and paid provider each run once per resolver execution. Existing outer media-task retries remain bounded by the task row (normally three attempts). Deterministic fallback failures such as identity mismatch, malformed/no media, invalid media, size, duration, and unsupported multiple media are terminal; transient provider/CDN failures retain existing retry semantics.

Measured worker occupancy is the end-to-end acquisition leg, including download and ffprobe. On nine currently public fixtures, primary median occupancy was 5,870 ms. It succeeded on all nine public fixtures and failed on the unavailable control.

## Provider contract verified 2026-08-24

- Official endpoint: `GET https://api.scrapecreators.com/v1/facebook/post`
- Authentication: server-only `x-api-key: <SCRAPE_CREATORS_KEY>`
- Query: canonical public Facebook post/reel URL in `url`
- Credit price: one credit per live request; eligible cache hits can be zero credits
- Current documented concurrency guidance: no enforced rate limit; keep below 500 concurrent requests
- Media mode: response already contains direct `video.hd_url` and `video.sd_url`; there is no Facebook `download_media` parameter
- Stable fields: modern reels expose numeric `video.id`; legacy/watch responses can omit `video.id` but return the numeric video ID in `url`
- `post_id` is not the video identity for many modern reels and is never accepted as the sole match key
- Metadata: duration in `video.length_in_second`, author ID/name, caption/description, thumbnail, optional captions URL
- Direct media observed on `*.fbcdn.net`; provider-hosted permanent media was neither required nor selected
- HTTP 402 is mapped to `provider_unavailable/scrapecreators_credits_exhausted`, not to no-media

Official references:

- <https://docs.scrapecreators.com/v1/facebook/post/>
- <https://docs.scrapecreators.com/>
- <https://scrapecreators.com/>

## URL forms and canonical identity

Supported Nearr forms include:

- `facebook.com/reel/<numeric-id>` and `/reels/<numeric-id>`
- `facebook.com/watch/?v=<numeric-id>` and `/video.php?v=<numeric-id>`
- `facebook.com/<page>/videos/.../<numeric-id>`
- `m.facebook.com` and `web.facebook.com` variants
- `fb.watch/<token>`
- `facebook.com/share/{r,v,p}/<token>`
- exact post/story/permalink forms already supported by the primary path
- the above with known Facebook/UTM tracking parameters

Unsupported home/profile URLs remain rejected.

The canonical content identity for fallback is a 5-30 digit Facebook video ID and its source-of-record URL is `https://www.facebook.com/reel/<id>/`. For `fb.watch`, the public Video Plugin first establishes the numeric ID. The provider response is accepted only when every observed video-shaped identity (`video.id` and/or numeric ID in returned `url`) equals the expected ID. Caption, title, creator, `post_id`, and response order are not identity evidence.

Shared posts/carousels with an ambiguous multiple-media response return `unsupported_url/scrapecreators_facebook_multiple_media_unsupported`; Nearr does not select the first asset.

## Universal fallback rule

`platform === facebook && canonical numeric Facebook ID exists && primary produced no usable media && provider not already attempted` invokes ScrapeCreators once.

No content label blocks fallback. Cancellation and absence of canonical identity remain hard stops before paid usage. Provider identity mismatch, malformed response, unsafe URL/DNS, redirect overflow, invalid type/bytes/stream, ffprobe failure, oversize, and over-duration media remain hard stops after invocation.

## Fixture matrix

The first provider pass made 10 metadata calls: nine live public successes at one credit each and one unavailable HTTP 404 control at zero credits. A second full download/ffprobe pass completed three provider legs before the development balance returned HTTP 402. Signed CDN URLs were never printed or retained.

| URL class / identity | Primary | ScrapeCreators | Bytes | Duration | ffprobe | Full latency | Credits | Recognition |
|---|---|---|---:|---:|---|---:|---:|---|
| Official public Reel `1535656380759655` | success, exact ID | success, exact ID | 3,188,192 both | 23.4 s | video+audio | 9,080 / 3,360 ms | 1 | acquisition validated; live recognition not run |
| Public Reel `1356645589772949` | success, exact ID | success, exact ID | 5,975,661 both | 13.767 s | video+audio | 12,506 / 2,549 ms | 1 | acquisition validated; live recognition not run |
| Public Reel `1303365218449136` | success, exact ID | success, exact ID | 3,572,062 both | 13.0 s | video+audio | 6,813 / 4,504 ms | 1 | acquisition validated; live recognition not run |
| Public Reel `2349748325554244` | success, 10,163,975 bytes, 15.6 s | metadata success earlier; full replay blocked by 402 | not re-downloaded | 15.602 s reported | primary pass | 5,870 ms primary | 1 on metadata pass | not run |
| Tracking variant / `1313027950911844` | tracking stripped; success | metadata success earlier; full replay blocked by 402 | 5,515,693 primary | 19.2 s | primary pass | 4,999 ms primary | 1 on metadata pass | prior production reached finalizer; task did not rerun recognition here |
| Public Reel `3384429771712962` | success | metadata success earlier; full replay blocked by 402 | 3,045,824 primary | 10.967 s | primary pass | 4,756 ms primary | 1 on metadata pass | prior production reached finalizer; not rerun here |
| Minimal/short fixture `1052691990581061` | success | metadata success earlier; full replay blocked by 402 | 2,482,325 primary | 8.733 s | primary pass | 5,162 ms primary | 1 on metadata pass | prior production reached finalizer; caption minimality not independently confirmed |
| Historical `fb.watch/J8m9M2wynx` -> `1356645589772949` | success after canonicalization | metadata success with matching returned URL; canonical full provider leg above is byte-valid | 5,975,661 primary/canonical provider | 13.767 s | video+audio | 5,262 ms primary | 1 on metadata pass | not rerun |
| Canonical watch/longer `10153231379946729` | success | metadata success with matching returned URL; full replay blocked by 402 | 5,388,007 primary | 74.312 s | video+audio | 5,922 ms primary | 1 on metadata pass | known negative-place corpus fixture; not rerun |
| Unavailable `9999999999999999` | `provider_changed` | 404/zero credits on metadata pass; later 402 after balance exhaustion | none | none | not reached | 2,118 ms primary | 0 on 404 pass | not reached |

The requested independently verified known-location Facebook ground-truth fixture was not present in the repository or bounded operational history. Three historical Facebook tasks had prior `auto_save` decisions, but those model outputs were not relabeled as ground truth.

## Historical failure replay

The redacted production lookup found seven Facebook media tasks and one acquisition failure. No user IDs were read into the report.

- Tested acquisition failures: 1
- Historical URL: `fb.watch/J8m9M2wynx`
- Canonical recovery: `1356645589772949`
- ScrapeCreators metadata/direct-media result: success, exact identity
- Equivalent canonical provider download+ffprobe: success, 5,975,661 bytes, 13.767 seconds, video+audio
- Acquisition recovery: 1/1 (100%) by canonical identity evidence
- End-to-end recognition recovery in Nearr-Dev: not measured because development credits were exhausted before deployment

## fb.watch regression

The mandatory `fb.watch/J8m9M2wynx` path canonicalized to `1356645589772949` and succeeded through primary with 5,975,661 validated bytes. In normal ladder semantics ScrapeCreators is not invoked after that primary success. Deterministic coverage pins `scrapeCreatorsInvoked=false` for an already-canonicalized `fb.watch` input.

## Performance and economics

- Primary full acquisition median: 5,870 ms across nine public fixtures
- ScrapeCreators metadata median: 2,767 ms across nine public fixtures
- ScrapeCreators full acquisition median: 3,360 ms across three completed provider downloads
- Primary success rate in the live public matrix: 9/9
- ScrapeCreators metadata/direct-media success rate before billing exhaustion: 9/9
- Media quality on the three completed comparisons: byte-for-byte equal size and equal ffprobe duration to primary
- Observed Facebook cost: 1 credit per live metadata/media response; direct CDN download had no distinct provider credit
- Recommendation: `PRIMARY-FIRST + SCRAPECREATORS FALLBACK`. Primary is free and was healthy on all current fixtures; the fallback was materially faster on the completed pairs but requires credits.

Current public pay-as-you-go packages are $47/25,000 credits ($1.88 per 1,000 credits) and $497/500,000 credits ($0.994 per 1,000 credits). Allocated usage cost is below; actual cash purchase requires buying an available package.

| Fallback videos | 1 credit/video ($47 pack rate / $497 pack rate) | 5 credits/video | 10 credits/video |
|---:|---:|---:|---:|
| 1,000 | $1.88 / $0.994 | $9.40 / $4.97 | $18.80 / $9.94 |
| 10,000 | $18.80 / $9.94 | $94.00 / $49.70 | $188.00 / $99.40 |
| 25,000 | $47.00 / $24.85 | $235.00 / $124.25 | $470.00 / $248.50 |
| 100,000 | $188.00 / $99.40 | $940.00 / $497.00 | $1,880.00 / $994.00 |

The Facebook endpoint was observed at one credit/video, so the five- and ten-credit columns are sensitivity cases only.

## Security and privacy

- The existing `SCRAPE_CREATORS_KEY` remains server-only and is never logged, persisted, committed, returned by readiness, or given an `EXPO_PUBLIC_` name.
- No Facebook credentials, cookies, authenticated scraping, browser automation, or account session were introduced.
- Provider response parsing is bounded to documented fields; raw payloads and signed URLs are not logged or persisted.
- Direct media must be HTTPS on `fbcdn.net`, resolve only to public IPs, stay within redirect/timeout/byte caps, present a video/octet-stream content type, contain non-HTML/JSON bytes, and pass ffprobe with a video stream and duration limit.
- Provider temp files are removed on every validation error and the job temp directory remains covered by the existing pipeline cleanup.

## Nearr-Dev proof and deployment state

Nearr-Dev before implementation used Railway development deployment `9a545c98-e99d-4a63-a939-b9c739d05cb8`, image `sha256:27a1f50ae1e4e96f011c80e26fd822f1a2539526ffe207c844165ae30a0b4c23` (captured 2026-08-24). Facebook primary and the ScrapeCreators key were present; the new Facebook fallback flag was absent.

The benchmark gate did not pass completely because the authorized development key returned HTTP 402 after the bounded calls. Therefore no Railway development deployment was made, and live Proofs A-D were not claimed. Edge Functions, schema, OTA, and production were untouched.

## Known limitations and next gate

1. Replenish the authorized development ScrapeCreators balance.
2. Rerun the remaining full fixture downloads and record all ffprobe/latency fields without HTTP 402.
3. Supply or independently verify a real known-location Facebook fixture.
4. Deploy the exact tested worker to Nearr-Dev with `SCRAPECREATORS_FACEBOOK_FALLBACK_ENABLED=true` only after the benchmark is green.
5. Run live proofs for healthy `fb.watch` primary/no-paid-call, forced primary failure/provider success/recognition, provider mismatch/no-recognition, and both-fail honest UI.
6. Review retry economics: a transient CDN failure after a charged provider response can cause another paid call on an outer task retry (bounded by existing attempts).
7. Production promotion remains a separate, explicit action after Andrew review.
