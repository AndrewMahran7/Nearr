"""Provider interfaces.

Three orthogonal capabilities a platform module may implement:

- SocialMetadataProvider: post/video metadata (title, caption, author, hashtags...)
- SocialProfileProvider:  profile bio for a handle
- SocialTranscriptProvider: spoken-word transcript for a video/reel

A platform module exposes whichever subset it can support. Unsupported
operations should raise `EvidenceError(UNSUPPORTED_PLATFORM)` or return a
structured failure rather than throwing.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..models.responses import Post, Profile, Transcript, VideoMetadata


@runtime_checkable
class SocialMetadataProvider(Protocol):
    platform: str

    async def fetch_post_metadata(self, url: str) -> tuple[Post, VideoMetadata]:
        """Return (Post, VideoMetadata). Raise EvidenceError on failure."""
        ...


@runtime_checkable
class SocialProfileProvider(Protocol):
    platform: str

    async def fetch_profile(self, handle: str) -> Profile:
        """Return Profile for handle. Raise EvidenceError on failure."""
        ...


@runtime_checkable
class SocialTranscriptProvider(Protocol):
    platform: str

    async def fetch_transcript(self, url: str) -> Transcript:
        """Return Transcript. Raise EvidenceError(TRANSCRIPT_UNAVAILABLE) if none."""
        ...
