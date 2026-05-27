from __future__ import annotations

from ..errors import EvidenceError
from ..logging_setup import get_logger
from ..models.responses import Transcript, VideoMetadata, VideoTranscriptResponse
from ..providers.registry import get_metadata_provider, get_transcript_provider
from ..timing import elapsed_ms, now_ms, with_provider_timeout
from ..utils import detect_platform, extract_handles

log = get_logger("svc.transcript")


async def get_video_transcript(url: str, platform: str | None = None) -> VideoTranscriptResponse:
    start = now_ms()
    p = (platform or detect_platform(url)).lower()
    errors: list[dict] = []

    metadata = VideoMetadata()
    transcript = Transcript()

    # Metadata first (cheap, also gives us caption text + handles)
    try:
        meta_provider = get_metadata_provider(p)
        _, metadata = await with_provider_timeout(meta_provider.fetch_post_metadata(url), label=f"{p}.metadata")
    except EvidenceError as e:
        errors.append(e.to_dict())
        log.info("metadata.failed", platform=p, error=e.error_type.value)

    # Transcript
    try:
        tr_provider = get_transcript_provider(p)
        transcript = await with_provider_timeout(tr_provider.fetch_transcript(url), label=f"{p}.transcript")
    except EvidenceError as e:
        errors.append(e.to_dict())
        log.info("transcript.failed", platform=p, error=e.error_type.value)

    # Merge handles detected in caption + transcript
    merged = list(metadata.detected_handles)
    for h in extract_handles(transcript.text):
        if h not in merged:
            merged.append(h)
    metadata.detected_handles = merged

    success = bool(transcript.text) or bool(metadata.title or metadata.description)
    return VideoTranscriptResponse(
        success=success,
        platform=p,
        url=url,
        transcript=transcript,
        metadata=metadata,
        errors=errors,
        latency_ms=elapsed_ms(start),
    )
