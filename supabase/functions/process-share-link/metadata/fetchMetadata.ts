// supabase/functions/process-share-link/metadata/fetchMetadata.ts
//
// Fetch the raw HTML for a share URL and extract a normalized
// `PostMetadata` shape.
//   - 8-second hard timeout on the HTML fetch
//   - User-agent set to NearrBot
//   - captures the post-redirect canonical URL (`resolvedUrl`) so short
//     links (vm./vt.tiktok.com) resolve to `@user/video/<id>`
//   - TikTok-only: use the OFFICIAL keyless oEmbed endpoint for the complete
//     caption plus creator/post identity; HTML remains the fallback
//   - Failures are propagated; callers decide how to degrade.

// @ts-nocheck — Deno runtime.

import { pickMeta, pickTitle } from './htmlMeta.ts';
import { cleanTitle, cleanIngestionCaption } from './normalizeText.ts';
import { fetchTikTokOEmbed } from './fetchTikTokOEmbed.ts';
import {
  extractTikTokPostIdentity,
  isSupportedTikTokShareUrl,
  normalizeShareUrl,
} from '../../../../lib/shareAgent/tiktokUrl.ts';
import { normalizeFacebookMetadata } from './facebookMetadata.ts';
import { inspectFacebookUrl } from '../../../../lib/shareAgent/facebookUrl.ts';
import { selectInstagramContentUrl } from '../../../../lib/shareAgent/instagramUrl.ts';

const USER_AGENT =
  'Mozilla/5.0 (compatible; NearrBot/1.0; +https://nearr.app)';
const FETCH_TIMEOUT_MS = 8000;
export type PostMetadata = {
  title: string | null;
  description: string | null;
  /** Public source identity. It is provenance/context, never a venue hint. */
  creatorHandle: string | null;
  postId: string | null;
  /** Raw HTML — kept so caller can run platform-specific extra
   *  scrapes (e.g. Instagram profile enrichment). */
  html: string;
  titleSource: 'open_graph' | 'html_title' | null;
  descriptionSource: 'open_graph' | 'html_description' | 'tiktok_oembed' | null;
};

export type FetchMetadataResult =
  | {
      ok: true;
      metadata: PostMetadata;
      /** Post-redirect, tracking-stripped canonical URL. Equals the input
       *  when no redirect happened / parsing failed. */
      resolvedUrl: string;
      /** True when TikTok oEmbed supplied a caption different from HTML. */
      usedTikTokOEmbed: boolean;
    }
  | {
      ok: false;
      reason:
        | 'network_error'
        | 'http_error'
        | 'redirect_off_platform'
        | 'unsupported_tiktok_url'
        | 'tiktok_redirect_not_post'
        | 'tiktok_post_mismatch';
      error?: string;
    };

export type MetadataFailureReason = Extract<FetchMetadataResult, { ok: false }>['reason'];

/** Permanent acquisition failures must not enqueue/retry the media worker. */
export function isPermanentMetadataFailure(reason: MetadataFailureReason): boolean {
  return reason === 'redirect_off_platform' ||
    reason === 'unsupported_tiktok_url' ||
    reason === 'tiktok_redirect_not_post' ||
    reason === 'tiktok_post_mismatch';
}

// A share link's own redirect/deep-link machinery can bounce an
// unauthenticated fetch completely OFF the source platform and onto an app
// storefront (verified live: a TikTok SEO/keyword discovery short link
// redirected, with no login, to `apps.apple.com/.../tiktok-videos-shop-live`
// — Apple's own App Store listing for the TikTok app). That page's title/
// description describe the APP, not the shared video, yet nothing before
// this point would have caught it: the URL "resolved" successfully and
// returned real HTML. Treating that HTML as post content produced a search
// query for "App Store" and a picker full of random OR/WA electronics
// retailers with zero relationship to the actual share. These hosts are
// NEVER a legitimate content page for ANY platform, so metadata fetch fails
// outright rather than extracting evidence from a storefront.
const NON_CONTENT_REDIRECT_HOSTS = new Set([
  'apps.apple.com',
  'itunes.apple.com',
  'play.google.com',
]);

function isNonContentRedirectHost(resolvedUrl: string): boolean {
  try {
    const host = new URL(resolvedUrl).hostname.toLowerCase();
    return NON_CONTENT_REDIRECT_HOSTS.has(host);
  } catch {
    return false;
  }
}

export async function fetchPostMetadata(
  url: string,
  platform?: string,
): Promise<FetchMetadataResult> {
  const inputIdentity = platform === 'tiktok' ? extractTikTokPostIdentity(url) : null;
  if (platform === 'tiktok' && !isSupportedTikTokShareUrl(url)) {
    return { ok: false, reason: 'unsupported_tiktok_url' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let title: string | null = null;
  let description: string | null = null;
  let html = '';
  let htmlOk = false;
  let titleSource: PostMetadata['titleSource'] = null;
  let descriptionSource: PostMetadata['descriptionSource'] = null;
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
    const normalizedResponse = normalizeShareUrl(res.url || url);
    const normalizedFinalUrl = normalizedResponse.url || url;
    // A temporary Instagram auth wall is transport/provider behavior, not a
    // new content identity. Never replace a valid post/reel source with an
    // /accounts/login (or any other same-host non-content) final URL. If the
    // final URL is still a real content identity it remains preferred.
    resolvedUrl = platform === 'instagram'
      ? selectInstagramContentUrl(url, normalizedFinalUrl) ?? url
      : normalizedFinalUrl;
    if (platform === 'tiktok' && normalizedResponse.platform !== 'tiktok') {
      clearTimeout(timer);
      return { ok: false, reason: 'redirect_off_platform' };
    }
    if (res.ok && isNonContentRedirectHost(resolvedUrl)) {
      clearTimeout(timer);
      return { ok: false, reason: 'redirect_off_platform' };
    }
    // Facebook commonly answers an unavailable/private share with a successful
    // 200 login/home redirect. That HTML is product chrome, not post metadata.
    if (res.ok && platform === 'facebook' && !inspectFacebookUrl(resolvedUrl)?.supported) {
      clearTimeout(timer);
      return { ok: false, reason: 'redirect_off_platform' };
    }
    if (res.ok) {
      html = await res.text();
      const ogTitle = pickMeta(html, 'og:title');
      const ogDescription = pickMeta(html, 'og:description');
      const plainDescription = pickMeta(html, 'description');
      title = cleanTitle(ogTitle ?? pickTitle(html));
      const rawDescription = ogDescription ?? plainDescription;
      description = cleanIngestionCaption(rawDescription);
      titleSource = ogTitle ? 'open_graph' : title ? 'html_title' : null;
      descriptionSource = ogDescription
        ? 'open_graph'
        : plainDescription
        ? 'html_description'
        : null;
      if (platform === 'facebook') {
        const cleaned = normalizeFacebookMetadata({ title, description });
        title = cleaned.title;
        description = cleaned.description;
        if (!title) titleSource = null;
        if (!description) descriptionSource = null;
      }
      htmlOk = true;
    } else {
      httpError = `HTTP ${res.status}`;
    }
  } catch (err) {
    networkError = (err as Error)?.message;
  } finally {
    clearTimeout(timer);
  }

  // ---- TikTok official oEmbed enrichment -------------------------------
  // Its caption is authoritative; creator identity is provenance/exclusion
  // context only and never becomes a place signal.
  let usedTikTokOEmbed = false;
  let creatorHandle = inputIdentity?.creatorHandle ?? null;
  let postId = inputIdentity?.postId ?? null;
  if (platform === 'tiktok') {
    const oe = await fetchTikTokOEmbed(resolvedUrl);
    if (oe.ok) {
      const pageIdentity = extractTikTokPostIdentity(resolvedUrl);
      const observedIds = [inputIdentity?.postId, pageIdentity?.postId, oe.postId]
        .filter((value): value is string => !!value);
      if (new Set(observedIds).size > 1) {
        return { ok: false, reason: 'tiktok_post_mismatch' };
      }
      if (oe.canonicalUrl) resolvedUrl = normalizeShareUrl(oe.canonicalUrl).url;
      const observedIdentity = extractTikTokPostIdentity(resolvedUrl) ?? inputIdentity;
      creatorHandle = oe.creatorHandle ?? observedIdentity?.creatorHandle ?? creatorHandle;
      postId = oe.postId ?? observedIdentity?.postId ?? postId;
      const caption = cleanIngestionCaption(oe.title);
      if (caption) {
        usedTikTokOEmbed = caption !== description;
        description = caption;
        descriptionSource = 'tiktok_oembed';
      }
    }

    const finalIdentity = extractTikTokPostIdentity(resolvedUrl) ?? inputIdentity;
    if (!finalIdentity) {
      // A successful redirect that lands on a feed/profile is permanent. A
      // network/HTTP failure while expanding a short link is transient and
      // must retain its original classification so durable media can retry it.
      if (htmlOk) return { ok: false, reason: 'tiktok_redirect_not_post' };
      if (httpError) return { ok: false, reason: 'http_error', error: httpError };
      return { ok: false, reason: 'network_error', error: networkError };
    }
    if (inputIdentity && finalIdentity && finalIdentity.postId !== inputIdentity.postId) {
      return { ok: false, reason: 'tiktok_post_mismatch' };
    }
    if (finalIdentity) {
      resolvedUrl = finalIdentity.canonicalUrl;
      creatorHandle = creatorHandle ?? finalIdentity.creatorHandle;
      postId = postId ?? finalIdentity.postId;
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
    metadata: { title, description, html, creatorHandle, postId, titleSource, descriptionSource },
    resolvedUrl,
    usedTikTokOEmbed,
  };
}
