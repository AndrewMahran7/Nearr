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
// ATTRIBUTION: the general idea of resolving a public Instagram media URL was
// informed by the MIT-licensed riad-azz/instagram-video-downloader project;
// no code was copied (that repo defers its downloader backend), and this
// implementation is independent and uses yt-dlp.

import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import type { ResolvedMedia } from '../types/media.js';
import { MediaError } from '../types/media.js';
import type { WorkerConfig } from '../config/env.js';
import { execBinary } from '../util/exec.js';
import { safeDownloadToFile, sanitizeUrlForLog } from '../security/ssrf.js';
import { log } from '../util/logger.js';

type YtFormat = {
  url?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  protocol?: string;
  filesize?: number;
};

type YtInfo = {
  duration?: number;
  title?: string;
  description?: string;
  ext?: string;
  url?: string;
  formats?: YtFormat[];
};

function boundedMetadata(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function classifyYtError(stderr: string): MediaError {
  const s = stderr.toLowerCase();
  if (/login required|log in|sign in|account|cookies|authentication/.test(s)) {
    return new MediaError('authentication_required', 'login_required');
  }
  if (/private|not available|removed|only available to|restricted/.test(s)) {
    return new MediaError('private_or_unavailable', 'not_public');
  }
  if (/rate.?limit|429|too many requests|temporar/.test(s)) {
    return new MediaError('download_failed', 'rate_limited');
  }
  if (/unable to extract|unsupported url|no video formats|failed to parse/.test(s)) {
    return new MediaError('provider_changed', 'extractor_failed');
  }
  return new MediaError('provider_changed', 'yt_dlp_failed');
}

/** Prefer a single progressive (audio+video) https URL we can fetch ourselves. */
export function pickProgressiveUrl(info: YtInfo): string | null {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const progressive = formats.filter(
    (f) =>
      typeof f.url === 'string' &&
      /^https:/i.test(f.url) &&
      f.vcodec &&
      f.vcodec !== 'none' &&
      f.acodec &&
      f.acodec !== 'none' &&
      (f.protocol === 'https' || f.protocol === undefined),
  );
  progressive.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return progressive[0]?.url ?? null;
}

export class InstagramMediaResolver implements MediaResolver {
  readonly name = 'instagram/yt-dlp';
  private readonly cfg: WorkerConfig;

  constructor(cfg: WorkerConfig) {
    this.cfg = cfg;
  }

  supports(input: { platform: string; url: URL }): boolean {
    if (!this.cfg.instagramResolverEnabled) return false;
    if (input.platform.toLowerCase() !== 'instagram') return false;
    const host = input.url.hostname.toLowerCase();
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  }

  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    const warnings: string[] = [];
    const rawUrl = input.canonicalUrl || input.sourceUrl;

    // Validate the SOURCE url before it ever reaches yt-dlp (defense in depth;
    // supports() also gates but the resolver never trusts an unvalidated URL):
    // HTTPS only + an Instagram host only. Public posts only — no login.
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new MediaError('unsupported_url', 'bad_source_url');
    }
    if (parsed.protocol !== 'https:') {
      throw new MediaError('unsupported_url', 'non_https_source');
    }
    const srcHost = parsed.hostname.toLowerCase();
    if (srcHost !== 'instagram.com' && !srcHost.endsWith('.instagram.com')) {
      throw new MediaError('unsupported_url', 'non_instagram_host');
    }
    const url = parsed.toString();

    // 1) Metadata only (NO download). --no-cache-dir keeps zero persistent
    //    state; the whole run is confined to the isolated job temp dir.
    const probe = await execBinary(
      this.cfg.ytDlpPath,
      [
        '-j',
        '--no-warnings',
        '--no-progress',
        '--no-playlist',
        '--no-cache-dir',
        '--socket-timeout',
        '20',
        url,
      ],
      { timeoutMs: Math.min(this.cfg.downloadTimeoutMs, 45_000), signal: input.signal, cwd: input.workDir },
    );

    if (input.signal.aborted) throw new MediaError('cancelled');
    if (probe.code !== 0 || !probe.stdout.trim()) {
      throw classifyYtError(probe.stderr || 'no_output');
    }

    let info: YtInfo;
    try {
      info = JSON.parse(probe.stdout.trim().split('\n')[0] ?? '{}') as YtInfo;
    } catch {
      throw new MediaError('provider_changed', 'json_parse_failed');
    }

    const duration = Number(info.duration);
    if (Number.isFinite(duration) && duration > this.cfg.maxDurationSeconds) {
      throw new MediaError('duration_too_long', `${Math.round(duration)}s`);
    }

    const destPath = path.join(input.workDir, 'source.mp4');
    const directUrl = pickProgressiveUrl(info);

    // 2a) Preferred: fetch the direct progressive URL ourselves (full SSRF +
    //     size-cap control).
    if (directUrl) {
      log.info('ig_resolve_direct', { jobId: input.jobId, url: sanitizeUrlForLog(directUrl) });
      const dl = await safeDownloadToFile({
        url: directUrl,
        destPath,
        maxBytes: this.cfg.maxDownloadBytes,
        timeoutMs: this.cfg.downloadTimeoutMs,
        redirectLimit: this.cfg.redirectLimit,
        allowlist: this.cfg.allowedMediaHosts,
        signal: input.signal,
      });
      return {
        canonicalUrl: url,
        localFilePath: destPath,
        mimeType: dl.contentType?.split(';')[0]?.trim() || 'video/mp4',
        sizeBytes: dl.bytes,
        durationSeconds: Number.isFinite(duration) ? duration : undefined,
        metadataTitle: boundedMetadata(info.title, 500),
        metadataDescription: boundedMetadata(info.description, 4000),
        source: 'instagram/yt-dlp-direct',
        warnings,
      };
    }

    // 2b) Fallback: no single progressive URL (DASH split) — let yt-dlp merge,
    //     still bounded by --max-filesize + a hard timeout, into the temp dir.
    warnings.push('no_progressive_url_used_ytdlp_download');
    const outTpl = path.join(input.workDir, 'source.%(ext)s');
    const dl = await execBinary(
      this.cfg.ytDlpPath,
      [
        '--no-warnings',
        '--no-progress',
        '--no-playlist',
        '--no-cache-dir',
        '--socket-timeout',
        '20',
        '--max-filesize',
        String(this.cfg.maxDownloadBytes),
        '-f',
        'best[ext=mp4][protocol^=https]/best[protocol^=https]/best',
        '-o',
        outTpl,
        url,
      ],
      { timeoutMs: this.cfg.downloadTimeoutMs, signal: input.signal, cwd: input.workDir },
    );

    if (input.signal.aborted) throw new MediaError('cancelled');
    if (dl.timedOut) throw new MediaError('download_timeout');
    if (dl.code !== 0) {
      if (/file is larger than max-filesize/i.test(dl.stderr)) {
        throw new MediaError('file_too_large');
      }
      throw classifyYtError(dl.stderr || 'download_failed');
    }

    const produced = await this.findDownloaded(input.workDir);
    if (!produced) throw new MediaError('missing_video', 'no_output_file');
    const s = await stat(produced);
    if (s.size > this.cfg.maxDownloadBytes) throw new MediaError('file_too_large');

    return {
      canonicalUrl: url,
      localFilePath: produced,
      mimeType: 'video/mp4',
      sizeBytes: s.size,
      durationSeconds: Number.isFinite(duration) ? duration : undefined,
      metadataTitle: boundedMetadata(info.title, 500),
      metadataDescription: boundedMetadata(info.description, 4000),
      source: 'instagram/yt-dlp-merged',
      warnings,
    };
  }

  private async findDownloaded(dir: string): Promise<string | null> {
    const entries = await readdir(dir).catch(() => [] as string[]);
    const candidate = entries.find((e) => e.startsWith('source.'));
    return candidate ? path.join(dir, candidate) : null;
  }
}
