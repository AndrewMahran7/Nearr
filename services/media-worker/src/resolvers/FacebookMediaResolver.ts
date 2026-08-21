// services/media-worker/src/resolvers/FacebookMediaResolver.ts
//
// Facebook PUBLIC Reel/video retrieval. Same public-only mission constraints
// as Instagram — no login, no cookies, no private-content bypass. Built on
// the shared yt-dlp core (ytDlpShared.ts); yt-dlp's `facebook` extractor
// handles public `/reel/`, `/.../videos/`, and `fb.watch` redirect forms
// without a bespoke HTML scraper.
//
// A private/friends-only/group-restricted video is NOT retrievable through
// this path — yt-dlp reports it as login-required/unavailable and this
// resolver surfaces the same `authentication_required` /
// `private_or_unavailable` MediaError as every other platform, which routes
// to a safe manual fallback. No bypass is attempted.

import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import { MediaError, type ResolvedMedia } from '../types/media.js';
import type { WorkerConfig } from '../config/env.js';
import {
  boundedMetadata,
  pickLocationMetadata,
  pickCreatorHandle,
  enforceDurationLimit,
  probeWithYtDlp,
  requireHttpsHost,
  retrieveVideoFile,
} from './ytDlpShared.js';
import { safeFetchText } from '../security/ssrf.js';
import { log } from '../util/logger.js';
import { normalizeSourceDescription } from '../util/sourceText.js';

const FACEBOOK_VIDEO_ID_RE = /^\d{5,30}$/;
const FACEBOOK_EMBED_MAX_BYTES = 512 * 1024;
const FACEBOOK_EMBED_TIMEOUT_MS = 8_000;
const FACEBOOK_PAGE_ALLOWLIST = ['facebook.com'];

type FacebookPageFetch = typeof safeFetchText;

type FacebookAcquisitionUrl = {
  url: string;
  canonicalized: boolean;
};

function boundedIdentity(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

/** Pure adapter from yt-dlp's public Facebook response to stable provenance. */
export function facebookSourceIdentityFromInfo(
  info: { id?: string; uploader?: string; uploader_id?: string; channel_id?: string },
  fallbackUrl: string,
): {
  canonicalUrl: string;
  sourceId: string | null;
  creatorName: string | null;
  creatorId: string | null;
} {
  const sourceId = boundedIdentity(info.id, 80);
  const canonicalUrl = sourceId && FACEBOOK_VIDEO_ID_RE.test(sourceId)
    ? `https://www.facebook.com/reel/${sourceId}/`
    : fallbackUrl;
  return {
    canonicalUrl,
    sourceId,
    creatorName: boundedIdentity(info.uploader, 200),
    creatorId: boundedIdentity(info.uploader_id ?? info.channel_id, 120),
  };
}

const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'fb.watch',
]);

function isFacebookHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return FACEBOOK_HOSTS.has(host) || host.endsWith('.facebook.com');
}

function numericFacebookContentId(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !isFacebookHost(url.hostname)) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (['reel', 'reels'].includes((segments[0] ?? '').toLowerCase()) && FACEBOOK_VIDEO_ID_RE.test(segments[1] ?? '')) {
    return segments[1]!;
  }
  const queryId = url.searchParams.get('v') ?? '';
  if (FACEBOOK_VIDEO_ID_RE.test(queryId) && ['watch', 'video.php'].includes((segments[0] ?? '').toLowerCase())) {
    return queryId;
  }
  const videosIndex = segments.findIndex((part) => part.toLowerCase() === 'videos');
  return videosIndex >= 0
    ? [...segments.slice(videosIndex + 1)].reverse().find((part) => FACEBOOK_VIDEO_ID_RE.test(part)) ?? null
    : null;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function linkAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ? decodeHtmlAttribute(match[2]) : null;
}

/**
 * Accept only a numeric Facebook video identity from the public Video Plugin's
 * canonical link. The plugin page may contain many unrelated Facebook URLs;
 * none of them are trusted unless they expose the same stable video-id shape
 * accepted by the ordinary resolver.
 */
export function facebookCanonicalVideoUrlFromHtml(html: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]{0,2000}>/gi)) {
    const tag = match[0];
    const rel = linkAttribute(tag, 'rel');
    if (!rel?.toLowerCase().split(/\s+/).includes('canonical')) continue;
    const href = linkAttribute(tag, 'href');
    const id = numericFacebookContentId(href ?? undefined);
    if (id) return `https://www.facebook.com/reel/${id}/`;
  }
  return null;
}

export function isOpaqueFacebookRedirectUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || !isFacebookHost(url.hostname)) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'fb.watch') return /^\/[A-Za-z0-9_-]{4,200}\/?$/.test(url.pathname);
  return /^\/share\/(?:r|v|p)\/[A-Za-z0-9_-]{4,200}\/?$/i.test(url.pathname);
}

function classifyFacebookPage(finalUrl: string, html: string): MediaError | null {
  let pathname = '';
  try {
    pathname = new URL(finalUrl).pathname.toLowerCase();
  } catch {
    // HTML signals below remain available.
  }
  if (/^\/(?:login|checkpoint)(?:\/|\.php|$)/.test(pathname)) {
    return new MediaError('authentication_required', 'facebook_login_redirect');
  }

  const bounded = html.slice(0, FACEBOOK_EMBED_MAX_BYTES).toLowerCase();
  const hasLoginForm = /<form\b[^>]{0,1500}(?:id=["']login_form["']|action=["'][^"']*\/login)/i.test(bounded);
  const hasIdentityInput = /<input\b[^>]{0,500}(?:name=["'](?:email|pass)["']|autocomplete=["'](?:username|current-password)["'])/i.test(bounded);
  if (hasLoginForm && hasIdentityInput) {
    return new MediaError('authentication_required', 'facebook_login_page');
  }

  if (
    /this content isn['’]t available|this video isn['’]t available|content not available|video unavailable|page isn['’]t available/.test(
      bounded,
    )
  ) {
    return new MediaError('private_or_unavailable', 'facebook_content_unavailable');
  }
  return null;
}

/**
 * Resolve only Facebook's opaque public share forms through Facebook's own
 * public Video Plugin. This is URL normalization, not media scraping: no
 * cookies, credentials, login flow, private API, or media URL is requested.
 */
export async function resolveFacebookAcquisitionUrl(
  rawUrl: string,
  signal: AbortSignal,
  fetchPage: FacebookPageFetch = safeFetchText,
): Promise<FacebookAcquisitionUrl> {
  if (!isOpaqueFacebookRedirectUrl(rawUrl)) {
    return { url: rawUrl, canonicalized: false };
  }

  const embed = new URL('https://www.facebook.com/plugins/video.php');
  embed.searchParams.set('href', rawUrl);

  let page: Awaited<ReturnType<FacebookPageFetch>>;
  try {
    page = await fetchPage({
      url: embed.toString(),
      maxBytes: FACEBOOK_EMBED_MAX_BYTES,
      timeoutMs: FACEBOOK_EMBED_TIMEOUT_MS,
      redirectLimit: 2,
      allowlist: FACEBOOK_PAGE_ALLOWLIST,
      signal,
    });
  } catch (error) {
    if (error instanceof MediaError && (error.code === 'cancelled' || error.code === 'authentication_required')) {
      throw error;
    }
    // The plugin is a normalization aid. If it is temporarily unavailable,
    // preserve the previously working direct yt-dlp path and its classifier.
    return { url: rawUrl, canonicalized: false };
  }

  const canonical = facebookCanonicalVideoUrlFromHtml(page.text);
  if (canonical) return { url: canonical, canonicalized: true };

  const wall = classifyFacebookPage(page.finalUrl, page.text);
  if (wall) throw wall;
  return { url: rawUrl, canonicalized: false };
}

/** Numeric Facebook identities are immutable across redirects and extraction. */
export function assertFacebookPostIdentityMatches(
  requestedUrl: string,
  extractorPostId: string | null,
  extractorWebpageUrl?: string,
): void {
  const observedIds = [
    numericFacebookContentId(requestedUrl),
    extractorPostId && FACEBOOK_VIDEO_ID_RE.test(extractorPostId) ? extractorPostId : null,
    numericFacebookContentId(extractorWebpageUrl),
  ].filter((value): value is string => !!value);
  if (new Set(observedIds).size > 1) {
    throw new MediaError('identity_mismatch', 'facebook_post_id_mismatch');
  }
}

export class FacebookMediaResolver implements MediaResolver {
  readonly name = 'facebook/yt-dlp';
  private readonly cfg: WorkerConfig;

  constructor(cfg: WorkerConfig) {
    this.cfg = cfg;
  }

  supports(input: { platform: string; url: URL }): boolean {
    if (!this.cfg.facebookResolverEnabled) return false;
    if (input.platform.toLowerCase() !== 'facebook') return false;
    return isFacebookHost(input.url.hostname);
  }

  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    const rawUrl = input.canonicalUrl || input.sourceUrl;
    const validatedUrl = requireHttpsHost(rawUrl, isFacebookHost);
    const acquisition = await resolveFacebookAcquisitionUrl(validatedUrl, input.signal);
    const url = requireHttpsHost(acquisition.url, isFacebookHost);
    if (acquisition.canonicalized) {
      log.info('facebook_redirect_canonicalized', { jobId: input.jobId });
    }

    const info = await probeWithYtDlp(this.cfg, url, { workDir: input.workDir, signal: input.signal });
    const duration = enforceDurationLimit(this.cfg, info);
    const identity = facebookSourceIdentityFromInfo(info, url);
    assertFacebookPostIdentityMatches(url, identity.sourceId, info.webpage_url);

    const file = await retrieveVideoFile(this.cfg, {
      jobId: input.jobId,
      url,
      info,
      workDir: input.workDir,
      signal: input.signal,
      sourceLabel: 'facebook',
    });

    if (acquisition.canonicalized) file.warnings.push('facebook_public_embed_canonicalized');

    return {
      canonicalUrl: identity.canonicalUrl,
      localFilePath: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      durationSeconds: duration,
      metadataTitle: boundedMetadata(info.title, 500),
      metadataDescription: normalizeSourceDescription(info.description),
      metadataLocation: pickLocationMetadata(info),
      metadataCreatorHandle: pickCreatorHandle(info, url),
      sourceId: identity.sourceId,
      metadataCreatorName: identity.creatorName,
      metadataCreatorId: identity.creatorId,
      source: file.source,
      warnings: file.warnings,
    };
  }
}
