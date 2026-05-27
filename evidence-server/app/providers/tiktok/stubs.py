"""TikTok stubs – not implemented in MVP. They return structured UNSUPPORTED_PLATFORM errors.

To implement: yt-dlp supports tiktok well for metadata + captions; profile bios
require either web scraping or a third-party API. Replace stubs with real
providers and register them in `providers/registry.py`.
"""
from __future__ import annotations

from ...errors import ErrorType, EvidenceError
from ...models.responses import Post, Profile, Transcript, VideoMetadata


def _unsupported(op: str):
    raise EvidenceError(ErrorType.UNSUPPORTED_PLATFORM, f"tiktok.{op} not implemented yet", provider="tiktok")


class TikTokMetadataStub:
    platform = "tiktok"

    async def fetch_post_metadata(self, url: str) -> tuple[Post, VideoMetadata]:  # noqa: ARG002
        _unsupported("metadata")


class TikTokProfileStub:
    platform = "tiktok"

    async def fetch_profile(self, handle: str) -> Profile:  # noqa: ARG002
        _unsupported("profile")


class TikTokTranscriptStub:
    platform = "tiktok"

    async def fetch_transcript(self, url: str) -> Transcript:  # noqa: ARG002
        _unsupported("transcript")
