import type { MediaErrorCode } from '../types/media.js';

export type ScrapeCreatorsFallbackPolicyInput = {
  platform: string;
  primaryAcquisitionProducedUsableMedia: boolean;
  scrapeCreatorsAttempted: boolean;
  failureCode?: MediaErrorCode;
  failureDetail?: string;
  canonicalTikTokId?: string | null;
  /** Telemetry only. Content classification never controls eligibility. */
  contentClassification?: string | null;
};

export type ScrapeCreatorsFallbackDecision = {
  eligible: boolean;
  reason: string;
};

const VIDEO_ID = /^\d{1,24}$/;

/** The one authoritative decision point for the paid TikTok fallback.
 *
 * Eligibility is intentionally independent of yt-dlp's content classification:
 * once a shared TikTok has a stable canonical ID, every primary acquisition
 * failure gets one provider attempt. Classifications remain telemetry only. */
export function shouldUseScrapeCreatorsFallback(
  input: ScrapeCreatorsFallbackPolicyInput,
): ScrapeCreatorsFallbackDecision {
  if (input.platform.trim().toLowerCase() !== 'tiktok') {
    return { eligible: false, reason: 'non_tiktok' };
  }
  const id = input.canonicalTikTokId ?? '';
  if (!VIDEO_ID.test(id)) {
    return { eligible: false, reason: 'canonical_id_missing' };
  }
  if (input.primaryAcquisitionProducedUsableMedia) {
    return { eligible: false, reason: 'primary_media_usable' };
  }
  if (input.scrapeCreatorsAttempted) {
    return { eligible: false, reason: 'scrapecreators_already_attempted' };
  }
  return {
    eligible: true,
    reason: input.failureDetail ?? input.failureCode ?? 'primary_no_usable_media',
  };
}
