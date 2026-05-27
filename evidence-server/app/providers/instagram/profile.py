"""Instagram profile bio provider.

Strategy:
1. Try instaloader (anonymous, or logged-in if creds + session file exist).
2. On rate-limit / login-required, return RATE_LIMITED with structured error.
3. Heuristic classifier extracts name/address/city + classifies bio.

A third-party provider hook is wired but not implemented in MVP; if env
THIRD_PARTY_PROFILE_PROVIDER is set, we log and skip (placeholder for future
RapidAPI / ScrapingDog / etc. adapters).
"""
from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Optional

from ...config import get_settings
from ...errors import ErrorType, EvidenceError
from ...logging_setup import get_logger
from ...models.responses import Profile
from ...utils import normalize_handle

log = get_logger("provider.instagram.profile")


# --- Heuristics ---

_BUSINESS_KEYWORDS = {
    "restaurant", "cafe", "café", "coffee", "bar", "bistro", "grill", "kitchen",
    "eatery", "diner", "bakery", "pizzeria", "taqueria", "trattoria", "pub",
    "brewery", "winery", "menu", "reservations", "reserve", "open", "closed",
    "hours", "delivery", "takeout", "dine", "chef", "tasting", "shop", "store",
    "boutique", "studio", "gym", "spa", "salon", "clinic", "hotel", "inn",
}
_CREATOR_KEYWORDS = {
    "creator", "influencer", "blogger", "vlogger", "youtuber", "tiktoker",
    "content creator", "founder", "ceo", "writer", "photographer",
}
_PERSONAL_HINTS = {"mom", "dad", "husband", "wife", "she/her", "he/him", "they/them"}

_US_STATE_RE = re.compile(r"\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b")
_ADDRESS_RE = re.compile(r"\b\d{1,5}\s+[A-Z][A-Za-z'\.\-]+(?:\s+[A-Za-z'\.\-]+){0,4}\s+(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Hwy|Pkwy|Ct|Pl|Sq|Terr?)\.?")
_CITY_STATE_RE = re.compile(r"([A-Z][A-Za-z'\.\- ]{2,40}),\s*(?:[A-Z]{2}|[A-Z][a-z]{2,})\b")
_URL_RE = re.compile(r"https?://[^\s|,;]+")


def _classify(bio: str | None, category: str | None, is_business: bool | None) -> tuple[str, str]:
    text = (bio or "").lower()
    if is_business:
        return ("restaurant_or_business", "high")
    if category:
        c = category.lower()
        if any(k in c for k in ("restaurant", "food", "bar", "cafe", "business", "shop", "store", "hotel")):
            return ("restaurant_or_business", "high")
        if "creator" in c or "blogger" in c or "artist" in c or "media" in c:
            return ("creator", "medium")
    if any(k in text for k in _BUSINESS_KEYWORDS):
        return ("restaurant_or_business", "medium")
    if any(k in text for k in _CREATOR_KEYWORDS):
        return ("creator", "medium")
    if any(k in text for k in _PERSONAL_HINTS):
        return ("personal", "low")
    return ("unknown", "low")


def _extract_location(bio: str | None) -> tuple[Optional[str], Optional[str]]:
    if not bio:
        return None, None
    addr_match = _ADDRESS_RE.search(bio)
    city_match = _CITY_STATE_RE.search(bio)
    address = addr_match.group(0).strip() if addr_match else None
    city = city_match.group(1).strip() if city_match else None
    return address, city


def _extract_external_links(bio: str | None, website: str | None) -> list[str]:
    links: list[str] = []
    if website:
        links.append(website)
    if bio:
        for m in _URL_RE.finditer(bio):
            u = m.group(0)
            if u not in links:
                links.append(u)
    return links


# --- Provider ---

class InstagramProfileProvider:
    platform = "instagram"

    async def fetch_profile(self, handle: str) -> Profile:
        handle = normalize_handle(handle)
        if not handle:
            raise EvidenceError(ErrorType.INVALID_INPUT, "empty handle", provider="instagram.profile")

        try:
            data = await asyncio.to_thread(_instaloader_fetch, handle)
        except EvidenceError:
            raise
        except Exception as e:  # noqa: BLE001
            raise EvidenceError(ErrorType.PROVIDER_ERROR, str(e), provider="instagram.profile")

        bio = data.get("biography") or ""
        category = data.get("category_name")
        website = data.get("external_url")
        is_business = bool(data.get("is_business_account"))
        display_name = data.get("full_name")

        address, city = _extract_location(bio)
        classification, confidence = _classify(bio, category, is_business)

        # extracted_name: prefer full_name, fall back to a cleaned-up handle-cased label
        extracted_name = display_name or handle

        return Profile(
            display_name=display_name,
            bio=bio,
            category=category,
            website=website,
            external_links=_extract_external_links(bio, website),
            is_business=is_business,
            extracted_name=extracted_name,
            extracted_address=address,
            extracted_city=city,
            classification=classification,  # type: ignore[arg-type]
            confidence=confidence,  # type: ignore[arg-type]
        )


def _instaloader_fetch(handle: str) -> dict[str, Any]:
    """Blocking instaloader call. Returns a dict of fields we care about.

    Raises EvidenceError on rate-limit / login-required / not-found.
    """
    settings = get_settings()
    try:
        import instaloader  # type: ignore
        from instaloader.exceptions import (  # type: ignore
            ConnectionException,
            LoginRequiredException,
            ProfileNotExistsException,
            QueryReturnedBadRequestException,
            TooManyRequestsException,
        )
    except ImportError as e:
        raise EvidenceError(ErrorType.PROVIDER_ERROR, "instaloader not installed", provider="instagram.profile") from e

    L = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        request_timeout=settings.http_timeout_seconds,
        user_agent="Mozilla/5.0 (compatible; NearrEvidenceBot/0.1)",
    )

    # Optional login (improves reliability against IG rate limits)
    if settings.instagram_username and settings.instagram_password:
        session_path = os.path.join(settings.instaloader_session_dir, f"session-{settings.instagram_username}")
        try:
            os.makedirs(settings.instaloader_session_dir, exist_ok=True)
        except Exception:  # noqa: BLE001
            pass
        try:
            if os.path.exists(session_path):
                L.load_session_from_file(settings.instagram_username, filename=session_path)
            else:
                L.login(settings.instagram_username, settings.instagram_password)
                try:
                    L.save_session_to_file(filename=session_path)
                except Exception:  # noqa: BLE001
                    pass
        except Exception as e:  # noqa: BLE001
            log.warning("instaloader.login_failed", error=str(e))

    try:
        p = instaloader.Profile.from_username(L.context, handle)
    except ProfileNotExistsException as e:
        raise EvidenceError(ErrorType.PROFILE_UNAVAILABLE, f"profile not found: {handle}", provider="instagram.profile") from e
    except (TooManyRequestsException, QueryReturnedBadRequestException) as e:
        raise EvidenceError(ErrorType.RATE_LIMITED, str(e), provider="instagram.profile") from e
    except LoginRequiredException as e:
        raise EvidenceError(ErrorType.RATE_LIMITED, "login_required", provider="instagram.profile") from e
    except ConnectionException as e:
        msg = str(e).lower()
        if "401" in msg or "login" in msg or "checkpoint" in msg:
            raise EvidenceError(ErrorType.RATE_LIMITED, str(e), provider="instagram.profile") from e
        if "429" in msg or "wait a few" in msg or "rate" in msg:
            raise EvidenceError(ErrorType.RATE_LIMITED, str(e), provider="instagram.profile") from e
        raise EvidenceError(ErrorType.PROVIDER_ERROR, str(e), provider="instagram.profile") from e

    return {
        "username": p.username,
        "full_name": p.full_name,
        "biography": p.biography,
        "external_url": p.external_url,
        "is_business_account": getattr(p, "is_business_account", False),
        "category_name": getattr(p, "business_category_name", None) or getattr(p, "category_name", None),
        "followers": p.followers,
    }
