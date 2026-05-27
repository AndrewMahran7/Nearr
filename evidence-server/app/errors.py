from __future__ import annotations

from enum import Enum


class ErrorType(str, Enum):
    UNSUPPORTED_PLATFORM = "unsupported_platform"
    METADATA_UNAVAILABLE = "metadata_unavailable"
    TRANSCRIPT_UNAVAILABLE = "transcript_unavailable"
    PROFILE_UNAVAILABLE = "profile_unavailable"
    RATE_LIMITED = "rate_limited"
    PROVIDER_ERROR = "provider_error"
    TIMEOUT = "timeout"
    INVALID_INPUT = "invalid_input"


class EvidenceError(Exception):
    def __init__(self, error_type: ErrorType, message: str, *, provider: str | None = None):
        super().__init__(message)
        self.error_type = error_type
        self.message = message
        self.provider = provider

    def to_dict(self) -> dict:
        return {
            "type": self.error_type.value,
            "message": self.message,
            "provider": self.provider,
        }


def make_error(error_type: ErrorType, message: str, provider: str | None = None) -> dict:
    return {"type": error_type.value, "message": message, "provider": provider}
