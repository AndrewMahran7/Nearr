# ScrapeCreators Instagram fallback

Date: 2026-08-24
Branch: `feat/scrapecreators-instagram-fallback`
Base: clean `main` / `origin/main` at `0982bacdec33a0d9f17479e9e1e3899f6a16f24b`

## Decision

Nearr should remain **primary-first with ScrapeCreators fallback**. The primary
path is free and succeeded on all ten available public video fixtures. The
ScrapeCreators path recovered the same bytes faster on the same fixtures and
is an appropriate reliability tail, but it costs credits on live cache misses.

The implementation is complete and deterministic tests pass. Nearr-Dev was
not deployed during this task because the authorized ScrapeCreators account
began returning HTTP 402 after the benchmark/discovery calls. A provider credit
top-up and the withheld live fallback proof are required before promotion.

## Current Instagram acquisition ladder

### Before

1. `create-share-job` validates and normalizes the shared URL, strips tracking
   parameters, and classifies Instagram.
2. `process-share-link` fetches public HTML with an eight-second budget and
   extracts Open Graph/title/description metadata. An Instagram login redirect
   is not allowed to replace the original post identity.
3. The existing metadata resolver/Places safety gate either finishes normally
   or enqueues one durable `share_media_tasks` row when media evidence is
   warranted. There is no worker recognition cache on this `main` base.
4. `InstagramMediaResolver` validates an HTTPS Instagram `/p`, `/reel`,
   `/reels`, or `/tv` URL and runs `yt-dlp -j` once with a 45-second maximum
   metadata-probe budget.
5. If yt-dlp exposes a progressive audio+video URL, the worker performs one
   SSRF-checked, redirect-limited, byte-capped download. Otherwise yt-dlp runs
   one bounded merge download.
6. The shared worker runs ffprobe, normalization, audio extraction,
   transcription, frames, OCR, Gemini/Vayrin, Places verification, and the
   existing finalizer. Retryable acquisition errors can be requeued up to the
   task's configured `max_attempts` (normally three).

There was only one Instagram media provider: yt-dlp/public Meta CDN. No
ScrapeCreators Instagram path existed.

### After

1. The existing metadata and task-dispatch ordering is unchanged.
2. `instagramContentIdentity` establishes the exact shortcode and canonical
   `https://www.instagram.com/{p|reel|tv}/{shortcode}/` identity before any
   paid call.
3. A future trusted recognition-cache lookup remains the first injectable
   resolver seam. Current main wires no cache.
4. The primary yt-dlp path runs first.
5. The acquisition ladder ffprobes primary bytes before declaring success.
6. If the primary path throws any structured acquisition/validation failure
   and the task is not cancelled, one ScrapeCreators attempt runs when the
   feature flag and canonical shortcode are present.
7. The provider response must contain a numeric Instagram media ID and a
   shortcode exactly equal to the expected shortcode.
8. The worker immediately downloads the direct Meta CDN URL with the existing
   HTTPS/DNS/SSRF/redirect/timeout/byte guards, validates content type and file
   prefix, and ffprobes for a valid video stream and duration.
9. Valid provider media rejoins the exact existing recognition/finalizer path.

Authoritative rule:

> ANY PRIMARY INSTAGRAM MEDIA ACQUISITION FAILURE WITH VALID CANONICAL ID FALLS BACK TO SCRAPECREATORS: YES

Cancellation, a missing canonical identity, an already-consumed provider
attempt, or a disabled/unconfigured provider remain hard stops.

## Provider contract

- Official endpoint: `GET https://api.scrapecreators.com/v1/instagram/post`
- Authentication: server-only `x-api-key: SCRAPE_CREATORS_KEY`
- Parameters used: `url=<canonical Instagram URL>` and
  `download_media=false`
- Response identity: `data.xdt_shortcode_media.shortcode` plus numeric
  `data.xdt_shortcode_media.id`
- Direct media: `data.xdt_shortcode_media.video_url`; carousel children are in
  `data.xdt_shortcode_media.edge_sidecar_to_children`
- Direct-media mode: 1 documented credit on a live request; the benchmark
  observed 1 credit on each of ten live misses
- Provider-hosted permanent media: intentionally disabled; documentation says
  `download_media=true` adds 10 credits when media is found
- Cache: documented cache hits can be 0 credits, but production does not ask
  for a long-lived cached response because signed direct media URLs can expire
- Rate limits: the current provider site states there are no artificial rate
  limits. Nearr still uses its own worker concurrency and timeout bounds.
- Official references:
  [Post/Reel Info](https://docs.scrapecreators.com/v1/instagram/post/),
  [OpenAPI](https://docs.scrapecreators.com/v1/instagram/post/openapi.json),
  [pricing](https://scrapecreators.com/)

The endpoint supports public Reels and ordinary video posts. It also returns
carousel children. Nearr accepts a carousel only when exactly one video child
exists. A multi-video carousel returns `NO_MEDIA`/
`scrapecreators_multi_video_carousel_unsupported`; selecting one of several
clips would lose sequence and could analyze the wrong asset.

## Identity model

Nearr's authoritative Instagram content identity is the case-sensitive
shortcode from the normalized URL. The provider's numeric media ID is retained
only as bounded provenance. Acceptance requires the returned shortcode to be
present and exactly equal to the expected shortcode; URL similarity, creator,
caption, and CDN host are not substitutes for identity.

Internal parse results are `SUCCESS_MEDIA`, `IDENTITY_MISMATCH`, `NO_MEDIA`,
and `INVALID_RESPONSE`. Transport failures use the existing structured
`MediaError` taxonomy. Provider names/details remain internal.

## Fixture benchmark

The benchmark used public fixtures already present in the repository. It made
no Instagram login, cookie, browser, or account-credential request. Temporary
media was deleted after each row. Latency is wall-clock worker occupancy for
primary; provider latency and direct-download latency are reported separately.

| Fixture | Shape / purpose | Primary | ScrapeCreators | Identity | Bytes | Duration | Streams | Primary ms | Provider API + download ms | Credits |
| --- | --- | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: |
| `DUWyZkfgbT4` | Reel, caption-heavy, known Capone's ground truth | success | success | exact | 7,087,527 | 32.433 s | H.264 + AAC | 6,696 | 6,140 + 1,113 | 1 |
| `CxdY35frOrf` | Reel, different creator, Brooklyn City Pizzeria | success | success | exact | 12,261,706 | 36.033 s | H.264 + AAC | 13,034 | 4,185 + 1,308 | 1 |
| `DYq7Q3Lza0G` | Reel, Hellfire Bay ambiguity regression | success | success | exact | 7,175,465 | 8.667 s | H.264 + AAC | 7,531 | 3,808 + 404 | 1 |
| `DYpcd2ZBTsZ` | ordinary `/p` video post | success | success | exact | 4,760,321 | 14.900 s | H.264 + AAC | 5,718 | 5,076 + 352 | 1 |
| `DX77lghIHeG` | ordinary `/p` video post | success | success | exact | 6,960,767 | 36.900 s | H.264 + AAC | 8,211 | 5,055 + 1,442 | 1 |
| `Db60wxqvvOI` | ordinary Reel, extractor reference fixture | success | success | exact | 5,923,597 | 24.500 s | H.264 + AAC | 8,253 | 5,302 + 1,540 | 1 |
| `DbYVuJjM9u2` | minimal-description post (0 description chars in primary metadata) | success | success | exact | 6,413,352 | 14.467 s | H.264 + AAC | 11,558 | 4,141 + 1,984 | 1 |
| `DNT_wptv1K9` | ordinary Reel | success | success | exact | 3,001,406 | 11.667 s | H.264 + AAC | 16,674 | 4,701 + 1,287 | 1 |
| `DVrn72RmJsW` | short `/p` video | success | success | exact | 2,155,936 | 10.833 s | H.264 + AAC | 10,383 | 6,466 + 1,672 | 1 |
| `DLfvZunSKRp` | long in-limit video | success | success | exact | 13,244,315 | 88.433 s | H.264 + AAC | 15,665 | 6,655 + 1,183 | 1 |
| `DbbY9pdm6Q2` | eight-child, three-video carousel | extractor failure | explicit no-media | exact | n/a | n/a | n/a | 2,750 | 894 metadata | 0 cached |
| `E2eNearrProbe0` | unavailable/deleted control | failed | HTTP 404 | n/a | n/a | n/a | n/a | 2,418 | 2,226 | not returned |
| malformed/profile URL | non-content control | rejected before acquisition | not invoked | no canonical ID | n/a | n/a | n/a | n/a | 0 | 0 |

For the ten valid single-video fixtures, primary and ScrapeCreators byte counts,
durations, codecs, dimensions, and audio presence matched exactly. Identity
accuracy was 10/10. Recognition was already proven for the Capone's and Brooklyn
fixtures through the current primary path in Nearr-Dev. The deterministic
pipeline contract additionally proves Instagram ScrapeCreators media reaches
the same model interface; a live fallback recognition run is still required.

Median end-to-end primary acquisition: **9,318 ms**.
Median ScrapeCreators API time: **5,066 ms**.
Median ScrapeCreators direct download time: **1,298 ms**.
Median ScrapeCreators API + download: **6,311 ms**.

Primary uses a yt-dlp metadata subprocess and, on all ten fixtures, a bounded
yt-dlp merge subprocess. ScrapeCreators waits on one API request and then uses
the in-process guarded downloader. Both occupy one worker slot for their wall
time; ffprobe cost is equivalent. CPU was not separately instrumented.

## Historical failure replay

Nearr-Dev was queried read-only before deployment work. It contained four
Instagram media tasks, all completed (two recognition and two post-save
enrichment tasks for two public Reels). It contained **zero** Instagram tasks
ending in `failed` or `needs_help`, so no honest historical failure cohort was
available.

- Historical failures tested: 0
- Recovered by ScrapeCreators: 0
- Recovery rate: not measurable

The multi-video carousel is a real primary failure but is not counted as a
recovery: exact identity was returned, yet Nearr correctly rejected the three
ambiguous video assets.

## Retry and cost budget

There is one provider attempt per resolver execution. Deterministic provider
400/404/422 statuses become terminal `missing_video`; identity mismatch,
malformed response, no media, invalid content, size, duration, and ffprobe
failures are also terminal. Transient transport/timeout/429/5xx/provider-credit
outages retain the existing bounded outer queue behavior, so a new task attempt
can make one new provider call until `max_attempts` is exhausted. There is no
inner retry or multiplicative provider loop.

Observed usage was 1 credit per live recovered video. Public pack arithmetic:

| Credits/video | Fallback videos | Credits | Freelance ($47 / 25k) | Business ($497 / 500k) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1,000 | 1,000 | $1.88 | $0.99 |
| 1 | 10,000 | 10,000 | $18.80 | $9.94 |
| 1 | 25,000 | 25,000 | $47.00 | $24.85 |
| 1 | 100,000 | 100,000 | $188.00 | $99.40 |
| 5 | 1,000 / 10,000 / 25,000 / 100,000 | 5k / 50k / 125k / 500k | $9.40 / $94 / $235 / $940 | $4.97 / $49.70 / $124.25 / $497 |
| 10 | 1,000 / 10,000 / 25,000 / 100,000 | 10k / 100k / 250k / 1m | $18.80 / $188 / $470 / $1,880 | $9.94 / $99.40 / $248.50 / $994 |

These are planning estimates from current public pack prices. They do not
fabricate an account-specific billed dollar amount. Cache hits may cost zero,
but Nearr does not rely on cache savings for production architecture.

## Security and telemetry

- Reuses the server-only `SCRAPE_CREATORS_KEY`; no duplicate secret.
- No key, raw provider response, raw response body, signed media URL, cookies,
  or authorization headers are logged or persisted.
- Provider response JSON is bounded to 2 MiB and parsed only into documented
  fields.
- Provider calls reject redirects and have a 30-second maximum.
- Media requires HTTPS, an allowlisted Meta CDN host, public DNS, a bounded
  redirect chain, size cap, timeout, video/octet-stream content type, non-HTML
  file prefix, ffprobe video stream, and the existing duration cap.
- Audio is retained when present; video without audio remains valid for visual
  recognition.
- Partial provider downloads are unlinked on failure; successful files live
  only in the existing per-job temp directory and are deleted in `finally`.
- Telemetry includes platform, primary provider/result/failure, invocation,
  canonical shortcode, identity match, latency, bytes, final provider, result,
  numeric provider post ID, and credits only when returned.
- User-facing failure planning contains no provider name or detail.

## Funded resume run

The funded resume completed on 2026-08-24. The original implementation survives
as commit `7f13c9c` (`feat: add ScrapeCreators Instagram fallback`). It was
semantically reconciled with the concurrent Facebook fallback, the development
worker heartbeat, and `origin/main` at `fc293c1`; the tested integration commit
was `d4a7ed3`.

One bounded pre-deployment provider probe returned HTTP 200 for shortcode
`DUWyZkfgbT4`, reported one charged credit, and confirmed that HTTP 402 was
resolved. The local and Nearr-Dev keys were both present and matched by length
and SHA-256 digest; no credential value was printed. The full ten-video
benchmark was deliberately not repeated.

Before deployment, Nearr-Dev was running the concurrent Facebook proof
deployment `7d545e17-9da5-4b00-a340-733a28133557`, image
`sha256:ad58fb9713990d068a704bed29f35fc1cd3612d97ca8e0ad727d8b084750a3c3`.
That work was preserved rather than overwritten: the combined source includes
both Instagram and Facebook fallbacks. The final proof-capable deployment was
`47ad0bc1-ca74-401b-845c-b437363db0eb`, image
`sha256:00c9e738d0fb934fc02451092d0d6d2ae865d66785d1b275de17e8be419e47de`.

Live Nearr-Dev evidence on that exact image:

- Healthy primary: public Reel `CxdY35frOrf`, job
  `9e232053-f01f-419d-9a46-791f4e9290ea`. Primary acquisition succeeded,
  ScrapeCreators was not invoked, 22 frames reached the normal model adapter,
  and Brooklyn City Pizzeria & Market was recognized.
- Forced primary failure: public Reel `DUWyZkfgbT4`, job
  `d7b01c7a-633e-4ab5-bbd6-30ae6cb798bf`. The development-only exact-shortcode
  seam produced a primary `provider_changed` failure. ScrapeCreators was invoked
  once, returned the matching identity and 7,087,527 bytes of valid media,
  reported one charged credit, passed ffprobe, yielded 24 extracted/22 analyzed
  frames, and reached the normal recognition and finalizer path. The model did
  not name Capone's Italian Cucina; exact auto-save was explicitly not a gate
  for this acquisition ticket.
- Both paths fail: synthetic well-formed shortcode `E2eNearrProbe0`, job
  `ec68aab0-e14d-4207-8d67-2260de88fba6`. The natural yt-dlp path failed,
  ScrapeCreators was invoked once and returned terminal HTTP 404/no media, the
  task ended `needs_help` with `missing_video`, and the model was not reached.
  Existing failure-presentation tests confirm this maps to Nearr's Honest
  Failure without exposing the provider name.
- Exact identity mismatch and single-/multi-video carousel behavior were
  re-proved deterministically. A mismatch is rejected before download and never
  reaches recognition. A single exact video child is accepted; multiple video
  children are explicitly unsupported and are never selected by response order.

The forced-shortcode environment variable was then deleted. Deployment
`17a66eff-6ac2-433e-af68-f0cf382d1af7` redeployed the same image with the proof
seam disabled. Final `/health` and `/ready` both returned 200; config, ffmpeg,
ffprobe, yt-dlp `2026.08.19`, Supabase, and the Instagram, TikTok, and Facebook
ScrapeCreators capabilities were ready. The final state is one replica with
worker concurrency 1 and claim batch 2. Edge functions, schema, OTA, production,
and host JavaScript were not deployed.

Five bounded provider calls were made during the complete resume: the funded
probe, one fallback whose provider response succeeded before a transient CDN
download failure, its single controlled retry, the final combined-image
fallback proof, and the terminal 404 proof. Three charged credits are confirmed
by provider responses; charging for the CDN-failure and 404 calls was not
reported, so total consumption is 3 confirmed and at most 5. No cache hit was
observed or relied upon.

There is one paid call per resolver execution. The queue default is three task
attempts, so a retryable post-provider CDN failure can make at most three paid
calls for one user submission. Terminal provider statuses and validation
failures do not outer-retry. A checkpoint was not added because the returned CDN
URL is temporary and reusing it would weaken recovery reliability for negligible
cost.

The post-proof historical audit again found zero non-E2E Instagram tasks ending
in `failed` or `needs_help`, so a historical recovery rate remains unavailable.

## Remaining limitations and recommendation

1. No real historical Nearr-Dev acquisition-failure cohort exists, so field
   recovery rate is not yet measurable.
2. Multi-video carousels remain deliberately unsupported until recognition can
   preserve ordered multi-asset context.
3. A transient CDN failure after a charged provider response can spend again on
   an outer task retry, bounded to three total calls per default task.
4. The forced fallback reached recognition but did not name the known venue;
   acquisition integration is proven, while recognition quality remains a
   separate evaluation concern.

Production recommendation: **READY FOR PRODUCTION PROMOTION**. Production still
requires a separate promotion ticket and was not changed by this run.
