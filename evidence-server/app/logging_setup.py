from __future__ import annotations

import logging
import sys

import structlog

from .config import get_settings


def setup_logging() -> None:
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=level,
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name or "evidence")


# --- Secret redaction helpers ---

_SECRET_KEYS = {"password", "api_key", "key", "token", "authorization", "cookie"}


def redact(d: dict) -> dict:
    """Return a shallow copy of d with secret-ish values redacted. Use before logging request bodies."""
    out = {}
    for k, v in (d or {}).items():
        if any(s in k.lower() for s in _SECRET_KEYS):
            out[k] = "***"
        else:
            out[k] = v
    return out
