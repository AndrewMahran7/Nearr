import type { WorkerConfig } from '../config/env.js';
import type { ScrapeCreatorsInstagramProvider } from '../providers/ScrapeCreatorsInstagramProvider.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { isMediaError, type ResolvedMedia } from '../types/media.js';
import { log } from '../util/logger.js';
import { InstagramMediaResolver } from './InstagramMediaResolver.js';
import { instagramContentIdentity } from './instagramUrl.js';
import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import { shouldUseScrapeCreatorsFallback } from './scrapeCreatorsFallbackPolicy.js';

export type InstagramCacheLookup = (input: ResolveInput) => Promise<ResolvedMedia | null>;
export type InstagramPrimaryMediaInspector = typeof inspectMedia;

/** Instagram acquisition ladder. The cache seam is intentionally first, but
 * current main has no worker recognition cache, so production wiring omits it. */
export class InstagramFallbackMediaResolver implements MediaResolver {
  readonly name = 'instagram/yt-dlp';
  private readonly cfg: WorkerConfig;
  private readonly primary: MediaResolver;
  private readonly fallback: Pick<ScrapeCreatorsInstagramProvider, 'resolve'>;
  private readonly cacheLookup?: InstagramCacheLookup;
  private readonly inspectPrimary: InstagramPrimaryMediaInspector;

  constructor(
    cfg: WorkerConfig,
    fallback: Pick<ScrapeCreatorsInstagramProvider, 'resolve'>,
    primary: MediaResolver = new InstagramMediaResolver(cfg),
    cacheLookup?: InstagramCacheLookup,
    inspectPrimary: InstagramPrimaryMediaInspector = inspectMedia,
  ) {
    this.cfg = cfg;
    this.primary = primary;
    this.fallback = fallback;
    this.cacheLookup = cacheLookup;
    this.inspectPrimary = inspectPrimary;
  }

  supports(input: { platform: string; url: URL }): boolean {
    return this.primary.supports(input);
  }

  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    let scrapeCreatorsAttempted = false;
    const cached = await this.cacheLookup?.(input);
    if (cached) return cached;

    const identity = instagramContentIdentity(input.sourceUrl, input.canonicalUrl);
    try {
      const media = await this.primary.resolve(input);
      // The fallback decision is based on usable video bytes, not on whether a
      // downloader happened to return a file. This duplicates the pipeline's
      // later probe deliberately so invalid primary bytes still reach the paid
      // fallback instead of failing after the decision point.
      await this.inspectPrimary(this.cfg, media.localFilePath, input.signal);
      return {
        ...media,
        acquisition: {
          provider: 'yt_dlp',
          primaryAcquisitionProvider: 'yt_dlp',
          primaryAcquisitionResult: 'success_media',
          scrapeCreatorsInvoked: false,
          finalAcquisitionProvider: 'yt_dlp',
          ...(identity ? { canonicalInstagramId: identity.shortcode } : {}),
        },
      };
    } catch (error) {
      if (!isMediaError(error)) throw error;
      if (error.code === 'cancelled' || input.signal.aborted) throw error;
      const decision = shouldUseScrapeCreatorsFallback({
        platform: 'instagram',
        primaryAcquisitionProducedUsableMedia: false,
        scrapeCreatorsAttempted,
        failureCode: error.code,
        failureDetail: error.detail,
        canonicalInstagramId: identity?.shortcode,
        contentClassification: error.detail,
      });
      if (!this.cfg.scrapeCreatorsInstagramFallbackEnabled || !decision.eligible || !identity) {
        throw error;
      }

      scrapeCreatorsAttempted = true;
      log.info('scrapecreators_fallback_invoked', {
        platform: 'instagram',
        jobId: input.jobId,
        primaryAcquisitionProvider: 'yt_dlp',
        primaryAcquisitionResult: 'failure_no_usable_media',
        primaryFailureCode: error.code,
        scrapeCreatorsInvoked: true,
        canonicalInstagramId: identity.shortcode,
        fallbackReason: decision.reason,
      });
      try {
        const media = await this.fallback.resolve({
          jobId: input.jobId,
          sourceUrl: input.sourceUrl,
          canonicalUrl: identity.canonicalUrl,
          expectedShortcode: identity.shortcode,
          workDir: input.workDir,
          signal: input.signal,
        });
        const acquisition = {
          ...media.acquisition,
          provider: 'scrapecreators' as const,
          primaryAcquisitionProvider: 'yt_dlp' as const,
          primaryAcquisitionResult: 'failure_no_usable_media' as const,
          primaryFailureCode: error.code,
          scrapeCreatorsInvoked: true,
          scrapeCreatorsResult: media.acquisition?.providerResult ?? 'SUCCESS_MEDIA',
          identityMatch: true,
          finalAcquisitionProvider: 'scrapecreators' as const,
          fallbackReason: decision.reason,
          canonicalInstagramId: identity.shortcode,
        };
        log.info('scrapecreators_fallback_success', {
          platform: 'instagram',
          jobId: input.jobId,
          primaryAcquisitionProvider: 'yt_dlp',
          primaryAcquisitionResult: 'failure_no_usable_media',
          primaryFailureCode: error.code,
          scrapeCreatorsInvoked: true,
          canonicalInstagramId: identity.shortcode,
          fallbackReason: decision.reason,
          providerLatencyMs: acquisition.providerLatencyMs,
          providerMediaBytes: acquisition.providerMediaBytes,
          providerResult: acquisition.providerResult,
          scrapeCreatorsResult: acquisition.scrapeCreatorsResult,
          providerCredits: acquisition.providerCredits,
          identityMatch: true,
          finalAcquisitionProvider: 'scrapecreators',
          mediaRecovered: true,
        });
        return { ...media, acquisition };
      } catch (fallbackError) {
        const fallbackMediaError = isMediaError(fallbackError) ? fallbackError : null;
        log.warn('scrapecreators_fallback_failure', {
          platform: 'instagram',
          jobId: input.jobId,
          primaryAcquisitionProvider: 'yt_dlp',
          primaryAcquisitionResult: 'failure_no_usable_media',
          primaryFailureCode: error.code,
          scrapeCreatorsInvoked: true,
          canonicalInstagramId: identity.shortcode,
          fallbackReason: decision.reason,
          providerResult: fallbackMediaError?.code ?? 'download_failed',
          scrapeCreatorsResult: fallbackMediaError?.code ?? 'download_failed',
          providerFailureDetail: fallbackMediaError?.detail ?? 'unknown',
          identityMatch: fallbackMediaError?.code === 'identity_mismatch' ? false : undefined,
          mediaRecovered: false,
        });
        throw fallbackError;
      }
    }
  }
}
