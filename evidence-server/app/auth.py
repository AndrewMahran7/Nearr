from __future__ import annotations

from fastapi import Header, HTTPException, status

from .config import get_settings

API_KEY_HEADER = "X-NEARR-EVIDENCE-KEY"


async def require_api_key(x_nearr_evidence_key: str | None = Header(default=None, alias=API_KEY_HEADER)) -> None:
    expected = get_settings().nearr_evidence_server_key
    if not expected:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="server_key_not_configured")
    if not x_nearr_evidence_key or x_nearr_evidence_key != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_api_key")
