# Nearr Media Worker (Phase 2+)

A private, containerized service that provides the **durable video-analysis
fallback** for Nearr's async share jobs. It is isolated from the Expo app and
from Supabase Edge Functions because it runs long jobs and needs `ffmpeg`,
`ffprobe`, and `yt-dlp`.

> The full architecture, state machine, and deployment runbook live in
> [`../../docs/MEDIA_FALLBACK.md`](../../docs/MEDIA_FALLBACK.md). This README is
> the service-local quick reference.

## What it does

```
claim share_media_task
  → retrieve public media (Instagram / TikTok / YouTube / Facebook /
    Snapchat Spotlight — one MediaResolver per platform, all built on the
    same shared yt-dlp core) to an isolated temp dir
  → ffprobe inspect + (rarely) normalize
  → transcript: platform captions (YouTube) if usable, else extract audio →
    transcribe (provider-neutral); no usable speech is a normal, non-fatal
    outcome — frames still carry the analysis forward
  → extract first/last/interval frames → perceptual-hash dedup
  → extract visible text (OCR provider; default noop)
  → analyze → PROPOSE structured, timestamped place evidence
  → POST evidence to process-share-jobs (finalize) which runs Nearr's
    EXISTING deterministic resolver + safeToAutoSave + save path
  → delete all temp files (finally)
```

Every resolver implements the same `MediaResolver` interface
([`src/resolvers/MediaResolver.ts`](src/resolvers/MediaResolver.ts)) and shares
one yt-dlp retrieval core
([`src/resolvers/ytDlpShared.ts`](src/resolvers/ytDlpShared.ts)) — the rest of
the pipeline (inspect, frames, transcript, analyze, finalize) never branches on
platform.

**The worker only proposes evidence.** It never picks a Google Place ID, never
decides `safeToAutoSave`, and never writes a saved place. Nearr's deterministic
safety gate decides — a wrong silent save is worse than asking the user.

## Core rule & isolation

- Separate package with its own `package.json` / lockfile. Not part of the Expo
  dependency graph (Metro block-lists it, the app `tsconfig` excludes it).
- Dependencies are intentionally tiny: Node built-ins + `zod` +
  `@supabase/supabase-js`. `ffmpeg` / `ffprobe` / `yt-dlp` are **containerized
  binaries**, invoked via `child_process` with no shell.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Process is alive. |
| GET | `/ready` | none | Config valid + ffmpeg/ffprobe/yt-dlp present + Supabase reachable. Never returns secrets. |
| POST | `/v1/process-media-tasks` | `Bearer SHARE_MEDIA_WORKER_SECRET` | Claim + process a batch. |

The service-role key is used **internally only** (DB access) and is never
accepted on `/v1/process-media-tasks`, never returned, never logged. The
finalize call to `process-share-jobs` is authenticated separately with a
dedicated `MEDIA_FINALIZE_SECRET` bearer — independent of the service-role
key, so a service-role rotation can never silently break it.

## Security limits (and why these defaults)

| Limit | Default | Rationale |
| --- | --- | --- |
| `MEDIA_MAX_DURATION_SECONDS` | 180 | Short-form social clips; longer is rarely a place video and inflates cost. |
| `MEDIA_MAX_DOWNLOAD_BYTES` | 150 MB | Generous for ≤180 s 1080p; bounds disk + egress. |
| `MEDIA_DOWNLOAD_TIMEOUT_MS` | 60 000 | A stalled CDN fetch must not hold a worker slot. |
| `MEDIA_JOB_TIMEOUT_MS` | 480 000 | Hard ceiling for one task incl. model calls (8 min). |
| `MEDIA_MAX_SELECTED_FRAMES` | 24 | Enough visual coverage; caps multimodal cost. |
| `MEDIA_REDIRECT_LIMIT` | 3 | Public CDNs rarely need more; shrinks SSRF surface. |
| `MEDIA_WORKER_MAX_CONCURRENCY` | 1 | Start conservative; raise after load testing. |
| `MEDIA_WORKER_CLAIM_BATCH` | 1 | Must not exceed immediately available concurrency; the worker also enforces this invariant. |

All are environment-configurable. Outbound media fetches are **HTTPS-only**,
**host-allowlisted** (Meta CDNs, `googlevideo.com`/`youtube.com`, TikTok's CDN
family, and Snapchat's `sc-cdn.net` — see `MEDIA_ALLOWED_HOSTS` in
`.env.example`), and rejected if DNS resolves to loopback, private,
link-local, unique-local, CGNAT, or cloud-metadata addresses.

## Local development

```bash
cd services/media-worker
cp .env.example .env            # fill SHARE_MEDIA_WORKER_SECRET + Supabase
npm install
npm run typecheck
npm test                        # unit tests (no network, no real media)
npm run dev                     # starts the server with tsx watch
```

Requires `ffmpeg`, `ffprobe`, and `yt-dlp` on `PATH` (or set `FFMPEG_PATH` /
`FFPROBE_PATH` / `YT_DLP_PATH`). Generate synthetic test media locally:

```bash
npm run fixtures:generate       # writes synthetic mp4s under tests/fixtures/
```

## Docker

```bash
docker build -t nearr-media-worker ./services/media-worker
docker run --rm --env-file services/media-worker/.env -p 8090:8090 nearr-media-worker
curl -s localhost:8090/health
curl -s localhost:8090/ready
```

## Live tests (opt-in, may incur API cost)

```bash
npm run test:media-worker-live        # requires MEDIA_LIVE_TESTS=1
npm run test:instagram-resolver-live  # requires INSTAGRAM_LIVE_TESTS=1 + a public URL
npm run test:native-video-live        # requires NATIVE_VIDEO_LIVE_TESTS=1
```

These are **not** part of the default `npm test` / repo prebuild.

## Known platform fragility

- Any platform's markup / CDN behavior can change without notice. On
  extraction failure a resolver returns `provider_changed` and the parent job
  moves to a safe `needs_help(manual)` state — it never fabricates a result.
- Public-post retrieval can be rate-limited. Rate limits are treated as
  retryable; the parent is never wrongly failed.
- **TikTok**: implemented on the same shared yt-dlp core as every other
  platform and unit-tested, but live acquisition could **not** be verified from
  the development sandbox this was built in — TikTok's anti-bot layer blocked
  both yt-dlp and the official oEmbed endpoint for automated/datacenter
  traffic. Per the public-content-only mission, no anti-bot evasion was
  attempted. Verify from the actual Railway deployment (different IP
  reputation) before enabling `TIKTOK_MEDIA_RESOLVER_ENABLED` broadly.
- **YouTube**: uses yt-dlp's adaptive video+audio merge, not a single
  progressive URL — verified live that YouTube's legacy single-file format
  (id `18`) can 403 or resolve to an HLS manifest instead of raw bytes even
  when yt-dlp's own metadata calls it `protocol: "https"`.
- **Snapchat**: ONLY public Spotlight links (`snapchat.com/spotlight/...`) are
  supported, verified live end-to-end (probe → direct CDN download → frames).
  Stories, profiles, and any other Snapchat surface are never claimed as
  supported by `SnapchatMediaResolver.supports()`.
