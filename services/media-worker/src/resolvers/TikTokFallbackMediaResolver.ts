import type { WorkerConfig } from '../config/env.js';
import type { ScrapeCreatorsTikTokProvider } from '../providers/ScrapeCreatorsTikTokProvider.js';
import { isMediaError, type ResolvedMedia } from '../types/media.js';
import { log } from '../util/logger.js';
import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import { canonicalTikTokVideoUrl, TikTokMediaResolver } from './TikTokMediaResolver.js';
import { shouldUseScrapeCreatorsFallback } from './scrapeCreatorsTikTokFallbackPolicy.js';

export type TikTokCacheLookup = (input: ResolveInput) => Promise<ResolvedMedia | null>;

/** TikTok acquisition ladder. Recognition-cache injection is supported at the
 *  first step, but the current integration base has no worker recognition
 *  cache, so production wiring leaves it absent. */
export class TikTokFallbackMediaResolver implements MediaResolver {
  readonly name = 'tiktok/yt-dlp';
  private readonly cfg: WorkerConfig;
  private readonly primary: MediaResolver;
  private readonly fallback: Pick<ScrapeCreatorsTikTokProvider, 'resolve'>;
  private readonly cacheLookup?: TikTokCacheLookup;

  constructor(
    cfg: WorkerConfig,
    fallback: Pick<ScrapeCreatorsTikTokProvider, 'resolve'>,
    primary: MediaResolver = new TikTokMediaResolver(cfg),
    cacheLookup?: TikTokCacheLookup,
  ) {
    this.cfg = cfg;
    this.primary = primary;
    this.fallback = fallback;
    this.cacheLookup = cacheLookup;
  }

  supports(input: { platform: string; url: URL }): boolean {
    return this.primary.supports(input);
  }

  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    let scrapeCreatorsAttempted = false;
    const cached = await this.cacheLookup?.(input);
    if (cached) return cached;

    const exactCanonical = canonicalTikTokVideoUrl(input.canonicalUrl) ??
      canonicalTikTokVideoUrl(input.sourceUrl);
    const canonicalTikTokId = exactCanonical?.split('/').pop() ?? null;
    try {
      const media = await this.primary.resolve(input);
      return {
        ...media,
        acquisition: {
          provider: 'yt_dlp',
          primaryAcquisitionResult: 'success_media',
          scrapeCreatorsInvoked: false,
          finalAcquisitionProvider: 'yt_dlp',
          ...(canonicalTikTokId ? { canonicalTikTokId } : {}),
        },
      };
    } catch (error) {
      if (!isMediaError(error)) throw error;
      // Cancellation is an exhausted execution budget, not an acquisition
      // classification. Never start a paid call after the task was cancelled.
      if (error.code === 'cancelled' || input.signal.aborted) throw error;
      const decision = shouldUseScrapeCreatorsFallback({
        platform: 'tiktok',
        primaryAcquisitionProducedUsableMedia: false,
        scrapeCreatorsAttempted,
        failureCode: error.code,
        failureDetail: error.detail,
        canonicalTikTokId,
        contentClassification: error.detail,
      });
      if (!this.cfg.scrapeCreatorsTikTokFallbackEnabled || !decision.eligible || !exactCanonical || !canonicalTikTokId) {
        return Promise.reject(error);
      }

      scrapeCreatorsAttempted = true;
      log.info('scrapecreators_fallback_invoked', {
        jobId: input.jobId,
        primaryAcquisitionResult: 'failure_no_usable_media',
        primaryFailureCode: error.code,
        scrapeCreatorsInvoked: true,
        canonicalTikTokId,
        fallbackReason: decision.reason,
      });
      try {
        const media = await this.fallback.resolve({
          jobId: input.jobId,
          sourceUrl: input.sourceUrl,
          canonicalUrl: exactCanonical,
          expectedVideoId: canonicalTikTokId,
          workDir: input.workDir,
          signal: input.signal,
        });
        const acquisition = {
          ...media.acquisition,
          provider: 'scrapecreators' as const,
          fallbackReason: decision.reason,
          canonicalTikTokId,
          primaryAcquisitionResult: 'failure_no_usable_media' as const,
          primaryFailureCode: error.code,
          scrapeCreatorsInvoked: true,
          scrapeCreatorsResult: media.acquisition?.providerResult ?? 'SUCCESS_MEDIA',
          identityMatch: true,
          finalAcquisitionProvider: 'scrapecreators' as const,
        };
        log.info('scrapecreators_fallback_success', {
          jobId: input.jobId,
          primaryAcquisitionResult: 'failure_no_usable_media',
          primaryFailureCode: error.code,
          scrapeCreatorsInvoked: true,
          canonicalTikTokId,
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
          jobId: input.jobId,
          primaryAcquisitionResult: 'failure_no_usable_media',
          primaryFailureCode: error.code,
          scrapeCreatorsInvoked: true,
          canonicalTikTokId,
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
