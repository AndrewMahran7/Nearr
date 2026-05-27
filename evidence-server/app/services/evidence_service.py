from __future__ import annotations

import asyncio

from ..errors import EvidenceError
from ..logging_setup import get_logger
from ..models.responses import (
    EvidenceQuality,
    Post,
    ProfileEntry,
    SocialEvidenceResponse,
    Transcript,
)
from ..providers.registry import get_metadata_provider, get_profile_provider, get_transcript_provider
from ..timing import elapsed_ms, now_ms, with_provider_timeout
from ..utils import detect_platform

log = get_logger("svc.evidence")

MAX_PROFILES = 5


def _quality(post: Post | None, profiles: list[ProfileEntry], transcript: Transcript | None) -> EvidenceQuality:
    score = 0
    if post and (post.caption or post.title):
        score += 1
    if transcript and transcript.text:
        score += 2 if transcript.confidence == "high" else 1
    for pe in profiles:
        if pe.profile and pe.profile.classification == "restaurant_or_business":
            score += 2
            break
        if pe.profile:
            score += 1
            break
    if score >= 4:
        return "strong"
    if score >= 2:
        return "medium"
    return "weak"


async def get_social_evidence(url: str, include_transcript: bool, include_profiles: bool) -> SocialEvidenceResponse:
    start = now_ms()
    platform = detect_platform(url)
    errors: list[dict] = []
    post: Post | None = None
    transcript: Transcript | None = None
    profiles: list[ProfileEntry] = []

    # 1. Metadata
    handles_to_resolve: list[str] = []
    try:
        meta_provider = get_metadata_provider(platform)
        post, _vmeta = await with_provider_timeout(
            meta_provider.fetch_post_metadata(url), label=f"{platform}.metadata"
        )
        if post.author_handle:
            handles_to_resolve.append(post.author_handle)
        for h in post.tagged_handles:
            if h not in handles_to_resolve:
                handles_to_resolve.append(h)
    except EvidenceError as e:
        errors.append(e.to_dict())
        log.info("evidence.metadata_failed", platform=platform, error=e.error_type.value)

    # 2. Transcript + profiles in parallel
    async def _do_transcript() -> Transcript | None:
        if not include_transcript:
            return None
        try:
            provider = get_transcript_provider(platform)
            return await with_provider_timeout(provider.fetch_transcript(url), label=f"{platform}.transcript")
        except EvidenceError as e:
            errors.append(e.to_dict())
            log.info("evidence.transcript_failed", platform=platform, error=e.error_type.value)
            return None

    async def _do_profile(handle: str) -> ProfileEntry:
        entry_errors: list[dict] = []
        prof = None
        try:
            provider = get_profile_provider(platform)
            prof = await with_provider_timeout(provider.fetch_profile(handle), label=f"{platform}.profile")
        except EvidenceError as e:
            entry_errors.append(e.to_dict())
            log.info("evidence.profile_failed", platform=platform, handle=handle, error=e.error_type.value)
        return ProfileEntry(handle=handle, profile=prof, errors=entry_errors)

    tasks: list = [_do_transcript()]
    handle_subset = handles_to_resolve[:MAX_PROFILES] if include_profiles else []
    for h in handle_subset:
        tasks.append(_do_profile(h))

    results = await asyncio.gather(*tasks, return_exceptions=False)
    transcript = results[0] if include_transcript else None
    profiles = [r for r in results[1:] if isinstance(r, ProfileEntry)]

    success = post is not None or bool(profiles) or (transcript is not None and bool(transcript.text))
    return SocialEvidenceResponse(
        success=success,
        platform=platform,
        url=url,
        post=post,
        profiles=profiles,
        transcript=transcript,
        evidence_quality=_quality(post, profiles, transcript),
        errors=errors,
        latency_ms=elapsed_ms(start),
    )
