// services/media-worker/src/resolvers/HttpMediaFetchResolver.ts
//
// Optional, PROVIDER-NEUTRAL fallback for public-media retrieval. Used ONLY
// when the direct yt-dlp provider can't fetch public content and the operator
// has configured an external public-media fetch service (e.g. a self-hosted
// Cobalt instance, or a documented Instagram media API). It:
//   - resolves a DIRECT media URL from a configurable JSON endpoint,
//   - validates that URL is HTTPS + on the SSRF host allowlist,
//   - downloads it through the SAME SSRF-guarded, size-capped downloader.
//
// Credentials come from env (MEDIA_FETCH_PROVIDER_*) and are NEVER hardcoded,
// NEVER logged, and NEVER sent to the app. Public content only. This adapter is
// intentionally generic so a specific provider's *verified* API is configured,
// not hardcoded here. See docs/MEDIA_FALLBACK.md for provider + cost notes.

import path from 'node:path';
import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import type { ResolvedMedia } from '../types/media.js';
import { MediaError } from '../types/media.js';
import type { WorkerConfig } from '../config/env.js';
import { safeDownloadToFile, sanitizeUrlForLog } from '../security/ssrf.js';
import { log } from '../util/logger.js';

export function isHttpFetchProviderConfigured(cfg: WorkerConfig): boolean {
  return /^https:\/\//i.test(cfg.mediaFetchProviderUrl.trim());
}

/** Build the provider request URL by appending the source URL as a query param. */
export function buildFetchProviderRequestUrl(cfg: WorkerConfig, sourceUrl: string): string {
  const base = new URL(cfg.mediaFetchProviderUrl);
  base.searchParams.set(cfg.mediaFetchProviderUrlParam || 'url', sourceUrl);
  return base.toString();
}

/** Resolve a dot-path (e.g. "data.url" or "url") in a JSON object. Pure. */
export function pickMediaUrlFromJson(json: unknown, dotPath: string): string | null {
  const parts = (dotPath || 'url').split('.').filter(Boolean);
  let cur: unknown = json;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  return typeof cur === 'string' && /^https:\/\//i.test(cur) ? cur : null;
}

type Deps = {
  fetchImpl?: typeof fetch;
  download?: typeof safeDownloadToFile;
};

export class HttpMediaFetchResolver implements MediaResolver {
  readonly name = 'instagram/http-fetch-provider';
  private readonly cfg: WorkerConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly download: typeof safeDownloadToFile;

  constructor(cfg: WorkerConfig, deps: Deps = {}) {
    this.cfg = cfg;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.download = deps.download ?? safeDownloadToFile;
  }

  supports(input: { platform: string; url: URL }): boolean {
    if (!isHttpFetchProviderConfigured(this.cfg)) return false;
    if (input.platform.toLowerCase() !== 'instagram') return false;
    const host = input.url.hostname.toLowerCase();
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  }

  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    const rawUrl = input.canonicalUrl || input.sourceUrl;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new MediaError('unsupported_url', 'bad_source_url');
    }
    if (parsed.protocol !== 'https:') throw new MediaError('unsupported_url', 'non_https_source');

    const requestUrl = buildFetchProviderRequestUrl(this.cfg, parsed.toString());
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.cfg.mediaFetchProviderApiKey) {
      const h = (this.cfg.mediaFetchProviderAuthHeader || 'authorization').toLowerCase();
      headers[h] = h === 'authorization' ? `Bearer ${this.cfg.mediaFetchProviderApiKey}` : this.cfg.mediaFetchProviderApiKey;
    }

    log.info('http_fetch_provider_request', { jobId: input.jobId });
    let res: Response;
    try {
      res = await this.fetchImpl(requestUrl, { method: 'GET', headers, signal: input.signal });
    } catch {
      throw new MediaError('download_failed', 'provider_unreachable');
    }
    if (input.signal.aborted) throw new MediaError('cancelled');
    if (res.status === 429) throw new MediaError('download_failed', 'rate_limited');
    if (res.status === 401 || res.status === 403) throw new MediaError('provider_changed', 'provider_auth_failed');
    if (!res.ok) throw new MediaError('download_failed', `provider_http_${res.status}`);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new MediaError('provider_changed', 'provider_json_parse_failed');
    }
    const mediaUrl = pickMediaUrlFromJson(json, this.cfg.mediaFetchProviderResultPath);
    if (!mediaUrl) throw new MediaError('provider_changed', 'no_media_url_in_response');

    const destPath = path.join(input.workDir, 'source.mp4');
    log.info('http_fetch_provider_download', { jobId: input.jobId, url: sanitizeUrlForLog(mediaUrl) });
    const dl = await this.download({
      url: mediaUrl,
      destPath,
      maxBytes: this.cfg.maxDownloadBytes,
      timeoutMs: this.cfg.downloadTimeoutMs,
      redirectLimit: this.cfg.redirectLimit,
      allowlist: this.cfg.allowedMediaHosts,
      signal: input.signal,
    });

    return {
      canonicalUrl: parsed.toString(),
      localFilePath: destPath,
      mimeType: dl.contentType?.split(';')[0]?.trim() || 'video/mp4',
      sizeBytes: dl.bytes,
      source: 'instagram/http-fetch-provider',
      warnings: [],
    };
  }
}
