import type { MediaErrorCode } from '../types/media.js';

export type ScrapeCreatorsFallbackPolicyInput = {
  platform: string;
  primaryAcquisitionProducedUsableMedia: boolean;
  scrapeCreatorsAttempted: boolean;
  failureCode?: MediaErrorCode;
  failureDetail?: string;
  canonicalTikTokId?: string | null;
  canonicalInstagramId?: string | null;
  /** Telemetry only. Content classification never controls eligibility. */
  contentClassification?: string | null;
};

export type ScrapeCreatorsFallbackDecision = {
  eligible: boolean;
  reason: string;
};

const TIKTOK_VIDEO_ID = /^\d{1,24}$/;
const INSTAGRAM_SHORTCODE = /^[A-Za-z0-9_-]{1,80}$/;

/** The one authoritative decision point for paid ScrapeCreators fallbacks.
 * Content labels never control eligibility. Once an exact supported platform
 * identity exists, every primary acquisition failure gets one provider call. */
export function shouldUseScrapeCreatorsFallback(
  input: ScrapeCreatorsFallbackPolicyInput,
): ScrapeCreatorsFallbackDecision {
  const platform = input.platform.trim().toLowerCase();
  const canonicalId = platform === 'tiktok'
    ? input.canonicalTikTokId ?? ''
    : platform === 'instagram'
      ? input.canonicalInstagramId ?? ''
      : '';
  const identityValid = platform === 'tiktok'
    ? TIKTOK_VIDEO_ID.test(canonicalId)
    : platform === 'instagram'
      ? INSTAGRAM_SHORTCODE.test(canonicalId)
      : false;
  if (platform !== 'tiktok' && platform !== 'instagram') {
    return { eligible: false, reason: 'unsupported_platform' };
  }
  if (!identityValid) return { eligible: false, reason: 'canonical_id_missing' };
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
