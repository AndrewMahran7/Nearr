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
  photoUrls?: readonly string[] | null;
  sourceFrameUrl?: string | null;
  sourceTimestamps?: readonly number[] | null;
  matchScore?: number | null;
  /** Optional producer-authored qualitative label. */
  matchStrength?: 'high' | 'medium' | 'low' | null;
  /** Closed resolver reason codes; never raw model reasoning. */
  reasons?: readonly string[] | null;
  evidence?: readonly string[] | null;
  /** Candidate evidence that explicitly came from analyzed video frames. */
  matchedFrameTimestamps?: readonly number[] | null;
  analyzedFrameCount?: number | null;
  evidenceItems?: readonly {
    source: 'caption' | 'speech' | 'visible_text' | 'frame';
    timestampSeconds: number | null;
  }[] | null;
  businessStatus?: string | null;
  contextReason?: string | null;
  contextLabel?: string | null;
  distanceKm?: number | null;
  localityMatch?: boolean;
  discoveryOnly?: boolean;
  provenance?: { identityEvidence?: readonly string[] | null } | null;
};

export type CandidateMatchStrength = 'high' | 'medium' | 'low';

/**
 * CONFIDENCE SOURCE: the resolver's normalized evidence-strength score, or an
 * explicit qualitative producer decision. The numeric score is a ranking aid,
 * not a calibrated probability, so the UI never renders it as a percentage.
 *
 * CONFIDENCE INTERPRETATION: bands mirror the resolver's existing strong and
 * medium decision thresholds. They compare evidence strength only and never
 * imply that Vayrin is a stated percentage "sure".
 */
export const CONFIDENCE_SOURCE = 'resolver_normalized_evidence_strength';
export const CONFIDENCE_INTERPRETATION = 'qualitative evidence-strength band; not a probability';

/** Physical-layout contract for 320/375/390/430 pt iPhone widths. */
export function quickCheckEvidenceFrameWidth(windowWidth: number): number {
  return Math.max(240, Math.min(390, Math.floor(windowWidth) - 48));
}

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
  if (safeCount === 0) return 'Select a place to save';
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

export function candidateMatchStrength(
  candidate: CandidateConfirmationPlace,
): CandidateMatchStrength | null {
  if (candidate.discoveryOnly ||
      (candidate.provenance && (candidate.provenance.identityEvidence?.length ?? 0) === 0)) return null;
  if (candidate.matchStrength) return candidate.matchStrength;
  const score = candidate.matchScore;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return null;
  if (score >= 0.78) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

export function candidateMatchLabel(candidate: CandidateConfirmationPlace): string | null {
  const strength = candidateMatchStrength(candidate);
  return strength ? `${strength[0]!.toUpperCase()}${strength.slice(1)} match` : null;
}

function uniqueFiniteTimestamps(values: readonly number[] | null | undefined): number[] {
  return [...new Set((values ?? []).filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  ))].sort((a, b) => a - b);
}

export function candidateMatchedFramesLabel(
  candidate: CandidateConfirmationPlace,
): string | null {
  const matched = uniqueFiniteTimestamps(candidate.matchedFrameTimestamps);
  if (matched.length === 0) return null;
  const analyzed = typeof candidate.analyzedFrameCount === 'number' && candidate.analyzedFrameCount >= matched.length
    ? Math.floor(candidate.analyzedFrameCount)
    : null;
  return analyzed ? `Matched frames: ${matched.length} of ${analyzed}` : 'Matched multiple video frames';
}

const REASON_COPY: Readonly<Record<string, string>> = {
  address_verified: 'Address details agree with the source evidence.',
  address_verified_multi: 'Address details agree with the source evidence.',
  address_verified_multi_ambiguous: 'Address details agree with the source evidence.',
  compact_name_match: 'The place name matches text found in the post.',
  strong_name_match: 'The place name strongly matches the source evidence.',
  meaningful_name_match: 'The place name matches the source evidence.',
  state_match: 'The region agrees with the source evidence.',
  country_match: 'The country agrees with the source evidence.',
  category_match: 'The place type agrees with what appears in the video.',
  category_primary_type_match: 'The place type agrees with what appears in the video.',
  distinctive_token_match: 'Distinctive words in the place name match the source evidence.',
};

/** Plain-language, bounded explanations derived only from structured evidence. */
export function candidateWhyMatchLines(
  candidate: CandidateConfirmationPlace,
  locality?: string | null,
): string[] {
  const lines: string[] = [];
  const add = (line: string | null | undefined) => {
    if (line && !lines.includes(line) && lines.length < 4) lines.push(line);
  };
  const frameCount = uniqueFiniteTimestamps(candidate.matchedFrameTimestamps).length;
  if (frameCount > 0) {
    add(`${frameCount} analyzed video ${frameCount === 1 ? 'frame contains' : 'frames contain'} supporting visual evidence.`);
  }
  for (const reason of candidate.reasons ?? []) add(REASON_COPY[reason]);
  const sources = new Set((candidate.evidenceItems ?? []).map((item) => item.source));
  if (sources.has('visible_text')) add('Visible text in the video supports this match.');
  if (sources.has('speech')) add('Spoken evidence in the video supports this match.');
  if (sources.has('caption')) add('The post caption supports this match.');
  if (locality && [...(candidate.reasons ?? [])].some((reason) => reason.includes('state') || reason.includes('country'))) {
    add(`Video evidence points to ${locality}.`);
  }
  return lines.slice(0, 4);
}
