// services/media-worker/src/resolvers/SnapchatMediaResolver.ts
//
// Snapchat PUBLIC Spotlight retrieval — and ONLY Spotlight. Verified live
// against a real, currently-public `snapchat.com/spotlight/<id>` share URL:
// yt-dlp's `SnapchatSpotlight` extractor returns a single direct
// `bolt-gcdn.sc-cdn.net` https URL (video+audio muxed, no login/cookies
// required) that this worker fetches through the same SSRF-guarded, size-
// capped downloader as every other platform.
//
// SCOPE, ON PURPOSE: `supports()` requires the `/spotlight/` path. Snapchat
// Stories, Snap Maps, profile pages, and any friends-only/authenticated
// content are NOT matched here at all — they fall straight to
// `unsupported_platform` (a deterministic, non-retrying MediaError) rather
// than being handed to yt-dlp and hoping for the best. This mirrors the
// mission constraint precisely: public Spotlight only, never private Snaps,
// never login, never a bypass attempt.

import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import type { ResolvedMedia } from '../types/media.js';
import { MediaError } from '../types/media.js';
import type { WorkerConfig } from '../config/env.js';
import {
  boundedMetadata,
  enforceDurationLimit,
  probeWithYtDlp,
  requireHttpsHost,
  retrieveVideoFile,
} from './ytDlpShared.js';

const SNAPCHAT_HOSTS = new Set(['snapchat.com', 'www.snapchat.com']);

function isSnapchatHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return SNAPCHAT_HOSTS.has(host) || host.endsWith('.snapchat.com');
}

function isSpotlightPath(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).pathname.toLowerCase().startsWith('/spotlight/');
  } catch {
    return false;
  }
}

export class SnapchatMediaResolver implements MediaResolver {
  readonly name = 'snapchat/yt-dlp';
  private readonly cfg: WorkerConfig;

  constructor(cfg: WorkerConfig) {
    this.cfg = cfg;
  }

  supports(input: { platform: string; url: URL }): boolean {
    if (!this.cfg.snapchatResolverEnabled) return false;
    if (input.platform.toLowerCase() !== 'snapchat') return false;
    if (!isSnapchatHost(input.url.hostname)) return false;
    return input.url.pathname.toLowerCase().startsWith('/spotlight/');
  }

  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    const rawUrl = input.canonicalUrl || input.sourceUrl;
    const url = requireHttpsHost(rawUrl, isSnapchatHost);
    if (!isSpotlightPath(url)) {
      throw new MediaError('unsupported_url', 'not_spotlight');
    }

    const info = await probeWithYtDlp(this.cfg, url, { workDir: input.workDir, signal: input.signal });
    const duration = enforceDurationLimit(this.cfg, info);

    const file = await retrieveVideoFile(this.cfg, {
      jobId: input.jobId,
      url,
      info,
      workDir: input.workDir,
      signal: input.signal,
      sourceLabel: 'snapchat',
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
