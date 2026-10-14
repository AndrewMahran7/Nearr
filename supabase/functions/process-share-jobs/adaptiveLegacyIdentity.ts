/** Extra veto for legacy address resolution. A building address is not a tenant identity. */
import type { MediaPlaceEvidence } from './mediaEvidence.ts';

const foodCategories = new Set(['restaurant', 'cafe', 'bar', 'bakery', 'nightlife']);
const parentTypes = new Set(['shopping_mall', 'park', 'national_park', 'locality', 'sublocality', 'neighborhood', 'campground', 'event_venue', 'premise']);
const foodType = (type: string) => /(?:restaurant|cafe|coffee_shop|bakery|bar|deli|sandwich_shop|food_court)$/.test(type);

/** Category-only veto, isolated from the stricter name/unit experiment. */
export function evaluateLegacyParentCategory(candidate: any, evidence: MediaPlaceEvidence) {
  const mentions = evidence.places.filter((p) => p.role !== 'passing_mention' &&
    p.identityEvidenceKind !== 'model_prior' && p.explicitEvidence.length > 0);
  const types = [...(Array.isArray(candidate?.types) ? candidate.types : []), candidate?.primaryType]
    .filter((t): t is string => typeof t === 'string');
  const mismatch = mentions.length > 0 && mentions.every((p) => foodCategories.has(p.category ?? '')) &&
    types.some((t) => parentTypes.has(t)) && !types.some(foodType);
  return { eligible: !mismatch, reason: mismatch ? 'legacy_parent_category_mismatch' : 'legacy_parent_category_no_veto' };
}

/** Use the existing Production completion gate's semantic contradiction reason. */
export function applyLegacyParentCategoryVeto<T extends { reasons?: string[] }>(candidate: T, evidence: MediaPlaceEvidence): T {
  const check = evaluateLegacyParentCategory(candidate, evidence);
  return check.eligible ? candidate : {
    ...candidate,
    reasons: [...(candidate.reasons ?? []), 'candidate_semantic_mismatch', check.reason],
  };
}
