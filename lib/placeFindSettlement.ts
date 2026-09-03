export type PlaceFindSettlementAction = 'consume' | 'release';

type TerminalJob = {
  status?: unknown;
  saved_place_id?: unknown;
  candidate_payload?: unknown;
  failure_reason?: unknown;
  needs_help_reason?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function usefulCandidatePayload(value: unknown): boolean {
  const payload = record(value);
  if (!payload) return false;
  if (Array.isArray(payload.candidates) && payload.candidates.some((item) => !!record(item))) {
    return true;
  }
  if (Array.isArray(payload.savedPlaceIds) && payload.savedPlaceIds.some((id) => typeof id === 'string')) {
    return true;
  }
  if (Array.isArray(payload.mentionSlots)) {
    for (const rawSlot of payload.mentionSlots) {
      const slot = record(rawSlot);
      if (!slot) continue;
      if (Array.isArray(slot.candidates) && slot.candidates.some((item) => !!record(item))) return true;
      if (typeof slot.savedPlaceId === 'string' && slot.savedPlaceId) return true;
      if (Array.isArray(slot.identityHypotheses)) {
        const observableName = slot.identityHypotheses.some((raw) => {
          const hypothesis = record(raw);
          return hypothesis?.evidenceKind === 'observable' &&
            typeof hypothesis.name === 'string' && hypothesis.name.trim().length > 1;
        });
        if (observableName) return true;
      }
    }
  }
  const partial = record(payload.partialResult);
  const lead = record(partial?.strongestLead);
  return lead?.evidenceKind === 'observable' &&
    typeof lead.name === 'string' && lead.name.trim().length > 1;
}

/**
 * Billing follows durable user value, not internal pipeline cost. Cache hits,
 * exact auto-saves, candidate review, and multi-place results all converge on
 * this same terminal classifier. Technical/no-result outcomes release.
 */
export function placeFindSettlementForTerminalJob(job: TerminalJob): {
  action: PlaceFindSettlementAction;
  reason: string;
} {
  if (job.status === 'completed') {
    return { action: 'consume', reason: job.saved_place_id ? 'durable_place_result' : 'actionable_completed_result' };
  }
  if (job.status === 'needs_help' && usefulCandidatePayload(job.candidate_payload)) {
    return { action: 'consume', reason: 'actionable_review_result' };
  }
  const reason = typeof job.failure_reason === 'string' && job.failure_reason
    ? job.failure_reason
    : typeof job.needs_help_reason === 'string' && job.needs_help_reason
    ? job.needs_help_reason
    : job.status === 'cancelled'
    ? 'user_cancelled_before_result'
    : 'no_actionable_result';
  return { action: 'release', reason };
}

