"""X/Twitter stubs – not implemented in MVP.

To implement: official X API v2 (with bearer token) for tweets + user lookup,
or snscrape (rate-limited). Both require careful handling of guest tokens.
"""
from __future__ import annotations

from ...errors import ErrorType, EvidenceError
from ...models.responses import Post, Profile, Transcript, VideoMetadata


def _unsupported(op: str):
    raise EvidenceError(ErrorType.UNSUPPORTED_PLATFORM, f"x.{op} not implemented yet", provider="x")


class XMetadataStub:
    platform = "x"

    async def fetch_post_metadata(self, url: str) -> tuple[Post, VideoMetadata]:  # noqa: ARG002
        _unsupported("metadata")


class XProfileStub:
    platform = "x"

    async def fetch_profile(self, handle: str) -> Profile:  # noqa: ARG002
        _unsupported("profile")


class XTranscriptStub:
    platform = "x"

    async def fetch_transcript(self, url: str) -> Transcript:  # noqa: ARG002
        _unsupported("transcript")
