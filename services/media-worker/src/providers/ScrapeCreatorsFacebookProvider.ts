import path from 'node:path';
import { unlink } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { safeDownloadToFile } from '../security/ssrf.js';
import { MediaError, type MediaProbe, type ResolvedMedia } from '../types/media.js';
import { normalizeSourceDescription } from '../util/sourceText.js';
import {
  requestScrapeCreatorsJson,
  validateScrapeCreatorsDownloadedPayload,
  type ScrapeCreatorsRequestDeps,
} from './ScrapeCreatorsClient.js';

const ENDPOINT = 'https://api.scrapecreators.com/v1/facebook/post';
const FACEBOOK_VIDEO_ID = /^\d{5,30}$/;
const DIRECT_FACEBOOK_MEDIA_HOSTS = ['fbcdn.net'] as const;

type JsonObject = Record<string, unknown>;

export type ParsedScrapeCreatorsFacebookPost = {
  result: 'SUCCESS_MEDIA' | 'NO_MEDIA' | 'IDENTITY_MISMATCH' | 'INVALID_RESPONSE' | 'UNSUPPORTED_MULTIPLE_MEDIA';
  providerVideoId: string | null;
  canonicalVideoId: string | null;
  directMediaUrl: string | null;
  durationSeconds: number | null;
  description: string | null;
  creatorName: string | null;
  creatorId: string | null;
  credits: number | null;
};

export type ScrapeCreatorsFacebookResolveInput = {
  jobId: string;
  sourceUrl: string;
  canonicalUrl: string;
  expectedFacebookId: string;
  workDir: string;
  signal: AbortSignal;
};

type ProviderDeps = ScrapeCreatorsRequestDeps & {
  download: typeof safeDownloadToFile;
  inspect: typeof inspectMedia;
  remove: typeof unlink;
};

const DEFAULT_DEPS: ProviderDeps = {
  fetch,
  now: Date.now,
  download: safeDownloadToFile,
  inspect: inspectMedia,
  remove: unlink,
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

export function facebookVideoIdFromProviderUrl(value: unknown): string | null {
  const raw = stringValue(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/(?:^|\.)facebook\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (['reel', 'reels'].includes((parts[0] ?? '').toLowerCase()) && FACEBOOK_VIDEO_ID.test(parts[1] ?? '')) {
      return parts[1]!;
    }
    const queryId = url.searchParams.get('v') ?? '';
    if (FACEBOOK_VIDEO_ID.test(queryId)) return queryId;
    const videos = parts.findIndex((part) => part.toLowerCase() === 'videos');
    return videos >= 0
      ? [...parts.slice(videos + 1)].reverse().find((part) => FACEBOOK_VIDEO_ID.test(part)) ?? null
      : null;
  } catch {
    return null;
  }
}

function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

export function isDirectFacebookMediaUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return DIRECT_FACEBOOK_MEDIA_HOSTS.some((allowed) => hostMatches(host, allowed));
  } catch {
    return false;
  }
}

function hasAmbiguousMultipleMedia(root: JsonObject): boolean {
  for (const field of ['videos', 'media', 'attachments', 'carousel']) {
    const value = root[field];
    if (Array.isArray(value) && value.filter((entry) => objectValue(entry)).length > 1) return true;
  }
  return false;
}

/** Parse only the documented single-post fields. post_id is retained only as
 * metadata: live responses prove that it often differs from video.id. */
export function parseScrapeCreatorsFacebookPost(
  body: unknown,
  expectedFacebookId: string,
): ParsedScrapeCreatorsFacebookPost {
  const root = objectValue(body);
  const video = objectValue(root?.video);
  const author = objectValue(root?.author);
  const providerVideoId = stringValue(video?.id, 30);
  const providerVideoIdMalformed = video && video.id !== undefined &&
    (!providerVideoId || !FACEBOOK_VIDEO_ID.test(providerVideoId));
  const canonicalVideoId = facebookVideoIdFromProviderUrl(root?.url);
  const observed = [
    providerVideoId && FACEBOOK_VIDEO_ID.test(providerVideoId) ? providerVideoId : null,
    canonicalVideoId,
  ].filter((value): value is string => !!value);
  const hd = stringValue(video?.hd_url, 4096);
  const sd = stringValue(video?.sd_url, 4096);
  const directMediaUrl = [hd, sd].find((value): value is string => !!value && isDirectFacebookMediaUrl(value)) ?? null;
  const structurallyValid = root?.success === true && !!video && FACEBOOK_VIDEO_ID.test(expectedFacebookId);
  const identityMatches = observed.length > 0 && observed.every((id) => id === expectedFacebookId);

  return {
    result: !root || !structurallyValid || providerVideoIdMalformed
      ? 'INVALID_RESPONSE'
      : hasAmbiguousMultipleMedia(root)
        ? 'UNSUPPORTED_MULTIPLE_MEDIA'
        : !identityMatches
          ? 'IDENTITY_MISMATCH'
          : directMediaUrl
            ? 'SUCCESS_MEDIA'
            : 'NO_MEDIA',
    providerVideoId: providerVideoId && FACEBOOK_VIDEO_ID.test(providerVideoId) ? providerVideoId : null,
    canonicalVideoId,
    directMediaUrl,
    durationSeconds: numberValue(video?.length_in_second),
    description: stringValue(root?.description, 2_000),
    creatorName: stringValue(author?.name, 200),
    creatorId: stringValue(author?.id, 100),
    credits: numberValue(root?.credits_charged),
  };
}

export class ScrapeCreatorsFacebookProvider {
  private readonly cfg: WorkerConfig;
  private readonly deps: ProviderDeps;

  constructor(cfg: WorkerConfig, deps: Partial<ProviderDeps> = {}) {
    this.cfg = cfg;
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  async resolve(input: ScrapeCreatorsFacebookResolveInput): Promise<ResolvedMedia> {
    if (!this.cfg.scrapeCreatorsFacebookFallbackEnabled || !this.cfg.scrapeCreatorsApiKey) {
      throw new MediaError('provider_unavailable', 'scrapecreators_not_configured');
    }
    if (!FACEBOOK_VIDEO_ID.test(input.expectedFacebookId)) {
      throw new MediaError('unsupported_url', 'scrapecreators_missing_canonical_id');
    }

    const endpoint = new URL(ENDPOINT);
    endpoint.searchParams.set('url', input.canonicalUrl);
    const { body, providerLatencyMs } = await requestScrapeCreatorsJson({
      endpoint,
      apiKey: this.cfg.scrapeCreatorsApiKey,
      timeoutMs: this.cfg.downloadTimeoutMs,
      signal: input.signal,
      clientErrorCode: 'missing_video',
      deps: { fetch: this.deps.fetch, now: this.deps.now },
    });
    const parsed = parseScrapeCreatorsFacebookPost(body, input.expectedFacebookId);
    if (parsed.result === 'IDENTITY_MISMATCH') {
      throw new MediaError('identity_mismatch', 'scrapecreators_facebook_identity_mismatch');
    }
    if (parsed.result === 'INVALID_RESPONSE') {
      throw new MediaError('invalid_media', 'scrapecreators_facebook_invalid_response');
    }
    if (parsed.result === 'UNSUPPORTED_MULTIPLE_MEDIA') {
      throw new MediaError('unsupported_url', 'scrapecreators_facebook_multiple_media_unsupported');
    }
    if (parsed.result === 'NO_MEDIA' || !parsed.directMediaUrl) {
      throw new MediaError('missing_video', 'scrapecreators_facebook_no_direct_media');
    }
    if (parsed.durationSeconds && parsed.durationSeconds > this.cfg.maxDurationSeconds) {
      throw new MediaError('duration_too_long', `${Math.round(parsed.durationSeconds)}s`);
    }

    const destination = path.join(input.workDir, 'scrapecreators-facebook-source.mp4');
    try {
      const download = await this.deps.download({
        url: parsed.directMediaUrl,
        destPath: destination,
        maxBytes: this.cfg.maxDownloadBytes,
        timeoutMs: this.cfg.downloadTimeoutMs,
        redirectLimit: this.cfg.redirectLimit,
        allowlist: [...DIRECT_FACEBOOK_MEDIA_HOSTS],
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
        metadataPostId: input.expectedFacebookId,
        sourceId: input.expectedFacebookId,
        metadataCreatorName: parsed.creatorName,
        metadataCreatorId: parsed.creatorId,
        source: 'facebook/scrapecreators-direct',
        warnings: ['scrapecreators_fallback'],
        acquisition: {
          provider: 'scrapecreators',
          canonicalFacebookId: input.expectedFacebookId,
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
