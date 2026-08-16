// services/media-worker/src/resolvers/InstagramMediaResolver.ts
//
// Instagram PUBLIC post/reel media retrieval.
//
// STRICT LIMITS (mission): public posts only; NO account login; NO user
// credentials; NO copied browser cookies; NO private-post/challenge/CAPTCHA
// bypass; NO proxy rotation; NO anti-bot evasion; NO long-lived browser
// profile. Strict timeout + redirect limit + isolated temp dir; browser/cache
// state deleted with the job temp dir.
//
// METHOD: yt-dlp is the smallest maintainable retriever proven by the existing
// evidence-server. We run `yt-dlp -j` (metadata only, NO download) to obtain a
// direct progressive CDN URL + duration, then fetch that URL ourselves through
// the SSRF-guarded, size-capped downloader. If Instagram's markup changes and
// extraction fails, we return `provider_changed` and never fabricate a result.
//
// The actual "probe â†’ pick a direct URL â†’ download it ourselves, or fall back
// to a bounded yt-dlp merge" mechanics are shared with every other yt-dlp-backed
// resolver (TikTok/YouTube/Facebook) via ytDlpShared.ts â€” this file only owns
// Instagram's own host gate and wiring.
//
// ATTRIBUTION: the general idea of resolving a public Instagram media URL was
// informed by the MIT-licensed riad-azz/instagram-video-downloader project;
// no code was copied (that repo defers its downloader backend), and this
// implementation is independent and uses yt-dlp.

import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import type { ResolvedMedia } from '../types/media.js';
import { MediaError } from '../types/media.js';
import type { WorkerConfig } from '../config/env.js';
import {
  boundedMetadata,
  pickCreatorHandle,
  enforceDurationLimit,
  probeWithYtDlp,
  requireHttpsHost,
  retrieveVideoFile,
} from './ytDlpShared.js';

// Re-exported for back-compat: existing tests + any external caller import
// `pickProgressiveUrl` from this module specifically.
export { pickProgressiveUrl } from './ytDlpShared.js';

export class InstagramMediaResolver implements MediaResolver {
  readonly name = 'instagram/yt-dlp';
  private readonly cfg: WorkerConfig;

  constructor(cfg: WorkerConfig) {
    this.cfg = cfg;
  }

  supports(input: { platform: string; url: URL }): boolean {
    if (!this.cfg.instagramResolverEnabled) return false;
    if (input.platform.toLowerCase() !== 'instagram') return false;
    return isInstagramHost(input.url.hostname);
  }

  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    const rawUrl = input.canonicalUrl || input.sourceUrl;
    const url = requireHttpsHost(rawUrl, isInstagramHost);

    const info = await probeWithYtDlp(this.cfg, url, { workDir: input.workDir, signal: input.signal });
    const duration = enforceDurationLimit(this.cfg, info);

    const file = await retrieveVideoFile(this.cfg, {
      jobId: input.jobId,
      url,
      info,
      workDir: input.workDir,
      signal: input.signal,
      sourceLabel: 'instagram',
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

function isInstagramHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'instagram.com' || host.endsWith('.instagram.com');
}
