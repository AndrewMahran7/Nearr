import path from 'node:path';
import type { WorkerConfig } from '../config/env.js';
import { MediaError, type ResolvedMedia } from '../types/media.js';
import { normalizeSourceDescription } from '../util/sourceText.js';
import { requestScrapeCreatorsJson } from './ScrapeCreatorsClient.js';
import {
  downloadAndInspectScrapeCreatorsMedia,
  isProviderHostedMediaUrl,
  numberValue,
  objectValue,
  stringValue,
  urlUsesAllowedHost,
  type ScrapeCreatorsMediaDeps,
} from './scrapeCreatorsMedia.js';

const ENDPOINT = 'https://api.scrapecreators.com/v1/instagram/post';
const SHORTCODE = /^[A-Za-z0-9_-]{1,80}$/;
const MEDIA_ID = /^\d{1,32}$/;
const DIRECT_INSTAGRAM_MEDIA_HOSTS = ['cdninstagram.com', 'fbcdn.net'] as const;

export type ParsedScrapeCreatorsInstagramPost = {
  result: 'SUCCESS_MEDIA' | 'NO_MEDIA' | 'IDENTITY_MISMATCH' | 'INVALID_RESPONSE';
  shortcode: string | null;
  mediaId: string | null;
  directMediaUrl: string | null;
  providerHostedMediaPresent: boolean;
  mediaType: 'video' | 'carousel_single_video' | 'carousel_multiple_videos' | 'non_video' | 'unknown';
  carouselAssetCount: number;
  carouselVideoCount: number;
  durationSeconds: number | null;
  description: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  creatorId: string | null;
  credits: number | null;
};

export type ScrapeCreatorsInstagramResolveInput = {
  jobId: string;
  sourceUrl: string;
  canonicalUrl: string;
  expectedShortcode: string;
  workDir: string;
  signal: AbortSignal;
};

type ProviderDeps = Partial<ScrapeCreatorsMediaDeps> & {
  fetch?: typeof fetch;
  now?: () => number;
};

function captionText(media: Record<string, unknown>): string | null {
  const caption = objectValue(media.edge_media_to_caption);
  const edges = Array.isArray(caption?.edges) ? caption.edges.slice(0, 1) : [];
  return stringValue(objectValue(objectValue(edges[0])?.node)?.text, 2_000);
}

function videoUrl(media: Record<string, unknown>): string | null {
  const candidates = [media.video_url];
  const versions = Array.isArray(media.video_versions) ? media.video_versions.slice(0, 8) : [];
  candidates.push(...versions.map((value) => objectValue(value)?.url));
  return candidates
    .map((value) => stringValue(value, 4096))
    .find((value): value is string => !!value && urlUsesAllowedHost(value, DIRECT_INSTAGRAM_MEDIA_HOSTS)) ?? null;
}

function allKnownVideoUrls(media: Record<string, unknown>): string[] {
  const versions = Array.isArray(media.video_versions) ? media.video_versions.slice(0, 8) : [];
  return [media.video_url, ...versions.map((value) => objectValue(value)?.url)]
    .map((value) => stringValue(value, 4096))
    .filter((value): value is string => !!value);
}

/** Parse only documented bounded fields. A single-video post/reel is accepted.
 * A carousel is accepted only when it contains exactly one video child; a
 * multi-video carousel is explicit NO_MEDIA because the current recognition
 * pipeline has one media asset and cannot preserve carousel sequence safely. */
export function parseScrapeCreatorsInstagramPost(
  body: unknown,
  expectedShortcode: string,
): ParsedScrapeCreatorsInstagramPost {
  const root = objectValue(body);
  const media = objectValue(objectValue(root?.data)?.xdt_shortcode_media);
  const shortcode = stringValue(media?.shortcode, 80);
  const mediaIdCandidate = stringValue(media?.id, 32);
  const mediaId = mediaIdCandidate && MEDIA_ID.test(mediaIdCandidate) ? mediaIdCandidate : null;
  const owner = objectValue(media?.owner);
  const sidecar = objectValue(media?.edge_sidecar_to_children);
  const edges = Array.isArray(sidecar?.edges) ? sidecar.edges.slice(0, 24) : [];
  const children = edges
    .map((edge) => objectValue(objectValue(edge)?.node))
    .filter((node): node is Record<string, unknown> => !!node);
  const videoChildren = children.filter((node) => node.is_video === true || allKnownVideoUrls(node).length > 0);
  const rootVideo = media ? videoUrl(media) : null;
  const childVideo = videoChildren.length === 1 ? videoUrl(videoChildren[0]!) : null;
  const directMediaUrl = rootVideo ?? childVideo;
  const knownUrls = [
    ...(media ? allKnownVideoUrls(media) : []),
    ...videoChildren.flatMap(allKnownVideoUrls),
  ];
  const providerHostedMediaPresent = knownUrls.some(isProviderHostedMediaUrl);
  const structurallyValid = root?.success === true && !!media && !!shortcode && !!mediaId &&
    SHORTCODE.test(expectedShortcode) && SHORTCODE.test(shortcode);
  const identityMatches = shortcode === expectedShortcode;
  const carouselVideoCount = videoChildren.length;
  const mediaType: ParsedScrapeCreatorsInstagramPost['mediaType'] = children.length > 0
    ? carouselVideoCount > 1
      ? 'carousel_multiple_videos'
      : carouselVideoCount === 1
        ? 'carousel_single_video'
        : 'non_video'
    : media?.is_video === true || !!rootVideo
      ? 'video'
      : media
        ? 'non_video'
        : 'unknown';

  return {
    result: !structurallyValid
      ? 'INVALID_RESPONSE'
      : !identityMatches
        ? 'IDENTITY_MISMATCH'
        : directMediaUrl && carouselVideoCount <= 1
          ? 'SUCCESS_MEDIA'
          : 'NO_MEDIA',
    shortcode,
    mediaId,
    directMediaUrl,
    providerHostedMediaPresent,
    mediaType,
    carouselAssetCount: children.length,
    carouselVideoCount,
    durationSeconds: numberValue(media?.video_duration ?? videoChildren[0]?.video_duration),
    description: media ? captionText(media) : null,
    creatorHandle: stringValue(owner?.username, 100),
    creatorName: stringValue(owner?.full_name, 200),
    creatorId: stringValue(owner?.id, 100),
    credits: numberValue(root?.credits_charged),
  };
}

export class ScrapeCreatorsInstagramProvider {
  private readonly cfg: WorkerConfig;
  private readonly requestDeps: Pick<ProviderDeps, 'fetch' | 'now'>;
  private readonly mediaDeps: Partial<ScrapeCreatorsMediaDeps>;

  constructor(cfg: WorkerConfig, deps: ProviderDeps = {}) {
    this.cfg = cfg;
    this.requestDeps = { fetch: deps.fetch, now: deps.now };
    this.mediaDeps = { download: deps.download, inspect: deps.inspect, remove: deps.remove };
  }

  async resolve(input: ScrapeCreatorsInstagramResolveInput): Promise<ResolvedMedia> {
    if (!this.cfg.scrapeCreatorsInstagramFallbackEnabled || !this.cfg.scrapeCreatorsApiKey) {
      throw new MediaError('provider_unavailable', 'scrapecreators_not_configured');
    }
    if (!SHORTCODE.test(input.expectedShortcode)) {
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
      terminalNoMediaStatuses: [400, 404, 422],
      paymentRequiredDetail: 'scrapecreators_payment_required',
      deps: this.requestDeps,
    });
    const parsed = parseScrapeCreatorsInstagramPost(body, input.expectedShortcode);
    if (parsed.result === 'IDENTITY_MISMATCH') {
      throw new MediaError('identity_mismatch', 'scrapecreators_identity_mismatch');
    }
    if (parsed.result === 'INVALID_RESPONSE') {
      throw new MediaError('invalid_media', 'scrapecreators_invalid_response');
    }
    if (parsed.result === 'NO_MEDIA' || !parsed.directMediaUrl) {
      const detail = parsed.mediaType === 'carousel_multiple_videos'
        ? 'scrapecreators_multi_video_carousel_unsupported'
        : 'scrapecreators_no_direct_media';
      throw new MediaError('missing_video', detail);
    }
    if (parsed.durationSeconds && parsed.durationSeconds > this.cfg.maxDurationSeconds) {
      throw new MediaError('duration_too_long', `${Math.round(parsed.durationSeconds)}s`);
    }

    const destination = path.join(input.workDir, 'scrapecreators-instagram-source.mp4');
    const { download, probe } = await downloadAndInspectScrapeCreatorsMedia({
      cfg: this.cfg,
      url: parsed.directMediaUrl,
      destination,
      canonicalUrl: input.canonicalUrl,
      allowlist: DIRECT_INSTAGRAM_MEDIA_HOSTS,
      signal: input.signal,
      deps: this.mediaDeps,
    });
    return {
      canonicalUrl: input.canonicalUrl,
      localFilePath: destination,
      mimeType: download.contentType?.split(';')[0]?.trim() || 'video/mp4',
      sizeBytes: download.bytes,
      durationSeconds: probe.durationSeconds,
      metadataDescription: normalizeSourceDescription(parsed.description),
      metadataCreatorHandle: parsed.creatorHandle,
      metadataPostId: parsed.mediaId,
      sourceId: parsed.mediaId,
      metadataCreatorName: parsed.creatorName,
      metadataCreatorId: parsed.creatorId,
      source: 'instagram/scrapecreators-direct',
      warnings: ['scrapecreators_fallback'],
      acquisition: {
        provider: 'scrapecreators',
        canonicalInstagramId: input.expectedShortcode,
        ...(parsed.mediaId ? { providerPostId: parsed.mediaId } : {}),
        providerLatencyMs,
        providerMediaBytes: download.bytes,
        providerResult: 'SUCCESS_MEDIA',
        ...(parsed.credits === null ? {} : { providerCredits: parsed.credits }),
      },
    };
  }
}
