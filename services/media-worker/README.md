# Nearr Media Worker (Phase 2)

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
  → retrieve public media (Instagram, yt-dlp) to an isolated temp dir
  → ffprobe inspect + (rarely) normalize
  → extract mono 16 kHz audio → transcribe (provider-neutral)
  → extract first/last/interval frames → perceptual-hash dedup
  → extract visible text (OCR provider; default noop)
  → analyze → PROPOSE structured, timestamped place evidence
  → POST evidence to process-share-jobs (finalize) which runs Nearr's
    EXISTING deterministic resolver + safeToAutoSave + save path
  → delete all temp files (finally)
```

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

The service-role key is used **internally only** (DB + finalize call) and is
never accepted on `/v1/process-media-tasks`, never returned, never logged.

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

All are environment-configurable. Outbound media fetches are **HTTPS-only**,
**host-allowlisted** (Meta CDNs), and rejected if DNS resolves to loopback,
private, link-local, unique-local, CGNAT, or cloud-metadata addresses.

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

- Instagram markup / CDN behavior can change without notice. On extraction
  failure the resolver returns `provider_changed` and the parent job moves to a
  safe `needs_help(manual)` state — it never fabricates a result.
- Public-post retrieval can be rate-limited. Rate limits are treated as
  retryable; the parent is never wrongly failed.
- TikTok / Facebook retrieval is intentionally **not** implemented in Phase 2.
