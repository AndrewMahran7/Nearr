/**
 * Canonical, privacy-safe presentation for terminal share failures.
 *
 * Backend codes remain useful for diagnostics and analytics, but only these
 * four stable categories may select user-facing failure copy. Notification and
 * in-app surfaces both call this mapper; copy is never used as control flow.
 */

export const SHARE_MEDIA_MAX_DURATION_SECONDS = 180;

export type ShareFailureCategory =
  | 'media_access_required'
  | 'media_too_long'
  | 'analysis_insufficient'
  | 'technical_failure';

export type ShareFailureAction = 'back' | 'manual_search' | 'retry';

export type ShareFailureInput = {
  failureCategory?: string | null;
  failureCode?: string | null;
  provider?: string | null;
  analysisAttempted?: boolean | null;
  status?: string | null;
};

export type ShareFailurePresentation = {
  category: ShareFailureCategory;
  title: string;
  body: string;
  actions: readonly ShareFailureAction[];
  retryable: boolean;
};

const CATEGORIES = new Set<ShareFailureCategory>([
  'media_access_required',
  'media_too_long',
  'analysis_insufficient',
  'technical_failure',
]);

const ACCESS_CODES = new Set([
  'authentication_required',
  'private_or_unavailable',
]);

const INSUFFICIENT_CODES = new Set([
  'insufficient_evidence',
  'no_result',
  'no_trustworthy_place',
  'premium_no_useful_result',
]);

function normalized(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function formatShareMediaDurationLimit(seconds = SHARE_MEDIA_MAX_DURATION_SECONDS): string {
  if (seconds > 0 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  return `${Math.max(1, Math.floor(seconds))} seconds`;
}

/**
 * Map persisted backend facts to the small user-facing taxonomy. An explicit
 * analysis-insufficient category is accepted only when the recognition path
 * was actually entered. Unknown/legacy states fail closed to technical copy.
 */
export function classifyShareFailure(input: ShareFailureInput): ShareFailureCategory {
  const code = normalized(input.failureCode);
  const explicit = normalized(input.failureCategory) as ShareFailureCategory;

  if (code === 'duration_too_long' || explicit === 'media_too_long') {
    return 'media_too_long';
  }
  if (code === 'authentication_required' || ACCESS_CODES.has(code) || explicit === 'media_access_required') {
    return 'media_access_required';
  }
  if (
    input.analysisAttempted === true &&
    (INSUFFICIENT_CODES.has(code) || explicit === 'analysis_insufficient' || (!code && input.status === 'needs_help'))
  ) {
    return 'analysis_insufficient';
  }
  if (CATEGORIES.has(explicit) && explicit !== 'analysis_insufficient') return explicit;
  return 'technical_failure';
}

export function presentShareFailure(input: ShareFailureInput): ShareFailurePresentation {
  const category = classifyShareFailure(input);
  const code = normalized(input.failureCode);
  const provider = normalized(input.provider);

  switch (category) {
    case 'media_access_required':
      if (code === 'authentication_required' && provider === 'tiktok') {
        return {
          category,
          title: "We couldn't access this video",
          body: "TikTok requires sign-in to view this post, so Nearr couldn't analyze it.",
          actions: ['back', 'manual_search'],
          retryable: false,
        };
      }
      return {
        category,
        title: "We couldn't access this post",
        body: "The source requires access Nearr doesn't currently have.",
        actions: ['back', 'manual_search'],
        retryable: false,
      };

    case 'media_too_long':
      return {
        category,
        title: 'This video is too long to analyze right now',
        body: `Nearr currently supports videos up to ${formatShareMediaDurationLimit()}.`,
        actions: ['back', 'manual_search'],
        retryable: false,
      };

    case 'analysis_insufficient':
      return {
        category,
        title: "We couldn't pin this one down",
        body: 'Open Nearr to search manually.',
        actions: ['back', 'manual_search'],
        retryable: false,
      };

    case 'technical_failure':
    default:
      return {
        category: 'technical_failure',
        title: 'Something went wrong',
        body: "We couldn't finish checking this post. Open Nearr to try again.",
        actions: ['back', 'retry'],
        retryable: true,
      };
  }
}
