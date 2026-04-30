# Nearr Transcription Service

Self-hosted FastAPI microservice that turns a TikTok / Instagram / YouTube
short URL into a transcript using **yt-dlp + ffmpeg + Whisper**. It exists
because Supabase Edge Functions (Deno) cannot run native binaries.

The Nearr Edge Function ([supabase/functions/process-share-link/index.ts](../supabase/functions/process-share-link/index.ts))
calls this service **only when** its metadata-confidence heuristic is low,
and only after a 2-second `/health` pre-flight check passes. A failure at
any step never blocks the share-save flow — the pipeline degrades to
title/description-only AI extraction.

---

## API

### `GET /health`

Cheap readiness probe (does **not** load the Whisper model). The Edge
Function calls this with a 2 s timeout before every `/transcribe`.

```json
{
  "ok": true,
  "service": "transcription-service",
  "provider": "yt-dlp+whisper",
  "model": "base",
  "device": "cpu",
  "yt_dlp_available": true,
  "ffmpeg_available": true
}
```

### `POST /transcribe`

```
Headers:
  content-type: application/json
  x-api-key: <TRANSCRIPTION_SERVICE_API_KEY>   # required if configured
Body:
  { "url": "https://www.tiktok.com/@user/video/..." }

200 OK   → { "success": true,  "transcript": "..." }
4xx/5xx  → { "success": false, "error": "..." }
```

---

## Local development with Docker (recommended)

This is the fastest way to run the service identically to production.

```bash
cd transcription-service
cp .env.example .env
# Edit .env — at minimum set TRANSCRIPTION_SERVICE_API_KEY

docker compose up --build
```

The image installs ffmpeg, yt-dlp, torch (CPU wheel), whisper, and uvicorn,
then exposes port `8080`. The Whisper model cache is persisted in a named
volume so subsequent starts skip the ~140 MB download.

### Smoke tests

```bash
# Health check
curl -s http://localhost:8080/health | jq

# Real transcription (use any short, public TikTok/Reel/Short URL)
curl -s -X POST http://localhost:8080/transcribe \
  -H "content-type: application/json" \
  -H "x-api-key: $TRANSCRIPTION_SERVICE_API_KEY" \
  -d '{"url":"https://www.tiktok.com/@scout2015/video/6718335390845095173"}' | jq
```

PowerShell equivalent (Windows):

```powershell
curl.exe -s http://localhost:8080/health
$env:KEY = (Get-Content .env | Select-String '^TRANSCRIPTION_SERVICE_API_KEY=').ToString().Split('=',2)[1]
curl.exe -s -X POST http://localhost:8080/transcribe `
  -H "content-type: application/json" `
  -H "x-api-key: $env:KEY" `
  -d '{"url":"https://www.tiktok.com/@scout2015/video/6718335390845095173"}'
```

---

## Local development without Docker

Requires `ffmpeg` on PATH (`brew install ffmpeg` / `apt-get install ffmpeg` /
`winget install Gyan.FFmpeg`) and Python 3.10+.

```bash
cd transcription-service
python -m venv .venv && source .venv/bin/activate   # PowerShell: .venv\Scripts\Activate.ps1
pip install -U pip
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --host 0.0.0.0 --port 8080
```

---

## Deployment options

> **Recommended first deployment:** **Railway** or **Render** if you want
> fastest-to-running with managed builds, secrets, and HTTPS. Switch to a
> **VPS** (Hetzner, DigitalOcean, etc.) once you outgrow free tiers — it's
> typically 5–10× cheaper at steady-state for Whisper-class workloads.

All of these consume the same `Dockerfile` shipped here.

### Railway

1. Push this repo (or just this folder) to GitHub.
2. New Project → Deploy from GitHub repo → pick `transcription-service/` as
   the root directory.
3. Railway auto-detects the `Dockerfile`. Set service port to `8080`.
4. Add variables (Settings → Variables):
   - `TRANSCRIPTION_SERVICE_API_KEY=<random-32-byte-hex>`
   - `WHISPER_MODEL=base`
   - `WHISPER_DEVICE=cpu`
   - `TRANSCRIPTION_TIMEOUT_SEC=120`
   - `YTDLP_TIMEOUT_SEC=45`
   - `MAX_TRANSCRIPT_CHARS=8000`
5. After deploy, copy the generated public URL (e.g. `https://nearr-transcription.up.railway.app`).
   Use it as `SELF_HOSTED_TRANSCRIPTION_URL` in Supabase (next section).

### Render

1. New → **Web Service** → connect repo → root `transcription-service/`.
2. Environment: **Docker**. Render reads the `Dockerfile`. Health check
   path: `/health`.
3. Instance type: at least **Standard (2 GB RAM)** for `whisper base`.
4. Add the same env vars as the Railway list above.

### Fly.io

```bash
cd transcription-service
fly launch --no-deploy            # accept the existing Dockerfile
fly secrets set \
  TRANSCRIPTION_SERVICE_API_KEY=$(openssl rand -hex 32) \
  WHISPER_MODEL=base \
  WHISPER_DEVICE=cpu
fly scale memory 2048             # 2 GB for whisper base
fly deploy
fly status                        # grab the public hostname
```

### VPS (Hetzner / DO / Linode)

Cheapest long-term. Any 2 vCPU / 2 GB RAM box works for `whisper base`.

```bash
# On the VPS, after installing docker + docker compose:
git clone <your repo> nearr && cd nearr/transcription-service
cp .env.example .env && nano .env
docker compose up -d --build

# Put a TLS-terminating reverse proxy in front (Caddy is one line):
cat <<EOF | sudo tee /etc/caddy/Caddyfile
transcribe.yourdomain.com {
  reverse_proxy 127.0.0.1:8080
}
EOF
sudo systemctl reload caddy
```

---

## Env vars

### On the transcription service

See [.env.example](.env.example).

| Var | Default | Purpose |
|---|---|---|
| `TRANSCRIPTION_SERVICE_API_KEY` | _(empty)_ | Shared secret. Required in production. Sent by the Edge Function as `x-api-key`. |
| `WHISPER_MODEL` | `base` | `tiny` / `base` / `small` / `medium` / `large` |
| `WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` |
| `TRANSCRIPTION_TIMEOUT_SEC` | `120` | Wall-clock cap for the entire `/transcribe` request. |
| `YTDLP_TIMEOUT_SEC` | `45` | Sub-budget for the audio download step. |
| `MAX_TRANSCRIPT_CHARS` | `8000` | Truncate longer transcripts in the response. |
| `LOG_LEVEL` | `INFO` | Standard Python logging level. |
| `PORT` | `8080` | Bound by uvicorn. |

### On Supabase (Edge Function)

Set these so `process-share-link` knows where to call:

```bash
supabase secrets set TRANSCRIPTION_PROVIDER=self_hosted
supabase secrets set SELF_HOSTED_TRANSCRIPTION_URL=https://YOUR_DEPLOYED_SERVICE_URL
supabase secrets set TRANSCRIPTION_SERVICE_API_KEY=YOUR_SECRET
supabase functions deploy process-share-link
```

`SELF_HOSTED_TRANSCRIPTION_URL` may be the bare host (`https://host`) or
include `/transcribe` or `/health`; the Edge Function normalizes it and
appends the right path per call.

#### Switch providers without redeploying

```bash
# Use the paid SoScripted provider instead
supabase secrets set TRANSCRIPTION_PROVIDER=soscripted

# Disable transcription entirely (pipeline still works, metadata-only)
supabase secrets set TRANSCRIPTION_PROVIDER=placeholder
# or
supabase secrets unset TRANSCRIPTION_PROVIDER
```

---

## How the share flow uses this

1. iOS Share Extension POSTs `{ url, accessToken }` to `process-share-link`.
2. Edge Function fetches the page's OG metadata.
3. A cheap heuristic scores the metadata. Score **≥ 0.6** → no
   transcription is attempted (logged as `TRANSCRIPT_SKIPPED_LOW_CONFIDENCE=false`).
4. Score **< 0.6** + URL looks like a video → Edge Function:
   1. Calls `GET $SELF_HOSTED_TRANSCRIPTION_URL/health` with a **2 s** timeout.
      - Logs `TRANSCRIPT_HEALTH_CHECK_REQUESTED` and one of
        `TRANSCRIPT_HEALTH_CHECK_SUCCESS` / `TRANSCRIPT_HEALTH_CHECK_FAILED`.
      - If unhealthy: logs `TRANSCRIPT_SKIPPED_SERVICE_UNHEALTHY` and skips
        `/transcribe` entirely.
   2. Otherwise calls `POST /transcribe`. Logs:
      - `TRANSCRIPT_SELF_HOSTED_REQUESTED`
      - `TRANSCRIPT_SELF_HOSTED_SUCCESS` (with `length=` and `ms=`)
      - `TRANSCRIPT_SELF_HOSTED_FAILED` (with `reason=`)
      - `TRANSCRIPT_SELF_HOSTED_TIMEOUT`
5. Whatever transcript comes back (or `null` on failure) is forwarded to
   Gemini. The prompt instructs Gemini to use the transcript **only** when
   title/description don't name a venue.
6. Save flow continues unchanged. **Transcription is never required for a
   successful save.**

---

## Verifying logs end-to-end

After deploying both pieces, share a deliberately vague TikTok/Reel from
the iOS share sheet (e.g. one whose caption is just emoji + hashtags),
then tail the Edge Function logs:

```bash
supabase functions logs process-share-link --tail
```

Expected sequence on a successful low-confidence flow:

```
TRANSCRIPT_REQUESTED url=... confidence=0.20
TRANSCRIPT_HEALTH_CHECK_REQUESTED endpoint=https://.../health
TRANSCRIPT_HEALTH_CHECK_SUCCESS
TRANSCRIPT_SELF_HOSTED_REQUESTED url=...
TRANSCRIPT_SELF_HOSTED_SUCCESS url=... length=... ms=...
TRANSCRIPT_USED_IN_AI url=... length=... aiConfidence=high
```

Expected sequence when the service is down (and the save still succeeds):

```
TRANSCRIPT_REQUESTED url=... confidence=0.20
TRANSCRIPT_HEALTH_CHECK_REQUESTED endpoint=https://.../health
TRANSCRIPT_HEALTH_CHECK_FAILED reason=timeout
TRANSCRIPT_SKIPPED_SERVICE_UNHEALTHY url=...
```

(no `TRANSCRIPT_SELF_HOSTED_*` follow-up, no `TRANSCRIPT_USED_IN_AI`)

---

## Troubleshooting

- **`ffmpeg not found`** → install at OS level, or use the Docker image
  (it's already installed there).
- **`ytdlp_rc_*`** → Instagram/TikTok rotated their HTML. Update yt-dlp:
  rebuild the image (`docker compose build --no-cache transcription`).
- **Slow first request** → expected: Whisper loads the model on first
  call. Subsequent calls reuse the in-memory model and the on-disk cache.
- **OOM on small hosts** → drop to `WHISPER_MODEL=tiny` or upgrade RAM.
- **Health check passes but every `/transcribe` 401s** → `x-api-key`
  mismatch. Re-set `TRANSCRIPTION_SERVICE_API_KEY` on **both** sides and
  redeploy the Edge Function so it picks up the new secret.
