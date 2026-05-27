from __future__ import annotations

from ..errors import EvidenceError
from ..logging_setup import get_logger
from ..models.responses import ProfileBioResponse
from ..providers.registry import get_profile_provider
from ..timing import elapsed_ms, now_ms, with_provider_timeout
from ..utils import normalize_handle

log = get_logger("svc.profile")


async def get_profile_bio(platform: str, handle: str) -> ProfileBioResponse:
    start = now_ms()
    p = (platform or "").lower()
    h = normalize_handle(handle)
    errors: list[dict] = []
    profile = None

    try:
        provider = get_profile_provider(p)
        profile = await with_provider_timeout(provider.fetch_profile(h), label=f"{p}.profile")
    except EvidenceError as e:
        errors.append(e.to_dict())
        log.info("profile.failed", platform=p, handle=h, error=e.error_type.value)

    return ProfileBioResponse(
        success=profile is not None,
        platform=p,
        handle=h,
        profile=profile,
        errors=errors,
        latency_ms=elapsed_ms(start),
    )
