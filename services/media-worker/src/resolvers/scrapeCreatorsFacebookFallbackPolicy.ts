import type { MediaErrorCode } from '../types/media.js';

export type ScrapeCreatorsFacebookFallbackPolicyInput = {
  platform: string;
  primaryAcquisitionProducedUsableMedia: boolean;
  scrapeCreatorsAttempted: boolean;
  canonicalFacebookId?: string | null;
  failureCode?: MediaErrorCode;
  failureDetail?: string;
};

export type ScrapeCreatorsFacebookFallbackDecision = {
  eligible: boolean;
  reason: string;
};

const FACEBOOK_VIDEO_ID = /^\d{5,30}$/;

/** One authoritative Facebook paid-fallback decision. Primary failure
 * classification is telemetry only: valid identity + no usable video bytes
 * means one fallback attempt. */
export function shouldUseScrapeCreatorsFacebookFallback(
  input: ScrapeCreatorsFacebookFallbackPolicyInput,
): ScrapeCreatorsFacebookFallbackDecision {
  if (input.platform.trim().toLowerCase() !== 'facebook') {
    return { eligible: false, reason: 'non_facebook' };
  }
  if (!FACEBOOK_VIDEO_ID.test(input.canonicalFacebookId ?? '')) {
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
