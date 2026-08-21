import type { NeedsHelpMode, ResolverDecision } from './decisionMapping.ts';
import {
  normalizeSelectionMode,
  type SelectionMode,
} from '../../../lib/placeSelection.ts';

export type CandidateCountDecision = {
  decision: ResolverDecision;
  mode: NeedsHelpMode | 'auto';
  autoSave: boolean;
};

/** Product invariant shared by metadata persistence and media recovery. */
export function decisionForPlausibleCandidates(
  candidateCount: number,
  hasConcreteBlocker = false,
): CandidateCountDecision {
  const count = Math.max(0, Math.floor(candidateCount));
  if (count === 0) return { decision: 'manual_fallback', mode: 'manual', autoSave: false };
  if (count === 1 && !hasConcreteBlocker) return { decision: 'auto_save', mode: 'auto', autoSave: true };
  if (count === 1) return { decision: 'candidate_confirmation', mode: 'single', autoSave: false };
  return { decision: 'candidate_picker', mode: 'picker', autoSave: false };
}

export function decisionForSelectionSemantics(
  candidateCount: number,
  selectionMode: SelectionMode,
  hasConcreteBlocker = false,
): CandidateCountDecision {
  const count = Math.max(0, Math.floor(candidateCount));
  if (selectionMode === 'multi_independent' && count >= 2) {
    return {
      decision: 'multi_candidate_confirmation',
      mode: 'multi',
      autoSave: false,
    };
  }
  return decisionForPlausibleCandidates(count, hasConcreteBlocker);
}

export function persistedCandidateCount(candidatePayload: unknown): number {
  if (!candidatePayload || typeof candidatePayload !== 'object') return 0;
  const candidates = (candidatePayload as { candidates?: unknown }).candidates;
  return Array.isArray(candidates)
    ? candidates.filter((candidate) => candidate && typeof candidate === 'object').length
    : 0;
}

export function buildCandidateReviewSnapshot<T>(
  candidates: T[],
  limit = 10,
  selectionMode?: SelectionMode,
): { candidates: T[]; selectionMode?: SelectionMode } {
  return {
    candidates: candidates.slice(0, Math.max(0, Math.floor(limit))),
    ...(selectionMode ? { selectionMode } : {}),
  };
}

/** Failed media work must fall back to the persisted metadata choices. */
export function mediaFailureReview(candidatePayload: unknown): CandidateCountDecision {
  const count = persistedCandidateCount(candidatePayload);
  const selectionMode = normalizeSelectionMode(
    candidatePayload && typeof candidatePayload === 'object'
      ? (candidatePayload as { selectionMode?: unknown }).selectionMode
      : null,
  ) ?? 'single_identity';
  if (count === 0) return decisionForSelectionSemantics(0, selectionMode);
  // A parked single candidate necessarily carried a concrete blocker; an
  // unblocked singleton would already have auto-saved before media fallback.
  return decisionForSelectionSemantics(count, selectionMode, count === 1);
}
