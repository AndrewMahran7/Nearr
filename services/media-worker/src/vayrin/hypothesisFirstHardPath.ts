import type { MediaPlaceEvidence, PlaceCandidateEvidence } from '../types/evidence.js';
import { isCategoryOnlyPlaceName } from './placeIdentityGuard.js';
import type { VayrinHypothesisRaw, VayrinPayload } from './visualGeolocationClient.js';

export const VAYRIN_HYPOTHESIS_FIRST_VERSION =
  'vayrin-core-v4-2026-08-27.v1';

export type HardPathReason =
  | 'flag_disabled'
  | 'no_frames'
  | 'technical_baseline_failure'
  | 'no_exact_source_identity'
  | 'coarse_geography_only'
  | 'generic_category_only'
  | 'weak_alias_only'
  | 'model_prior_only'
  | 'strong_exact_source_identity';

export type HardPathRoute = {
  eligible: boolean;
  reason: HardPathReason;
  easyIdentityCount: number;
  unresolvedIdentityCount: number;
};

export type HypothesisIdentitySupport = 'exact' | 'strong' | 'weak' | 'none';
export type HypothesisGeoSupport =
  | 'explicit_source_geo'
  | 'strong_inferred_geo'
  | 'weak_inferred_geo'
  | 'none';

export type IndependentHypothesisContract = {
  hypothesisOrigin: 'independent_multimodal';
  hypothesisPathVersion: string;
  identitySupport: HypothesisIdentitySupport;
  geoSupport: HypothesisGeoSupport;
  semanticCategory: string | null;
  conflicts: string[];
  evidenceBasis:
    | 'direct_visible_identity'
    | 'distinctive_visual_match'
    | 'contextual_or_memory_prior'
    | 'insufficient';
};

const GENERIC_NAME_TOKENS = new Set([
  'a', 'an', 'the', 'at', 'in', 'of', 'and', 'place', 'spot', 'area',
  'restaurant', 'cafe', 'bar', 'hotel', 'resort', 'park', 'trail', 'beach',
  'waterfall', 'falls', 'lake', 'island', 'quarry', 'cliff', 'jumping',
  'hiking', 'swimming', 'hole', 'viewpoint', 'landmark', 'attraction',
]);

function fold(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactFold(value: string | null | undefined): string {
  return fold(value).replace(/\s+/g, '');
}

function distinctiveNameTokens(value: string): string[] {
  return fold(value).split(' ').filter((token) => token.length > 1 && !GENERIC_NAME_TOKENS.has(token));
}

function isCoarseGeography(place: PlaceCandidateEvidence): boolean {
  const name = fold(place.name);
  return !!name && [place.city, place.region, place.country].some((value) => fold(value) === name);
}

function evidenceNamesPlace(place: PlaceCandidateEvidence): {
  exact: boolean;
  visibleText: boolean;
} {
  const name = fold(place.name);
  const compactName = compactFold(place.name);
  if (!name) return { exact: false, visibleText: false };
  let exact = false;
  let visibleText = false;
  for (const item of place.explicitEvidence) {
    const value = fold(item.value);
    const compactValue = compactFold(item.value);
    const ordinaryMatch = !!value && (value.includes(name) || name.includes(value));
    // Provider captions commonly expose exact locations as compact hashtags
    // (for example #LakeHavasu). Treat the compact spelling as the same source
    // identity, but only when the entire proper-name token sequence is present.
    const compactMatch = compactName.length >= 5 && compactValue.includes(compactName);
    if (!ordinaryMatch && !compactMatch) continue;
    exact = true;
    if (item.source === 'visible_text') visibleText = true;
  }
  return { exact, visibleText };
}

function looksLikePersonIdentity(
  place: PlaceCandidateEvidence,
  sourceText?: string | null,
  creatorNames: Array<string | null | undefined> = [],
): boolean {
  const name = fold(place.name);
  if (!name) return false;
  if (creatorNames.some((value) => fold(value) === name)) return true;
  const text = fold(sourceText);
  if (!text || !text.includes(name)) return false;
  return /\b(athlete|creator|diver|climber|record holder|world record|he|she|his|her|him)\b/.test(text);
}

function isEasyExactIdentity(
  place: PlaceCandidateEvidence,
  metadataLocation?: string | null,
  sourceText?: string | null,
  creatorNames: Array<string | null | undefined> = [],
): boolean {
  if (place.identityEvidenceKind === 'model_prior') return false;
  if (isCoarseGeography(place) || isCategoryOnlyPlaceName(place.name)) return false;
  if (looksLikePersonIdentity(place, sourceText, creatorNames)) return false;
  const name = fold(place.name);
  const metadata = fold(metadataLocation);
  if (metadata && name && (metadata === name || metadata.includes(name) || name.includes(metadata))) return true;
  if (place.address?.trim()) return true;
  const support = evidenceNamesPlace(place);
  if (support.visibleText) return true;
  if (support.exact && distinctiveNameTokens(place.name).length >= 1) return true;
  const visualClues = place.explicitEvidence.filter((item) => item.source === 'frame');
  const geoFields = [place.city, place.region, place.country].filter((value) => !!value?.trim());
  return place.confidence >= 0.8 && visualClues.length >= 2 && geoFields.length >= 2;
}

/**
 * Deterministic EASY/HARD routing. It never looks at a Places candidate or
 * provider score: only the source-grounded cheap-pass envelope is admitted.
 */
export function classifyHypothesisFirstPath(input: {
  enabled: boolean;
  frameCount: number;
  evidence: MediaPlaceEvidence;
  metadataLocation?: string | null;
  sourceText?: string | null;
  sourceCreatorHandle?: string | null;
  sourceCreatorName?: string | null;
  technicalFailure?: boolean;
}): HardPathRoute {
  if (!input.enabled) {
    return { eligible: false, reason: 'flag_disabled', easyIdentityCount: 0, unresolvedIdentityCount: 0 };
  }
  if (input.frameCount <= 0) {
    return { eligible: false, reason: 'no_frames', easyIdentityCount: 0, unresolvedIdentityCount: 0 };
  }
  const explicit = input.evidence.places.filter((place) => place.explicitEvidence.length > 0);
  const specific = explicit.filter((place) => !isCoarseGeography(place) && !isCategoryOnlyPlaceName(place.name));
  const easy = specific.filter((place) => isEasyExactIdentity(
    place,
    input.metadataLocation,
    input.sourceText,
    [input.sourceCreatorHandle, input.sourceCreatorName],
  ));
  const unresolved = specific.length - easy.length;

  if (input.technicalFailure) {
    return { eligible: true, reason: 'technical_baseline_failure', easyIdentityCount: easy.length, unresolvedIdentityCount: unresolved };
  }
  if (easy.length > 0) {
    return { eligible: false, reason: 'strong_exact_source_identity', easyIdentityCount: easy.length, unresolvedIdentityCount: unresolved };
  }
  if (explicit.length > 0 && explicit.every(isCoarseGeography)) {
    return { eligible: true, reason: 'coarse_geography_only', easyIdentityCount: 0, unresolvedIdentityCount: unresolved };
  }
  if (explicit.length > 0 && explicit.every((place) => isCategoryOnlyPlaceName(place.name))) {
    return { eligible: true, reason: 'generic_category_only', easyIdentityCount: 0, unresolvedIdentityCount: unresolved };
  }
  if (specific.length > 0 && specific.every((place) => distinctiveNameTokens(place.name).length <= 1)) {
    return { eligible: true, reason: 'weak_alias_only', easyIdentityCount: 0, unresolvedIdentityCount: specific.length };
  }
  if (specific.length > 0 && specific.every((place) => place.identityEvidenceKind === 'model_prior')) {
    return { eligible: true, reason: 'model_prior_only', easyIdentityCount: 0, unresolvedIdentityCount: specific.length };
  }
  return {
    eligible: true,
    reason: 'no_exact_source_identity',
    easyIdentityCount: 0,
    unresolvedIdentityCount: Math.max(unresolved, specific.length),
  };
}

function identitySupportFor(hypothesis: VayrinHypothesisRaw): HypothesisIdentitySupport {
  switch (hypothesis.evidence_basis) {
    case 'direct_visible_identity': return 'exact';
    case 'distinctive_visual_match': return 'strong';
    case 'contextual_or_memory_prior': return 'weak';
    default: return 'none';
  }
}

function geoSupportFor(payload: VayrinPayload): HypothesisGeoSupport {
  switch (payload.source_geography.confidence_class) {
    case 'explicit_source_geo': return 'explicit_source_geo';
    case 'strong_inferred_geo': return 'strong_inferred_geo';
    case 'weak_inferred_geo': return 'weak_inferred_geo';
    default: return 'none';
  }
}

export function independentHypothesisContract(
  hypothesis: VayrinHypothesisRaw,
  payload: VayrinPayload,
): IndependentHypothesisContract {
  return {
    hypothesisOrigin: 'independent_multimodal',
    hypothesisPathVersion: VAYRIN_HYPOTHESIS_FIRST_VERSION,
    identitySupport: identitySupportFor(hypothesis),
    geoSupport: geoSupportFor(payload),
    semanticCategory: payload.scene_category || hypothesis.place_type || null,
    conflicts: hypothesis.conflicting_clues.slice(0, 8),
    evidenceBasis: hypothesis.evidence_basis ?? 'contextual_or_memory_prior',
  };
}

/** Model confidence and independent evidence dominate. A provider lexical score
 * may break a close tie, but can contribute at most 5% of the ranking value. */
export function rankIndependentHypotheses<T extends {
  hypothesis: VayrinHypothesisRaw;
  canonicalScore?: number | null;
}>(items: T[]): T[] {
  const supportWeight: Record<HypothesisIdentitySupport, number> = {
    exact: 0.2, strong: 0.12, weak: 0.04, none: 0,
  };
  return [...items].sort((a, b) => {
    const score = (item: T) => {
      const independent = Math.max(0, Math.min(1, item.hypothesis.confidence));
      const provider = Math.max(0, Math.min(1, item.canonicalScore ?? 0));
      return independent * 0.75 + supportWeight[identitySupportFor(item.hypothesis)] + provider * 0.05;
    };
    return score(b) - score(a);
  });
}

export type CanonicalizationOutcome =
  | 'CANONICAL_EXACT'
  | 'CANONICAL_NEAR_MATCH'
  | 'AMBIGUOUS_CANONICAL'
  | 'NO_CANONICAL_MATCH';

export function canonicalizationOutcome(input: {
  candidateCount: number;
  verifiedSingle: boolean;
  topNameMatchesHypothesis: boolean;
}): CanonicalizationOutcome {
  if (input.candidateCount <= 0) return 'NO_CANONICAL_MATCH';
  if (input.candidateCount > 1) return 'AMBIGUOUS_CANONICAL';
  return input.verifiedSingle && input.topNameMatchesHypothesis
    ? 'CANONICAL_EXACT'
    : 'CANONICAL_NEAR_MATCH';
}
