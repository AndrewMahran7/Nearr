import {
  isNearrCategory,
  mapGoogleType,
  type NearrCategory,
} from './placeCategory';

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
