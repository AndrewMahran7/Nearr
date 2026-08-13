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

export const EvidenceSource = z.enum(['caption', 'speech', 'visible_text', 'frame']);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

export const PlaceRole = z.enum(['primary', 'secondary', 'passing_mention']);
export type PlaceRole = z.infer<typeof PlaceRole>;

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
  name: z.string().min(1).max(200),
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
export type PlaceCandidateEvidence = z.infer<typeof PlaceCandidateEvidence>;

export const MediaPlaceEvidence = z.object({
  places: z.array(PlaceCandidateEvidence).max(12).default([]),
  multipleIntentionalPlaces: z.boolean().default(false),
  insufficientEvidence: z.boolean().default(false),
  warnings: z.array(z.string().max(200)).max(24).default([]),
});
export type MediaPlaceEvidence = z.infer<typeof MediaPlaceEvidence>;

export function emptyEvidence(warnings: string[] = []): MediaPlaceEvidence {
  return {
    places: [],
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

/** Parse unknown model output into validated evidence. Never throws — on
 *  failure returns empty/insufficient evidence with a warning so the pipeline
 *  degrades to a safe manual fallback. Malformed individual evidence items are
 *  dropped (not fatal); structural errors still degrade safely. */
export function safeParseEvidence(raw: unknown): MediaPlaceEvidence {
  const result = MediaPlaceEvidence.safeParse(normalizeRawEvidence(raw));
  if (result.success) return result.data;
  return emptyEvidence(['evidence_schema_invalid']);
}
