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
import type { ResolvedMedia } from '../types/media.js';
import type { WorkerConfig } from '../config/env.js';
import {
  boundedMetadata,
  enforceDurationLimit,
  probeWithYtDlp,
  requireHttpsHost,
  retrieveVideoFile,
} from './ytDlpShared.js';

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

    const file = await retrieveVideoFile(this.cfg, {
      jobId: input.jobId,
      url,
      info,
      workDir: input.workDir,
      signal: input.signal,
      sourceLabel: 'facebook',
    });

    return {
      canonicalUrl: url,
      localFilePath: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      durationSeconds: duration,
      metadataTitle: boundedMetadata(info.title, 500),
      metadataDescription: boundedMetadata(info.description, 4000),
      source: file.source,
      warnings: file.warnings,
    };
  }
}
