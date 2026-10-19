import { isSameSourceUrl } from './savedPlaceSourceMerge';
import type { ShareJob } from '../services/shareJobsService';
import type { SavedPlaceWithPlace } from '../types';

export type QuickCheckCompletionIntent = {
  jobId: string;
  savedPlaceId: string;
  googlePlaceId: string;
  sourceUrl: string | null;
};

export type QuickCheckIntentMismatch = 'missing_saved_place' | 'different_place' | 'missing_source';

export type QuickCheckCompletionDecision =
  | { kind: 'verified_completed'; savedPlaceId: string }
  | { kind: 'retry_resolution'; savedPlaceId: string }
  | { kind: 'cancelled_or_unavailable'; reason: 'missing_job' | 'cancelled' }
  | { kind: 'different_result'; authoritativeSavedPlaceId: string | null }
  | { kind: 'unverified_result'; reason: QuickCheckIntentMismatch };

/** Exact relationship check used after a lost/terminal resolve response. */
export function savedPlaceMatchesQuickCheckIntent(
  saved: SavedPlaceWithPlace | null,
  intent: QuickCheckCompletionIntent,
): QuickCheckIntentMismatch | null {
  if (!saved || saved.id !== intent.savedPlaceId) return 'missing_saved_place';
  if (saved.place.google_place_id !== intent.googlePlaceId) return 'different_place';
  if (!intent.sourceUrl) return null;
  const represented = isSameSourceUrl(saved.source_url, intent.sourceUrl)
    || (saved.sources ?? []).some((source) =>
      isSameSourceUrl(source.canonical_url, intent.sourceUrl)
      || isSameSourceUrl(source.original_url, intent.sourceUrl));
  return represented ? null : 'missing_source';
}

/**
 * Reconcile the two durable records after persistence and job resolution race.
 * A similarly named save is never enough: id, provider identity and source
 * association must all match the user's exact intended result.
 */
export function decideQuickCheckCompletion(input: {
  job: ShareJob | null;
  saved: SavedPlaceWithPlace | null;
  intent: QuickCheckCompletionIntent;
}): QuickCheckCompletionDecision {
  if (!input.job || input.job.id !== input.intent.jobId) {
    return { kind: 'cancelled_or_unavailable', reason: 'missing_job' };
  }
  if (input.job.status === 'cancelled') {
    return { kind: 'cancelled_or_unavailable', reason: 'cancelled' };
  }
  if (input.job.status === 'completed' && input.job.saved_place_id !== input.intent.savedPlaceId) {
    return { kind: 'different_result', authoritativeSavedPlaceId: input.job.saved_place_id };
  }
  const mismatch = savedPlaceMatchesQuickCheckIntent(input.saved, input.intent);
  if (mismatch) return { kind: 'unverified_result', reason: mismatch };
  if (input.job.status === 'completed' && input.job.saved_place_id === input.intent.savedPlaceId) {
    return { kind: 'verified_completed', savedPlaceId: input.intent.savedPlaceId };
  }
  if (input.job.status === 'needs_help') {
    return { kind: 'retry_resolution', savedPlaceId: input.intent.savedPlaceId };
  }
  return { kind: 'different_result', authoritativeSavedPlaceId: input.job.saved_place_id };
}

