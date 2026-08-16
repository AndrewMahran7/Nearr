// supabase/functions/process-share-jobs/mediaRunDiagnostics.ts
//
// PURE (Node + Deno) — assembles the RECOGNITION FUNNEL persisted on each
// `share_media_runs` row. Observability only: this module never influences
// recognition, and nothing downstream reads what it produces.
//
// The question it exists to answer, from ONE stored row, without an uncapped
// raw model response:
//
//   model places emitted
//     → schema-valid / schema-rejected      (worker; it alone sees the raw payload)
//     → source geographic context           (edge; the e98802f guard)
//     → destination places reaching the resolver
//
// During the Rio audit (job 1e234bae) none of this was recoverable: the model
// emitted six places and `model_output` stores only the first 500 characters,
// so places #4-#6 could not even be named. The parser counts existed in worker
// memory and were already being TRANSPORTED — they were simply not persisted.
//
// PRIVACY: every value here is either an integer or a closed-vocabulary label.
// No place names, no addresses, no caption/transcript text, no model prose.
//
// No I/O, no Deno globals — unit-tested from Node (scripts/testMediaRunDiagnostics.ts).

import {
  summarizeSourceGeographicContext,
  type MediaPlaceEvidence,
} from './mediaEvidence.ts';

/** Cap on persisted schema-rejection labels. Matches the worker's own
 *  MAX_REJECTION_PATHS — re-applied because the transport is never trusted. */
export const MAX_PERSISTED_REJECTION_PATHS = 8;
/** A label is `places.<i>.<zod path>:<zod code>` — structural text only. */
export const MAX_REJECTION_LABEL_CHARS = 120;

export type RecognitionFunnel = {
  /** Places the model emitted, before our schema ran (worker-reported). */
  modelPlacesEmitted?: number;
  /** Places that independently passed the strict schema (worker-reported). */
  modelPlacesValid?: number;
  /** Places dropped by the schema (worker-reported). */
  modelPlacesRejected?: number;
  /** Bounded `places.<i>.<path>:<code>` labels for the rejected places. */
  evidenceRejectionPaths?: string[];
  /** Places suppressed by the source geographic-context guard. */
  sourceGeographicContextDropped?: number;
  /** Bounded `index:category:reason` labels for those suppressions. */
  sourceGeographicContextLabels?: string[];
  /** Places that survived every gate and reached the resolver. */
  destinationPlaces?: number;
};

/**
 * Build the funnel from what is already in hand at persistence time.
 *
 * `diagnosticsBag` is the worker's untyped `diagnostics` object off the wire.
 * EVERY field in it is optional: a worker deployed before these diagnostics
 * existed sends none of them, and this must still return a usable funnel rather
 * than fail finalization (an in-flight task from an older worker is a normal
 * event during a rolling deploy, not an error).
 *
 * `evidence` is null when the callback carried no parsable evidence at all; the
 * edge-computed half of the funnel is then simply absent.
 */
export function buildRecognitionFunnel(
  diagnosticsBag: unknown,
  evidence: MediaPlaceEvidence | null,
  renderablePlaces: number,
): RecognitionFunnel {
  const d =
    diagnosticsBag && typeof diagnosticsBag === 'object'
      ? (diagnosticsBag as Record<string, unknown>)
      : {};
  const count = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;

  const out: RecognitionFunnel = {};

  const emitted = count(d.modelPlacesEmitted);
  const valid = count(d.modelPlacesValid);
  const rejected = count(d.modelPlacesRejected);
  if (emitted !== undefined) out.modelPlacesEmitted = emitted;
  if (valid !== undefined) out.modelPlacesValid = valid;
  if (rejected !== undefined) out.modelPlacesRejected = rejected;

  if (Array.isArray(d.evidenceRejectionPaths)) {
    const labels = d.evidenceRejectionPaths
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .slice(0, MAX_PERSISTED_REJECTION_PATHS)
      .map((p) => p.slice(0, MAX_REJECTION_LABEL_CHARS));
    if (labels.length > 0) out.evidenceRejectionPaths = labels;
  }

  if (evidence) {
    const geo = summarizeSourceGeographicContext(evidence);
    out.sourceGeographicContextDropped = geo.dropped;
    if (geo.labels.length > 0) out.sourceGeographicContextLabels = geo.labels;
    out.destinationPlaces = Number.isInteger(renderablePlaces) && renderablePlaces >= 0
      ? renderablePlaces
      : 0;
  }
  return out;
}
