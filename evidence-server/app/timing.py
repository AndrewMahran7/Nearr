from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable, TypeVar

from .config import get_settings
from .errors import ErrorType, EvidenceError

T = TypeVar("T")


async def with_provider_timeout(coro: Awaitable[T], *, label: str, seconds: float | None = None) -> T:
    """Run an awaitable with a per-provider timeout. Raises EvidenceError(TIMEOUT)."""
    settings = get_settings()
    t = seconds if seconds is not None else settings.provider_timeout_seconds
    try:
        return await asyncio.wait_for(coro, timeout=t)
    except asyncio.TimeoutError as e:
        raise EvidenceError(ErrorType.TIMEOUT, f"{label} timed out after {t:.1f}s", provider=label) from e


def now_ms() -> int:
    return int(time.time() * 1000)


def elapsed_ms(start_ms: int) -> int:
    return max(0, now_ms() - start_ms)
