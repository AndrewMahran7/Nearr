// supabase/functions/process-share-jobs/mediaEvidence.ts
//
// PURE adapter between the containerized media worker's structured
// place-evidence output and Nearr's EXISTING deterministic resolver.
//
// The media worker (and its multimodal model) PROPOSES evidence. It never
// picks a Google Place ID, never decides safeToAutoSave, and never saves. This
// module renders that evidence into a synthetic post caption (title +
// description) that the existing `extractEvidence` → `resolveSharedPlace`
// pipeline consumes UNCHANGED — so verification, address matching, Places
// lookup, scoring, and the safeToAutoSave gate are byte-identical to Phase 1.
//
// FABRICATION GUARD: only places that carry at least one EXPLICIT evidence
// item (spoken / visible_text / caption / frame) are rendered. Inferred-only
// places are dropped — a model guess never becomes a verifiable venue on its
// own. No coordinates are forwarded (a model must not fabricate a location).
//
// No Deno globals, no I/O — unit-tested from Node (scripts/testMediaEvidenceAdapter.ts).

import { classifyPlacePhrase } from '../../../lib/placeIdentityClassification.ts';
import {
  VAYRIN_ENTITY_TYPES,
  classifyEntity,
  type VayrinEntityType,
} from '../../../lib/vayrin/entitySemantics.ts';

type NearrCategory =
  | 'restaurant' | 'cafe' | 'bakery' | 'bar' | 'brewery' | 'winery' | 'dessert'
  | 'hotel' | 'resort' | 'hiking_trail' | 'park' | 'beach' | 'waterfall'
  | 'lake' | 'marina' | 'island' | 'scenic_spot' | 'attraction' | 'museum'
  | 'shopping' | 'entertainment' | 'nightlife' | 'sports' | 'fitness'
  | 'wellness' | 'transportation' | 'education' | 'service' | 'other';

const NEARR_CATEGORY_SET = new Set<string>([
  'restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert',
  'hotel', 'resort', 'hiking_trail', 'park', 'beach', 'waterfall', 'lake',
  'marina', 'island', 'scenic_spot', 'attraction', 'museum', 'shopping',
  'entertainment', 'nightlife', 'sports', 'fitness', 'wellness',
  'transportation', 'education', 'service', 'other',
]);

function isNearrCategory(value: unknown): value is NearrCategory {
  return typeof value === 'string' && NEARR_CATEGORY_SET.has(value);
}

export type PlaceEvidenceSource = 'caption' | 'speech' | 'visible_text' | 'frame';

export type PlaceEvidenceItem = {
  timestampSeconds: number | null;
  source: PlaceEvidenceSource;
  value: string;
};

export type PlaceRole = 'primary' | 'secondary' | 'passing_mention';

export type PlaceCandidateEvidence = {
  logicalPlaceId?: string | null;
  identityEvidenceKind?: 'observable' | 'model_prior';
  hypothesisRank?: number;
  hypothesisOrigin?: 'independent_multimodal';
  hypothesisPathVersion?: string;
  identitySupport?: 'exact' | 'strong' | 'weak' | 'none';
  geoSupport?: 'explicit_source_geo' | 'strong_inferred_geo' | 'weak_inferred_geo' | 'none';
  semanticCategory?: string | null;
  conflicts?: string[];
  evidenceBasis?: 'direct_visible_identity' | 'distinctive_visual_match' | 'contextual_or_memory_prior' | 'insufficient';
  name: string;
  entityType?: VayrinEntityType;
  sceneSignature?: {
    environmentType?: string | null;
    setting?: string | null;
    visualAnchors?: string[];
    activity?: string | null;
    regionClue?: string | null;
  };
  category: NearrCategory | null;
  categoryConfidence?: number;
  categoryEvidenceTags?: string[];
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  coordinates: { lat: number; lng: number } | null;
  role: PlaceRole;
  confidence: number;
  explicitEvidence: PlaceEvidenceItem[];
  inferredEvidence: PlaceEvidenceItem[];
  memoryCue?: string | null;
  memoryCueEvidence?: PlaceEvidenceItem[];
};

export type PartialPlaceEvidence = {
  hypothesisOrigin?: 'independent_multimodal';
  hypothesisPathVersion?: string;
  identitySupport?: 'exact' | 'strong' | 'weak' | 'none';
  geoSupport?: 'explicit_source_geo' | 'strong_inferred_geo' | 'weak_inferred_geo' | 'none';
  semanticCategory?: string | null;
  conflicts?: string[];
  evidenceBasis?: 'direct_visible_identity' | 'distinctive_visual_match' | 'contextual_or_memory_prior' | 'insufficient';
  nameHint: string | null;
  entityType?: VayrinEntityType;
  category: NearrCategory | null;
  categoryConfidence: number;
  categoryEvidenceTags: string[];
  addressHint: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  role: PlaceRole;
  confidence: number;
  explicitEvidence: PlaceEvidenceItem[];
  validationErrors: string[];
};

export type MediaPlaceEvidence = {
  places: PlaceCandidateEvidence[];
  partialPlaces?: PartialPlaceEvidence[];
  multipleIntentionalPlaces: boolean;
  insufficientEvidence: boolean;
  warnings: string[];
};

export type ParseResult =
  | { ok: true; value: MediaPlaceEvidence }
  | { ok: false; error: string };

const VALID_SOURCES: ReadonlySet<string> = new Set([
  'caption',
  'speech',
  'visible_text',
  'frame',
]);
const VALID_ROLES: ReadonlySet<string> = new Set([
  'primary',
  'secondary',
  'passing_mention',
]);
const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(VAYRIN_ENTITY_TYPES);

function parseEntityType(v: unknown): VayrinEntityType {
  return typeof v === 'string' && VALID_ENTITY_TYPES.has(v)
    ? v as VayrinEntityType
    : 'UNKNOWN';
}

// Bounds so a malformed / oversized model payload can never blow up the worker
// finalizer. These mirror the worker-side Zod caps (defense in depth).
const MAX_PLACES = 12;
const MAX_EVIDENCE_PER_PLACE = 24;
const MAX_STRING = 400;
const MAX_WARNINGS = 24;

function str(v: unknown, max = MAX_STRING): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseEvidenceItem(raw: unknown): PlaceEvidenceItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const value = str(r.value);
  if (!value) return null;
  const source = typeof r.source === 'string' && VALID_SOURCES.has(r.source)
    ? (r.source as PlaceEvidenceSource)
    : null;
  if (!source) return null;
  const ts = num(r.timestampSeconds);
  return { timestampSeconds: ts, source, value };
}

function parsePlace(raw: unknown): PlaceCandidateEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  if (!name) return null; // a place with no name is not verifiable.

  const role = typeof r.role === 'string' && VALID_ROLES.has(r.role)
    ? (r.role as PlaceRole)
    : 'primary';

  const explicit = Array.isArray(r.explicitEvidence)
    ? r.explicitEvidence
        .slice(0, MAX_EVIDENCE_PER_PLACE)
        .map(parseEvidenceItem)
        .filter((x): x is PlaceEvidenceItem => x !== null)
    : [];
  const inferred = Array.isArray(r.inferredEvidence)
    ? r.inferredEvidence
        .slice(0, MAX_EVIDENCE_PER_PLACE)
        .map(parseEvidenceItem)
        .filter((x): x is PlaceEvidenceItem => x !== null)
    : [];
  const memoryCueEvidence = Array.isArray(r.memoryCueEvidence)
    ? r.memoryCueEvidence
        .slice(0, 8)
        .map(parseEvidenceItem)
        .filter((x): x is PlaceEvidenceItem => x !== null)
    : [];

  let confidence = num(r.confidence) ?? 0;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  return {
    logicalPlaceId: str(r.logicalPlaceId, 80),
    identityEvidenceKind: r.identityEvidenceKind === 'model_prior' ? 'model_prior' : 'observable',
    hypothesisRank: Math.max(0, Math.min(11, Math.floor(num(r.hypothesisRank) ?? 0))),
    hypothesisOrigin: r.hypothesisOrigin === 'independent_multimodal' ? 'independent_multimodal' : undefined,
    hypothesisPathVersion: str(r.hypothesisPathVersion, 100) ?? undefined,
    identitySupport: r.identitySupport === 'exact' || r.identitySupport === 'strong' || r.identitySupport === 'weak' || r.identitySupport === 'none'
      ? r.identitySupport : undefined,
    geoSupport: r.geoSupport === 'explicit_source_geo' || r.geoSupport === 'strong_inferred_geo' || r.geoSupport === 'weak_inferred_geo' || r.geoSupport === 'none'
      ? r.geoSupport : undefined,
    semanticCategory: str(r.semanticCategory, 100),
    conflicts: Array.isArray(r.conflicts)
      ? r.conflicts.map((value) => str(value, 300)).filter((value): value is string => !!value).slice(0, 8)
      : [],
    evidenceBasis: r.evidenceBasis === 'direct_visible_identity' || r.evidenceBasis === 'distinctive_visual_match' || r.evidenceBasis === 'contextual_or_memory_prior' || r.evidenceBasis === 'insufficient'
      ? r.evidenceBasis : undefined,
    name,
    entityType: parseEntityType(r.entityType),
    sceneSignature: r.sceneSignature && typeof r.sceneSignature === 'object'
      ? {
          environmentType: str((r.sceneSignature as Record<string, unknown>).environmentType, 40),
          setting: str((r.sceneSignature as Record<string, unknown>).setting, 20),
          visualAnchors: Array.isArray((r.sceneSignature as Record<string, unknown>).visualAnchors)
            ? ((r.sceneSignature as Record<string, unknown>).visualAnchors as unknown[])
              .map((value) => str(value, 100)).filter((value): value is string => !!value).slice(0, 8)
            : [],
          activity: str((r.sceneSignature as Record<string, unknown>).activity, 100),
          regionClue: str((r.sceneSignature as Record<string, unknown>).regionClue, 120),
        }
      : undefined,
    category: isNearrCategory(r.category) ? r.category : null,
    categoryConfidence: Math.max(0, Math.min(1, num(r.categoryConfidence) ?? 0)),
    categoryEvidenceTags: Array.isArray(r.categoryEvidenceTags)
      ? r.categoryEvidenceTags.map((tag) => str(tag, 80)).filter((tag): tag is string => !!tag).slice(0, 8)
      : [],
    address: str(r.address),
    city: str(r.city),
    region: str(r.region),
    country: str(r.country),
    // Coordinates are intentionally NOT trusted from the model — never
    // forwarded into verification (no fabricated location bias).
    coordinates: null,
    role,
    confidence,
    explicitEvidence: explicit,
    inferredEvidence: inferred,
    memoryCue: memoryCueEvidence.length > 0 ? str(r.memoryCue, 180) : null,
    memoryCueEvidence,
  };
}

function parsePartialPlace(raw: unknown): PartialPlaceEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const explicitEvidence = Array.isArray(r.explicitEvidence)
    ? r.explicitEvidence.slice(0, MAX_EVIDENCE_PER_PLACE)
      .map(parseEvidenceItem)
      .filter((item): item is PlaceEvidenceItem => item !== null)
    : [];
  if (explicitEvidence.length === 0) return null;
  const role = typeof r.role === 'string' && VALID_ROLES.has(r.role)
    ? (r.role as PlaceRole)
    : 'primary';
  return {
    hypothesisOrigin: r.hypothesisOrigin === 'independent_multimodal' ? 'independent_multimodal' : undefined,
    hypothesisPathVersion: str(r.hypothesisPathVersion, 100) ?? undefined,
    identitySupport: r.identitySupport === 'exact' || r.identitySupport === 'strong' || r.identitySupport === 'weak' || r.identitySupport === 'none'
      ? r.identitySupport : undefined,
    geoSupport: r.geoSupport === 'explicit_source_geo' || r.geoSupport === 'strong_inferred_geo' || r.geoSupport === 'weak_inferred_geo' || r.geoSupport === 'none'
      ? r.geoSupport : undefined,
    semanticCategory: str(r.semanticCategory, 100),
    conflicts: Array.isArray(r.conflicts)
      ? r.conflicts.map((value) => str(value, 300)).filter((value): value is string => !!value).slice(0, 8)
      : [],
    evidenceBasis: r.evidenceBasis === 'direct_visible_identity' || r.evidenceBasis === 'distinctive_visual_match' || r.evidenceBasis === 'contextual_or_memory_prior' || r.evidenceBasis === 'insufficient'
      ? r.evidenceBasis : undefined,
    nameHint: str(r.nameHint, 200),
    entityType: parseEntityType(r.entityType),
    category: isNearrCategory(r.category) ? r.category : null,
    categoryConfidence: Math.max(0, Math.min(1, num(r.categoryConfidence) ?? 0)),
    categoryEvidenceTags: Array.isArray(r.categoryEvidenceTags)
      ? r.categoryEvidenceTags.map((tag) => str(tag, 80)).filter((tag): tag is string => !!tag).slice(0, 8)
      : [],
    addressHint: str(r.addressHint, 300),
    city: str(r.city, 120),
    region: str(r.region, 120),
    country: str(r.country, 120),
    role,
    confidence: Math.max(0, Math.min(1, num(r.confidence) ?? 0)),
    explicitEvidence,
    validationErrors: Array.isArray(r.validationErrors)
      ? r.validationErrors.map((error) => str(error, 160)).filter((error): error is string => !!error).slice(0, 8)
      : [],
  };
}

/**
 * Defensively parse/normalize the media worker's evidence JSON. The heavy
 * schema validation lives in the worker (Zod); this is defense-in-depth so a
 * malformed payload safely degrades to "insufficient evidence" rather than
 * throwing inside the finalizer.
 */
export function parseMediaEvidence(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'evidence_not_object' };
  }
  const r = raw as Record<string, unknown>;

  const places = Array.isArray(r.places)
    ? r.places
        .slice(0, MAX_PLACES)
        .map(parsePlace)
        .filter((x): x is PlaceCandidateEvidence => x !== null)
    : [];
  const partialPlaces = Array.isArray(r.partialPlaces)
    ? r.partialPlaces.slice(0, MAX_PLACES)
      .map(parsePartialPlace)
      .filter((place): place is PartialPlaceEvidence => place !== null)
    : [];

  const warnings = Array.isArray(r.warnings)
    ? r.warnings
        .slice(0, MAX_WARNINGS)
        .map((w) => str(w))
        .filter((x): x is string => x !== null)
    : [];

  return {
    ok: true,
    value: {
      places,
      partialPlaces,
      multipleIntentionalPlaces: r.multipleIntentionalPlaces === true,
      insufficientEvidence: r.insufficientEvidence === true,
      warnings,
    },
  };
}

function partialFieldIsGrounded(value: string | null, evidence: PlaceEvidenceItem[]): boolean {
  if (!value) return false;
  const folded = foldLabel(value);
  return folded.length >= 3 && evidence.some((item) => foldLabel(item.value).includes(folded));
}

const PARTIAL_CATEGORY_GROUNDING: Readonly<Partial<Record<NearrCategory, readonly string[]>>> = {
  restaurant: ['restaurant', 'dining', 'eatery'],
  cafe: ['cafe', 'coffee'],
  bakery: ['bakery', 'pastry', 'pastries'],
  bar: ['bar', 'pub'],
  brewery: ['brewery', 'beer'],
  winery: ['winery', 'vineyard', 'wine'],
  dessert: ['dessert', 'ice cream', 'gelato'],
  hotel: ['hotel', 'hostel', 'inn'],
  resort: ['resort'],
  hiking_trail: ['hiking trail', 'hike', 'trail', 'trailhead'],
  park: ['park'],
  beach: ['beach', 'cove', 'shore'],
  waterfall: ['waterfall', 'falls'],
  lake: ['lake', 'lagoon', 'reservoir'],
  marina: ['marina', 'harbor', 'harbour', 'pier'],
  island: ['island', 'islet'],
  scenic_spot: ['scenic', 'viewpoint', 'overlook', 'lookout', 'cliff'],
  attraction: ['attraction', 'landmark'],
  museum: ['museum', 'gallery'],
  shopping: ['shopping', 'mall', 'store', 'boutique'],
  entertainment: ['entertainment', 'theater', 'theatre', 'cinema', 'amusement'],
  nightlife: ['nightlife', 'nightclub', 'club'],
  sports: ['sports', 'stadium', 'arena'],
  fitness: ['fitness', 'gym'],
  wellness: ['wellness', 'spa'],
  transportation: ['transportation', 'station', 'airport', 'transit'],
  education: ['education', 'school', 'university', 'campus'],
  service: ['service', 'salon', 'repair'],
};

function partialCategoryIsGrounded(
  category: NearrCategory | null,
  evidence: PlaceEvidenceItem[],
): category is NearrCategory {
  if (!category || category === 'other') return false;
  const aliases = PARTIAL_CATEGORY_GROUNDING[category] ?? [category.replace(/_/g, ' ')];
  return evidence.some((item) => {
    const haystack = ` ${foldLabel(item.value)} `;
    return aliases.some((alias) => haystack.includes(` ${foldLabel(alias)} `));
  });
}

/** Convert partial evidence into a deliberately prior-labelled synthetic
 * candidate for the existing resolver. Returning model_prior is load-bearing:
 * even a perfect Places match remains confirmation-only. */
export function partialPlaceToReviewOnlyCandidate(
  partial: PartialPlaceEvidence,
  index: number,
): PlaceCandidateEvidence | null {
  const groundedName = partialFieldIsGrounded(partial.nameHint, partial.explicitEvidence)
    ? partial.nameHint
    : null;
  const city = partialFieldIsGrounded(partial.city, partial.explicitEvidence) ? partial.city : null;
  const region = partialFieldIsGrounded(partial.region, partial.explicitEvidence) ? partial.region : null;
  const country = partialFieldIsGrounded(partial.country, partial.explicitEvidence) ? partial.country : null;
  const name = groundedName ?? city ?? region ?? country;
  if (!name || partial.role === 'passing_mention') return null;
  return {
    logicalPlaceId: `partial-${index + 1}`,
    identityEvidenceKind: 'model_prior',
    hypothesisRank: 0,
    name,
    entityType: partial.entityType ?? 'UNKNOWN',
    category: partialCategoryIsGrounded(partial.category, partial.explicitEvidence)
      ? partial.category
      : null,
    categoryConfidence: partial.categoryConfidence,
    categoryEvidenceTags: partial.categoryEvidenceTags,
    address: partialFieldIsGrounded(partial.addressHint, partial.explicitEvidence)
      ? partial.addressHint
      : null,
    city,
    region,
    country,
    coordinates: null,
    role: 'primary',
    confidence: Math.min(0.49, partial.confidence),
    explicitEvidence: partial.explicitEvidence,
    inferredEvidence: [],
    memoryCue: null,
    memoryCueEvidence: [],
  };
}

export type VayrinPartialResult = {
  version: 1;
  reviewOnly: true;
  resultClass: 'area_match' | 'search_lead' | 'partial_result';
  locality: string | null;
  category: NearrCategory | null;
  searchQuery: string | null;
  clueCount: number;
  placeType?: string | null;
  reasonCode?: 'category_only_candidate';
  discoveryOnly?: true;
  provenance?: {
    identityEvidence: string[];
    categoryEvidence: string[];
    geoEvidence: string[];
  };
};

export function buildVayrinPartialResult(evidence: MediaPlaceEvidence): VayrinPartialResult | null {
  const partialResults = (evidence.partialPlaces ?? []).flatMap((partial, index) => {
    const candidate = partialPlaceToReviewOnlyCandidate(partial, index);
    const proposedName = candidate && partial.nameHint && foldLabel(candidate.name) === foldLabel(partial.nameHint)
      ? partial.nameHint
      : null;
    const semantic = classifyEntity({
      text: proposedName ?? '',
      source: 'search_lead',
      declaredType: partial.entityType ?? 'UNKNOWN',
      contextText: partial.explicitEvidence.map((item) => item.value).join(' '),
      category: partial.category,
      city: partial.city,
      region: partial.region,
      country: partial.country,
    });
    const groundedName = proposedName && (semantic.placesEligible || semantic.entityType === 'UNKNOWN')
      ? semantic.canonicalSearchName ?? proposedName
      : null;
    const locality = candidate
      ? candidate.city ?? candidate.region ?? candidate.country ?? null
      : null;
    const category = partialCategoryIsGrounded(partial.category, partial.explicitEvidence)
      ? partial.category
      : null;
    if (!groundedName && !locality && !category) return [];
    const searchQuery = [groundedName, category?.replace(/_/g, ' '), locality]
      .filter(Boolean).join(' ').trim().slice(0, 240) || null;
    return [{
      version: 1 as const,
      reviewOnly: true as const,
      resultClass: locality ? 'area_match' as const : groundedName ? 'search_lead' as const : 'partial_result' as const,
      locality,
      category,
      searchQuery,
      clueCount: partial.explicitEvidence.length,
    }];
  });
  const categoryOnlyResults = evidence.places.flatMap((place) => {
    const admission = classifyPlacePhrase(place.name);
    if (admission.classification !== 'GENERIC_PLACE_TYPE' && admission.classification !== 'DESCRIPTIVE_CLUE') return [];
    const locality = place.city ?? place.region ?? place.country ?? null;
    const category = isNearrCategory(admission.nearrCategory) ? admission.nearrCategory : place.category;
    const categoryEvidence = [place.name, ...place.explicitEvidence.map((item) => item.value)]
      .filter(Boolean).slice(0, 8);
    const geoEvidence = [place.city, place.region, place.country]
      .filter((value): value is string => !!value).slice(0, 3);
    return [{
      version: 1 as const,
      reviewOnly: true as const,
      resultClass: locality ? 'area_match' as const : 'partial_result' as const,
      locality,
      category,
      searchQuery: [admission.placeType?.replace(/_/g, ' '), locality].filter(Boolean).join(' ').slice(0, 240) || null,
      clueCount: place.explicitEvidence.length,
      placeType: admission.placeType,
      reasonCode: 'category_only_candidate' as const,
      discoveryOnly: true as const,
      provenance: { identityEvidence: [], categoryEvidence, geoEvidence },
    }];
  });
  const results = [...partialResults, ...categoryOnlyResults];
  const priority: Record<VayrinPartialResult['resultClass'], number> = {
    area_match: 3,
    search_lead: 2,
    partial_result: 1,
  };
  return results.sort((a, b) => priority[b.resultClass] - priority[a.resultClass] || b.clueCount - a.clueCount)[0] ?? null;
}

/** A place is renderable only if it carries at least one explicit evidence
 *  item. Inferred-only places are model guesses and are never rendered. */
export function hasExplicitEvidence(place: PlaceCandidateEvidence): boolean {
  return place.explicitEvidence.length > 0;
}

const ROLE_ORDER: Record<PlaceRole, number> = {
  primary: 0,
  secondary: 1,
  passing_mention: 2,
};

// A street-address pattern (number + street type, incl. Spanish/French types
// the resolver already understands). Media auto-save requires a concretely
// shown/spoken street address — a name-only or city-only mention is never
// enough for a SILENT save (it can still become needs_help for confirmation).
const ADDRESS_LIKE_RE =
  /\b\d{1,6}\s+[^,]*\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|ter|terrace|pl|place|cir|circle|plaza|sq|square|paseo|camino|calle|avenida|via|rue)\b/i;

/** Whether a piece of text concretely states a street address. */
export function hasStreetAddressText(text: string | null | undefined): boolean {
  return typeof text === 'string' && ADDRESS_LIKE_RE.test(text);
}

/** Case/accent/punctuation-insensitive fold for comparing place labels. */
function foldLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Which administrative label a place restated. Closed vocabulary — safe to
 *  persist as a diagnostic, unlike the place's own free-form strings. */
export type SourceGeographicContextReason =
  | 'name_matches_city'
  | 'name_matches_region'
  | 'name_matches_country'
  | 'name_matches_compound_admin_context';

/** The administrative labels a place asserts about ITSELF, folded — each field
 *  alone plus their natural compound forms ("Los Angeles, California"), each
 *  paired with the reason code it would justify. Order is precedence order:
 *  the narrowest single field wins over a compound. */
function selfAdministrativeLabels(
  place: PlaceCandidateEvidence,
): Array<{ label: string; reason: SourceGeographicContextReason }> {
  const city = (place.city ?? '').trim();
  const region = (place.region ?? '').trim();
  const country = (place.country ?? '').trim();
  const combos: Array<{ parts: string[]; reason: SourceGeographicContextReason }> = [
    { parts: [city], reason: 'name_matches_city' },
    { parts: [region], reason: 'name_matches_region' },
    { parts: [country], reason: 'name_matches_country' },
    { parts: [city, region], reason: 'name_matches_compound_admin_context' },
    { parts: [city, country], reason: 'name_matches_compound_admin_context' },
    { parts: [region, country], reason: 'name_matches_compound_admin_context' },
    { parts: [city, region, country], reason: 'name_matches_compound_admin_context' },
  ];
  const out: Array<{ label: string; reason: SourceGeographicContextReason }> = [];
  for (const combo of combos) {
    const parts = combo.parts.filter(Boolean);
    if (parts.length === 0) continue;
    const folded = foldLabel(parts.join(' '));
    if (folded) out.push({ label: folded, reason: combo.reason });
  }
  return out;
}

/**
 * Whether a model-proposed place IS the geographic context it sits in, rather
 * than a destination inside it.
 *
 * This is the SOURCE-side counterpart to `isGeographicContextOnly(candidate)`,
 * which classifies a Google result by its provider entity types. They answer
 * different questions and neither replaces the other:
 *
 *   candidate side — "is this Google result merely an administrative entity?"
 *   source side    — "did the post ever name a destination, or only a place-name
 *                     that the post itself also gives as its own city/region?"
 *
 * The production wrong-save this prevents (job 1e234bae, Instagram DcBz1dhSoax):
 * the model emitted `name: "Rio de Janeiro"` with `city: "Rio de Janeiro"` and
 * `region: "Rio de Janeiro"`. The candidate guard correctly rejected Google's
 * `locality` entity for Rio — and then the name-driven search matched
 * "7 Mares - Passeio de Lancha Rio de Janeiro", a tour agency whose NAME merely
 * contains the city, which is business-like, plausible, and was SILENTLY SAVED.
 * A city mention is context; a company containing that city's name is not
 * automatically what the user meant.
 *
 * The test is deliberately structural, not lexical. We do NOT ask "does this
 * name look geographic" (no gazetteer, no geographic word list, no name
 * blacklist) — we ask whether the place's own name is identical to an
 * administrative label the SAME place reports for itself. That self-reference is
 * first-party structured evidence, and it is what separates:
 *
 *   name "Rio de Janeiro"       + city "Rio de Janeiro"  -> context only
 *   name "Copacabana Beach"     + city "Rio de Janeiro"  -> a real destination
 *   name "California Pizza Kitchen" + region "California" -> a real destination
 *   name "Los Angeles"          + city "Los Angeles"     -> context only
 *   name "Los Angeles Cafe"     + city "Los Angeles"     -> a real destination
 *
 * PRECEDENCE. A concretely stated street address is stronger first-party
 * evidence than the self-referential name, so it wins: a place that shows or
 * speaks a street address is a specific location and keeps resolving normally,
 * however the model labelled it. Note that `category` is deliberately NOT
 * consulted — the model's category vocabulary has no city/locality/admin member
 * to consult (see NEARR_CATEGORY_SET), and in the production case above it
 * emitted `scenic_spot`, a category we must keep resolving for real parks,
 * beaches and landmarks.
 *
 * A place naming a city with no city/region/country of its own is NOT caught
 * here: that needs geographic knowledge this module deliberately does not have.
 */
export function isGeographicContextOnlySource(place: PlaceCandidateEvidence): boolean {
  return sourceGeographicContextReasonOf(place) !== null;
}

/**
 * WHICH administrative label made a place context-only, or null when it is a
 * real destination. Same decision as `isGeographicContextOnlySource` — that
 * function is defined in terms of this one, so the two can never drift — but it
 * returns the reason so a production run is explainable without persisting the
 * place's own free-form strings.
 *
 * Mirrors the candidate-side pair `isGeographicContextOnly` /
 * `geographicContextTypeOf` in placeNormalization.ts.
 */
export function sourceGeographicContextReasonOf(
  place: PlaceCandidateEvidence,
): SourceGeographicContextReason | null {
  const name = foldLabel(place.name ?? '');
  if (!name) return null;
  const matched = selfAdministrativeLabels(place).find((entry) => entry.label === name);
  if (!matched) return null;
  if (hasStreetAddressText(place.address)) return null;
  if (place.explicitEvidence.some((item) => hasStreetAddressText(item.value))) return null;
  return matched.reason;
}

/**
 * What ROLE a geographic source place is playing in its post.
 *
 *   redundant_container — the post's real destinations sit INSIDE it, so naming
 *                         it again adds nothing. Context, never a destination.
 *   peer_geographic_destination
 *                       — it stands alongside the other destinations rather
 *                         than containing them, so the post is recommending the
 *                         place itself.
 */
export type GeographicSourceRole = 'redundant_container' | 'peer_geographic_destination';

/**
 * Decide which role a geographic source place is playing, or null when the place
 * is not geographic context at all.
 *
 * `name === city` cannot make this call on its own — "Rio de Janeiro" and
 * "Granada" both satisfy it. The distinguishing signal, proven against both
 * production jobs, is whether the OTHER places say they are inside this one:
 *
 *   Rio reel (job e5825a93) — Copacabana Beach, Christ the Redeemer and
 *   Sugarloaf Mountain Cable Car every one report `city: "Rio de Janeiro"`.
 *   Rio is where the destinations are, not a destination. 3 contained siblings.
 *
 *   Nicaragua reel (job 10ce36b5) — Granada, San Juan del Sur and León each
 *   report only their OWN name as their city, and Ometepe Island reports none.
 *   Nothing sits inside Granada. 0 contained siblings, so the post is offering
 *   the cities themselves as stops.
 *
 * Containment is counted only from places that are NOT themselves geographic
 * context, so two peer cities can never mark each other as containers.
 */
export function classifyGeographicSourcePlace(
  place: PlaceCandidateEvidence,
  allPlaces: PlaceCandidateEvidence[],
): GeographicSourceRole | null {
  if (!isGeographicContextOnlySource(place)) return null;
  const self = foldLabel(place.name ?? '');
  if (!self) return null;
  const contained = allPlaces.filter((other) => {
    if (other === place) return false;
    // A sibling that is itself only geographic context cannot establish
    // containment — otherwise peer cities would suppress one another.
    if (isGeographicContextOnlySource(other)) return false;
    if (other.explicitEvidence.length === 0) return false;
    if (other.role === 'passing_mention') return false;
    return foldLabel(other.city ?? '') === self || foldLabel(other.region ?? '') === self;
  });
  return contained.length > 0 ? 'redundant_container' : 'peer_geographic_destination';
}

/** Whether a geographic source place must stay context (never a destination). */
export function isRedundantGeographicContainer(
  place: PlaceCandidateEvidence,
  allPlaces: PlaceCandidateEvidence[],
): boolean {
  return classifyGeographicSourcePlace(place, allPlaces) === 'redundant_container';
}

/** Whether a geographic source place is offered as a destination in its own
 *  right. Such a place resolves through the GEOGRAPHIC path only — it may never
 *  be matched to a business that merely carries its name. */
export function isPeerGeographicDestination(
  place: PlaceCandidateEvidence,
  allPlaces: PlaceCandidateEvidence[],
): boolean {
  return classifyGeographicSourcePlace(place, allPlaces) === 'peer_geographic_destination';
}

/** Cap on persisted per-place diagnostic labels: one per place the payload can
 *  carry at all (MAX_PLACES), so a single share can never emit more. */
const MAX_CONTEXT_DIAGNOSTIC_LABELS = MAX_PLACES;

export type SourceGeographicContextSummary = {
  /** Redundant CONTAINER places suppressed (the post's destinations sit inside). */
  dropped: number;
  /** Geographic places admitted as destinations in their own right. */
  peerDestinations: number;
  /** Bounded `index:category:reason` labels. Closed vocabulary only — the
   *  place index, its model category (or `none`), and the reason code. Never
   *  the place's name, address, or any model prose. */
  labels: string[];
};

/**
 * Bounded, privacy-safe summary of which model places were suppressed as
 * geographic context. Pure. Recomputes the SAME predicate the pipeline uses, so
 * it is a description of the decision rather than a second opinion about it.
 */
export function summarizeSourceGeographicContext(
  evidence: MediaPlaceEvidence,
): SourceGeographicContextSummary {
  const labels: string[] = [];
  let dropped = 0;
  let peerDestinations = 0;
  const places = Array.isArray(evidence?.places) ? evidence.places : [];
  for (let i = 0; i < places.length; i += 1) {
    const reason = sourceGeographicContextReasonOf(places[i]!);
    if (!reason) continue;
    const role = classifyGeographicSourcePlace(places[i]!, places);
    if (role === 'peer_geographic_destination') peerDestinations += 1;
    else dropped += 1;
    if (labels.length < MAX_CONTEXT_DIAGNOSTIC_LABELS) {
      // index : model category : why it is geographic : the role it plays.
      labels.push(`${i}:${places[i]!.category ?? 'none'}:${reason}:${role ?? 'unknown'}`);
    }
  }
  return { dropped, peerDestinations, labels };
}

export type RenderedCaption = {
  title: string;
  description: string;
  /** How many places were actually rendered (0 → nothing verifiable). */
  renderedPlaces: number;
};

/**
 * The SINGLE source of truth for "which places may influence the outcome":
 * explicit-evidence, non-passing places in render order (primary first).
 * Secondary places are included only when the model flagged multiple
 * intentional places. Inferred-only places and passing mentions are always
 * dropped here — before anything reaches the resolver or the auto-save gate.
 *
 * A place that merely restates its own city/region/country is dropped here ONLY
 * when it is a REDUNDANT CONTAINER — when the post's other destinations report
 * sitting inside it (Rio de Janeiro around Copacabana / Christ the Redeemer /
 * Sugarloaf). Such a place is where the destinations are, not one of them, and
 * must not seed a name search that could match an unrelated business carrying
 * the same place-name. It still contributes geographic context to its siblings.
 *
 * A PEER geographic destination (Granada, León and San Juan del Sur, which
 * contain none of their siblings) survives here and is resolved through the
 * dedicated geographic path in `buildVenueMentions` — never through ordinary
 * business matching.
 */
export function selectRenderablePlaces(
  evidence: MediaPlaceEvidence,
): PlaceCandidateEvidence[] {
  if (evidence.insufficientEvidence) return [];
  return evidence.places
    .filter(hasExplicitEvidence)
    .filter((p) => p.role !== 'passing_mention')
    .filter((p) => !isRedundantGeographicContainer(p, evidence.places))
    .filter((p) => p.role === 'primary' || evidence.multipleIntentionalPlaces)
    .sort((a, b) => {
      const r = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (r !== 0) return r;
      return b.confidence - a.confidence;
    });
}

/**
 * Render structured evidence into a synthetic post caption for
 * `extractEvidence`. Only explicit-evidence places are included; passing
 * mentions are always excluded; secondary places are included only when the
 * model flagged multiple intentional places. Fields are joined the way a
 * normal caption reads ("Name, 123 St, City, Region") so the existing
 * deterministic address/venue extractors pick them up unchanged.
 */
export function renderMediaEvidenceCaption(
  evidence: MediaPlaceEvidence,
): RenderedCaption {
  const renderable = selectRenderablePlaces(evidence);
  if (renderable.length === 0) {
    return { title: '', description: '', renderedPlaces: 0 };
  }

  const lines = renderable.map((p) =>
    [p.name, p.address, p.city, p.region, p.country]
      .map((x) => (x ?? '').trim())
      .filter(Boolean)
      .join(', '),
  );

  const primary = renderable[0]!;
  return {
    title: primary.name,
    description: lines.join('\n'),
    renderedPlaces: renderable.length,
  };
}

export const DEFAULT_MEDIA_AUTOSAVE_MIN_CONFIDENCE = 0.7;

const NATURAL_PLACE_CATEGORIES = new Set<NearrCategory>([
  'park', 'hiking_trail', 'beach', 'waterfall', 'lake', 'marina', 'island',
  'scenic_spot', 'attraction',
]);

function normalizedEvidenceText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function explicitGeoGrounding(primary: PlaceCandidateEvidence): boolean {
  if (!primary.city || !primary.region) return false;
  const explicit = primary.explicitEvidence.map((item) => normalizedEvidenceText(item.value)).join(' ');
  return explicit.includes(normalizedEvidenceText(primary.city)) && explicit.includes(normalizedEvidenceText(primary.region));
}

/**
 * Whether media evidence is strong enough to permit a SILENT auto-save. This is
 * an EXTRA gate ON TOP OF the resolver's `safeToAutoSave` — it can only make
 * media auto-save STRICTER, never looser. Because a video is a less reliable
 * source than an owner-written caption, we additionally require the primary
 * place to carry an EXPLICIT street address at high model confidence, and we
 * never silent-save multi-intentional content. Model coordinates and Place IDs
 * are never trusted (the schema has no Place ID; coordinates are dropped).
 *
 * Adversarial inputs (inferred-only, passing mentions, creator handles, dish /
 * product / cuisine names, city-as-context, low-confidence text) all fail this
 * gate because none of them carry an explicit high-confidence street address.
 */
export function mediaEvidenceAutoSaveEligible(
  evidence: MediaPlaceEvidence,
  minConfidence: number = DEFAULT_MEDIA_AUTOSAVE_MIN_CONFIDENCE,
): boolean {
  if (evidence.insufficientEvidence) return false;
  // Multiple intentional places are inherently a confirmation case.
  if (evidence.multipleIntentionalPlaces) return false;

  const primary = selectRenderablePlaces(evidence)[0];
  if (!primary) return false;
  if (!(primary.confidence >= minConfidence)) return false;
  if (primary.hypothesisOrigin === 'independent_multimodal') {
    if (primary.identitySupport !== 'exact' && primary.identitySupport !== 'strong') return false;
    if (primary.geoSupport !== 'explicit_source_geo' && primary.geoSupport !== 'strong_inferred_geo') return false;
    if ((primary.conflicts?.length ?? 0) > 0) return false;
  }

  // Built destinations require an explicit street address. Recognized natural
  // destinations may instead use explicit city+region grounding; the downstream
  // resolver still independently requires unique provider identity, coordinates,
  // state agreement, city proximity, and strong repeated name evidence.
  const addressInField = !!primary.address && ADDRESS_LIKE_RE.test(primary.address);
  const addressInExplicit = primary.explicitEvidence.some((e) => ADDRESS_LIKE_RE.test(e.value));
  if (addressInField && addressInExplicit) return true;
  return !!primary.category && NATURAL_PLACE_CATEGORIES.has(primary.category) && explicitGeoGrounding(primary);
}

/** Small, size-bounded summary for diagnostics logging (no raw evidence). */
export function summarizeMediaEvidence(evidence: MediaPlaceEvidence): {
  placeCount: number;
  explicitPlaceCount: number;
  multiple: boolean;
  insufficient: boolean;
  partialPlaceCount: number;
} {
  return {
    placeCount: evidence.places.length,
    explicitPlaceCount: evidence.places.filter(hasExplicitEvidence).length,
    multiple: evidence.multipleIntentionalPlaces,
    insufficient: evidence.insufficientEvidence,
    partialPlaceCount: evidence.partialPlaces?.length ?? 0,
  };
}
