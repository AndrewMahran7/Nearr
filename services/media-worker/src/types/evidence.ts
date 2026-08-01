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

export const PlaceCandidateEvidence = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(120).nullable().default(null),
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

/** Parse unknown model output into validated evidence. Never throws — on
 *  failure returns empty/insufficient evidence with a warning so the pipeline
 *  degrades to a safe manual fallback. */
export function safeParseEvidence(raw: unknown): MediaPlaceEvidence {
  const result = MediaPlaceEvidence.safeParse(raw);
  if (result.success) return result.data;
  return emptyEvidence(['evidence_schema_invalid']);
}
