// Pure translation of the resolver decision into an async share-job outcome.
// Notification presentation lives in shareCompletionNotification.ts.

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
 * Map a resolver decision to a durable job plan. `failed` deliberately routes
 * to manual help because the worker reserves hard `failed` status for errors
 * that exhaust the retry budget.
 */
export function planFromResolverDecision(input: PlanInput): JobPlan {
  const hasCandidates = input.candidateCount > 0;

  switch (input.decision) {
    case 'auto_save':
      if (input.safeToAutoSave && input.hasPrimaryCandidate) {
        return { route: 'auto_save' };
      }
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
