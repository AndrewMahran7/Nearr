/** Extra veto for legacy address resolution. A building address is not a tenant identity. */
import type { MediaPlaceEvidence } from './mediaEvidence.ts';

const normalize = (x: unknown) => typeof x === 'string'
  ? x.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
const foodCategories = new Set(['restaurant', 'cafe', 'bar', 'bakery', 'nightlife']);
const parentTypes = new Set(['shopping_mall', 'park', 'national_park', 'locality', 'sublocality', 'neighborhood', 'campground', 'event_venue', 'premise']);
const foodType = (type: string) => /(?:restaurant|cafe|coffee_shop|bakery|bar|deli|sandwich_shop|food_court)$/.test(type);

function childNameForms(place: MediaPlaceEvidence['places'][number]) {
  const names = new Set([normalize(place.name)]);
  const child = place.name.split(/\s+(?:at|inside|within)\s+/i)[0];
  if (child) names.add(normalize(child));
  for (const geo of [place.country, place.region, place.city]) {
    const suffix = normalize(geo);
    if (!suffix) continue;
    for (const name of [...names]) if (name.endsWith(' ' + suffix)) names.add(name.slice(0, -suffix.length).trim());
  }
  return [...names].filter((name) => name.length >= 3);
}

function units(address: unknown) {
  return new Set([...String(address ?? '').toLowerCase().matchAll(/(?:#|\b(?:suite|ste|unit|apt)\s*)\s*([a-z0-9]+(?:-[a-z0-9]+)?)/g)].map((m) => m[1]));
}

export function evaluateLegacyCandidateIdentity(candidate: any, evidence: MediaPlaceEvidence) {
  const name = normalize(candidate?.name);
  const mentions = evidence.places.filter((p) => p.role !== 'passing_mention' &&
    p.identityEvidenceKind !== 'model_prior' && p.explicitEvidence.length > 0);
  const matching = mentions.filter((p) => childNameForms(p).includes(name));
  if (!name || matching.length !== 1) return { eligible: false, reason: 'legacy_candidate_identity_unbound' };
  const mention = matching[0]!;
  const types = [...(Array.isArray(candidate.types) ? candidate.types : []), candidate.primaryType]
    .filter((t): t is string => typeof t === 'string');
  if (foodCategories.has(mention.category ?? '') && types.some((t) => parentTypes.has(t)) && !types.some(foodType)) {
    return { eligible: false, reason: 'legacy_parent_category_mismatch' };
  }
  const sourceUnits = units(mention.address), candidateUnits = units(candidate.formattedAddress ?? candidate.address);
  // Model address text is used only to veto contradictions, never to establish
  // identity, rank, confidence, source geography or branch verification.
  if (sourceUnits.size && candidateUnits.size && [...candidateUnits].some((u) => !sourceUnits.has(u))) {
    return { eligible: false, reason: 'legacy_unit_conflict' };
  }
  return { eligible: true, reason: 'legacy_exact_child_name_bound' };
}
