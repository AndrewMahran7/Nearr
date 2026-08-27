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
  raw_moment_count?: number;
  logical_place_count?: number;
  moments_merged?: number;
  moments_split?: number;
  grouping_reason_codes?: string[];
  same_place_confidence_band?: string;
  distinct_place_evidence_present?: boolean;
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
    hardPathEligible?: boolean;
    hardPathReason?: string;
    hardPathVersion?: string;
    hypothesisModel?: string;
    hypothesisFrameCount?: number;
    hypothesisCount?: number;
    topHypothesisNamePresent?: boolean;
    hypothesisGeoStrength?: string;
    rawFrames?: number;
    candidateFrames?: number;
    selectedFrames?: number;
    canonicalizationOutcome?: 'deferred_to_edge';
    canonicalPlacesCalls?: number;
    hardPathCost?: number | null;
    hardPathLatency?: number;
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

  const groupingCountFields = [
    'raw_moment_count', 'logical_place_count', 'moments_merged', 'moments_split',
  ] as const;
  for (const field of groupingCountFields) {
    const value = count(d[field]);
    if (value !== undefined) out[field] = value;
  }
  const groupingReasons = new Set([
    'same_logical_place_id', 'same_normalized_name', 'compatible_identity_name',
    'overlapping_candidate_ids', 'visual_anchor_overlap', 'explicit_transition',
    'travel_segment', 'different_city', 'different_region', 'different_country',
    'distinct_named_venues', 'incompatible_categories',
    'visually_incompatible_environment', 'conservative_unknown_merged',
  ]);
  if (Array.isArray(d.grouping_reason_codes)) {
    out.grouping_reason_codes = d.grouping_reason_codes
      .filter((value): value is string => typeof value === 'string' && groupingReasons.has(value))
      .slice(0, 16);
  }
  if (d.same_place_confidence_band === 'high' || d.same_place_confidence_band === 'medium' || d.same_place_confidence_band === 'none') {
    out.same_place_confidence_band = d.same_place_confidence_band;
  }
  if (typeof d.distinct_place_evidence_present === 'boolean') {
    out.distinct_place_evidence_present = d.distinct_place_evidence_present;
  }

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
      ...(typeof v.hardPathEligible === 'boolean' ? { hardPathEligible: v.hardPathEligible } : {}),
      ...(boundedString(v.hardPathReason, 64) ? { hardPathReason: boundedString(v.hardPathReason, 64) } : {}),
      ...(boundedString(v.hardPathVersion, 100) ? { hardPathVersion: boundedString(v.hardPathVersion, 100) } : {}),
      ...(boundedString(v.hypothesisModel, 100) ? { hypothesisModel: boundedString(v.hypothesisModel, 100) } : {}),
      ...(count(v.hypothesisFrameCount) !== undefined ? { hypothesisFrameCount: count(v.hypothesisFrameCount) } : {}),
      ...(count(v.hypothesisCount) !== undefined ? { hypothesisCount: count(v.hypothesisCount) } : {}),
      ...(typeof v.topHypothesisNamePresent === 'boolean' ? { topHypothesisNamePresent: v.topHypothesisNamePresent } : {}),
      ...(boundedString(v.hypothesisGeoStrength, 32) ? { hypothesisGeoStrength: boundedString(v.hypothesisGeoStrength, 32) } : {}),
      ...(count(v.rawFrames) !== undefined ? { rawFrames: count(v.rawFrames) } : {}),
      ...(count(v.candidateFrames) !== undefined ? { candidateFrames: count(v.candidateFrames) } : {}),
      ...(count(v.selectedFrames) !== undefined ? { selectedFrames: count(v.selectedFrames) } : {}),
      ...(v.canonicalizationOutcome === 'deferred_to_edge' ? { canonicalizationOutcome: 'deferred_to_edge' as const } : {}),
      ...(count(v.canonicalPlacesCalls) !== undefined ? { canonicalPlacesCalls: count(v.canonicalPlacesCalls) } : {}),
      ...(v.hardPathCost === null
        ? { hardPathCost: null }
        : finite(v.hardPathCost) !== undefined
        ? { hardPathCost: finite(v.hardPathCost) }
        : {}),
      ...(count(v.hardPathLatency) !== undefined ? { hardPathLatency: count(v.hardPathLatency) } : {}),
    };
  }
  return out;
}
