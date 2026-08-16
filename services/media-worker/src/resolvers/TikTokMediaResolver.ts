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
// separately resolves + normalizes short links earlier (fetchPostMetadata /
// normalizeShareUrl) so `Watch post` still opens the user's ORIGINAL link;
// this resolver only needs a URL it can hand to yt-dlp.

import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import type { ResolvedMedia } from '../types/media.js';
import type { WorkerConfig } from '../config/env.js';
import {
  boundedMetadata,
  pickCreatorHandle,
  enforceDurationLimit,
  probeWithYtDlp,
  requireHttpsHost,
  retrieveVideoFile,
} from './ytDlpShared.js';

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
      canonicalUrl: url,
      localFilePath: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      durationSeconds: duration,
      metadataTitle: boundedMetadata(info.title, 500),
      metadataDescription: boundedMetadata(info.description, 4000),
      metadataCreatorHandle: pickCreatorHandle(info, url),
      source: file.source,
      warnings: file.warnings,
    };
  }
}
