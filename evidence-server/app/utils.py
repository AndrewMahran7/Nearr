from __future__ import annotations

import re
from urllib.parse import urlparse

# Platform detection from URL
_INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com", "instagr.am"}
_TIKTOK_HOSTS = {"tiktok.com", "www.tiktok.com", "vm.tiktok.com", "m.tiktok.com"}
_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
_X_HOSTS = {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"}


def detect_platform(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return "unknown"
    if host in _INSTAGRAM_HOSTS:
        return "instagram"
    if host in _TIKTOK_HOSTS:
        return "tiktok"
    if host in _YOUTUBE_HOSTS:
        return "youtube"
    if host in _X_HOSTS:
        return "x"
    return "unknown"


# Extract @handles mentioned in text
_HANDLE_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_.]{2,30})")
_HASHTAG_RE = re.compile(r"(?<![\w#])#([A-Za-z0-9_]{2,50})")


def extract_handles(text: str | None) -> list[str]:
    if not text:
        return []
    seen: list[str] = []
    for m in _HANDLE_RE.finditer(text):
        h = m.group(1).lower().rstrip(".")
        if h and h not in seen:
            seen.append(h)
    return seen


def extract_hashtags(text: str | None) -> list[str]:
    if not text:
        return []
    seen: list[str] = []
    for m in _HASHTAG_RE.finditer(text):
        h = m.group(1).lower()
        if h and h not in seen:
            seen.append(h)
    return seen


def normalize_handle(handle: str) -> str:
    return handle.strip().lstrip("@").lower()
