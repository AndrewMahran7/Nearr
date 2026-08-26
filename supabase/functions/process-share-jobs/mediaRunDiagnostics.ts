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
  /** Whether usable frames entered the recognition/model path. */
  analysisAttempted?: boolean;
  /** Places the model emitted, before our schema ran (worker-reported). */
  modelPlacesEmitted?: number;
  /** Places that independently passed the strict schema (worker-reported). */
  modelPlacesValid?: number;
  /** Places dropped by the schema (worker-reported). */
  modelPlacesRejected?: number;
  modelPartialPlacesPreserved?: number;
  finalResultClass?: string;
  recognitionFailureClass?: string;
  modelValidationErrorClass?: string;
  /** Bounded `places.<i>.<path>:<code>` labels for the rejected places. */
  evidenceRejectionPaths?: string[];
  /** Places suppressed by the source geographic-context guard. */
  sourceGeographicContextDropped?: number;
  /** Bounded `index:category:reason` labels for those suppressions. */
  sourceGeographicContextLabels?: string[];
  /** Places that survived every gate and reached the resolver. */
  destinationPlaces?: number;
  /** How firmly the post established ONE shared country. */
  sharedGeoCountryStrength?: string;
  /** What corroborated it (only when strong). Closed vocabulary. */
  sharedGeoCountrySource?: string;
  /** How many distinct countries the post asserted. >1 means conflicted. */
  sharedGeoCountryCandidates?: number;
  /** Whether a strong shared country was available to scope sibling searches. */
  sharedGeoCountryApplied?: boolean;
  /** Geographic places admitted as destinations in their own right (peer cities). */
  peerGeographicDestinations?: number;
  /** One bounded, content-free record of the Vayrin invocation. The job/task
   * IDs and media duration already live in columns on the same run row. */
  vayrinInvocation?: {
    invoked: true;
    framesExtracted?: number;
    framesConsidered?: number;
    frameBudget?: number;
    selectedFrameCount?: number;
    selectedTimestampsSeconds?: number[];
    selectionStrategy?: string;
    selectionDecisions?: Array<{ timestampSeconds: number; reason: string }>;
    baselineModel?: string;
    baselineResultClass?: string;
    baselineFrameCount?: number;
    baselineTimestampsSeconds?: number[];
    baselineTextContextCategories?: string[];
    model?: string;
    sentFrameCount?: number;
    sentTimestampsSeconds?: number[];
    latencyMs?: number;
    usage?: {
      inputTokens: number | null;
      cachedInputTokens: number | null;
      outputTokens: number | null;
      reasoningTokens: number | null;
      totalTokens: number | null;
    };
    estimatedCostUsd?: number | null;
  };
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
  /** The post-level geo aggregate, when mentions have already been built.
   *  Only its bounded country VERDICT is recorded — never the country string
   *  itself, keeping this row free of source content. */
  geoContext?: {
    countryStrength?: string;
    countrySource?: string;
    countryCandidates?: string[];
  } | null,
): RecognitionFunnel {
  const d =
    diagnosticsBag && typeof diagnosticsBag === 'object'
      ? (diagnosticsBag as Record<string, unknown>)
      : {};
  const count = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;

  const out: RecognitionFunnel = {};

  if (typeof d.analysisAttempted === 'boolean') {
    out.analysisAttempted = d.analysisAttempted;
  }

  const emitted = count(d.modelPlacesEmitted);
  const valid = count(d.modelPlacesValid);
  const rejected = count(d.modelPlacesRejected);
  const partialPreserved = count(d.modelPartialPlacesPreserved);
  if (emitted !== undefined) out.modelPlacesEmitted = emitted;
  if (valid !== undefined) out.modelPlacesValid = valid;
  if (rejected !== undefined) out.modelPlacesRejected = rejected;
  if (partialPreserved !== undefined) out.modelPartialPlacesPreserved = partialPreserved;
  const closedClasses = new Set([
    'canonical_evidence', 'partial_evidence', 'genuine_no_evidence', 'technical_failure',
    'ai_note_evidence', 'ai_note_insufficient', 'none', 'candidate_field_invalid',
    'model_schema_invalid', 'model_provider_failure', 'recovery_invalid', 'recovery_empty',
    'candidate_field_invalid', 'envelope_invalid', 'top_level_invalid',
  ]);
  if (typeof d.finalResultClass === 'string' && closedClasses.has(d.finalResultClass)) {
    out.finalResultClass = d.finalResultClass;
  }
  if (typeof d.recognitionFailureClass === 'string' && closedClasses.has(d.recognitionFailureClass)) {
    out.recognitionFailureClass = d.recognitionFailureClass;
  }
  if (typeof d.modelValidationErrorClass === 'string' && closedClasses.has(d.modelValidationErrorClass)) {
    out.modelValidationErrorClass = d.modelValidationErrorClass;
  }

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
    out.peerGeographicDestinations = geo.peerDestinations;
    if (geo.labels.length > 0) out.sourceGeographicContextLabels = geo.labels;
    out.destinationPlaces = Number.isInteger(renderablePlaces) && renderablePlaces >= 0
      ? renderablePlaces
      : 0;
  }

  if (geoContext && typeof geoContext.countryStrength === 'string') {
    out.sharedGeoCountryStrength = geoContext.countryStrength;
    out.sharedGeoCountryApplied = geoContext.countryStrength === 'strong';
    if (typeof geoContext.countrySource === 'string') {
      out.sharedGeoCountrySource = geoContext.countrySource;
    }
    if (Array.isArray(geoContext.countryCandidates)) {
      out.sharedGeoCountryCandidates = geoContext.countryCandidates.length;
    }
  }

  const rawVayrin = d.vayrin;
  if (rawVayrin && typeof rawVayrin === 'object' && (rawVayrin as Record<string, unknown>).invoked === true) {
    const v = rawVayrin as Record<string, unknown>;
    const finite = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
    const boundedString = (value: unknown, max = 100): string | undefined =>
      typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
    const timestamps = (value: unknown): number[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      const values = value
        .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item >= 0)
        .slice(0, 24);
      return values.length > 0 ? values : undefined;
    };
    const usageRaw = v.usage && typeof v.usage === 'object'
      ? v.usage as Record<string, unknown>
      : null;
    const nullableCount = (value: unknown): number | null => {
      const parsed = count(value);
      return parsed === undefined ? null : parsed;
    };
    const selectionDecisions = Array.isArray(v.selectionDecisions)
      ? v.selectionDecisions
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
          .map((item) => ({
            timestampSeconds: finite(item.timestampSeconds),
            reason: boundedString(item.reason, 64),
          }))
          .filter((item): item is { timestampSeconds: number; reason: string } =>
            item.timestampSeconds !== undefined && item.reason !== undefined)
          .slice(0, 24)
      : [];
    const baselineCategories = Array.isArray(v.baselineTextContextCategories)
      ? v.baselineTextContextCategories
          .filter((item): item is string => typeof item === 'string' && item.length > 0)
          .map((item) => item.slice(0, 48))
          .slice(0, 12)
      : [];

    out.vayrinInvocation = {
      invoked: true,
      ...(count(d.framesExtracted) !== undefined ? { framesExtracted: count(d.framesExtracted) } : {}),
      ...(count(d.framesConsidered ?? d.frameCount) !== undefined
        ? { framesConsidered: count(d.framesConsidered ?? d.frameCount) }
        : {}),
      ...(count(v.frameBudget) !== undefined ? { frameBudget: count(v.frameBudget) } : {}),
      ...(count(v.selectedFrameCount) !== undefined ? { selectedFrameCount: count(v.selectedFrameCount) } : {}),
      ...(timestamps(v.selectedTimestampsSeconds) ? { selectedTimestampsSeconds: timestamps(v.selectedTimestampsSeconds) } : {}),
      ...(boundedString(v.frameStrategy, 32) ? { selectionStrategy: boundedString(v.frameStrategy, 32) } : {}),
      ...(selectionDecisions.length > 0 ? { selectionDecisions } : {}),
      ...(boundedString(v.baselineModel) ? { baselineModel: boundedString(v.baselineModel) } : {}),
      ...(boundedString(v.baselineResultClass, 48) ? { baselineResultClass: boundedString(v.baselineResultClass, 48) } : {}),
      ...(count(v.baselineFrameCount) !== undefined ? { baselineFrameCount: count(v.baselineFrameCount) } : {}),
      ...(timestamps(v.baselineTimestampsSeconds) ? { baselineTimestampsSeconds: timestamps(v.baselineTimestampsSeconds) } : {}),
      ...(baselineCategories.length > 0 ? { baselineTextContextCategories: baselineCategories } : {}),
      ...(boundedString(v.model) ? { model: boundedString(v.model) } : {}),
      ...(count(v.sentFrameCount) !== undefined ? { sentFrameCount: count(v.sentFrameCount) } : {}),
      ...(timestamps(v.sentTimestampsSeconds) ? { sentTimestampsSeconds: timestamps(v.sentTimestampsSeconds) } : {}),
      ...(count(v.latencyMs) !== undefined ? { latencyMs: count(v.latencyMs) } : {}),
      ...(usageRaw
        ? {
            usage: {
              inputTokens: nullableCount(usageRaw.inputTokens),
              cachedInputTokens: nullableCount(usageRaw.cachedInputTokens),
              outputTokens: nullableCount(usageRaw.outputTokens),
              reasoningTokens: nullableCount(usageRaw.reasoningTokens),
              totalTokens: nullableCount(usageRaw.totalTokens),
            },
          }
        : {}),
      ...(v.estimatedCostUsd === null
        ? { estimatedCostUsd: null }
        : finite(v.estimatedCostUsd) !== undefined
        ? { estimatedCostUsd: finite(v.estimatedCostUsd) }
        : {}),
    };
  }
  return out;
}
