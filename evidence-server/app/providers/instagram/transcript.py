"""Instagram transcript provider.

Strategy:
1. Try yt-dlp captions / automatic subtitles (rare for IG, but cheap).
2. If `ENABLE_WHISPER=true` and ffmpeg available, download audio with yt-dlp
   and transcribe with faster-whisper (lazy import). Off by default for MVP.
3. Otherwise return TRANSCRIPT_UNAVAILABLE.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from typing import Any

import httpx

from ...config import get_settings
from ...errors import ErrorType, EvidenceError
from ...logging_setup import get_logger
from ...models.responses import Transcript, TranscriptSegment
from ._ytdlp import ydl_extract

log = get_logger("provider.instagram.transcript")


def _pick_caption_track(info: dict[str, Any]) -> tuple[str | None, str | None]:
    """Return (subtitle_url, language) preferring manual subs, then auto-captions."""
    for key in ("subtitles", "automatic_captions"):
        tracks = info.get(key) or {}
        if not tracks:
            continue
        preferred = ["en", "en-US", "en-GB"]
        langs = preferred + [l for l in tracks.keys() if l not in preferred]
        for lang in langs:
            entries = tracks.get(lang)
            if not entries:
                continue
            # Prefer vtt then any
            for ext in ("vtt", "srv3", "ttml", "json3"):
                for entry in entries:
                    if entry.get("ext") == ext and entry.get("url"):
                        return entry["url"], lang
            if entries[0].get("url"):
                return entries[0]["url"], lang
    return None, None


async def _download_text(url: str) -> str:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.http_timeout_seconds) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.text


def _vtt_to_segments(vtt: str) -> tuple[str, list[TranscriptSegment]]:
    """Very small VTT parser. Returns (full_text, segments)."""
    segments: list[TranscriptSegment] = []
    text_parts: list[str] = []
    lines = vtt.splitlines()
    i = 0

    def _ts(s: str) -> float:
        try:
            h, m, rest = s.split(":")
            sec, _, ms = rest.partition(".")
            return int(h) * 3600 + int(m) * 60 + int(sec) + (int(ms or 0) / 1000.0)
        except Exception:  # noqa: BLE001
            return 0.0

    while i < len(lines):
        line = lines[i].strip()
        if "-->" in line:
            try:
                start_s, end_s = [p.strip() for p in line.split("-->")]
                start = _ts(start_s.split(" ")[0])
                end = _ts(end_s.split(" ")[0])
                i += 1
                buf: list[str] = []
                while i < len(lines) and lines[i].strip():
                    buf.append(lines[i].strip())
                    i += 1
                txt = " ".join(buf).strip()
                if txt:
                    segments.append(TranscriptSegment(start=start, end=end, text=txt))
                    text_parts.append(txt)
            except Exception:  # noqa: BLE001
                pass
        i += 1
    return (" ".join(text_parts).strip(), segments)


class InstagramTranscriptProvider:
    platform = "instagram"

    async def fetch_transcript(self, url: str) -> Transcript:
        settings = get_settings()

        # --- 1. yt-dlp captions ---
        try:
            info = await ydl_extract(
                url,
                extra={
                    "writesubtitles": True,
                    "writeautomaticsub": True,
                    "subtitleslangs": ["en", "en-US"],
                },
            )
            sub_url, lang = _pick_caption_track(info)
            if sub_url:
                try:
                    raw = await _download_text(sub_url)
                    text, segs = _vtt_to_segments(raw)
                    if text:
                        return Transcript(
                            text=text,
                            source="captions",
                            confidence="medium",
                            language=lang,
                            segments=segs,
                        )
                except Exception as e:  # noqa: BLE001
                    log.debug("ig.caption_download_failed", error=str(e))
        except EvidenceError as e:
            if e.error_type == ErrorType.RATE_LIMITED:
                raise
            log.debug("ig.captions_extract_failed", error=str(e))

        # --- 2. Whisper (feature-flagged) ---
        if settings.enable_whisper:
            try:
                return await self._whisper_transcribe(url)
            except EvidenceError:
                raise
            except Exception as e:  # noqa: BLE001
                log.warning("ig.whisper_failed", error=str(e))

        raise EvidenceError(
            ErrorType.TRANSCRIPT_UNAVAILABLE,
            "No captions available and Whisper transcription is disabled or failed",
            provider="instagram.transcript",
        )

    # --- Whisper path (lazy import; only if ENABLE_WHISPER=true) ---
    async def _whisper_transcribe(self, url: str) -> Transcript:
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except ImportError as e:
            raise EvidenceError(
                ErrorType.PROVIDER_ERROR,
                "faster-whisper is not installed (set ENABLE_WHISPER=false or install it)",
                provider="instagram.whisper",
            ) from e

        settings = get_settings()
        tmpdir = tempfile.mkdtemp(prefix="ig_audio_", dir="/data/tmp" if os.path.isdir("/data/tmp") else None)
        outtmpl = os.path.join(tmpdir, "audio.%(ext)s")

        def _download() -> str:
            from yt_dlp import YoutubeDL
            opts = {
                "quiet": True,
                "no_warnings": True,
                "outtmpl": outtmpl,
                "format": "bestaudio/best",
                "postprocessors": [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "128"},
                ],
            }
            if settings.ytdlp_cookies_file:
                opts["cookiefile"] = settings.ytdlp_cookies_file
            with YoutubeDL(opts) as ydl:
                ydl.download([url])
            for fn in os.listdir(tmpdir):
                if fn.endswith(".mp3"):
                    return os.path.join(tmpdir, fn)
            raise EvidenceError(ErrorType.PROVIDER_ERROR, "audio_download_failed", provider="instagram.whisper")

        audio_path = await asyncio.to_thread(_download)

        def _transcribe() -> tuple[str, list[TranscriptSegment], str | None]:
            model = WhisperModel(settings.whisper_model, device=settings.whisper_device, compute_type="int8")
            segments, info = model.transcribe(audio_path, vad_filter=True)
            segs: list[TranscriptSegment] = []
            parts: list[str] = []
            for s in segments:
                segs.append(TranscriptSegment(start=float(s.start), end=float(s.end), text=s.text.strip()))
                parts.append(s.text.strip())
            return (" ".join(parts).strip(), segs, getattr(info, "language", None))

        text, segs, lang = await asyncio.to_thread(_transcribe)
        return Transcript(text=text, source="audio", confidence="high", language=lang, segments=segs)
