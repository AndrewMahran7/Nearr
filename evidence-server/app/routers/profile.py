from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import require_api_key
from ..models.requests import ProfileBioRequest
from ..models.responses import ProfileBioResponse
from ..services.profile_service import get_profile_bio

router = APIRouter(prefix="/extract", tags=["extract"])


@router.post("/profile-bio", response_model=ProfileBioResponse, dependencies=[Depends(require_api_key)])
async def profile_bio(req: ProfileBioRequest) -> ProfileBioResponse:
    return await get_profile_bio(req.platform, req.handle)
