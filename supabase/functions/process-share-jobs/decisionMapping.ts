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

export type NeedsHelpMode = 'single' | 'multi' | 'manual';

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
        mode: hasCandidates ? 'single' : 'manual',
        needsHelpReason: 'candidate_confirmation',
        suggestedQuery: query(input.cleanSearchQuery),
      };

    case 'candidate_confirmation':
    case 'candidate_picker':
      return {
        route: 'needs_help',
        mode: hasCandidates ? 'single' : 'manual',
        needsHelpReason: 'candidate_confirmation',
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
        mode: 'manual',
        needsHelpReason: 'manual_search',
        suggestedQuery: query(input.cleanSearchQuery),
      };

    case 'failed':
    default:
      return {
        route: 'needs_help',
        mode: 'manual',
        needsHelpReason: query(input.failureReason) ?? 'manual_search',
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
}): JobNotification {
  const label = platformLabel(args.platform);
  const from = label === 'shared' ? 'your shared post' : `your ${label} post`;
  return {
    title: `Found ${args.placeName}`,
    body: `Saved from ${from}.`,
    data: {
      type: 'share_job_completed',
      jobId: args.jobId,
      savedPlaceId: args.savedPlaceId,
    },
  };
}

export function buildNeedsHelpNotification(args: {
  mode: NeedsHelpMode;
  jobId: string;
  candidateName?: string | null;
  candidateCount?: number;
}): JobNotification {
  const data = { type: 'share_job_needs_help', jobId: args.jobId };
  switch (args.mode) {
    case 'single':
      return {
        title: args.candidateName ? `Is this ${args.candidateName}?` : 'Is this the right place?',
        body: 'Tap to confirm the place.',
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
        title: 'We need help finding this place',
        body: 'Tap to search for it.',
        data,
      };
  }
}
