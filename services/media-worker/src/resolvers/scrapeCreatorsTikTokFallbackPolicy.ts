import type { MediaErrorCode } from '../types/media.js';

export type ScrapeCreatorsFallbackPolicyInput = {
  platform: string;
  failureCode: MediaErrorCode;
  failureDetail?: string;
  canonicalTikTokId?: string | null;
  contentClassification?: string | null;
};

export type ScrapeCreatorsFallbackDecision = {
  eligible: boolean;
  reason: string;
};

const VIDEO_ID = /^\d{1,24}$/;
const PROTECTED_CLASSIFICATION = /(?:sensitive|private|deleted|unavailable|removed|age[_ -]?restrict|protected|auth|login|not[_ -]?public)/i;
const ELIGIBLE_YTDLP_DETAILS = new Set([
  'extractor_failed',
  'yt_dlp_failed',
  'json_parse_failed',
]);

/** The one authoritative decision point for the paid TikTok fallback.
 *
 * General traffic is intentionally narrow: only a stable TikTok video ID and
 * a generic yt-dlp/extractor break qualify. Authentication, policy, privacy,
 * deletion and post-download media gates never qualify. There is no
 * authentication or sensitive-content override in production. */
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

  const classification = `${input.contentClassification ?? ''} ${input.failureDetail ?? ''}`.trim();
  if (PROTECTED_CLASSIFICATION.test(classification)) {
    return { eligible: false, reason: 'protected_classification' };
  }
  if (input.failureCode !== 'provider_changed') {
    return { eligible: false, reason: `excluded_${input.failureCode}` };
  }
  if (!ELIGIBLE_YTDLP_DETAILS.has(input.failureDetail ?? '')) {
    return { eligible: false, reason: 'not_generic_ytdlp_break' };
  }
  return {
    eligible: true,
    reason: input.failureDetail ?? 'yt_dlp_failed',
  };
}
