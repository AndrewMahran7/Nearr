import type { WorkerConfig } from '../config/env.js';
import type { ScrapeCreatorsFacebookProvider } from '../providers/ScrapeCreatorsFacebookProvider.js';
import { isMediaError, type ResolvedMedia } from '../types/media.js';
import { log } from '../util/logger.js';
import {
  FacebookMediaResolver,
  facebookNumericContentId,
  resolveFacebookAcquisitionUrl,
} from './FacebookMediaResolver.js';
import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import { shouldUseScrapeCreatorsFacebookFallback } from './scrapeCreatorsFacebookFallbackPolicy.js';

export type FacebookCacheLookup = (input: ResolveInput) => Promise<ResolvedMedia | null>;

function sourceUrlClass(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/').filter(Boolean).map((part) => part.toLowerCase());
    if (url.hostname.toLowerCase() === 'fb.watch') return 'fb_watch';
    if (['reel', 'reels'].includes(parts[0] ?? '')) return 'reel';
    if (parts.includes('videos') || parts[0] === 'watch' || parts[0] === 'video.php') return 'video';
    if (parts[0] === 'share') return 'share_redirect';
    if (parts.includes('posts') || ['story.php', 'permalink.php'].includes(parts[0] ?? '')) return 'post';
  } catch {
    // Bounded classification only.
  }
  return 'unknown';
}

/** Facebook acquisition ladder: canonical identity, optional recognition
 * cache, primary public yt-dlp retrieval, then exactly one ScrapeCreators call. */
export class FacebookFallbackMediaResolver implements MediaResolver {
  readonly name = 'facebook/yt-dlp';
  private readonly cfg: WorkerConfig;
  private readonly primary: MediaResolver;
  private readonly fallback: Pick<ScrapeCreatorsFacebookProvider, 'resolve'>;
  private readonly cacheLookup?: FacebookCacheLookup;

  constructor(
    cfg: WorkerConfig,
    fallback: Pick<ScrapeCreatorsFacebookProvider, 'resolve'>,
    primary: MediaResolver = new FacebookMediaResolver(cfg),
    cacheLookup?: FacebookCacheLookup,
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
    const rawUrl = input.canonicalUrl || input.sourceUrl;
    const acquisition = await resolveFacebookAcquisitionUrl(rawUrl, input.signal);
    const canonicalFacebookId = facebookNumericContentId(acquisition.url);
    const canonicalUrl = canonicalFacebookId
      ? `https://www.facebook.com/reel/${canonicalFacebookId}/`
      : acquisition.url;
    const normalizedInput: ResolveInput = { ...input, canonicalUrl };

    const cached = await this.cacheLookup?.(normalizedInput);
    if (cached) return cached;

    try {
      const media = await this.primary.resolve(normalizedInput);
      return {
        ...media,
        warnings: acquisition.canonicalized && !media.warnings.includes('facebook_public_embed_canonicalized')
          ? [...media.warnings, 'facebook_public_embed_canonicalized']
          : media.warnings,
        acquisition: {
          provider: 'yt_dlp',
          primaryAcquisitionResult: 'success_media',
          scrapeCreatorsInvoked: false,
          finalAcquisitionProvider: 'yt_dlp',
          sourceUrlClass: sourceUrlClass(input.sourceUrl),
          ...(canonicalFacebookId ? { canonicalFacebookId } : {}),
        },
      };
    } catch (error) {
      if (!isMediaError(error)) throw error;
      if (error.code === 'cancelled' || input.signal.aborted) throw error;
      const decision = shouldUseScrapeCreatorsFacebookFallback({
        platform: 'facebook',
        primaryAcquisitionProducedUsableMedia: false,
        scrapeCreatorsAttempted,
        canonicalFacebookId,
        failureCode: error.code,
        failureDetail: error.detail,
      });
      if (
        !this.cfg.scrapeCreatorsFacebookFallbackEnabled ||
        !decision.eligible ||
        !canonicalFacebookId
      ) {
        throw error;
      }

      scrapeCreatorsAttempted = true;
      const urlClass = sourceUrlClass(input.sourceUrl);
      log.info('scrapecreators_facebook_fallback_invoked', {
        jobId: input.jobId,
        platform: 'facebook',
        sourceUrlClass: urlClass,
        canonicalFacebookId,
        primaryProvider: this.primary.name,
        primaryAcquisitionResult: 'failure_no_usable_media',
        primaryFailureCode: error.code,
        scrapeCreatorsInvoked: true,
        fallbackReason: decision.reason,
      });
      try {
        const media = await this.fallback.resolve({
          jobId: input.jobId,
          sourceUrl: input.sourceUrl,
          canonicalUrl,
          expectedFacebookId: canonicalFacebookId,
          workDir: input.workDir,
          signal: input.signal,
        });
        const fallbackAcquisition = {
          ...media.acquisition,
          provider: 'scrapecreators' as const,
          sourceUrlClass: urlClass,
          fallbackReason: decision.reason,
          canonicalFacebookId,
          primaryAcquisitionResult: 'failure_no_usable_media' as const,
          primaryFailureCode: error.code,
          scrapeCreatorsInvoked: true,
          scrapeCreatorsResult: media.acquisition?.providerResult ?? 'SUCCESS_MEDIA',
          identityMatch: true,
          finalAcquisitionProvider: 'scrapecreators' as const,
        };
        log.info('scrapecreators_facebook_fallback_success', {
          jobId: input.jobId,
          platform: 'facebook',
          sourceUrlClass: urlClass,
          canonicalFacebookId,
          primaryProvider: this.primary.name,
          primaryAcquisitionResult: 'failure_no_usable_media',
          primaryFailureCode: error.code,
          scrapeCreatorsInvoked: true,
          scrapeCreatorsResult: fallbackAcquisition.scrapeCreatorsResult,
          identityMatch: true,
          providerLatencyMs: fallbackAcquisition.providerLatencyMs,
          bytes: fallbackAcquisition.providerMediaBytes,
          credits: fallbackAcquisition.providerCredits,
          finalAcquisitionProvider: 'scrapecreators',
        });
        return { ...media, acquisition: fallbackAcquisition };
      } catch (fallbackError) {
        const providerError = isMediaError(fallbackError) ? fallbackError : null;
        log.warn('scrapecreators_facebook_fallback_failure', {
          jobId: input.jobId,
          platform: 'facebook',
          sourceUrlClass: urlClass,
          canonicalFacebookId,
          primaryProvider: this.primary.name,
          primaryAcquisitionResult: 'failure_no_usable_media',
          primaryFailureCode: error.code,
          scrapeCreatorsInvoked: true,
          scrapeCreatorsResult: providerError?.code ?? 'download_failed',
          identityMatch: providerError?.code === 'identity_mismatch' ? false : undefined,
          finalAcquisitionProvider: 'none',
        });
        throw fallbackError;
      }
    }
  }
}
