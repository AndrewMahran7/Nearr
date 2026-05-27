from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, HttpUrl

Platform = Literal["instagram", "tiktok", "youtube", "x", "unknown"]


class VideoTranscriptRequest(BaseModel):
    url: HttpUrl
    platform: Optional[Platform] = None


class ProfileBioRequest(BaseModel):
    platform: Platform
    handle: str = Field(min_length=1, max_length=64)


class SocialEvidenceRequest(BaseModel):
    url: HttpUrl
    include_transcript: bool = Field(default=True, alias="includeTranscript")
    include_profiles: bool = Field(default=True, alias="includeProfiles")

    model_config = {"populate_by_name": True}
