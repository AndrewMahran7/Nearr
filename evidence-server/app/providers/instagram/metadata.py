from __future__ import annotations

from typing import Any

from ...models.responses import Post, VideoMetadata
from ...utils import extract_handles, extract_hashtags
from ._ytdlp import oembed_caption, ydl_extract


class InstagramMetadataProvider:
    platform = "instagram"

    async def fetch_post_metadata(self, url: str) -> tuple[Post, VideoMetadata]:
        info: dict[str, Any] = {}
        try:
            info = await ydl_extract(url)
        except Exception:
            # We'll still try oEmbed for caption-only fallback
            info = {}

        title = info.get("title") or None
        description = info.get("description") or info.get("alt_title") or None
        author = info.get("uploader") or info.get("uploader_id") or info.get("channel") or None

        caption = description or title
        if not caption:
            caption = await oembed_caption(url)

        handles = extract_handles(caption)
        if author:
            a = author.lstrip("@").lower()
            if a and a not in handles:
                handles.insert(0, a)

        post = Post(
            title=title,
            caption=caption,
            author_handle=author.lstrip("@").lower() if author else None,
            tagged_handles=handles,
            hashtags=extract_hashtags(caption),
        )
        metadata = VideoMetadata(
            title=title,
            description=description,
            author_handle=post.author_handle,
            detected_handles=handles,
        )
        return post, metadata
