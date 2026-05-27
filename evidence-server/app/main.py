from __future__ import annotations

import asyncio
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import get_settings
from .errors import ErrorType, EvidenceError, make_error
from .logging_setup import get_logger, setup_logging
from .routers import evidence as evidence_router
from .routers import profile as profile_router
from .routers import transcript as transcript_router

setup_logging()
log = get_logger("app")
settings = get_settings()

app = FastAPI(
    title="Nearr Social Evidence Server",
    version="0.1.0",
    description="Standalone social media evidence extraction service (Instagram MVP).",
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    # structlog contextvars
    import structlog
    structlog.contextvars.bind_contextvars(request_id=rid, path=request.url.path, method=request.method)
    try:
        # Hard per-request timeout
        response = await asyncio.wait_for(call_next(request), timeout=settings.request_timeout_seconds)
        response.headers["x-request-id"] = rid
        return response
    except asyncio.TimeoutError:
        log.warning("request.timeout")
        return JSONResponse(
            status_code=504,
            content={"success": False, "errors": [make_error(ErrorType.TIMEOUT, "request_timeout")]},
            headers={"x-request-id": rid},
        )
    finally:
        structlog.contextvars.clear_contextvars()


@app.exception_handler(EvidenceError)
async def _evidence_error_handler(_: Request, exc: EvidenceError):
    status = 400 if exc.error_type == ErrorType.INVALID_INPUT else 200
    if exc.error_type == ErrorType.UNSUPPORTED_PLATFORM:
        status = 400
    return JSONResponse(status_code=status, content={"success": False, "errors": [exc.to_dict()]})


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nearr-evidence-server", "version": app.version}


@app.get("/")
async def root():
    return {
        "service": "nearr-evidence-server",
        "endpoints": [
            "POST /extract/video-transcript",
            "POST /extract/profile-bio",
            "POST /extract/social-evidence",
            "GET  /health",
        ],
    }


app.include_router(transcript_router.router)
app.include_router(profile_router.router)
app.include_router(evidence_router.router)
