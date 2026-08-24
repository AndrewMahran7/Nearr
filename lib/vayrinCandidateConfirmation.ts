/** Pure presentation rules for Vayrin's pre-save candidate confirmation. */

export type CandidateConfirmationPlace = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string | null;
  category?: string | null;
  types?: readonly string[] | null;
  rawTypes?: readonly string[] | null;
  primaryType?: string | null;
  primaryTypeDisplayName?: string | null;
  googleMapsTypeLabel?: string | null;
  photoUrl?: string | null;
  sourceFrameUrl?: string | null;
  sourceTimestamps?: readonly number[] | null;
};

export type CandidateConfirmationMode = 'none' | 'single' | 'multiple' | 'broad';

const BROAD_TYPES = new Set([
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'colloquial_area',
  'country',
  'locality',
  'neighborhood',
  'postal_code',
  'postal_town',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
]);

const EXACT_TYPES = new Set([
  'establishment',
  'point_of_interest',
  'premise',
  'street_address',
  'tourist_attraction',
]);

function normalizedTypes(candidate: CandidateConfirmationPlace): string[] {
  return [candidate.primaryType, ...(candidate.types ?? candidate.rawTypes ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

export function isBroadCandidate(candidate: CandidateConfirmationPlace): boolean {
  const types = normalizedTypes(candidate);
  if (types.some((type) => EXACT_TYPES.has(type))) return false;
  return types.some((type) => BROAD_TYPES.has(type));
}

export function confirmationMode(
  candidates: readonly CandidateConfirmationPlace[],
): CandidateConfirmationMode {
  if (candidates.length === 0) return 'none';
  if (candidates.length > 1) return 'multiple';
  return isBroadCandidate(candidates[0]!) ? 'broad' : 'single';
}

export function confirmationPrompt(mode: CandidateConfirmationMode): string {
  switch (mode) {
    case 'single':
      return 'Is this the place?';
    case 'multiple':
      return 'Which one is it?';
    case 'broad':
      return 'Is it around here?';
    case 'none':
    default:
      return "Couldn't pin this one down.";
  }
}

export function formatCandidateTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function candidateEvidenceLabel(
  timestamps: readonly number[] | null | undefined,
): string | null {
  const first = timestamps?.find((value) => Number.isFinite(value) && value >= 0);
  return first == null ? null : `Seen around ${formatCandidateTimestamp(first)}`;
}

export function candidateCategoryLabel(candidate: CandidateConfirmationPlace): string | null {
  const fallbackType = (candidate.types ?? candidate.rawTypes ?? []).find((type) =>
    !['point_of_interest', 'establishment', 'political'].includes(type));
  const value = candidate.primaryTypeDisplayName ?? candidate.googleMapsTypeLabel ?? candidate.category ?? fallbackType;
  if (!value?.trim()) return null;
  return value.trim().replace(/_/g, ' ');
}
