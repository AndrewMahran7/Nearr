// services/media-worker/src/resolvers/ytDlpShared.ts
//
// Shared, platform-neutral yt-dlp retrieval core used by every
// yt-dlp-backed MediaResolver (Instagram, TikTok, YouTube, Facebook). Each
// resolver still owns its OWN `supports()` host/flag gate and its own public
// error-message vocabulary quirks where they matter, but the actual
// "probe metadata → pick a direct URL → download it ourselves, or fall back to
// a bounded yt-dlp merge" mechanics live here exactly once.
//
// STRICT LIMITS (mission, same as Instagram): public posts only; NO account
// login; NO user credentials; NO copied browser cookies; NO private-post/
// challenge/CAPTCHA bypass; NO proxy rotation; NO anti-bot evasion.

import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import { MediaError } from '../types/media.js';
import { execBinary } from '../util/exec.js';
import { safeDownloadToFile, sanitizeUrlForLog } from '../security/ssrf.js';
import { log } from '../util/logger.js';

export type YtSubtitleTrack = { url?: string; ext?: string; name?: string; protocol?: string };

export type YtFormat = {
  url?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  protocol?: string;
  filesize?: number;
  /** Per-format request headers yt-dlp's extractor determined the CDN
   *  requires (e.g. a hotlink-protection Referer). Only forwarded via
   *  `pickProgressiveHeaders` after whitelisting — see there for why. */
  http_headers?: Record<string, string>;
};

export type YtInfo = {
  duration?: number;
  title?: string;
  description?: string;
  ext?: string;
  url?: string;
  formats?: YtFormat[];
  /** Manually-authored captions, keyed by language code (yt-dlp `-j` output). */
  subtitles?: Record<string, YtSubtitleTrack[]>;
  /** Machine-generated captions, keyed by language code. */
  automatic_captions?: Record<string, YtSubtitleTrack[]>;
  /** Top-level fallback for `YtFormat.http_headers` (single-format extractors,
   *  e.g. Snapchat Spotlight, report headers here instead of per-format). */
  http_headers?: Record<string, string>;
};

export function boundedMetadata(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

/** Classify a yt-dlp stderr blob into a structured MediaError. Deliberately
 *  platform-agnostic — yt-dlp's message vocabulary for "login required" /
 *  "private" / "rate limited" / "extractor broke" is consistent across
 *  extractors, so one classifier serves every resolver built on this module. */
export function classifyYtError(stderr: string): MediaError {
  const s = stderr.toLowerCase();
  if (/login required|log in|sign in|account|cookies|authentication/.test(s)) {
    return new MediaError('authentication_required', 'login_required');
  }
  if (/private|not available|removed|only available to|restricted|no longer available/.test(s)) {
    return new MediaError('private_or_unavailable', 'not_public');
  }
  if (/rate.?limit|429|too many requests|temporar/.test(s)) {
    return new MediaError('download_failed', 'rate_limited');
  }
  if (/unable to extract|unsupported url|no video formats|failed to parse|no video could be found/.test(s)) {
    return new MediaError('provider_changed', 'extractor_failed');
  }
  return new MediaError('provider_changed', 'yt_dlp_failed');
}

const VIDEO_CONTAINER_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v']);

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
  if (progressive[0]?.url) return progressive[0].url;

  // Single-format extractors (verified live for Snapchat's Spotlight
  // extractor) report no `formats` array at all — just a top-level `url` +
  // `ext` for the one muxed file. Use it when it looks like a real,
  // fetchable video container (never an HLS manifest wrapper).
  if (
    formats.length === 0 &&
    typeof info.url === 'string' &&
    /^https:/i.test(info.url) &&
    VIDEO_CONTAINER_EXTS.has((info.ext ?? '').toLowerCase())
  ) {
    return info.url;
  }
  return null;
}

// Some CDNs (verified live: TikTok) reject a direct fetch with HTTP 403
// unless the request carries the same Referer the browser/app would have
// sent — ordinary hotlink protection, not anti-bot evasion. yt-dlp's own `-j`
// probe already tells us this in `http_headers`. Forward ONLY `Referer`: it's
// the one header that's purely "which page linked to this resource" (no
// identity, no session, no credential), so honoring it is standard web
// behavior. Never forward User-Agent (keep our own honest, self-identifying
// UA — see DEFAULT_UA) or anything else (Cookie/Authorization/etc. must
// never appear here per the mission's public-content-only constraint; public
// posts never require them from yt-dlp in the first place).
const FORWARDABLE_HEADER = 'referer';

/** The subset of yt-dlp-reported headers safe to forward for `pickedUrl`
 *  (matched against the SAME format entry `pickProgressiveUrl` selected, or
 *  the top-level `http_headers` for single-format extractors). */
export function pickProgressiveHeaders(
  info: YtInfo,
  pickedUrl: string,
): Record<string, string> | undefined {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const matched = formats.find((f) => f.url === pickedUrl);
  const source = matched?.http_headers ?? (info.url === pickedUrl ? info.http_headers : undefined);
  if (!source || typeof source !== 'object') return undefined;
  for (const [key, value] of Object.entries(source)) {
    if (key.toLowerCase() === FORWARDABLE_HEADER && typeof value === 'string' && value) {
      return { referer: value };
    }
  }
  return undefined;
}

export async function findDownloadedFile(dir: string): Promise<string | null> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  const candidate = entries.find((e) => e.startsWith('source.'));
  return candidate ? path.join(dir, candidate) : null;
}

/** Metadata-only probe (`yt-dlp -j`, NO download). Throws a classified
 *  MediaError on failure; never returns a partial/garbage result silently. */
export async function probeWithYtDlp(
  cfg: WorkerConfig,
  url: string,
  opts: { workDir: string; signal: AbortSignal; extraArgs?: string[] },
): Promise<YtInfo> {
  const probe = await execBinary(
    cfg.ytDlpPath,
    [
      '-j',
      '--no-warnings',
      '--no-progress',
      '--no-playlist',
      '--no-cache-dir',
      '--socket-timeout',
      '20',
      ...(opts.extraArgs ?? []),
      url,
    ],
    { timeoutMs: Math.min(cfg.downloadTimeoutMs, 45_000), signal: opts.signal, cwd: opts.workDir },
  );
  if (opts.signal.aborted) throw new MediaError('cancelled');
  if (probe.code !== 0 || !probe.stdout.trim()) {
    throw classifyYtError(probe.stderr || 'no_output');
  }
  try {
    return JSON.parse(probe.stdout.trim().split('\n')[0] ?? '{}') as YtInfo;
  } catch {
    throw new MediaError('provider_changed', 'json_parse_failed');
  }
}

/** Duration gate shared by every resolver. Returns the duration (if finite)
 *  for diagnostics, or throws `duration_too_long`. */
export function enforceDurationLimit(cfg: WorkerConfig, info: YtInfo): number | undefined {
  const duration = Number(info.duration);
  if (Number.isFinite(duration) && duration > cfg.maxDurationSeconds) {
    throw new MediaError('duration_too_long', `${Math.round(duration)}s`);
  }
  return Number.isFinite(duration) ? duration : undefined;
}

export type RetrievedFile = {
  path: string;
  sizeBytes: number;
  mimeType: string;
  source: string;
  warnings: string[];
};

/**
 * Retrieve the actual video bytes for an already-probed post:
 *   1) Preferred — fetch a direct progressive URL ourselves (full SSRF +
 *      size-cap control, no yt-dlp download process).
 *   2) Fallback — no single progressive URL (DASH split): let yt-dlp merge,
 *      still bounded by --max-filesize + a hard timeout.
 * `sourceLabel` becomes e.g. "tiktok/yt-dlp-direct" for diagnostics.
 */
export async function retrieveVideoFile(
  cfg: WorkerConfig,
  opts: {
    jobId: string;
    url: string;
    info: YtInfo;
    workDir: string;
    signal: AbortSignal;
    sourceLabel: string;
    /** yt-dlp `-f` selector for the merge fallback. */
    formatSelector?: string;
    /**
     * Skip the "fetch a single progressive URL ourselves" fast path and go
     * straight to the bounded yt-dlp merge download. YouTube's legacy
     * single-file progressive format (id `18`) is capped at 360p and, verified
     * live, can 403 or resolve to an HLS manifest instead of raw bytes even
     * when yt-dlp's own metadata labels it `protocol: "https"` — its adaptive
     * video+audio merge (what yt-dlp itself recommends for YouTube) is the
     * reliable path there. Other platforms leave this false.
     */
    skipDirectUrl?: boolean;
    /** Passed to yt-dlp as `--merge-output-format` when set (needed when the
     *  format selector merges separate video-only + audio-only streams). */
    mergeOutputFormat?: string;
  },
): Promise<RetrievedFile> {
  const warnings: string[] = [];
  const destPath = path.join(opts.workDir, 'source.mp4');
  const directUrl = opts.skipDirectUrl ? null : pickProgressiveUrl(opts.info);

  if (directUrl) {
    log.info(`${opts.sourceLabel}_resolve_direct`, { jobId: opts.jobId, url: sanitizeUrlForLog(directUrl) });
    const dl = await safeDownloadToFile({
      url: directUrl,
      destPath,
      maxBytes: cfg.maxDownloadBytes,
      timeoutMs: cfg.downloadTimeoutMs,
      redirectLimit: cfg.redirectLimit,
      allowlist: cfg.allowedMediaHosts,
      signal: opts.signal,
      extraHeaders: pickProgressiveHeaders(opts.info, directUrl),
    });
    return {
      path: destPath,
      sizeBytes: dl.bytes,
      mimeType: dl.contentType?.split(';')[0]?.trim() || 'video/mp4',
      source: `${opts.sourceLabel}/yt-dlp-direct`,
      warnings,
    };
  }

  warnings.push(opts.skipDirectUrl ? 'ytdlp_adaptive_merge_download' : 'no_progressive_url_used_ytdlp_download');
  const outTpl = path.join(opts.workDir, 'source.%(ext)s');
  const dl = await execBinary(
    cfg.ytDlpPath,
    [
      '--no-warnings',
      '--no-progress',
      '--no-playlist',
      '--no-cache-dir',
      '--socket-timeout',
      '20',
      '--max-filesize',
      String(cfg.maxDownloadBytes),
      '-f',
      opts.formatSelector ?? 'best[ext=mp4][protocol^=https]/best[protocol^=https]/best',
      ...(opts.mergeOutputFormat ? ['--merge-output-format', opts.mergeOutputFormat] : []),
      '-o',
      outTpl,
      opts.url,
    ],
    { timeoutMs: cfg.downloadTimeoutMs, signal: opts.signal, cwd: opts.workDir },
  );
  if (opts.signal.aborted) throw new MediaError('cancelled');
  if (dl.timedOut) throw new MediaError('download_timeout');
  if (dl.code !== 0) {
    if (/file is larger than max-filesize/i.test(dl.stderr)) {
      throw new MediaError('file_too_large');
    }
    throw classifyYtError(dl.stderr || 'download_failed');
  }

  const produced = await findDownloadedFile(opts.workDir);
  if (!produced) throw new MediaError('missing_video', 'no_output_file');
  const s = await stat(produced);
  if (s.size > cfg.maxDownloadBytes) throw new MediaError('file_too_large');

  return {
    path: produced,
    sizeBytes: s.size,
    mimeType: 'video/mp4',
    source: `${opts.sourceLabel}/yt-dlp-merged`,
    warnings,
  };
}

/** Validate + normalize the source URL BEFORE it ever reaches yt-dlp. Every
 *  resolver calls this first (defense in depth; `supports()` also gates but a
 *  resolver must never trust an unvalidated URL). */
export function requireHttpsHost(rawUrl: string, hostAllowed: (host: string) => boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new MediaError('unsupported_url', 'bad_source_url');
  }
  if (parsed.protocol !== 'https:') {
    throw new MediaError('unsupported_url', 'non_https_source');
  }
  if (!hostAllowed(parsed.hostname.toLowerCase())) {
    throw new MediaError('unsupported_url', 'unsupported_host');
  }
  return parsed.toString();
}
