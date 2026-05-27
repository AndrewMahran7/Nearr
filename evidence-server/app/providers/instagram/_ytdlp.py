"""Shared yt-dlp helpers for Instagram.

We use yt-dlp's `extract_info` (download=False) to pull metadata + captions for
posts/reels without auth where possible. If yt-dlp returns nothing, we fall back
to oEmbed for caption-only data.

All blocking work runs in a thread (asyncio.to_thread) and is wrapped with a
provider-level timeout in the calling service.
"""
from __future__ import annotations

import asyncio
from typing import Any, Optional

import httpx
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError, ExtractorError

from ...config import get_settings
from ...errors import ErrorType, EvidenceError
from ...logging_setup import get_logger

log = get_logger("provider.instagram")

_OEMBED_URL = "https://api.instagram.com/oembed/"


def _ydl_opts(extra: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    settings = get_settings()
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "extract_flat": False,
        "writesubtitles": False,
        "writeautomaticsub": False,
        # Be polite + identifiable
        "user_agent": "Mozilla/5.0 (compatible; NearrEvidenceBot/0.1)",
        "socket_timeout": int(settings.http_timeout_seconds),
        "retries": 1,
    }
    if settings.ytdlp_cookies_file:
        opts["cookiefile"] = settings.ytdlp_cookies_file
    if extra:
        opts.update(extra)
    return opts


def _ydl_extract_sync(url: str, extra: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    with YoutubeDL(_ydl_opts(extra)) as ydl:
        return ydl.extract_info(url, download=False) or {}


async def ydl_extract(url: str, extra: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(_ydl_extract_sync, url, extra)
    except (DownloadError, ExtractorError) as e:
        msg = str(e).lower()
        if "rate" in msg or "429" in msg or "login" in msg or "checkpoint" in msg:
            raise EvidenceError(ErrorType.RATE_LIMITED, str(e), provider="instagram.ytdlp")
        if "private" in msg or "not available" in msg or "removed" in msg:
            raise EvidenceError(ErrorType.METADATA_UNAVAILABLE, str(e), provider="instagram.ytdlp")
        raise EvidenceError(ErrorType.PROVIDER_ERROR, str(e), provider="instagram.ytdlp")
    except Exception as e:  # noqa: BLE001
        raise EvidenceError(ErrorType.PROVIDER_ERROR, str(e), provider="instagram.ytdlp")


async def oembed_caption(url: str) -> Optional[str]:
    """Public oEmbed fallback – returns title/caption-ish string or None."""
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=settings.http_timeout_seconds) as client:
            r = await client.get(_OEMBED_URL, params={"url": url})
            if r.status_code == 200:
                data = r.json()
                return data.get("title") or data.get("author_name")
    except Exception as e:  # noqa: BLE001
        log.debug("instagram.oembed_failed", error=str(e))
    return None
