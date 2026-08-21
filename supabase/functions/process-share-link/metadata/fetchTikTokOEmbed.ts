// supabase/functions/process-share-link/metadata/fetchTikTokOEmbed.ts
//
// Conservative, OFFICIAL, keyless TikTok metadata fallback.
//
// TikTok video pages frequently serve a JS-gated / challenge page to
// generic bots, so `og:title` / `og:description` can come back empty.
// TikTok's public oEmbed endpoint is the documented, auth-free way to
// read a public video's caption + author:
//
//   GET https://www.tiktok.com/oembed?url=<canonical video url>
//   → { title, author_name, author_url, thumbnail_url, html, ... }
//
// Docs: https://developers.tiktok.com/doc/embed-videos/ (oEmbed API).
//
// We use ONLY `title` (the caption) as caption evidence. We deliberately
// do NOT feed `author_name` into the place query — the creator handle is
// the classic "tiktok-creator-trap" and would produce noisy/wrong
// candidates. This endpoint requires a canonical `@user/video/<id>` URL;
// short links must be redirect-resolved first (see fetchMetadata.ts).
//
// NEVER logs the token/headers/HTML. Best-effort: any failure returns
// { ok:false } and the caller degrades (usually → manual fallback).

// @ts-nocheck — Deno runtime.

import {
  buildTikTokOEmbedUrl,
  extractTikTokPostIdentity,
} from '../../../../lib/shareAgent/tiktokUrl.ts';

const USER_AGENT =
  'Mozilla/5.0 (compatible; NearrBot/1.0; +https://nearr.app)';
const OEMBED_TIMEOUT_MS = 6000;

export type TikTokOEmbedResult =
  | {
      ok: true;
      title: string | null;
      authorName: string | null;
      creatorHandle: string | null;
      postId: string | null;
      canonicalUrl: string | null;
    }
  | { ok: false; reason: 'network_error' | 'http_error' | 'bad_json'; error?: string };

function boundedHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/^@/, '');
  return /^[a-z0-9._]{1,30}$/.test(normalized) ? normalized : null;
}

function boundedPostId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^\d{1,24}$/.test(normalized) ? normalized : null;
}

function identityFromOEmbed(obj: Record<string, unknown>, requestUrl: string) {
  const html = typeof obj.html === 'string' ? obj.html : '';
  const cite = html.match(/\bcite=["']([^"']+)["']/i)?.[1] ?? null;
  const citeIdentity = cite ? extractTikTokPostIdentity(cite.replace(/&amp;/g, '&')) : null;
  const requestIdentity = extractTikTokPostIdentity(requestUrl);
  const authorUrlIdentity = typeof obj.author_url === 'string'
    ? obj.author_url.match(/\/\@([A-Za-z0-9._]{1,30})(?:[/?#]|$)/)
    : null;
  const creatorHandle =
    boundedHandle(obj.author_unique_id) ??
    citeIdentity?.creatorHandle ??
    boundedHandle(authorUrlIdentity?.[1]) ??
    requestIdentity?.creatorHandle ??
    null;
  const postId =
    boundedPostId(obj.embed_product_id) ??
    boundedPostId(html.match(/\bdata-video-id=["'](\d{1,24})["']/i)?.[1]) ??
    citeIdentity?.postId ??
    requestIdentity?.postId ??
    null;
  const canonicalUrl = citeIdentity?.canonicalUrl ??
    (creatorHandle && postId
      ? `https://www.tiktok.com/@${creatorHandle}/video/${postId}`
      : requestIdentity?.canonicalUrl ?? null);
  return { creatorHandle, postId, canonicalUrl };
}

export async function fetchTikTokOEmbed(
  canonicalUrl: string,
): Promise<TikTokOEmbedResult> {
  const endpoint = buildTikTokOEmbedUrl(canonicalUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OEMBED_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: 'http_error', error: `HTTP ${res.status}` };
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch (err) {
      return { ok: false, reason: 'bad_json', error: (err as Error)?.message };
    }
    const obj = (data ?? {}) as Record<string, unknown>;
    const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : null;
    const authorName =
      typeof obj.author_name === 'string' && obj.author_name.trim()
        ? obj.author_name.trim()
        : null;
    const identity = identityFromOEmbed(obj, canonicalUrl);
    return { ok: true, title, authorName, ...identity };
  } catch (err) {
    return { ok: false, reason: 'network_error', error: (err as Error)?.message };
  } finally {
    clearTimeout(timer);
  }
}
