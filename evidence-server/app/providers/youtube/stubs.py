"""YouTube stubs – not implemented in MVP.

To implement: yt-dlp + youtube-transcript-api covers metadata + captions
robustly. Profiles map to channels/handles via the YouTube Data API.
"""
from __future__ import annotations

from ...errors import ErrorType, EvidenceError
from ...models.responses import Post, Profile, Transcript, VideoMetadata


def _unsupported(op: str):
    raise EvidenceError(ErrorType.UNSUPPORTED_PLATFORM, f"youtube.{op} not implemented yet", provider="youtube")


class YouTubeMetadataStub:
    platform = "youtube"

    async def fetch_post_metadata(self, url: str) -> tuple[Post, VideoMetadata]:  # noqa: ARG002
        _unsupported("metadata")


class YouTubeProfileStub:
    platform = "youtube"

    async def fetch_profile(self, handle: str) -> Profile:  # noqa: ARG002
        _unsupported("profile")


class YouTubeTranscriptStub:
    platform = "youtube"

    async def fetch_transcript(self, url: str) -> Transcript:  # noqa: ARG002
        _unsupported("transcript")
