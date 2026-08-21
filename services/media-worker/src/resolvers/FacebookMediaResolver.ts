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

const FACEBOOK_VIDEO_ID_RE = /^\d{5,30}$/;

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
    const url = requireHttpsHost(rawUrl, isFacebookHost);

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

    return {
      canonicalUrl: identity.canonicalUrl,
      localFilePath: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      durationSeconds: duration,
      metadataTitle: boundedMetadata(info.title, 500),
      metadataDescription: boundedMetadata(info.description, 4000),
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
