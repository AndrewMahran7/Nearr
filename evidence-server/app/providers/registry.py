"""Platform provider registry.

The router/services should always go through `get_metadata_provider`,
`get_profile_provider`, `get_transcript_provider`. Each returns either
a real provider implementation or a stub that raises a structured
`EvidenceError(UNSUPPORTED_PLATFORM)`.
"""
from __future__ import annotations

from typing import Optional

from ..errors import ErrorType, EvidenceError
from .base import SocialMetadataProvider, SocialProfileProvider, SocialTranscriptProvider
from .instagram import metadata as ig_metadata
from .instagram import profile as ig_profile
from .instagram import transcript as ig_transcript
from .tiktok import stubs as tiktok_stubs
from .x import stubs as x_stubs
from .youtube import stubs as youtube_stubs

SUPPORTED_PLATFORMS = ("instagram", "tiktok", "youtube", "x")


def _platform_or_raise(platform: str) -> str:
    p = (platform or "").lower()
    if p not in SUPPORTED_PLATFORMS:
        raise EvidenceError(ErrorType.UNSUPPORTED_PLATFORM, f"Platform '{platform}' is not supported")
    return p


def get_metadata_provider(platform: str) -> SocialMetadataProvider:
    p = _platform_or_raise(platform)
    if p == "instagram":
        return ig_metadata.InstagramMetadataProvider()
    if p == "tiktok":
        return tiktok_stubs.TikTokMetadataStub()
    if p == "youtube":
        return youtube_stubs.YouTubeMetadataStub()
    if p == "x":
        return x_stubs.XMetadataStub()
    raise EvidenceError(ErrorType.UNSUPPORTED_PLATFORM, p)


def get_profile_provider(platform: str) -> SocialProfileProvider:
    p = _platform_or_raise(platform)
    if p == "instagram":
        return ig_profile.InstagramProfileProvider()
    if p == "tiktok":
        return tiktok_stubs.TikTokProfileStub()
    if p == "youtube":
        return youtube_stubs.YouTubeProfileStub()
    if p == "x":
        return x_stubs.XProfileStub()
    raise EvidenceError(ErrorType.UNSUPPORTED_PLATFORM, p)


def get_transcript_provider(platform: str) -> SocialTranscriptProvider:
    p = _platform_or_raise(platform)
    if p == "instagram":
        return ig_transcript.InstagramTranscriptProvider()
    if p == "tiktok":
        return tiktok_stubs.TikTokTranscriptStub()
    if p == "youtube":
        return youtube_stubs.YouTubeTranscriptStub()
    if p == "x":
        return x_stubs.XTranscriptStub()
    raise EvidenceError(ErrorType.UNSUPPORTED_PLATFORM, p)
