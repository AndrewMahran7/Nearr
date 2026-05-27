# Nearr Social Evidence Server

Standalone Dockerized HTTP service that accepts social media links and handles, and returns **structured evidence** for place extraction.

> **Status:** MVP. **Instagram** is the only platform with real implementations. **TikTok / YouTube / X** are wired as clean stubs that return `unsupported_platform` so the API surface and provider architecture are already complete.
>
> **Not integrated with the Nearr app, Supabase, or the mobile codebase.** This is a standalone service.

---

## 1. Architecture summary

```
                    +---------------------------+
   HTTP client ---> |  FastAPI (app/main.py)    |
                    |  - API key middleware     |
                    |  - request timeout        |
                    |  - structured JSON logs   |
                    +-------------+-------------+
                                  |
              +-------------------+--------------------+
              |                   |                    |
        routers/transcript  routers/profile     routers/evidence
              |                   |                    |
        services/             services/           services/
        transcript_service    profile_service     evidence_service
              \                  |                    /
               \                 |                   /
                v                v                  v
                    +--------------------------+
                    |   providers/registry.py  |
                    |  picks one provider per  |
                    |  (platform, capability)  |
                    +-----+----------+---------+
                          |          |
                +---------+--+   +---+----------+   +-------------+   +-------+
                |  instagram |   |   tiktok     |   |   youtube   |   |   x   |
                |  metadata  |   |   (stub)     |   |   (stub)    |   | (stub)|
                |  profile   |   +--------------+   +-------------+   +-------+
                |  transcript|
                +------------+
```

Three orthogonal provider interfaces (in `app/providers/base.py`):

| Interface | Method | Purpose |
|---|---|---|
| `SocialMetadataProvider` | `fetch_post_metadata(url)` | Title / caption / author / handles / hashtags |
| `SocialProfileProvider` | `fetch_profile(handle)` | Display name, bio, category, website, classification |
| `SocialTranscriptProvider` | `fetch_transcript(url)` | Captions or audio-transcribed text |

Adding a new platform = drop a module under `app/providers/<platform>/` implementing whichever subset it can, and register it in `providers/registry.py`. Routers and services never touch platform code directly.

### Reliability

- Per-request hard timeout (`REQUEST_TIMEOUT_SECONDS`, default 45s) enforced in middleware.
- Per-provider timeout (`PROVIDER_TIMEOUT_SECONDS`, default 20s) via `with_provider_timeout`.
- Per-HTTP-call timeout (`HTTP_TIMEOUT_SECONDS`, default 15s) on outbound httpx + yt-dlp.
- One failing provider never crashes the response; failures are appended to `errors[]` with a structured `{type, message, provider}` shape.

### Error types (`app/errors.py::ErrorType`)

`unsupported_platform`, `metadata_unavailable`, `transcript_unavailable`,
`profile_unavailable`, `rate_limited`, `provider_error`, `timeout`, `invalid_input`.

### Security

- Every `/extract/*` endpoint requires header `X-NEARR-EVIDENCE-KEY: <NEARR_EVIDENCE_SERVER_KEY>`.
- Secret-ish keys (`password`, `api_key`, `token`, etc.) are redacted by `app.logging_setup.redact` before structured logs.
- No request body is logged by default.

---

## 2. Files created

```
evidence-server/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .dockerignore
├── .gitignore
├── requirements.txt
├── README.md
├── scripts/
│   └── test_evidence_server.py
└── app/
    ├── __init__.py
    ├── main.py                       # FastAPI app, middleware, exception handler
    ├── config.py                     # Settings via pydantic-settings
    ├── auth.py                       # X-NEARR-EVIDENCE-KEY dependency
    ├── errors.py                     # ErrorType + EvidenceError
    ├── logging_setup.py              # structlog JSON logs + secret redaction
    ├── timing.py                     # with_provider_timeout, latency helpers
    ├── utils.py                      # platform detect, handle/hashtag regex
    ├── models/
    │   ├── requests.py
    │   └── responses.py              # Pydantic camelCase responses
    ├── routers/
    │   ├── transcript.py
    │   ├── profile.py
    │   └── evidence.py
    ├── services/
    │   ├── transcript_service.py
    │   ├── profile_service.py
    │   └── evidence_service.py
    └── providers/
        ├── base.py                   # SocialMetadata/Profile/Transcript Protocols
        ├── registry.py
        ├── instagram/
        │   ├── _ytdlp.py             # shared yt-dlp + oEmbed helpers
        │   ├── metadata.py
        │   ├── profile.py            # instaloader + heuristic classifier
        │   └── transcript.py         # captions; optional Whisper (feature flag)
        ├── tiktok/stubs.py
        ├── youtube/stubs.py
        └── x/stubs.py
```

---

## 3. Run with Docker

```bash
cd evidence-server
cp .env.example .env
# Edit .env: set NEARR_EVIDENCE_SERVER_KEY to a long random string.
# (Optional) Set INSTAGRAM_USERNAME / INSTAGRAM_PASSWORD for better profile reliability.

docker compose build
docker compose up -d
docker compose logs -f
```

The server listens on `http://localhost:8088`.

Health check:

```bash
curl -s http://localhost:8088/health
```

To rebuild after code changes:

```bash
docker compose up -d --build
```

### Run without Docker (local dev)

```bash
cd evidence-server
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env  # edit NEARR_EVIDENCE_SERVER_KEY
uvicorn app.main:app --host 0.0.0.0 --port 8088 --reload
```

---

## 4. Test the endpoints

### Smoke test script

```bash
# from evidence-server/
python scripts/test_evidence_server.py \
  --base-url http://localhost:8088 \
  --key "$(grep NEARR_EVIDENCE_SERVER_KEY .env | cut -d= -f2)"
```

It hits `/health`, then exercises all three `/extract/*` endpoints with the canonical test handles and URLs and prints a one-line summary per call plus a final pass/fail count.

### Manual `curl`

```bash
KEY="<your NEARR_EVIDENCE_SERVER_KEY>"
BASE=http://localhost:8088

# Profile bio
curl -s -X POST "$BASE/extract/profile-bio" \
  -H "X-NEARR-EVIDENCE-KEY: $KEY" -H 'content-type: application/json' \
  -d '{"platform":"instagram","handle":"oldfishermansgrotto"}' | jq

# Video transcript
curl -s -X POST "$BASE/extract/video-transcript" \
  -H "X-NEARR-EVIDENCE-KEY: $KEY" -H 'content-type: application/json' \
  -d '{"url":"https://www.instagram.com/p/DLfvZunSKRp/","platform":"instagram"}' | jq

# Combined social evidence
curl -s -X POST "$BASE/extract/social-evidence" \
  -H "X-NEARR-EVIDENCE-KEY: $KEY" -H 'content-type: application/json' \
  -d '{"url":"https://www.instagram.com/p/DLfvZunSKRp/","includeTranscript":true,"includeProfiles":true}' | jq
```

OpenAPI docs (and a tester UI) live at `http://localhost:8088/docs`.

---

## 5. What works now

- **API surface complete** for all three endpoints with the exact request/response shapes specified.
- **Provider abstraction** (`SocialMetadataProvider` / `SocialProfileProvider` / `SocialTranscriptProvider`) with a registry — adding a new platform is purely additive.
- **Instagram post/reel metadata** via `yt-dlp` (no auth) with an `instagram.com/oembed/` fallback for caption text.
- **Instagram caption parsing** → extracted `@handles` and `#hashtags` populated on responses.
- **Instagram profile bio** via `instaloader` (anonymous, or logged-in if `INSTAGRAM_USERNAME` / `INSTAGRAM_PASSWORD` set; session is persisted to `/data/instaloader`).
- **Heuristic profile classifier** → `restaurant_or_business | creator | personal | unknown` with confidence + light name/address/city extraction.
- **Instagram transcript** when captions/automatic subtitles are exposed by `yt-dlp` (rare on IG but supported). A VTT parser converts them to `segments[]`.
- **Combined `/extract/social-evidence`** fetches metadata, then resolves profiles of the author + tagged handles (up to 5) and the transcript **in parallel**, then scores `evidenceQuality`.
- **Per-request and per-provider timeouts**, structured JSON logs, structured `errors[]`, secret redaction, request IDs.
- **Auth** via `X-NEARR-EVIDENCE-KEY`.

---

## 6. What is stubbed / feature-flagged

- **TikTok / YouTube / X providers** — all three capabilities return a structured `unsupported_platform` error. Adding real implementations is purely additive (drop in a module + register).
- **Whisper transcription** (audio → text) — disabled by default (`ENABLE_WHISPER=false`). The code path exists (`InstagramTranscriptProvider._whisper_transcribe`) and uses lazy `faster-whisper` import + `ffmpeg` + yt-dlp audio download. Enable by:
  1. Adding `faster-whisper==1.0.3` to `requirements.txt`.
  2. Setting `ENABLE_WHISPER=true`, optionally `WHISPER_MODEL=small` and `WHISPER_DEVICE=cpu|cuda`.
  Left off by default because it bloats the Docker image and CPU inference is slow — the MVP returns `transcript_unavailable` cleanly instead.
- **Third-party profile fallback** — env vars (`THIRD_PARTY_PROFILE_PROVIDER`, `THIRD_PARTY_PROFILE_API_KEY`) are wired through `Settings` but no adapter is implemented. Add one under `providers/instagram/third_party.py` and chain it after `_instaloader_fetch` if you want a paid fallback (RapidAPI, ScrapingDog, etc.).

---

## 7. Provider limitations (be realistic)

- **Instagram public metadata** via yt-dlp works for many public posts/reels but Instagram aggressively rate-limits anonymous IPs. Symptoms surface as `rate_limited` errors. Mitigations: `YTDLP_COOKIES_FILE` (Netscape cookies export) and/or running behind a residential IP.
- **Instagram captions are usually absent.** Without Whisper, expect `transcript_unavailable` on most reels. Caption text from the post body is still returned via the metadata provider.
- **`instaloader` anonymous mode** is rate-limited fast (often after a handful of profile lookups). Setting `INSTAGRAM_USERNAME` / `INSTAGRAM_PASSWORD` and persisting a session to `/data/instaloader` is **strongly recommended** for any sustained use. Use a throwaway account.
- **No browser automation / proxies** are used in this MVP. If Instagram blocks the server's IP entirely (returns `RATE_LIMITED` on every call), the next escalation is either (a) a third-party profile API or (b) yt-dlp with a logged-in cookies file. Both are wired but require operator action.
- **Whisper is intentionally optional.** Bundling a Whisper model would multiply image size by ~5–10x and add cold-start time. Treat it as a feature flag.

---

## 8. Next steps

1. **TikTok metadata + captions** via yt-dlp — the highest-ROI next provider; the code shape will mirror `providers/instagram/metadata.py` and `transcript.py`.
2. **YouTube transcript** via `youtube-transcript-api` (fast, no API key for many videos).
3. **X/Twitter** via the official v2 API behind a bearer token.
4. **Third-party Instagram profile adapter** for resilience when IP gets blocked.
5. **Caching layer** (Redis) keyed by `(platform, url-or-handle)` with short TTL to soak up retries cheaply.
6. **`/extract/batch`** endpoint to amortize handle lookups across an extraction job.
7. Only **after** the server proves stable in isolation: integrate from the Supabase Edge Function (server-to-server with `X-NEARR-EVIDENCE-KEY`), then from the Nearr app's share pipeline.
