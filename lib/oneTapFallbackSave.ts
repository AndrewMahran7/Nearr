import {
  visibleCandidateShortlist,
  type CandidateConfirmationPlace,
} from './vayrinCandidateConfirmation';

/**
 * Presentation-only policy for provider-backed fallback results.
 *
 * Recognition decides whether a job may auto-save before this screen opens.
 * Once the job is in fallback, this module only decides which bounded provider
 * result is initially selected and what the explicit commit button says.
 */
export function usableFallbackCandidates<T extends CandidateConfirmationPlace>(
  candidates: readonly T[],
): T[] {
  return visibleCandidateShortlist(candidates);
}

export function preselectedFallbackCandidate<T extends CandidateConfirmationPlace>(
  candidates: readonly T[],
): T | null {
  return usableFallbackCandidates(candidates)[0] ?? null;
}

/** A fallback result is a radio choice: tapping it changes the choice only. */
export function selectFallbackCandidate(
  candidates: readonly CandidateConfirmationPlace[],
  candidateId: string,
): string[] {
  return candidates.some((candidate) => candidate.googlePlaceId === candidateId)
    ? [candidateId]
    : [];
}

function placeName(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized ? normalized : null;
}

export function fallbackSaveLabel(name: string | null | undefined): string {
  const normalized = placeName(name);
  return normalized ? `Save ${normalized}` : 'Save place';
}

export function fallbackCorrectionLabel(name: string | null | undefined): string {
  const normalized = placeName(name);
  return normalized ? `Use ${normalized}` : 'Use place';
}
