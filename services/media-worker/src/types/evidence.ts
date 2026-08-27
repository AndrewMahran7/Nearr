// services/media-worker/src/types/evidence.ts
//
// Generic, category-agnostic place-evidence schema (Zod). The multimodal model
// PROPOSES this; Nearr's deterministic resolver DECIDES. It must support any
// Google-Places-compatible destination (restaurants, hotels, beaches, trails,
// parks, stores, landmarks, venues, museums, ...), so field names are generic.
//
// SAFETY: explicit evidence is kept separate from inference. The worker only
// ever forwards EXPLICIT-evidence places into verification, and coordinates are
// never trusted from the model (dropped downstream). This schema is the wire
// contract POSTed to the Deno finalizer (see mediaEvidence.ts on that side).

import { z } from 'zod';

export const VayrinEntityType = z.enum([
  'PERSON', 'ACTIVITY', 'EVENT', 'GENERIC_PLACE_TYPE', 'BUSINESS_OR_VENUE',
  'NAMED_NATURAL_FEATURE', 'LANDMARK', 'CITY', 'REGION', 'COUNTRY',
  'GEOGRAPHIC_ALIAS', 'PLACE_ALIAS', 'UNKNOWN',
]);
export type VayrinEntityType = z.infer<typeof VayrinEntityType>;

export const EvidenceSource = z.enum(['caption', 'speech', 'visible_text', 'frame']);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

export const PlaceRole = z.enum(['primary', 'secondary', 'passing_mention']);
export type PlaceRole = z.infer<typeof PlaceRole>;

export const SceneEnvironmentType = z.enum([
  'natural_water', 'natural_land', 'food_venue', 'lodging', 'cultural',
  'retail', 'urban_outdoor', 'transport', 'other', 'unknown',
]);
export type SceneEnvironmentType = z.infer<typeof SceneEnvironmentType>;

export const SceneSetting = z.enum(['indoor', 'outdoor', 'mixed', 'unknown']);
export type SceneSetting = z.infer<typeof SceneSetting>;

/** Small visual signature produced by the existing analysis call. It describes
 * an observed moment; it never names or verifies a canonical place. */
export const SceneSignature = z.object({
  environmentType: SceneEnvironmentType.default('unknown'),
  setting: SceneSetting.default('unknown'),
  visualAnchors: z.array(z.string().min(1).max(100)).max(8).default([]),
  activity: z.string().min(1).max(100).nullable().default(null),
  regionClue: z.string().min(1).max(120).nullable().default(null),
});
export type SceneSignature = z.infer<typeof SceneSignature>;

/** Closed, bounded claims that a moment begins a different destination. These
 * are hints only; the deterministic grouper corroborates them against source
 * text/structured geography before splitting. */
export const DistinctPlaceSignal = z.enum([
  'explicit_next_stop', 'explicit_then_went_to', 'explicit_new_day',
  'distinct_named_venue', 'different_city', 'different_region',
  'different_country', 'geographic_conflict', 'environment_conflict',
  'travel_segment', 'platform_location_conflict',
]);
export type DistinctPlaceSignal = z.infer<typeof DistinctPlaceSignal>;

export const EvidenceItem = z.object({
  timestampSeconds: z.number().finite().nonnegative().nullable().default(null),
  source: EvidenceSource,
  value: z.string().min(1).max(400),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const NearrCategory = z.enum([
  'restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert',
  'hotel', 'resort', 'hiking_trail', 'park', 'beach', 'waterfall', 'lake',
  'marina', 'island', 'scenic_spot', 'attraction', 'museum', 'shopping',
  'entertainment', 'nightlife', 'sports', 'fitness', 'wellness',
  'transportation', 'education', 'service', 'other',
]);

export const PlaceCandidateEvidence = z.object({
  /** Stable logical scene/place grouping. Different identity hypotheses for
   *  one scene share this id; genuinely distinct scenes use different ids. */
  logicalPlaceId: z.string().min(1).max(80).nullable().optional(),
  /** Whether the proposed identity is supported by observable pixels, or is
   *  only a contextual/memorized model prior. Priors may be shown as leads but
   *  are never silently saveable. */
  identityEvidenceKind: z.enum(['observable', 'model_prior']).optional(),
  /** Best-first rank within one logical place. */
  hypothesisRank: z.number().int().min(0).max(11).optional(),
  hypothesisOrigin: z.enum(['independent_multimodal']).optional(),
  hypothesisPathVersion: z.string().min(1).max(100).optional(),
  identitySupport: z.enum(['exact', 'strong', 'weak', 'none']).optional(),
  geoSupport: z.enum(['explicit_source_geo', 'strong_inferred_geo', 'weak_inferred_geo', 'none']).optional(),
  semanticCategory: z.string().min(1).max(100).nullable().optional(),
  conflicts: z.array(z.string().min(1).max(300)).max(8).optional(),
  evidenceBasis: z.enum([
    'direct_visible_identity', 'distinctive_visual_match',
    'contextual_or_memory_prior', 'insufficient',
  ]).optional(),
  /** All retained frame/evidence timestamps belonging to this raw moment. */
  momentTimestamps: z.array(z.number().finite().nonnegative()).max(24).default([]),
  sceneSignature: SceneSignature.optional(),
  distinctPlaceSignals: z.array(DistinctPlaceSignal).max(8).default([]),
  name: z.string().min(1).max(200),
  /** Semantic identity proposed by the extractor. The deterministic classifier
   * re-checks this before Places; it is a typed hint, never authority. */
  entityType: VayrinEntityType.default('UNKNOWN'),
  category: NearrCategory.nullable().default(null),
  categoryConfidence: z.number().min(0).max(1).default(0),
  categoryEvidenceTags: z.array(z.string().min(1).max(80)).max(8).default([]),
  address: z.string().max(300).nullable().default(null),
  city: z.string().max(120).nullable().default(null),
  region: z.string().max(120).nullable().default(null),
  country: z.string().max(120).nullable().default(null),
  // Coordinates are intentionally allowed in the schema but NEVER trusted
  // downstream (the adapter drops them) — a model must not fabricate a location.
  coordinates: z
    .object({ lat: z.number().finite(), lng: z.number().finite() })
    .nullable()
    .default(null),
  role: PlaceRole.default('primary'),
  confidence: z.number().min(0).max(1).default(0),
  explicitEvidence: z.array(EvidenceItem).max(24).default([]),
  inferredEvidence: z.array(EvidenceItem).max(24).default([]),
  // A short, optional reminder of what was compelling in the original post.
  // It is not identity evidence and never participates in place resolution.
  memoryCue: z.string().min(1).max(180).nullable().default(null),
  memoryCueEvidence: z.array(EvidenceItem).max(8).default([]),
});
type ParsedPlaceCandidateEvidence = z.infer<typeof PlaceCandidateEvidence>;
/** New grouping fields are optional in the TypeScript compatibility surface so
 * existing injected/custom providers remain source-compatible. The parser
 * materializes their defaults for real model output. */
export type PlaceCandidateEvidence = Omit<
  ParsedPlaceCandidateEvidence,
  'momentTimestamps' | 'distinctPlaceSignals' | 'entityType'
> & {
  momentTimestamps?: ParsedPlaceCandidateEvidence['momentTimestamps'];
  distinctPlaceSignals?: ParsedPlaceCandidateEvidence['distinctPlaceSignals'];
  entityType?: ParsedPlaceCandidateEvidence['entityType'];
};

/** Field-level evidence retained from a candidate that failed whole-object
 * validation. It is intentionally not a canonical candidate: downstream may
 * use it only for review-only search and area assistance. */
export const PartialPlaceEvidence = z.object({
  nameHint: z.string().min(1).max(200).nullable().default(null),
  entityType: VayrinEntityType.default('UNKNOWN'),
  category: NearrCategory.nullable().default(null),
  categoryConfidence: z.number().min(0).max(1).default(0),
  categoryEvidenceTags: z.array(z.string().min(1).max(80)).max(8).default([]),
  addressHint: z.string().min(1).max(300).nullable().default(null),
  city: z.string().min(1).max(120).nullable().default(null),
  region: z.string().min(1).max(120).nullable().default(null),
  country: z.string().min(1).max(120).nullable().default(null),
  role: PlaceRole.default('primary'),
  confidence: z.number().min(0).max(1).default(0),
  explicitEvidence: z.array(EvidenceItem).min(1).max(24),
  validationErrors: z.array(z.string().min(1).max(160)).max(8).default([]),
  hypothesisOrigin: z.enum(['independent_multimodal']).optional(),
  hypothesisPathVersion: z.string().min(1).max(100).optional(),
  identitySupport: z.enum(['exact', 'strong', 'weak', 'none']).optional(),
  geoSupport: z.enum(['explicit_source_geo', 'strong_inferred_geo', 'weak_inferred_geo', 'none']).optional(),
  semanticCategory: z.string().min(1).max(100).nullable().optional(),
  conflicts: z.array(z.string().min(1).max(300)).max(8).optional(),
  evidenceBasis: z.enum([
    'direct_visible_identity', 'distinctive_visual_match',
    'contextual_or_memory_prior', 'insufficient',
  ]).optional(),
});
type ParsedPartialPlaceEvidence = z.infer<typeof PartialPlaceEvidence>;
export type PartialPlaceEvidence = Omit<ParsedPartialPlaceEvidence, 'entityType'> & {
  entityType?: ParsedPartialPlaceEvidence['entityType'];
};

export const MediaPlaceEvidence = z.object({
  places: z.array(PlaceCandidateEvidence).max(12).default([]),
  partialPlaces: z.array(PartialPlaceEvidence).max(12).default([]),
  multipleIntentionalPlaces: z.boolean().default(false),
  insufficientEvidence: z.boolean().default(false),
  warnings: z.array(z.string().max(200)).max(24).default([]),
});
type ParsedMediaPlaceEvidence = z.infer<typeof MediaPlaceEvidence>;
/** Optional in the TypeScript compatibility surface so existing custom/test
 * providers remain source-compatible. The parser always materializes `[]`. */
export type MediaPlaceEvidence = Omit<ParsedMediaPlaceEvidence, 'places' | 'partialPlaces'> & {
  places: PlaceCandidateEvidence[];
  partialPlaces?: PartialPlaceEvidence[];
};

export function emptyEvidence(warnings: string[] = []): MediaPlaceEvidence {
  return {
    places: [],
    partialPlaces: [],
    multipleIntentionalPlaces: false,
    insufficientEvidence: true,
    warnings,
  };
}

/** A place is verifiable only if it carries at least one explicit evidence
 *  item. Inferred-only places are model guesses and are dropped by the worker
 *  before anything is forwarded to verification. */
export function hasExplicitEvidence(p: PlaceCandidateEvidence): boolean {
  return p.explicitEvidence.length > 0;
}

const VALID_EVIDENCE_SOURCES = new Set(['caption', 'speech', 'visible_text', 'frame']);

/** Keep only well-formed evidence items ({ source, value }), dropping anything
 *  else. Multimodal models sometimes emit `inferredEvidence` as bare strings or
 *  malformed objects — dropping those must NOT reject the whole payload (the
 *  place's valid EXPLICIT evidence has to survive). Never expands what counts as
 *  explicit evidence, so the downstream safeToAutoSave gate is unaffected. */
function coerceEvidenceItems(v: unknown): unknown[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x) =>
      !!x &&
      typeof x === 'object' &&
      typeof (x as { value?: unknown }).value === 'string' &&
      VALID_EVIDENCE_SOURCES.has((x as { source?: unknown }).source as string),
  );
}

/** Normalize a raw model payload so a single malformed evidence item can't
 *  invalidate the whole response. Coerces the two evidence arrays on each place;
 *  everything else is left for Zod to validate strictly. */
function normalizeRawEvidence(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.places)) return raw;
  return {
    ...r,
    // This collection is parser-authored. A model may not self-declare that
    // malformed output is safe partial evidence.
    partialPlaces: [],
    places: r.places.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const pl = p as Record<string, unknown>;
      return {
        ...pl,
        explicitEvidence: coerceEvidenceItems(pl.explicitEvidence),
        inferredEvidence: coerceEvidenceItems(pl.inferredEvidence),
        memoryCueEvidence: coerceEvidenceItems(pl.memoryCueEvidence),
      };
    }),
  };
}

export type EvidenceParseDiagnostics = {
  /** Places the model emitted (0 when the payload was structurally unusable). */
  emitted: number;
  /** Places that independently passed the FULL strict schema. */
  accepted: number;
  /** Places dropped because they individually failed validation. */
  rejected: number;
  /** Bounded `path:code` labels for the rejected places. Never model text. */
  rejectionPaths: string[];
  /** True when the payload was not even shaped like an evidence object. */
  topLevelInvalid: boolean;
  /** Rejected candidates that retained independently valid explicit fields. */
  partialPreserved: number;
  /** Aggregate validation class; contains no model-provided text. */
  validationErrorClass: 'none' | 'candidate_field_invalid' | 'envelope_invalid' | 'top_level_invalid';
};

const MAX_REJECTION_PATHS = 8;

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function partialFromRejectedPlace(raw: unknown, validationErrors: string[]): PartialPlaceEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const explicitEvidence: EvidenceItem[] = [];
  for (const item of coerceEvidenceItems(p.explicitEvidence)) {
    const parsed = EvidenceItem.safeParse(item);
    if (parsed.success) explicitEvidence.push(parsed.data);
  }
  // Model priors alone are not evidence and cannot become a partial result.
  if (explicitEvidence.length === 0) return null;

  const category = NearrCategory.safeParse(p.category);
  const role = PlaceRole.safeParse(p.role);
  const tags = Array.isArray(p.categoryEvidenceTags)
    ? p.categoryEvidenceTags
      .map((tag) => boundedString(tag, 80))
      .filter((tag): tag is string => tag !== null)
      .slice(0, 8)
    : [];

  return PartialPlaceEvidence.parse({
    nameHint: boundedString(p.name, 200),
    entityType: VayrinEntityType.safeParse(p.entityType).success
      ? VayrinEntityType.parse(p.entityType)
      : 'UNKNOWN',
    category: category.success ? category.data : null,
    categoryConfidence: boundedNumber(p.categoryConfidence, 0, 1) ?? 0,
    categoryEvidenceTags: tags,
    addressHint: boundedString(p.address, 300),
    city: boundedString(p.city, 120),
    region: boundedString(p.region, 120),
    country: boundedString(p.country, 120),
    role: role.success ? role.data : 'primary',
    confidence: boundedNumber(p.confidence, 0, 1) ?? 0,
    explicitEvidence: explicitEvidence.slice(0, 24),
    validationErrors: (validationErrors.length > 0
      ? validationErrors
      : ['candidate_field_invalid']).slice(0, 8),
  });
}

/**
 * Parse unknown model output into validated evidence, isolating faults at the
 * PLACE level. Never throws.
 *
 * The failure this replaces: validation was all-or-nothing, so a single bad
 * field anywhere collapsed the entire response to
 * `emptyEvidence(['evidence_schema_invalid'])` — erasing every independently
 * valid place and turning a good extraction into a manual fallback. Observed in
 * production on the frozen 20-share cohort (jobs d4e64093 / e7dde60b /
 * 1a5c9273), where the model had named real places and the parser discarded
 * them wholesale.
 *
 * Salvage boundaries, deliberately narrow:
 *   - top level unintelligible (not an object, `places` not an array) → hard
 *     fail, exactly as before. Nothing can be trusted from that.
 *   - one malformed place among valid siblings → drop only that place.
 *   - every emitted place malformed → no survivors, safe insufficient result.
 *
 * This is NOT a loosening of the schema: each surviving place still passes the
 * complete strict `PlaceCandidateEvidence` check. Malformed units are rejected,
 * never coerced into looking valid.
 */
export function parseEvidenceWithDiagnostics(
  raw: unknown,
): { evidence: MediaPlaceEvidence; diagnostics: EvidenceParseDiagnostics } {
  const base: EvidenceParseDiagnostics = {
    emitted: 0, accepted: 0, rejected: 0, rejectionPaths: [], topLevelInvalid: false,
    partialPreserved: 0, validationErrorClass: 'none',
  };

  const normalized = normalizeRawEvidence(raw);
  // Fast path: the whole payload is already valid.
  const whole = MediaPlaceEvidence.safeParse(normalized);
  if (whole.success) {
    return {
      evidence: whole.data,
      diagnostics: { ...base, emitted: whole.data.places.length, accepted: whole.data.places.length },
    };
  }

  // Structural gate. Anything that is not an object with a `places` array is
  // unintelligible, and salvaging from it would be guesswork.
  if (!normalized || typeof normalized !== 'object' || !Array.isArray((normalized as any).places)) {
    return {
      evidence: emptyEvidence(['evidence_schema_invalid']),
      diagnostics: { ...base, topLevelInvalid: true, validationErrorClass: 'top_level_invalid' },
    };
  }

  const r = normalized as Record<string, unknown>;
  const rawPlaces = r.places as unknown[];
  const accepted: PlaceCandidateEvidence[] = [];
  const partialPlaces: PartialPlaceEvidence[] = [];
  const rejectionPaths: string[] = [];

  for (let i = 0; i < rawPlaces.length; i += 1) {
    const one = PlaceCandidateEvidence.safeParse(rawPlaces[i]);
    if (one.success) {
      accepted.push(one.data);
      continue;
    }
    const candidateErrors: string[] = [];
    for (const issue of one.error.issues) {
      if (rejectionPaths.length >= MAX_REJECTION_PATHS && candidateErrors.length >= MAX_REJECTION_PATHS) break;
      // Bounded label only — path + code, never the offending value.
      const label = `places.${i}.${issue.path.join('.')}:${issue.code}`;
      if (rejectionPaths.length < MAX_REJECTION_PATHS) rejectionPaths.push(label);
      if (candidateErrors.length < MAX_REJECTION_PATHS) candidateErrors.push(label);
    }
    const partial = partialFromRejectedPlace(rawPlaces[i], candidateErrors);
    if (partial) partialPlaces.push(partial);
  }

  // Re-validate the envelope with only the surviving places, so top-level
  // fields (warnings, flags) still go through the same strict schema.
  const envelope = MediaPlaceEvidence.safeParse({ ...r, places: accepted, partialPlaces });
  const diagnostics: EvidenceParseDiagnostics = {
    emitted: rawPlaces.length,
    accepted: accepted.length,
    rejected: rawPlaces.length - accepted.length,
    rejectionPaths,
    topLevelInvalid: false,
    partialPreserved: partialPlaces.length,
    validationErrorClass: rawPlaces.length === accepted.length ? 'none' : 'candidate_field_invalid',
  };

  if (!envelope.success) {
    // The places were fine but the envelope itself is malformed — still safe-fail.
    return {
      evidence: emptyEvidence(['evidence_schema_invalid']),
      diagnostics: {
        ...diagnostics,
        accepted: 0,
        rejected: rawPlaces.length,
        partialPreserved: 0,
        topLevelInvalid: true,
        validationErrorClass: 'envelope_invalid',
      },
    };
  }

  const warnings = [...envelope.data.warnings];
  if (diagnostics.rejected > 0) warnings.push('evidence_place_schema_invalid');
  return {
    evidence: {
      ...envelope.data,
      warnings: warnings.slice(0, 24),
      // A surviving place is real evidence. Do NOT let a malformed sibling
      // flip this to "insufficient" — but never override an empty result.
      insufficientEvidence: accepted.length === 0 && partialPlaces.length === 0,
    },
    diagnostics,
  };
}

/** Back-compatible wrapper. Prefer `parseEvidenceWithDiagnostics` when the
 *  caller can record the accepted/rejected counts. */
export function safeParseEvidence(raw: unknown): MediaPlaceEvidence {
  return parseEvidenceWithDiagnostics(raw).evidence;
}
