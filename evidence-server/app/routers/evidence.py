from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import require_api_key
from ..models.requests import SocialEvidenceRequest
from ..models.responses import SocialEvidenceResponse
from ..services.evidence_service import get_social_evidence

router = APIRouter(prefix="/extract", tags=["extract"])


@router.post("/social-evidence", response_model=SocialEvidenceResponse, dependencies=[Depends(require_api_key)])
async def social_evidence(req: SocialEvidenceRequest) -> SocialEvidenceResponse:
    return await get_social_evidence(str(req.url), req.include_transcript, req.include_profiles)
