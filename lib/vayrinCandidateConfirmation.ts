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
  matchScore?: number | null;
  businessStatus?: string | null;
  contextReason?: string | null;
  contextLabel?: string | null;
  distanceKm?: number | null;
  localityMatch?: boolean;
};

/** The complete review taxonomy. Only provider-backed canonical values are saveable. */
export type VayrinResultType =
  | 'EXACT_PLACE'
  | 'RESOLVED_POI'
  | 'BROAD_AREA'
  | 'RAW_NAME'
  | 'TEXTUAL_LEAD'
  | 'UNRESOLVED_QUERY'
  | 'MULTI_PLACE'
  | 'ALTERNATIVE_CANDIDATE'
  | 'MANUAL_SEARCH_RESULT';

export const MAX_VISIBLE_CANDIDATES = 3;

export type CandidateSelectionMode = 'exclusive' | 'multiple';

export function reviewSelectionMode(
  mentionSlots: readonly {
    candidates?: readonly CandidateConfirmationPlace[];
    identityHypotheses?: readonly unknown[];
  }[],
): CandidateSelectionMode {
  const only = mentionSlots.length === 1 ? mentionSlots[0] : null;
  return only && (only.candidates?.length ?? 0) > 1 && (only.identityHypotheses?.length ?? 0) > 1
    ? 'exclusive'
    : 'multiple';
}

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

function normalizedKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isCanonicalCandidate(candidate: CandidateConfirmationPlace): boolean {
  return candidate.googlePlaceId.trim().length > 0 && candidate.name.trim().length > 0;
}

/**
 * Preserve the resolver's final order while removing presentation-only noise.
 * This intentionally does not rescore: the server's evidence ranking remains
 * authoritative and the complete persisted candidate payload remains intact.
 */
export function visibleCandidateShortlist<T extends CandidateConfirmationPlace>(
  candidates: readonly T[],
  limit = MAX_VISIBLE_CANDIDATES,
): T[] {
  const unique: T[] = [];
  const providerIds = new Set<string>();
  const identities = new Set<string>();
  for (const candidate of candidates) {
    if (!isCanonicalCandidate(candidate)) continue;
    if (candidate.businessStatus === 'CLOSED_PERMANENTLY') continue;
    if (typeof candidate.matchScore === 'number' && Number.isFinite(candidate.matchScore) && candidate.matchScore < 0.35) continue;
    const providerId = candidate.googlePlaceId.trim();
    const identity = `${normalizedKey(candidate.name)}|${normalizedKey(candidate.formattedAddress)}`;
    if (providerIds.has(providerId) || identities.has(identity)) continue;
    providerIds.add(providerId);
    identities.add(identity);
    unique.push(candidate);
  }

  const hasExact = unique.some((candidate) => !isBroadCandidate(candidate));
  const gated = hasExact
    ? unique.filter((candidate) => !isBroadCandidate(candidate))
    : unique;
  return gated.slice(0, Math.max(0, Math.floor(limit)));
}

const TITLE_WORDS = new Set([
  'best', 'beautiful', 'craziest', 'dangerous', 'ever', 'hidden', 'incredible',
  'insane', 'most', 'must', 'secret', 'top', 'viral', 'world', 'worlds', 'worst',
]);
const TITLE_CTA_WORDS = new Set(['need', 'needs', 'visit', 'watch', 'see', 'try']);

/** Generalized guard for captions/headlines that resemble names but lack identity evidence. */
export function isLikelyTitleLikePhrase(value: string): boolean {
  const tokens = normalizedKey(value).split(' ').filter(Boolean);
  if (tokens.length < 4) return false;
  const titleSignals = tokens.filter((token) => TITLE_WORDS.has(token)).length;
  return titleSignals >= 2 || (titleSignals >= 1 && tokens.some((token) => TITLE_CTA_WORDS.has(token)));
}

export function classifyCanonicalCandidate(
  candidate: CandidateConfirmationPlace,
  origin: 'resolver' | 'exact' | 'alternative' | 'manual' = 'resolver',
): VayrinResultType {
  if (!isCanonicalCandidate(candidate)) return 'UNRESOLVED_QUERY';
  if (origin === 'exact') return 'EXACT_PLACE';
  if (origin === 'manual') return 'MANUAL_SEARCH_RESULT';
  if (origin === 'alternative') return 'ALTERNATIVE_CANDIDATE';
  return isBroadCandidate(candidate) ? 'BROAD_AREA' : 'RESOLVED_POI';
}

export function classifyUnresolvedText(
  value: string,
  origin: 'identity' | 'text' | 'query',
): VayrinResultType {
  if (origin === 'query') return 'UNRESOLVED_QUERY';
  if (origin === 'text' || isLikelyTitleLikePhrase(value)) return 'TEXTUAL_LEAD';
  return 'RAW_NAME';
}

export function toggleCandidateSelection(
  selectedIds: readonly string[],
  candidateId: string,
  mode: CandidateSelectionMode,
): string[] {
  if (mode === 'exclusive') return selectedIds.includes(candidateId) ? [] : [candidateId];
  return selectedIds.includes(candidateId)
    ? selectedIds.filter((id) => id !== candidateId)
    : [...new Set([...selectedIds, candidateId])];
}

export function candidateSaveLabel(count: number): string {
  const safeCount = Math.max(0, Math.floor(count));
  return safeCount <= 1 ? 'Save this place' : `Save ${safeCount} places`;
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

export function candidateContextEvidenceLabel(
  candidate: CandidateConfirmationPlace,
): string | null {
  const label = candidate.contextLabel?.trim();
  if (!label) return null;
  if (candidate.contextReason === 'near_resolved_video_place') {
    return `Near the other place in this video · ${label}`;
  }
  if (candidate.localityMatch || candidate.contextReason === 'source_locality' ||
    candidate.contextReason === 'exact_source_evidence' || candidate.contextReason === 'video_geo_hint') {
    return `Matches the ${label} area`;
  }
  return null;
}

export function candidateCategoryLabel(candidate: CandidateConfirmationPlace): string | null {
  const fallbackType = (candidate.types ?? candidate.rawTypes ?? []).find((type) =>
    !['point_of_interest', 'establishment', 'political'].includes(type));
  const value = candidate.primaryTypeDisplayName ?? candidate.googleMapsTypeLabel ?? candidate.category ?? fallbackType;
  if (!value?.trim()) return null;
  return value.trim().replace(/_/g, ' ');
}
