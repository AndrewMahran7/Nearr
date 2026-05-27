from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import require_api_key
from ..models.requests import VideoTranscriptRequest
from ..models.responses import VideoTranscriptResponse
from ..services.transcript_service import get_video_transcript

router = APIRouter(prefix="/extract", tags=["extract"])


@router.post("/video-transcript", response_model=VideoTranscriptResponse, dependencies=[Depends(require_api_key)])
async def video_transcript(req: VideoTranscriptRequest) -> VideoTranscriptResponse:
    return await get_video_transcript(str(req.url), req.platform)
