import type { AnalyzeOutput } from '../providers/model.js';
import type { PlaceCandidateEvidence, SceneEnvironmentType } from '../types/evidence.js';
import { isCategoryOnlyPlaceName } from '../vayrin/placeIdentityGuard.js';

export const NORMAL_RESULT_SPECIFICITY_VERSION = 'normal-result-specificity.v2';

export type NormalResultRejectionReason =
  | 'GENERIC_DESCRIPTOR'
  | 'BROAD_GEOGRAPHY'
  | 'BROAD_PARENT'
  | 'NO_IDENTITY'
  | 'IDENTITY_DIVERGENCE'
  | 'NO_ACTIONABLE_CANDIDATE'
  | 'TECHNICAL_RECOVERY';

export type NormalResultSpecificity = {
  specific: boolean;
  rejectionReason: NormalResultRejectionReason | null;
  actionableCandidateCount: number;
  specificPlaceIntent: boolean;
  version: typeof NORMAL_RESULT_SPECIFICITY_VERSION;
};

const MISSING_DECISIONS = new Set([
  'no_result',
  'needs_help',
  'manual_fallback',
  'insufficient_evidence',
  'analysis_insufficient',
  'generic_place_type',
]);

const AREA_DESTINATION_CATEGORIES = new Set(['island']);

const CATEGORY_ENVIRONMENTS: Partial<Record<string, readonly SceneEnvironmentType[]>> = {
  restaurant: ['food_venue'],
  cafe: ['food_venue'],
  bakery: ['food_venue'],
  bar: ['food_venue'],
  brewery: ['food_venue'],
  winery: ['food_venue'],
  dessert: ['food_venue'],
  hotel: ['lodging'],
  resort: ['lodging'],
  beach: ['natural_water'],
  waterfall: ['natural_water'],
  lake: ['natural_water'],
  marina: ['natural_water'],
  island: ['natural_water', 'natural_land'],
  hiking_trail: ['natural_land'],
  park: ['natural_land', 'urban_outdoor'],
  scenic_spot: ['natural_land', 'natural_water', 'urban_outdoor'],
  museum: ['cultural'],
  shopping: ['retail'],
  transportation: ['transport'],
};

function fold(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function isBroadGeographyIdentity(place: PlaceCandidateEvidence): boolean {
  const name = fold(place.name);
  if (!name) return false;
  return [place.city, place.region, place.country].some((value) => fold(value) === name);
}

function hasIdentityDivergence(place: PlaceCandidateEvidence): boolean {
  const observed = place.sceneSignature?.environmentType;
  if (!observed || observed === 'unknown' || observed === 'other' || !place.category) return false;
  const compatible = CATEGORY_ENVIRONMENTS[place.category];
  return Array.isArray(compatible) && !compatible.includes(observed);
}

const SPECIFIC_CHILD_MARKER = /\b(?:arch|cave|cavern|cenote|falls?|waterfall|ledge|pool|hole|grotto|rock|trail|trailhead|crack|plunge|restaurant|cafe|bakery|bar|winery|brewery)\b/i;
const BROAD_PARENT_MARKER = /\b(?:national park|natural park|state park|regional park|beach park|recreation(?:al)? area|national forest|state forest|shopping mall|shopping center|island group|islands?|lake|river|complex)\b/i;

/** A named container can be real while still being too broad to end exact
 * recognition. Preserve it as evidence, but ask Sol for the child feature.
 * A child marker wins, so names such as Roaring River Falls and Waimea Bay
 * Jump Rock remain specific. This is lexical/type based and contains no case
 * IDs, ground truth, provider identities or coordinates. */
export function isBroadParentIdentity(place: PlaceCandidateEvidence): boolean {
  if (!BROAD_PARENT_MARKER.test(place.name)) return false;
  if (SPECIFIC_CHILD_MARKER.test(place.name)) return false;
  return !['restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert'].includes(place.category ?? '');
}

function specificPlaceIntent(places: readonly PlaceCandidateEvidence[]): boolean {
  if (places.length === 0) return true;
  return places.some((place) =>
    !AREA_DESTINATION_CATEGORIES.has(place.category ?? '') ||
    !isBroadGeographyIdentity(place));
}

/**
 * Deterministic server-side gate between the normal recognizer and Simple Sol.
 * A category or administrative label can remain evidence, but can never count
 * as the resolved destination identity.
 */
export function evaluateNormalResultSpecificity(input: Pick<
  AnalyzeOutput,
  'evidence' | 'recognitionFailureClass'
> & { terminalDecision?: string | null }): NormalResultSpecificity {
  const places = input.evidence.places.filter((place) => place.explicitEvidence.length > 0);
  const intent = specificPlaceIntent(places);
  const base = {
    actionableCandidateCount: 0,
    specificPlaceIntent: intent,
    version: NORMAL_RESULT_SPECIFICITY_VERSION,
  } as const;

  if (input.recognitionFailureClass) {
    return { ...base, specific: false, rejectionReason: 'TECHNICAL_RECOVERY' };
  }
  if (input.terminalDecision && MISSING_DECISIONS.has(fold(input.terminalDecision).replace(/ /g, '_'))) {
    return { ...base, specific: false, rejectionReason: 'NO_IDENTITY' };
  }
  if (places.length === 0) {
    const partials = input.evidence.partialPlaces ?? [];
    const genericPartial = partials.some((place) =>
      !!place.nameHint && isCategoryOnlyPlaceName(place.nameHint));
    if (genericPartial) return { ...base, specific: false, rejectionReason: 'GENERIC_DESCRIPTOR' };
    const hasArea = partials.some((place) => !!(place.city || place.region || place.country));
    return {
      ...base,
      specific: false,
      rejectionReason: hasArea ? 'BROAD_GEOGRAPHY' : 'NO_IDENTITY',
    };
  }

  if (places.some((place) => isCategoryOnlyPlaceName(place.name))) {
    return { ...base, specific: false, rejectionReason: 'GENERIC_DESCRIPTOR' };
  }
  if (places.length > 0 && places.every(isBroadParentIdentity)) {
    return { ...base, specific: false, rejectionReason: 'BROAD_PARENT' };
  }
  if (places.some(hasIdentityDivergence)) {
    return { ...base, specific: false, rejectionReason: 'IDENTITY_DIVERGENCE' };
  }
  const broad = places.filter(isBroadGeographyIdentity);
  if (broad.length > 0 && broad.some((place) => !AREA_DESTINATION_CATEGORIES.has(place.category ?? ''))) {
    return { ...base, specific: false, rejectionReason: 'BROAD_GEOGRAPHY' };
  }
  const actionable = places.filter((place) =>
    !isCategoryOnlyPlaceName(place.name) &&
    !isBroadParentIdentity(place) &&
    (!isBroadGeographyIdentity(place) || AREA_DESTINATION_CATEGORIES.has(place.category ?? '')) &&
    !hasIdentityDivergence(place));
  if (actionable.length === 0) {
    return { ...base, specific: false, rejectionReason: 'NO_ACTIONABLE_CANDIDATE' };
  }
  return {
    ...base,
    specific: true,
    rejectionReason: null,
    actionableCandidateCount: actionable.length,
  };
}
