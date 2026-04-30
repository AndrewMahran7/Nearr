"""
Nearr transcription microservice.

A tiny FastAPI server that turns a social video URL into a transcript using:

  yt-dlp     → download best audio track (no full video needed)
  ffmpeg     → (optionally) re-encode to 16 kHz mono WAV for Whisper
  whisper    → openai-whisper local inference (CPU or GPU)

This service exists because Supabase Edge Functions (Deno) cannot run
native binaries like yt-dlp / ffmpeg / Whisper. The Edge Function calls
us only when its metadata-confidence heuristic is low (see
`supabase/functions/process-share-link/index.ts`).

Contract:

    POST /transcribe
      headers: x-api-key: <TRANSCRIPTION_SERVICE_API_KEY>   (if configured)
      body:    { "url": "https://www.tiktok.com/..." }

    200 OK  → { "success": true,  "transcript": "..." }
    4xx/5xx → { "success": false, "error": "..." }

Operational rules:
  - Always cleans up its temp dir, even on failure.
  - Hard wall-clock timeout (TRANSCRIPTION_TIMEOUT_SEC) applied to the
    whole pipeline so the caller (Edge Function) doesn't time out first.
  - Fails open from the caller's perspective: any non-200 response causes
    the share pipeline to proceed without a transcript.
  - No PII / URLs are persisted; only ephemeral logs to stdout.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

# Whisper is heavy to import (~1–2s + model load on first transcribe).
# We import lazily inside the request handler so the server can boot
# fast and so unit tests / health checks don't pay the cost.

LOG = logging.getLogger("nearr.transcription")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_KEY = os.environ.get("TRANSCRIPTION_SERVICE_API_KEY", "").strip()
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base").strip() or "base"
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu").strip() or "cpu"
TIMEOUT_SEC = int(os.environ.get("TRANSCRIPTION_TIMEOUT_SEC", "120"))
YTDLP_TIMEOUT_SEC = int(os.environ.get("YTDLP_TIMEOUT_SEC", "45"))
MAX_TRANSCRIPT_CHARS = int(os.environ.get("MAX_TRANSCRIPT_CHARS", "8000"))

# Cache the loaded Whisper model between requests.
_whisper_model = None
_whisper_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------

app = FastAPI(title="Nearr Transcription Service", version="1.0.0")


class TranscribeRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)


class TranscribeResponse(BaseModel):
    success: bool
    transcript: Optional[str] = None
    error: Optional[str] = None


def require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    """Constant-time-ish API key check. Skipped entirely if no key is set
    (useful for local dev), so DO set TRANSCRIPTION_SERVICE_API_KEY in prod."""
    if not API_KEY:
        return
    if not x_api_key or x_api_key.strip() != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_api_key",
        )


@app.get("/health")
async def health() -> dict:
    """Lightweight readiness probe.

    Reports whether the two native binaries we depend on are reachable on
    PATH, plus model/device config. Intentionally cheap — does NOT load
    Whisper. The Edge Function uses this to short-circuit before paying
    for a full /transcribe call when the service is misconfigured.
    """
    return {
        "ok": True,
        "service": "transcription-service",
        "provider": "yt-dlp+whisper",
        "model": WHISPER_MODEL,
        "device": WHISPER_DEVICE,
        "yt_dlp_available": shutil.which("yt-dlp") is not None,
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
    }


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    body: TranscribeRequest,
    _auth: None = Depends(require_api_key),
) -> TranscribeResponse:
    url = body.url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        return TranscribeResponse(success=False, error="invalid_url")

    started = time.monotonic()
    LOG.info("transcribe request url=%s", _safe_url(url))

    try:
        transcript = await asyncio.wait_for(_pipeline(url), timeout=TIMEOUT_SEC)
    except asyncio.TimeoutError:
        LOG.warning("transcribe timeout url=%s after=%ss", _safe_url(url), TIMEOUT_SEC)
        return TranscribeResponse(success=False, error="timeout")
    except Exception as exc:  # noqa: BLE001 — fail-open response
        LOG.exception("transcribe failed url=%s", _safe_url(url))
        return TranscribeResponse(success=False, error=f"internal_error:{type(exc).__name__}")

    elapsed = time.monotonic() - started
    if not transcript:
        LOG.info("transcribe empty url=%s elapsed=%.2fs", _safe_url(url), elapsed)
        return TranscribeResponse(success=False, error="empty_transcript")

    if len(transcript) > MAX_TRANSCRIPT_CHARS:
        transcript = transcript[:MAX_TRANSCRIPT_CHARS]

    LOG.info(
        "transcribe success url=%s chars=%d elapsed=%.2fs",
        _safe_url(url),
        len(transcript),
        elapsed,
    )
    return TranscribeResponse(success=True, transcript=transcript)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


async def _pipeline(url: str) -> str:
    """Download audio with yt-dlp, transcribe with Whisper, return text.

    Always cleans up the temp dir, regardless of success/failure.
    """
    tmp_dir = Path(tempfile.mkdtemp(prefix="nearr-transcribe-"))
    try:
        audio_path = await _download_audio(url, tmp_dir)
        if audio_path is None or not audio_path.exists():
            raise RuntimeError("download_failed")
        transcript = await _whisper_transcribe(audio_path)
        return transcript.strip()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def _download_audio(url: str, dest_dir: Path) -> Optional[Path]:
    """Run yt-dlp as a subprocess to fetch best audio.

    We use the CLI rather than the python module to keep memory steady —
    yt-dlp's python API holds quite a bit of state per import.
    """
    out_template = str(dest_dir / "audio.%(ext)s")
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        "-f",
        "bestaudio/best",
        # Convert to a Whisper-friendly format. Requires ffmpeg on PATH.
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        "-o",
        out_template,
        url,
    ]
    LOG.debug("yt-dlp cmd=%s", " ".join(cmd))
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=YTDLP_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError("ytdlp_timeout")

    if proc.returncode != 0:
        err = (stderr or b"").decode("utf-8", errors="replace").strip().splitlines()[-1:]
        LOG.warning("yt-dlp rc=%s err=%s", proc.returncode, err)
        raise RuntimeError(f"ytdlp_rc_{proc.returncode}")

    # yt-dlp picks the actual extension; find whatever it produced.
    candidates = sorted(dest_dir.glob("audio.*"))
    return candidates[0] if candidates else None


async def _whisper_transcribe(audio_path: Path) -> str:
    """Run Whisper inference. Lazily loads (and caches) the model."""
    global _whisper_model
    async with _whisper_lock:
        if _whisper_model is None:
            import whisper  # type: ignore

            LOG.info("loading whisper model=%s device=%s", WHISPER_MODEL, WHISPER_DEVICE)
            _whisper_model = whisper.load_model(WHISPER_MODEL, device=WHISPER_DEVICE)

    # whisper.transcribe is sync + CPU-bound; offload so the event loop
    # can handle other requests.
    def _run() -> str:
        # fp16=False is required on CPU; harmless on GPU when explicit.
        result = _whisper_model.transcribe(  # type: ignore[union-attr]
            str(audio_path),
            fp16=(WHISPER_DEVICE != "cpu"),
        )
        return (result.get("text") or "").strip()

    return await asyncio.to_thread(_run)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_url(url: str) -> str:
    return url if len(url) <= 120 else url[:117] + "..."
