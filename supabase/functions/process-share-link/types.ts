// supabase/functions/process-share-link/types.ts
//
// Shared internal contracts for the refactored Edge Function.
//
// `ResolverResult` is the single internal shape produced by
// `resolver/resolveSharedPlace.ts`. The HTTP layer (`response.ts`)
// translates it into the wire-level statuses
// (`saved | ambiguous | failed_requires_app | open_app | extracted`)
// that existing clients already understand.
//
// Keep this file dependency-free.

export type ResolverDecision =
  | 'auto_save'
  | 'candidate_confirmation'
  | 'candidate_picker'
  | 'manual_fallback'
  | 'failed';

export type Confidence = 'low' | 'medium' | 'high';

export type ResolvedCandidate = {
  /** Google `place_id`. Always present for trusted Places results. */
  googlePlaceId: string;
  name: string;
  formattedAddress: string;
  latitude?: number;
  longitude?: number;
  types?: string[];
  /** 0..1 — deterministic ranker's score (higher == better). */
  confidenceScore: number;
  /** Atomic evidence keys that contributed to this candidate. */
  evidence: string[];
  /** Reasons the ranker kept or boosted this candidate. */
  reasons: string[];
};

export type RequestMode = 'save' | 'extract' | 'extract_debug_slow' | 'debug_gemini';

export type SourcePlatform = 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'genericWeb' | 'unknown';

/** Internal-only mapping back to the wire-level `source` enum that
 *  existing clients expect. */
export type LegacySource = 'instagram' | 'tiktok' | 'link';

export type SearchBias = { lat: number; lng: number };

export type ResolverResult = {
  decision: ResolverDecision;
  primaryCandidate?: ResolvedCandidate;
  candidates: ResolvedCandidate[];
  /** The final query that produced candidates (for diagnostics). */
  cleanSearchQuery?: string;
  /** Hard veto. The HTTP layer MUST re-check this before saving. */
  safeToAutoSave: boolean;
  confidence: Confidence;
  evidenceUsed: string[];
  /** Non-fatal warnings (degraded path taken, model timed out, etc.). */
  warnings: string[];
  /** Free-form diagnostics surfaced into the `extracted` payload. */
  diagnostics: Record<string, unknown>;
  /**
   * When `decision === 'failed'`, populated with the failure reason
   * code (e.g. `places_error`, `geocode_failed`). Used by the HTTP
   * layer to choose between `open_app` and `failed_requires_app`.
   */
  failureReason?:
    | 'no_query'
    | 'generic_query'
    | 'places_error'
    | 'no_candidates'
    | 'metadata_failed'
    | 'wrong_location_only'
    | 'roundup_post';
};
