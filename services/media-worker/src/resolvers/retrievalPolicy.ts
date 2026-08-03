// services/media-worker/src/resolvers/retrievalPolicy.ts
//
// PURE mapping from the resolver's structured MediaError codes to the LOCAL
// inspector's precise retrieval classifications. The user-facing app stays
// generic (needs_help), but the local diagnostic must be specific + sanitized.

import type { MediaErrorCode } from '../types/media.js';

export type RetrievalClassification =
  | 'retrieved_publicly'
  | 'unsupported_url'
  | 'post_unavailable'
  | 'private_or_login_required'
  | 'retrieval_provider_not_configured'
  | 'rate_limited'
  | 'media_too_large'
  | 'media_too_long'
  | 'invalid_media'
  | 'transient_retrieval_failure';

/** Map a resolver MediaError code (+ optional sanitized detail) to a precise
 *  retrieval classification. */
export function classifyRetrievalError(
  code: MediaErrorCode | string,
  detail?: string | null,
): RetrievalClassification {
  switch (code) {
    case 'authentication_required':
      return 'private_or_login_required';
    case 'private_or_unavailable':
      // yt-dlp reports removed/unavailable posts here too.
      return (detail ?? '').includes('not_public') ? 'private_or_login_required' : 'post_unavailable';
    case 'unsupported_platform':
    case 'unsupported_url':
      return 'unsupported_url';
    case 'file_too_large':
      return 'media_too_large';
    case 'duration_too_long':
      return 'media_too_long';
    case 'invalid_media':
    case 'missing_video':
      return 'invalid_media';
    case 'download_failed':
      // The resolver classifies rate limits into download_failed w/ a detail.
      return (detail ?? '').includes('rate_limited') ? 'rate_limited' : 'transient_retrieval_failure';
    case 'download_timeout':
    case 'provider_changed':
    case 'redirect_limit':
    case 'ssrf_blocked':
      return 'transient_retrieval_failure';
    case 'no_provider_configured':
      return 'retrieval_provider_not_configured';
    default:
      return 'transient_retrieval_failure';
  }
}

/** Whether a classification means the direct provider should hand off to a
 *  configured fallback provider (public content that a direct anonymous fetch
 *  couldn't get). Never triggers on unsupported/oversized/too-long inputs. */
export function shouldTryFallback(classification: RetrievalClassification): boolean {
  return (
    classification === 'private_or_login_required' ||
    classification === 'post_unavailable' ||
    classification === 'rate_limited' ||
    classification === 'transient_retrieval_failure'
  );
}
