// supabase/functions/process-share-link/metadata/fetchMetadata.ts
//
// Fetch the raw HTML for a share URL and extract a normalized
// `PostMetadata` shape.
//   - 8-second hard timeout on the HTML fetch
//   - User-agent set to NearrBot
//   - captures the post-redirect canonical URL (`resolvedUrl`) so short
//     links (vm./vt.tiktok.com) resolve to `@user/video/<id>`
//   - TikTok-only: when OG metadata is thin, fall back to the OFFICIAL,
//     keyless TikTok oEmbed endpoint for the caption (Phase 3)
//   - Failures are propagated; callers decide how to degrade.

// @ts-nocheck — Deno runtime.

import { pickMeta, pickTitle } from './htmlMeta.ts';
import { cleanTitle, cleanDescription } from './normalizeText.ts';
import { fetchTikTokOEmbed } from './fetchTikTokOEmbed.ts';
import { normalizeShareUrl } from '../../../../lib/shareAgent/tiktokUrl.ts';

const USER_AGENT =
  'Mozilla/5.0 (compatible; NearrBot/1.0; +https://nearr.app)';
const FETCH_TIMEOUT_MS = 8000;
// TikTok OG descriptions are often empty or a generic boilerplate line;
// below this length we try the oEmbed caption as a richer signal.
const TIKTOK_MIN_DESC_LEN = 24;

export type PostMetadata = {
  title: string | null;
  description: string | null;
  /** Raw HTML — kept so caller can run platform-specific extra
   *  scrapes (e.g. Instagram profile enrichment). */
  html: string;
};

export type FetchMetadataResult =
  | {
      ok: true;
      metadata: PostMetadata;
      /** Post-redirect, tracking-stripped canonical URL. Equals the input
       *  when no redirect happened / parsing failed. */
      resolvedUrl: string;
      /** True when the TikTok oEmbed fallback supplied the caption. */
      usedTikTokOEmbed: boolean;
    }
  | { ok: false; reason: 'network_error' | 'http_error'; error?: string };

export async function fetchPostMetadata(
  url: string,
  platform?: string,
): Promise<FetchMetadataResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let title: string | null = null;
  let description: string | null = null;
  let html = '';
  let htmlOk = false;
  let resolvedUrl = url;
  let networkError: string | undefined;
  let httpError: string | undefined;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      signal: ctrl.signal,
    });
    // `res.url` is the FINAL url after redirect follow — this is how a
    // vm./vt.tiktok.com short link resolves to its canonical video URL.
    resolvedUrl = normalizeShareUrl(res.url || url).url || url;
    if (res.ok) {
      html = await res.text();
      title = cleanTitle(pickMeta(html, 'og:title') ?? pickTitle(html));
      description = cleanDescription(
        pickMeta(html, 'og:description') ?? pickMeta(html, 'description'),
      );
      htmlOk = true;
    } else {
      httpError = `HTTP ${res.status}`;
    }
  } catch (err) {
    networkError = (err as Error)?.message;
  } finally {
    clearTimeout(timer);
  }

  // ---- TikTok oEmbed fallback (Phase 3) --------------------------------
  // Official, keyless. Only used to fill a MISSING/THIN caption — never to
  // inject the creator handle as a place signal. Feeds the exact same
  // evidence/resolver pipeline as Instagram (no TikTok safety shortcut).
  let usedTikTokOEmbed = false;
  if (platform === 'tiktok' && (!description || description.length < TIKTOK_MIN_DESC_LEN)) {
    const oe = await fetchTikTokOEmbed(resolvedUrl);
    if (oe.ok && oe.title) {
      const caption = cleanDescription(oe.title);
      if (caption && (!description || caption.length > description.length)) {
        description = caption;
        usedTikTokOEmbed = true;
      }
    }
  }

  if (!htmlOk && !title && !description) {
    // Nothing usable from HTML or oEmbed → let the caller degrade to the
    // requires-app / manual fallback path.
    if (httpError) return { ok: false, reason: 'http_error', error: httpError };
    return { ok: false, reason: 'network_error', error: networkError };
  }

  return {
    ok: true,
    metadata: { title, description, html },
    resolvedUrl,
    usedTikTokOEmbed,
  };
}
