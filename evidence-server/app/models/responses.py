from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Confidence = Literal["high", "medium", "low"]
TranscriptSource = Literal["captions", "audio", "provider", "unavailable"]
Classification = Literal["restaurant_or_business", "creator", "personal", "unknown"]
EvidenceQuality = Literal["strong", "medium", "weak"]


def _camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True)


class TranscriptSegment(CamelModel):
    start: float
    end: float
    text: str


class Transcript(CamelModel):
    text: str = ""
    source: TranscriptSource = "unavailable"
    confidence: Confidence = "low"
    language: Optional[str] = None
    segments: list[TranscriptSegment] = Field(default_factory=list)


class VideoMetadata(CamelModel):
    title: Optional[str] = None
    description: Optional[str] = None
    author_handle: Optional[str] = None
    detected_handles: list[str] = Field(default_factory=list)


class VideoTranscriptResponse(CamelModel):
    success: bool
    platform: str
    url: str
    transcript: Transcript
    metadata: VideoMetadata
    errors: list[dict[str, Any]] = Field(default_factory=list)
    latency_ms: int


class Profile(CamelModel):
    display_name: Optional[str] = None
    bio: Optional[str] = None
    category: Optional[str] = None
    website: Optional[str] = None
    external_links: list[str] = Field(default_factory=list)
    is_business: Optional[bool] = None
    extracted_name: Optional[str] = None
    extracted_address: Optional[str] = None
    extracted_city: Optional[str] = None
    classification: Classification = "unknown"
    confidence: Confidence = "low"


class ProfileBioResponse(CamelModel):
    success: bool
    platform: str
    handle: str
    profile: Optional[Profile] = None
    errors: list[dict[str, Any]] = Field(default_factory=list)
    latency_ms: int


class Post(CamelModel):
    title: Optional[str] = None
    caption: Optional[str] = None
    author_handle: Optional[str] = None
    tagged_handles: list[str] = Field(default_factory=list)
    hashtags: list[str] = Field(default_factory=list)


class ProfileEntry(CamelModel):
    handle: str
    profile: Optional[Profile] = None
    errors: list[dict[str, Any]] = Field(default_factory=list)


class SocialEvidenceResponse(CamelModel):
    success: bool
    platform: str
    url: str
    post: Optional[Post] = None
    profiles: list[ProfileEntry] = Field(default_factory=list)
    transcript: Optional[Transcript] = None
    evidence_quality: EvidenceQuality = "weak"
    errors: list[dict[str, Any]] = Field(default_factory=list)
    latency_ms: int
