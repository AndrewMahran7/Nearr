// services/media-worker/src/resolvers/TikTokMediaResolver.ts
//
// TikTok PUBLIC video retrieval. Same public-only mission constraints as
// Instagram (see InstagramMediaResolver.ts) — no login, no cookies, no
// private-content bypass. Built on the shared yt-dlp core (ytDlpShared.ts).
//
// TikTok share links commonly arrive as short redirects (`vm.tiktok.com`,
// `vt.tiktok.com`). We do NOT require the caller to have already resolved
// those — yt-dlp follows the redirect itself during the metadata probe, same
// as it does for the canonical `@user/video/<id>` form. The share pipeline
// usually resolves + normalizes short links earlier. If metadata expansion
// failed but yt-dlp succeeds, this resolver returns `webpage_url` so the
// finalizer can persist the exact post rather than the redirect token.

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
import { normalizeSourceDescription } from '../util/sourceText.js';

const TIKTOK_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);

function isTikTokHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return TIKTOK_HOSTS.has(host) || host.endsWith('.tiktok.com');
}

/** Accept only an exact TikTok video URL and optionally pin it to yt-dlp's id. */
export function canonicalTikTokVideoUrl(rawUrl: string | undefined, expectedPostId?: string | null): string | null {
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !isTikTokHost(parsed.hostname)) return null;
  const match = parsed.pathname.match(/^\/@([A-Za-z0-9._]{1,30})\/video\/(\d{1,24})\/?$/i);
  if (!match) return null;
  const [, rawCreator, postId] = match;
  if (!rawCreator || !postId) return null;
  if (expectedPostId && postId !== expectedPostId) return null;
  return `https://www.tiktok.com/@${rawCreator.toLowerCase()}/video/${postId}`;
}

function postIdFromCanonicalTikTokUrl(rawUrl: string | undefined): string | null {
  const canonical = canonicalTikTokVideoUrl(rawUrl);
  return canonical?.split('/').pop() ?? null;
}

/** Fail before download when yt-dlp appears to have crossed post identities. */
export function assertTikTokPostIdentityMatches(
  requestedUrl: string,
  extractorPostId: string | null,
  extractorWebpageUrl?: string,
): void {
  const observedIds = [
    postIdFromCanonicalTikTokUrl(requestedUrl),
    extractorPostId,
    postIdFromCanonicalTikTokUrl(extractorWebpageUrl),
  ].filter((value): value is string => !!value);
  if (new Set(observedIds).size > 1) {
    throw new MediaError('identity_mismatch', 'tiktok_post_id_mismatch');
  }
}

export class TikTokMediaResolver implements MediaResolver {
  readonly name = 'tiktok/yt-dlp';
  private readonly cfg: WorkerConfig;

  constructor(cfg: WorkerConfig) {
    this.cfg = cfg;
  }

  supports(input: { platform: string; url: URL }): boolean {
    if (!this.cfg.tiktokResolverEnabled) return false;
    if (input.platform.toLowerCase() !== 'tiktok') return false;
    return isTikTokHost(input.url.hostname);
  }

  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    const rawUrl = input.canonicalUrl || input.sourceUrl;
    const url = requireHttpsHost(rawUrl, isTikTokHost);

    const info = await probeWithYtDlp(this.cfg, url, { workDir: input.workDir, signal: input.signal });
    const duration = enforceDurationLimit(this.cfg, info);
    const postId = typeof info.id === 'string' && /^\d{1,24}$/.test(info.id) ? info.id : null;
    assertTikTokPostIdentityMatches(url, postId, info.webpage_url);
    const creatorHandle = pickCreatorHandle(info, info.webpage_url ?? url);
    const canonicalUrl =
      canonicalTikTokVideoUrl(info.webpage_url, postId) ??
      canonicalTikTokVideoUrl(url, postId) ??
      (creatorHandle && postId
        ? `https://www.tiktok.com/@${creatorHandle}/video/${postId}`
        : url);

    const file = await retrieveVideoFile(this.cfg, {
      jobId: input.jobId,
      url,
      info,
      workDir: input.workDir,
      signal: input.signal,
      sourceLabel: 'tiktok',
      // Verified live (2026-08-15): fetching TikTok's picked progressive CDN
      // URL ourselves consistently 403s, even after forwarding the Referer
      // yt-dlp itself reports — the CDN evidently binds the URL to more of
      // yt-dlp's own request context than one header. Rather than replicate
      // that context (which risks sliding into fingerprint spoofing, out of
      // scope per the mission), let yt-dlp's own bounded download handle it
      // end-to-end, same fallback already used for YouTube's legacy format.
      skipDirectUrl: true,
    });

    return {
      canonicalUrl,
      localFilePath: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      durationSeconds: duration,
      metadataTitle: boundedMetadata(info.title, 500),
      metadataDescription: normalizeSourceDescription(info.description),
      metadataLocation: pickLocationMetadata(info),
      metadataCreatorHandle: creatorHandle,
      metadataPostId: postId,
      source: file.source,
      warnings: file.warnings,
    };
  }
}
