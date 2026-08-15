// supabase/functions/process-share-jobs/decisionMapping.ts
//
// PURE translation of the existing resolver decision into an async share-job
// outcome + notification copy. No Deno globals, no I/O — so it is unit-tested
// from Node via scripts/tsconfig.json (scripts/testShareJobDecisionMapping.ts).
//
// SAFETY INVARIANT: `auto_save` is honored ONLY when the resolver's existing
// deterministic `safeToAutoSave` gate is true AND a primary candidate exists.
// This module NEVER loosens auto-save; it only routes. Everything else becomes
// `needs_help` (single / multi / manual) — never a silent wrong save.

export type ResolverDecision =
  | 'auto_save'
  | 'candidate_confirmation'
  | 'candidate_picker'
  | 'multi_candidate_confirmation'
  | 'manual_fallback'
  | 'failed';

export type NeedsHelpMode = 'single' | 'picker' | 'multi' | 'manual';

export type JobPlan =
  | { route: 'auto_save' }
  | {
      route: 'needs_help';
      mode: NeedsHelpMode;
      needsHelpReason: string;
      suggestedQuery: string | null;
    };

export type PlanInput = {
  decision: ResolverDecision;
  safeToAutoSave: boolean;
  hasPrimaryCandidate: boolean;
  candidateCount: number;
  cleanSearchQuery?: string | null;
  failureReason?: string | null;
};

function query(q: string | null | undefined): string | null {
  const t = (q ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * Map a resolver decision to a durable job plan.
 *
 * Note: `failed` is deliberately routed to `needs_help` (manual) because a
 * user can almost always still search for the place by hand — per the spec,
 * "prefer needs_help; set failed only when manual resolution is impossible."
 * A hard `failed` job STATUS is reserved for processing errors that exhaust
 * the retry budget (handled in the worker, not here).
 */
export function planFromResolverDecision(input: PlanInput): JobPlan {
  const hasCandidates = input.candidateCount > 0;

  switch (input.decision) {
    case 'auto_save':
      if (input.safeToAutoSave && input.hasPrimaryCandidate) {
        return { route: 'auto_save' };
      }
      // Defensive: auto_save without the safety gate must never silently save.
      return {
        route: 'needs_help',
        mode: input.candidateCount > 1 ? 'picker' : hasCandidates ? 'single' : 'manual',
        needsHelpReason: 'candidate_confirmation',
        suggestedQuery: query(input.cleanSearchQuery),
      };

    case 'candidate_confirmation':
      return {
        route: 'needs_help',
        mode: input.candidateCount > 1 ? 'picker' : hasCandidates ? 'single' : 'manual',
        needsHelpReason: 'candidate_confirmation',
        suggestedQuery: query(input.cleanSearchQuery),
      };

    case 'candidate_picker':
      return {
        route: 'needs_help',
        mode: input.candidateCount > 1 ? 'picker' : hasCandidates ? 'single' : 'manual',
        needsHelpReason: input.candidateCount > 1 ? 'multiple_candidates' : 'candidate_confirmation',
        suggestedQuery: query(input.cleanSearchQuery),
      };

    case 'multi_candidate_confirmation':
      return {
        route: 'needs_help',
        mode: input.candidateCount > 1 ? 'multi' : hasCandidates ? 'single' : 'manual',
        needsHelpReason: 'multiple_candidates',
        suggestedQuery: query(input.cleanSearchQuery),
      };

    case 'manual_fallback':
      return {
        route: 'needs_help',
        mode: input.candidateCount > 1 ? 'picker' : hasCandidates ? 'single' : 'manual',
        needsHelpReason: hasCandidates ? 'candidate_confirmation' : 'manual_search',
        suggestedQuery: query(input.cleanSearchQuery),
      };

    case 'failed':
    default:
      return {
        route: 'needs_help',
        mode: input.candidateCount > 1 ? 'picker' : hasCandidates ? 'single' : 'manual',
        needsHelpReason: hasCandidates ? 'candidate_confirmation' : query(input.failureReason) ?? 'manual_search',
        suggestedQuery: query(input.cleanSearchQuery),
      };
  }
}

// ---------------------------------------------------------------------------
// Notification copy (Task 7). Pure — the worker fans these out via Expo push.
// ---------------------------------------------------------------------------

export type JobNotification = {
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export function platformLabel(platform: string | null | undefined): string {
  switch ((platform ?? '').toLowerCase()) {
    case 'instagram':
      return 'Instagram';
    case 'tiktok':
      return 'TikTok';
    case 'youtube':
      return 'YouTube';
    case 'facebook':
      return 'Facebook';
    case 'snapchat':
      return 'Snapchat';
    case 'twitter':
      return 'X';
    default:
      return 'shared';
  }
}

export function buildCompletedNotification(args: {
  placeName: string;
  platform: string | null | undefined;
  jobId: string;
  savedPlaceId: string;
  googlePlaceId?: string | null;
  alreadySaved?: boolean;
}): JobNotification {
  const label = platformLabel(args.platform);
  const from = label === 'shared' ? 'your shared post' : `your ${label} post`;
  // Already-saved is an explicit, non-error terminal outcome. It routes to the
  // EXISTING saved place (same `savedPlaceId`), never to a queue item. The
  // canonical `googlePlaceId` is included as a stable fallback so the client can
  // still open the existing place if the saved_places row id can't be matched.
  if (args.alreadySaved) {
    return {
      title: 'Already saved',
      body: `${args.placeName} is already in Nearr.`,
      data: {
        type: 'share_job_completed',
        outcome: 'already_saved',
        jobId: args.jobId,
        savedPlaceId: args.savedPlaceId,
        ...(args.googlePlaceId ? { googlePlaceId: args.googlePlaceId } : {}),
      },
    };
  }
  return {
    title: `Found ${args.placeName}`,
    body: `Saved from ${from}.`,
    data: {
      type: 'share_job_completed',
      outcome: 'completed',
      jobId: args.jobId,
      savedPlaceId: args.savedPlaceId,
      ...(args.googlePlaceId ? { googlePlaceId: args.googlePlaceId } : {}),
    },
  };
}

export function buildMediaResultNotification(args: {
  jobId: string;
  createdSavedPlaceIds: string[];
  alreadySavedPlaceIds: string[];
  reviewCount: number;
}): JobNotification {
  const created = [...new Set(args.createdSavedPlaceIds.filter(Boolean))];
  const existing = [...new Set(args.alreadySavedPlaceIds.filter(Boolean))];
  const allSaved = [...new Set([...created, ...existing])];
  const reviewCount = Math.max(0, Math.floor(args.reviewCount));
  const savedCount = created.length;
  const savedCopy = `${savedCount} ${savedCount === 1 ? 'place' : 'places'}`;
  const reviewCopy = `${reviewCount} ${reviewCount === 1 ? 'needs' : 'need'} your review.`;

  if (reviewCount > 0) {
    return {
      title: savedCount > 0 ? `Saved ${savedCopy}. ${reviewCopy}` : 'We need your help',
      body: savedCount > 0 ? 'Tap to review the remaining places.' : 'Tap to identify the unresolved places.',
      data: {
        type: 'share_job_needs_help',
        outcome: 'mixed',
        jobId: args.jobId,
        savedPlaceIds: allSaved,
        createdSavedPlaceIds: created,
        reviewCount,
      },
    };
  }

  if (savedCount > 0) {
    return {
      title: `Saved ${savedCopy} to your map`,
      body: savedCount > 1 ? 'Tap to view them together.' : 'Tap to view it on your map.',
      data: {
        type: 'share_job_completed',
        outcome: 'completed',
        jobId: args.jobId,
        savedPlaceId: allSaved[0],
        savedPlaceIds: allSaved,
        createdSavedPlaceIds: created,
      },
    };
  }

  return {
    title: existing.length === 1 ? 'Already saved' : 'Places already saved',
    body: existing.length === 1 ? 'This place is already in Nearr.' : 'These places are already in Nearr.',
    data: {
      type: 'share_job_completed',
      outcome: 'already_saved',
      jobId: args.jobId,
      savedPlaceId: allSaved[0],
      savedPlaceIds: allSaved,
    },
  };
}

export function buildNeedsHelpNotification(args: {
  mode: NeedsHelpMode;
  jobId: string;
  candidateName?: string | null;
  candidateCount?: number;
}): JobNotification {
  const data = {
    type: 'share_job_needs_help',
    jobId: args.jobId,
    reviewMode: args.mode === 'picker' ? 'candidate_picker' : args.mode,
    ...(args.candidateCount ? { candidateCount: args.candidateCount } : {}),
  };
  switch (args.mode) {
    case 'single':
      return {
        title: 'We think we found it',
        body: 'Give us a quick check before we save it.',
        data,
      };
    case 'picker':
      return {
        title: `We found ${Math.max(Math.floor(args.candidateCount ?? 2), 2)} possible places`,
        body: 'Pick the one you meant and we\u2019ll save it.',
        data,
      };
    case 'multi':
      return {
        title: `We found ${Math.max(args.candidateCount ?? 2, 2)} possible locations`,
        body: 'Choose which ones to save.',
        data,
      };
    case 'manual':
    default:
      return {
        title: 'We couldn\u2019t quite find this one',
        body: 'Help us track down the place.',
        data,
      };
  }
}
