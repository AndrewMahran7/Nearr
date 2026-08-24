import path from 'node:path';
import { unlink } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { MediaError, type MediaProbe, type ResolvedMedia } from '../types/media.js';
import { safeDownloadToFile } from '../security/ssrf.js';
import { normalizeSourceDescription } from '../util/sourceText.js';
import {
  requestScrapeCreatorsJson,
  validateScrapeCreatorsDownloadedPayload,
} from './ScrapeCreatorsClient.js';

const ENDPOINT = 'https://api.scrapecreators.com/v2/tiktok/video';
const VIDEO_ID = /^\d{1,24}$/;
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
    const { body, providerLatencyMs } = await requestScrapeCreatorsJson({
      endpoint,
      apiKey: this.cfg.scrapeCreatorsApiKey,
      timeoutMs: this.cfg.downloadTimeoutMs,
      signal: input.signal,
      deps: { fetch: this.deps.fetch, now: this.deps.now },
    });
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
      await validateScrapeCreatorsDownloadedPayload(destination, download);
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
