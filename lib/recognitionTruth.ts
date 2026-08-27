import {
  isNearrCategory,
  mapGoogleType,
  type NearrCategory,
} from './placeCategory.ts';
import type { VayrinEntityType } from './vayrin/entitySemantics.ts';

export type SemanticCompatibility = 'SUPPORTS' | 'CONTRADICTS' | 'UNKNOWN';

export type SemanticCompatibilityDecision = {
  verdict: SemanticCompatibility;
  sceneCategory: NearrCategory | null;
  candidateCategory: NearrCategory | null;
  reason: string;
};

export type StrongIdentityEvidence = {
  exactAddress?: boolean;
  readableSignageExactName?: boolean;
  explicitCaptionExactName?: boolean;
  structuredLocationTagExactName?: boolean;
  independentNameSourceCount?: number;
};

const OUTDOORS = new Set<NearrCategory>([
  'hiking_trail', 'park', 'beach', 'waterfall', 'lake', 'marina', 'island',
  'scenic_spot', 'sports', 'attraction',
]);
const FOOD = new Set<NearrCategory>([
  'restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert',
]);
const STAY = new Set<NearrCategory>(['hotel', 'resort']);
// High-precision only. `service`, `transportation`, `education`, and
// `nightlife` are too broad to be safe blockers: tour operators, cable cars,
// school sports facilities, and cliff-side venues are real counterexamples.
const HARD_BUSINESS = new Set<NearrCategory>([...FOOD, ...STAY, 'shopping']);

const CATEGORY_ALIASES: ReadonlyArray<[RegExp, NearrCategory]> = [
  [/\b(waterfalls?|falls)\b/i, 'waterfall'],
  [/\b(swimming hole|river|canyon|gorge|cliff jump(?:ing)?|rock formation|natural landscape|scenic)\b/i, 'scenic_spot'],
  [/\b(hik(?:e|ing)|trail|trailhead)\b/i, 'hiking_trail'],
  [/\b(beach|coast|cove)\b/i, 'beach'],
  [/\b(lake)\b/i, 'lake'],
  [/\b(park|nature preserve)\b/i, 'park'],
  [/\b(hotel|lodging|room)\b/i, 'hotel'],
  [/\b(resort)\b/i, 'resort'],
  [/\b(restaurant|dining|food|meal|cuisine)\b/i, 'restaurant'],
  [/\b(cafe|coffee)\b/i, 'cafe'],
  [/\b(store|retail|shopping)\b/i, 'shopping'],
];

export function normalizeSceneCategory(value: unknown): NearrCategory | null {
  if (isNearrCategory(value)) return value;
  if (typeof value !== 'string') return null;
  const providerMapped = mapGoogleType(value);
  if (providerMapped) return providerMapped;
  for (const [pattern, category] of CATEGORY_ALIASES) {
    if (pattern.test(value)) return category;
  }
  return null;
}

export function candidatePoiCategory(candidate: {
  primaryType?: unknown;
  types?: unknown;
}): NearrCategory | null {
  const primary = typeof candidate.primaryType === 'string'
    ? mapGoogleType(candidate.primaryType)
    : null;
  if (primary) return primary;
  if (!Array.isArray(candidate.types)) return null;
  for (const type of candidate.types) {
    if (typeof type !== 'string') continue;
    const mapped = mapGoogleType(type);
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Compare affirmative structured scene intent with canonical provider type.
 * Absence is never contradiction: unknown/low-confidence media stays UNKNOWN.
 * Broad attractions are deliberately tolerated across outdoors use cases.
 */
export function semanticCategoryCompatibility(input: {
  sceneCategory: unknown;
  sceneConfidence?: number | null;
  categoryEvidenceTags?: readonly string[] | null;
  candidateCategory: unknown;
}): SemanticCompatibilityDecision {
  const scene = normalizeSceneCategory(input.sceneCategory);
  const candidate = normalizeSceneCategory(input.candidateCategory);
  const confidence = typeof input.sceneConfidence === 'number' && Number.isFinite(input.sceneConfidence)
    ? input.sceneConfidence
    : 0;
  const affirmative = confidence >= 0.60 && (input.categoryEvidenceTags?.length ?? 0) > 0;
  if (!scene || !candidate || !affirmative || scene === 'other' || candidate === 'other') {
    return { verdict: 'UNKNOWN', sceneCategory: scene, candidateCategory: candidate, reason: 'semantic_evidence_unknown' };
  }
  if (scene === candidate) {
    return { verdict: 'SUPPORTS', sceneCategory: scene, candidateCategory: candidate, reason: 'same_normalized_category' };
  }
  if (OUTDOORS.has(scene) && OUTDOORS.has(candidate)) {
    return { verdict: 'SUPPORTS', sceneCategory: scene, candidateCategory: candidate, reason: 'compatible_outdoor_family' };
  }
  if (FOOD.has(scene) && FOOD.has(candidate)) {
    return { verdict: 'SUPPORTS', sceneCategory: scene, candidateCategory: candidate, reason: 'compatible_food_family' };
  }
  if (STAY.has(scene) && STAY.has(candidate)) {
    return { verdict: 'SUPPORTS', sceneCategory: scene, candidateCategory: candidate, reason: 'compatible_stay_family' };
  }
  if ((OUTDOORS.has(scene) && HARD_BUSINESS.has(candidate)) ||
      (FOOD.has(scene) && OUTDOORS.has(candidate)) ||
      (STAY.has(scene) && candidate === 'shopping')) {
    return { verdict: 'CONTRADICTS', sceneCategory: scene, candidateCategory: candidate, reason: 'affirmative_category_family_mismatch' };
  }
  return { verdict: 'UNKNOWN', sceneCategory: scene, candidateCategory: candidate, reason: 'cross_family_not_decisive' };
}

/** A location tag is useful identity evidence, but is not sufficient by itself
 * to overrule an affirmative semantic contradiction (the production incident
 * proves that assumption unsafe). */
export function hasStrongIdentityOverride(evidence: StrongIdentityEvidence): boolean {
  if (evidence.exactAddress || evidence.readableSignageExactName) return true;
  if ((evidence.independentNameSourceCount ?? 0) >= 2) return true;
  return evidence.explicitCaptionExactName === true &&
    evidence.structuredLocationTagExactName === true;
}

export function semanticAutoSaveDecision(input: {
  compatibility: SemanticCompatibilityDecision;
  identityEvidence: StrongIdentityEvidence;
}): { allowed: boolean; overridden: boolean; reason: string } {
  if (input.compatibility.verdict !== 'CONTRADICTS') {
    return { allowed: true, overridden: false, reason: input.compatibility.reason };
  }
  if (hasStrongIdentityOverride(input.identityEvidence)) {
    return { allowed: true, overridden: true, reason: 'strong_identity_override' };
  }
  return { allowed: false, overridden: false, reason: 'candidate_semantic_mismatch' };
}

export const VAYRIN_EVIDENCE_PROVENANCE = [
  'SOURCE_CAPTION', 'SOURCE_HASHTAG', 'SOURCE_TRANSCRIPT', 'SOURCE_OCR',
  'SOURCE_LOCATION_METADATA', 'SOURCE_VISUAL', 'INDEPENDENT_MODEL_HYPOTHESIS',
  'USER_CONFIRMED', 'PLACES_NAME', 'PLACES_ADDRESS', 'PLACES_CATEGORY',
  'PLACES_GEOGRAPHY', 'PLACES_SEARCH_RANK', 'CANDIDATE_DERIVED',
] as const;
export type VayrinEvidenceProvenance = (typeof VAYRIN_EVIDENCE_PROVENANCE)[number];
export type VayrinFirewallAdmission = 'ADMIT_AUTOSAVE' | 'ADMIT_REVIEW' | 'ADMIT_PARTIAL' | 'REJECT';

export type SelectiveEvidenceFirewallInput = {
  hypothesisOrigin?: 'easy_source' | 'independent_multimodal' | 'provider_candidate' | 'user_confirmed' | null;
  entityType?: VayrinEntityType | null;
  identitySupport?: 'exact' | 'strong' | 'weak' | 'none' | null;
  geoSupport?: 'explicit_source_geo' | 'strong_inferred_geo' | 'weak_inferred_geo' | 'none' | null;
  semanticCategory?: string | null;
  conflicts?: readonly string[] | null;
  evidenceBasis?: 'direct_visible_identity' | 'distinctive_visual_match' | 'contextual_or_memory_prior' | 'insufficient' | null;
  evidenceProvenance?: readonly VayrinEvidenceProvenance[] | null;
  recognitionConfidence?: number | null;
  canonicalizationConfidence?: number | null;
  canonicalizationOutcome?: 'CANONICAL_EXACT' | 'CANONICAL_NEAR_MATCH' | 'AMBIGUOUS_CANONICAL' | 'NO_CANONICAL_MATCH' | null;
  explicitGeoConflict?: boolean;
  semanticConflict?: boolean;
  directSourceIdentity?: boolean;
  singletonCandidate?: boolean;
  hasTruthfulPartial?: boolean;
};

export type SelectiveEvidenceFirewallDecision = {
  admissionOutcome: VayrinFirewallAdmission;
  reasonCodes: string[];
  independentIdentitySupport: boolean;
  providerOnlyIdentity: boolean;
  geoConflict: boolean;
  semanticConflict: boolean;
  recognitionConfidence: number | null;
  canonicalizationConfidence: number | null;
  canonicalizationOutcome: SelectiveEvidenceFirewallInput['canonicalizationOutcome'];
};

const PROVIDER_DERIVED_PROVENANCE = new Set<VayrinEvidenceProvenance>([
  'PLACES_NAME', 'PLACES_ADDRESS', 'PLACES_CATEGORY', 'PLACES_GEOGRAPHY',
  'PLACES_SEARCH_RANK', 'CANDIDATE_DERIVED',
]);

function boundedConfidence(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value)) : null;
}

/**
 * Final, pure V4 admission check. Provider data may canonicalize a source or
 * blind multimodal hypothesis, but never becomes recognition evidence for its
 * own identity. Recognition and canonicalization confidences remain separate.
 *
 * Unlike the failed P0 policy, a strong candidate-blind visual hypothesis is
 * independent evidence: it does not need its exact name repeated in a caption.
 */
export function evaluateSelectiveEvidenceFirewall(
  input: SelectiveEvidenceFirewallInput,
): SelectiveEvidenceFirewallDecision {
  const provenance = [...new Set(input.evidenceProvenance ?? [])];
  const userConfirmed = input.hypothesisOrigin === 'user_confirmed' || provenance.includes('USER_CONFIRMED');
  const independentByProvenance = provenance.some((item) => !PROVIDER_DERIVED_PROVENANCE.has(item));
  const independentHypothesis = input.hypothesisOrigin === 'independent_multimodal' &&
    (input.evidenceBasis === 'direct_visible_identity' || input.evidenceBasis === 'distinctive_visual_match');
  const independentIdentitySupport = userConfirmed || independentByProvenance || independentHypothesis;
  const providerOnlyIdentity = provenance.length > 0 && !independentIdentitySupport;
  const recognitionConfidence = boundedConfidence(input.recognitionConfidence);
  const canonicalizationConfidence = boundedConfidence(input.canonicalizationConfidence);
  const reasonCodes: string[] = [];
  let admissionOutcome: VayrinFirewallAdmission;

  if (userConfirmed) {
    admissionOutcome = 'ADMIT_AUTOSAVE';
    reasonCodes.push('user_confirmed_truth');
  } else if (input.explicitGeoConflict) {
    admissionOutcome = 'REJECT';
    reasonCodes.push('explicit_source_geo_conflict');
  } else if (input.semanticConflict && !input.directSourceIdentity) {
    admissionOutcome = 'REJECT';
    reasonCodes.push('source_semantic_conflict');
  } else if (!independentIdentitySupport) {
    admissionOutcome = input.hasTruthfulPartial ? 'ADMIT_PARTIAL' : 'ADMIT_REVIEW';
    reasonCodes.push('candidate_cannot_create_identity');
    if (providerOnlyIdentity) reasonCodes.push('provider_data_is_canonicalization_only');
    if (input.singletonCandidate) reasonCodes.push('singleton_cannot_autosave_without_independent_support');
  } else if ((input.conflicts?.length ?? 0) > 0) {
    admissionOutcome = 'ADMIT_REVIEW';
    reasonCodes.push('independent_hypothesis_has_conflicts');
  } else if (input.identitySupport !== 'exact' && input.identitySupport !== 'strong') {
    admissionOutcome = 'ADMIT_REVIEW';
    reasonCodes.push('independent_identity_support_not_strong');
  } else if (input.canonicalizationOutcome !== 'CANONICAL_EXACT') {
    admissionOutcome = 'ADMIT_REVIEW';
    reasonCodes.push('canonicalization_not_exact');
  } else if (
    (recognitionConfidence ?? 0) < 0.70 &&
    !(input.identitySupport === 'exact' && input.evidenceBasis === 'direct_visible_identity')
  ) {
    admissionOutcome = 'ADMIT_REVIEW';
    reasonCodes.push('recognition_confidence_below_autosave_floor');
  } else {
    admissionOutcome = 'ADMIT_AUTOSAVE';
    reasonCodes.push(
      input.hypothesisOrigin === 'independent_multimodal'
        ? 'strong_independent_visual_hypothesis_canonicalized'
        : 'strong_source_identity_canonicalized',
    );
  }

  return {
    admissionOutcome,
    reasonCodes,
    independentIdentitySupport,
    providerOnlyIdentity,
    geoConflict: input.explicitGeoConflict === true,
    semanticConflict: input.semanticConflict === true,
    recognitionConfidence,
    canonicalizationConfidence,
    canonicalizationOutcome: input.canonicalizationOutcome ?? null,
  };
}
