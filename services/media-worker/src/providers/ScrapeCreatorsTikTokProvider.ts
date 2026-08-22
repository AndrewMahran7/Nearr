import path from 'node:path';
import { open, unlink } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { MediaError, type MediaProbe, type ResolvedMedia } from '../types/media.js';
import { safeDownloadToFile, type DownloadResult } from '../security/ssrf.js';
import { normalizeSourceDescription } from '../util/sourceText.js';

const ENDPOINT = 'https://api.scrapecreators.com/v2/tiktok/video';
const MAX_PROVIDER_BODY_BYTES = 2 * 1024 * 1024;
const VIDEO_ID = /^\d{1,24}$/;
const MIN_MEDIA_BYTES = 1024;
const DIRECT_TIKTOK_MEDIA_HOSTS = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'tiktokv.com',
  'tiktokv.us',
  'tiktokv.eu',
  'byteoversea.com',
  'ibytedtos.com',
  'muscdn.com',
] as const;

type JsonObject = Record<string, unknown>;

export type ParsedScrapeCreatorsVideo = {
  result: 'SUCCESS_MEDIA' | 'NO_MEDIA' | 'IDENTITY_MISMATCH' | 'INVALID_RESPONSE';
  videoId: string | null;
  canonicalVideoId: string | null;
  directMediaUrl: string | null;
  providerHostedMediaPresent: boolean;
  durationSeconds: number | null;
  description: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  creatorId: string | null;
  credits: number | null;
};

export type ScrapeCreatorsResolveInput = {
  jobId: string;
  sourceUrl: string;
  canonicalUrl: string;
  expectedVideoId: string;
  workDir: string;
  signal: AbortSignal;
};

type ProviderDeps = {
  fetch: typeof fetch;
  download: typeof safeDownloadToFile;
  inspect: typeof inspectMedia;
  remove: typeof unlink;
  now: () => number;
};

const DEFAULT_DEPS: ProviderDeps = {
  fetch,
  download: safeDownloadToFile,
  inspect: inspectMedia,
  remove: unlink,
  now: Date.now,
};

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function stringValue(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function videoIdFromTikTokUrl(value: unknown): string | null {
  const raw = stringValue(value, 2048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !/(?:^|\.)tiktok\.com$/i.test(parsed.hostname)) return null;
    return parsed.pathname.match(/\/video\/(\d{1,24})(?:\/|$)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

function normalizeDuration(value: unknown): number | null {
  const duration = numberValue(value);
  if (!duration || duration <= 0) return null;
  return duration > 1_000 ? duration / 1_000 : duration;
}

function addressUrls(value: unknown): string[] {
  const list = objectValue(value)?.url_list;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 8).map((entry) => stringValue(entry, 4096)).filter((entry): entry is string => !!entry);
}

function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

export function isDirectTikTokMediaUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return DIRECT_TIKTOK_MEDIA_HOSTS.some((allowed) => hostMatches(host, allowed));
  } catch {
    return false;
  }
}

function isProviderHostedMediaUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'scrapecreators.com' || host.endsWith('.scrapecreators.com') ||
      host.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

/** Parse only the documented bounded fields used by the worker. No recursive
 *  traversal and no raw response retention. */
export function parseScrapeCreatorsVideo(
  body: unknown,
  expectedVideoId: string,
): ParsedScrapeCreatorsVideo {
  const root = objectValue(body);
  const detail = objectValue(root?.aweme_detail);
  const video = objectValue(detail?.video);
  const author = objectValue(detail?.author);
  const videoId = [detail?.aweme_id, detail?.id_str, detail?.id]
    .map((value) => stringValue(value, 24))
    .find((value): value is string => !!value && VIDEO_ID.test(value)) ?? null;
  const canonicalVideoId = videoIdFromTikTokUrl(detail?.url) ?? videoIdFromTikTokUrl(detail?.share_url);
  const observed = [videoId, canonicalVideoId].filter((value): value is string => !!value);

  const knownAddresses = [
    video?.download_no_watermark_addr,
    video?.play_addr,
    video?.download_addr,
  ];
  const urls = knownAddresses.flatMap(addressUrls);
  const directMediaUrl = urls.find(isDirectTikTokMediaUrl) ?? null;
  const providerHostedMediaPresent = urls.some(isProviderHostedMediaUrl);
  const identityMatches = observed.length > 0 && observed.every((id) => id === expectedVideoId);
  const structurallyValid = root?.success === true && !!detail && VIDEO_ID.test(expectedVideoId);

  return {
    result: !structurallyValid
      ? 'INVALID_RESPONSE'
      : !identityMatches
        ? 'IDENTITY_MISMATCH'
        : directMediaUrl
          ? 'SUCCESS_MEDIA'
          : 'NO_MEDIA',
    videoId,
    canonicalVideoId,
    directMediaUrl,
    providerHostedMediaPresent,
    durationSeconds: normalizeDuration(video?.duration ?? detail?.duration),
    description: stringValue(detail?.desc, 2_000),
    creatorHandle: stringValue(author?.unique_id, 100),
    creatorName: stringValue(author?.nickname, 200),
    creatorId: stringValue(author?.uid ?? author?.id, 100),
    credits: numberValue(root?.credits_charged),
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_BODY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new MediaError('provider_unavailable', 'scrapecreators_response_too_large');
  }
  if (!response.body) throw new MediaError('provider_unavailable', 'scrapecreators_empty_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_PROVIDER_BODY_BYTES) {
        await reader.cancel();
        throw new MediaError('provider_unavailable', 'scrapecreators_response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
  } catch {
    throw new MediaError('provider_unavailable', 'scrapecreators_invalid_json');
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get('retry-after'));
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.ceil(value), 900) : undefined;
}

async function validateDownloadedPayload(filePath: string, result: DownloadResult): Promise<void> {
  const contentType = result.contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (!(contentType.startsWith('video/') || contentType === 'application/octet-stream')) {
    throw new MediaError('invalid_media', 'scrapecreators_bad_content_type');
  }
  if (result.bytes < MIN_MEDIA_BYTES) throw new MediaError('invalid_media', 'scrapecreators_media_too_small');
  const file = await open(filePath, 'r');
  try {
    const prefix = Buffer.alloc(Math.min(result.bytes, 512));
    await file.read(prefix, 0, prefix.byteLength, 0);
    const text = prefix.toString('utf8').trimStart().toLowerCase();
    if (text.startsWith('<!doctype') || text.startsWith('<html') || text.startsWith('{') || text.startsWith('[')) {
      throw new MediaError('invalid_media', 'scrapecreators_non_media_payload');
    }
  } finally {
    await file.close();
  }
}

export class ScrapeCreatorsTikTokProvider {
  private readonly cfg: WorkerConfig;
  private readonly deps: ProviderDeps;

  constructor(cfg: WorkerConfig, deps: Partial<ProviderDeps> = {}) {
    this.cfg = cfg;
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  async resolve(input: ScrapeCreatorsResolveInput): Promise<ResolvedMedia> {
    if (!this.cfg.scrapeCreatorsTikTokFallbackEnabled || !this.cfg.scrapeCreatorsApiKey) {
      throw new MediaError('provider_unavailable', 'scrapecreators_not_configured');
    }
    if (!VIDEO_ID.test(input.expectedVideoId)) {
      throw new MediaError('unsupported_url', 'scrapecreators_missing_canonical_id');
    }

    const endpoint = new URL(ENDPOINT);
    endpoint.searchParams.set('url', input.canonicalUrl);
    endpoint.searchParams.set('download_media', 'false');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (input.signal.aborted) throw new MediaError('cancelled');
    input.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.min(this.cfg.downloadTimeoutMs, 30_000));
    const finishRequest = () => {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', onAbort);
    };
    const started = this.deps.now();
    let response: Response;
    try {
      response = await this.deps.fetch(endpoint, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'x-api-key': this.cfg.scrapeCreatorsApiKey,
          'user-agent': 'NearrMediaWorker/0.1 (+https://nearr.app; contact=support@nearr.app)',
        },
      });
    } catch {
      finishRequest();
      if (input.signal.aborted) throw new MediaError('cancelled');
      if (controller.signal.aborted) throw new MediaError('download_timeout', 'scrapecreators_api_timeout');
      throw new MediaError('provider_unavailable', 'scrapecreators_transport_error');
    }
    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      finishRequest();
      throw new MediaError('provider_rate_limited', 'scrapecreators_rate_limited', retryAfterSeconds(response));
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      finishRequest();
      throw new MediaError('provider_unavailable', 'scrapecreators_provider_auth_failed');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      finishRequest();
      throw new MediaError(
        response.status >= 500 ? 'provider_unavailable' : 'download_failed',
        `scrapecreators_status_${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await readBoundedJson(response);
    } catch (error) {
      if (input.signal.aborted) throw new MediaError('cancelled');
      if (controller.signal.aborted) throw new MediaError('download_timeout', 'scrapecreators_api_timeout');
      throw error;
    } finally {
      finishRequest();
    }
    const providerLatencyMs = Math.max(0, this.deps.now() - started);
    const parsed = parseScrapeCreatorsVideo(body, input.expectedVideoId);
    if (parsed.result === 'IDENTITY_MISMATCH') {
      throw new MediaError('identity_mismatch', 'scrapecreators_identity_mismatch');
    }
    if (parsed.result === 'INVALID_RESPONSE') {
      throw new MediaError('invalid_media', 'scrapecreators_invalid_response');
    }
    if (parsed.result === 'NO_MEDIA' || !parsed.directMediaUrl) {
      throw new MediaError('missing_video', 'scrapecreators_no_direct_media');
    }
    if (parsed.durationSeconds && parsed.durationSeconds > this.cfg.maxDurationSeconds) {
      throw new MediaError('duration_too_long', `${Math.round(parsed.durationSeconds)}s`);
    }

    const destination = path.join(input.workDir, 'scrapecreators-source.mp4');
    try {
      const download = await this.deps.download({
        url: parsed.directMediaUrl,
        destPath: destination,
        maxBytes: this.cfg.maxDownloadBytes,
        timeoutMs: this.cfg.downloadTimeoutMs,
        redirectLimit: this.cfg.redirectLimit,
        allowlist: [...DIRECT_TIKTOK_MEDIA_HOSTS],
        signal: input.signal,
        extraHeaders: { referer: input.canonicalUrl },
      });
      await validateDownloadedPayload(destination, download);
      const probe: MediaProbe = await this.deps.inspect(this.cfg, destination, input.signal);
      return {
        canonicalUrl: input.canonicalUrl,
        localFilePath: destination,
        mimeType: download.contentType?.split(';')[0]?.trim() || 'video/mp4',
        sizeBytes: download.bytes,
        durationSeconds: probe.durationSeconds,
        metadataDescription: normalizeSourceDescription(parsed.description),
        metadataCreatorHandle: parsed.creatorHandle,
        metadataPostId: input.expectedVideoId,
        sourceId: input.expectedVideoId,
        metadataCreatorName: parsed.creatorName,
        metadataCreatorId: parsed.creatorId,
        source: 'tiktok/scrapecreators-direct',
        warnings: ['scrapecreators_fallback'],
        acquisition: {
          provider: 'scrapecreators',
          canonicalTikTokId: input.expectedVideoId,
          providerLatencyMs,
          providerMediaBytes: download.bytes,
          providerResult: 'SUCCESS_MEDIA',
          ...(parsed.credits === null ? {} : { providerCredits: parsed.credits }),
        },
      };
    } catch (error) {
      await this.deps.remove(destination).catch(() => undefined);
      throw error;
    }
  }
}
