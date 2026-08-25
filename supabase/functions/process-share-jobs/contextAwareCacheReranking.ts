/**
 * Recognition-cache candidate sets are recognition evidence, not a frozen UI
 * order. This adapter rebuilds the strongest privacy-safe context that survived
 * in the bounded cache payload and delegates presentation ordering to the same
 * shared ranker used by fresh Places results.
 *
 * Pure by design: no provider, Places, database, media, or model calls.
 */

import {
  MAX_VISIBLE_CONTEXTUAL_CANDIDATES,
  geographicFieldsFromLabel,
  rankContextAwareCandidates,
  type NearbyResolvedMention,
  type PlacesResolutionContext,
  type ResolutionEvidenceSource,
} from '../../../lib/contextAwarePlacesResolution.ts';
import {
  normalizeMentionSlots,
  normalizeResultCandidates,
  type ShareJobMentionSlot,
  type ShareJobResultCandidate,
} from '../../../lib/shareJobResult.ts';
import { evaluateMetadataAutoSave } from './metadataAutoSaveGate.ts';

export const CACHE_CANDIDATE_RANKING_POLICY = 'rerank_on_every_candidate_set_hit';

type JsonObject = Record<string, unknown>;

export type CachedCandidateRerankResult = {
  payload: JsonObject;
  applied: true;
  contextAvailable: boolean;
  contextSourceKind: ResolutionEvidenceSource;
  candidateCountBeforeRerank: number;
  candidateCountAfterRerank: number;
  placesCallCount: 0;
  rankingPolicy: typeof CACHE_CANDIDATE_RANKING_POLICY;
};

export type CachedSingletonAutoSaveDecision = {
  eligible: boolean;
  candidate: JsonObject | null;
  selectedProviderId: string | null;
  viableCandidateCount: number;
  reason: string;
  qualityReason: string | null;
};

type ReconstructedContext = {
  context: PlacesResolutionContext;
  sourceKind: ResolutionEvidenceSource;
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function rawCandidates(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(object).filter((item): item is JsonObject => !!item)
    : [];
}

function normalizedReason(value: unknown): string | null {
  const reason = text(value);
  return reason && [
    'exact_source_evidence',
    'source_locality',
    'source_region',
    'source_country',
    'near_resolved_video_place',
    'video_geo_hint',
    'user_proximity',
    'no_geographic_context',
  ].includes(reason) ? reason : null;
}

function bestContextLabel(candidates: readonly ShareJobResultCandidate[], fallback?: unknown): string | null {
  return text(fallback) ?? candidates.map((candidate) => text(candidate.contextLabel)).find(Boolean) ?? null;
}

function sourceKindFor(
  candidates: readonly ShareJobResultCandidate[],
  label: string | null,
  nearbyResolvedMentions: readonly NearbyResolvedMention[],
): ResolutionEvidenceSource {
  const reasons = candidates.map((candidate) => normalizedReason(candidate.contextReason));
  if (reasons.includes('exact_source_evidence')) return 'exact_source_evidence';
  if (reasons.includes('video_geo_hint') || reasons.includes('source_locality') ||
      reasons.includes('source_region') || reasons.includes('source_country') || label) {
    return 'video_region';
  }
  if (nearbyResolvedMentions.length > 0 || reasons.includes('near_resolved_video_place')) {
    return 'nearby_resolved_video_place';
  }
  if (reasons.includes('user_proximity')) return 'user_location';
  return 'none';
}

function explicitContext(value: unknown): ReconstructedContext | null {
  const raw = object(value);
  if (!raw) return null;
  const lat = finite(object(raw.coordinates)?.lat);
  const lng = finite(object(raw.coordinates)?.lng);
  const source = text(raw.sourceKind);
  const sourceKind: ResolutionEvidenceSource = source && [
    'exact_source_evidence', 'video_region', 'nearby_resolved_video_place',
    'creator_caption_geo', 'user_location', 'none',
  ].includes(source) ? source as ResolutionEvidenceSource : 'none';
  const locality = text(raw.locality);
  const region = text(raw.region);
  const country = text(raw.country);
  if (lat == null && lng == null && !locality && !region && !country) return null;
  return {
    sourceKind,
    context: {
      mode: 'source',
      inferredLocality: locality,
      inferredRegion: region,
      inferredCountry: country,
      inferredCoordinates: lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { lat, lng }
        : null,
      regionConfidence: raw.confidence === 'exact' || raw.confidence === 'strong'
        ? raw.confidence
        : 'strong',
      sourceEvidence: sourceKind === 'none' ? [] : [sourceKind],
    },
  };
}

function reconstructContext(args: {
  candidates: readonly ShareJobResultCandidate[];
  explicitContext?: unknown;
  contextLabel?: unknown;
  mentionTimestamp?: number | null;
  nearbyResolvedMentions?: readonly NearbyResolvedMention[];
}): ReconstructedContext {
  const explicit = explicitContext(args.explicitContext);
  if (explicit) {
    return {
      sourceKind: explicit.sourceKind,
      context: {
        ...explicit.context,
        mentionTimestamp: args.mentionTimestamp ?? null,
        nearbyResolvedMentions: [...(args.nearbyResolvedMentions ?? [])],
      },
    };
  }
  const nearbyResolvedMentions = [...(args.nearbyResolvedMentions ?? [])];
  const label = bestContextLabel(args.candidates, args.contextLabel);
  const fields = geographicFieldsFromLabel(label);
  const sourceKind = sourceKindFor(args.candidates, label, nearbyResolvedMentions);
  const hasSourceLabel = sourceKind !== 'none' && sourceKind !== 'user_location' && !!label;
  return {
    sourceKind,
    context: {
      mode: 'source',
      inferredLocality: hasSourceLabel ? fields.locality : null,
      inferredRegion: hasSourceLabel ? fields.region : null,
      inferredCountry: hasSourceLabel ? fields.country : null,
      regionConfidence: hasSourceLabel ? 'strong' : 'none',
      sourceEvidence: sourceKind === 'none' ? [] : [sourceKind],
      mentionTimestamp: args.mentionTimestamp ?? null,
      nearbyResolvedMentions,
    },
  };
}

function queryFor(candidates: readonly ShareJobResultCandidate[], preferred?: unknown): string {
  return text(preferred) ?? candidates[0]?.name ?? '';
}

function rerankCandidateArray(args: {
  raw: unknown;
  explicitContext?: unknown;
  query?: unknown;
  contextLabel?: unknown;
  mentionTimestamp?: number | null;
  nearbyResolvedMentions?: readonly NearbyResolvedMention[];
}): {
  candidates: JsonObject[];
  contextAvailable: boolean;
  contextSourceKind: ResolutionEvidenceSource;
  before: number;
} {
  const raw = rawCandidates(args.raw);
  const normalized = normalizeResultCandidates(raw);
  const originals = new Map<string, JsonObject>();
  for (const candidate of raw) {
    const id = text(candidate.googlePlaceId);
    if (id && !originals.has(id)) originals.set(id, candidate);
  }
  const reconstructed = reconstructContext({
    candidates: normalized,
    explicitContext: args.explicitContext,
    contextLabel: args.contextLabel,
    mentionTimestamp: args.mentionTimestamp,
    nearbyResolvedMentions: args.nearbyResolvedMentions,
  });
  const ranking = rankContextAwareCandidates({
    query: queryFor(normalized, args.query),
    candidates: normalized,
    context: reconstructed.context,
    placesCallCount: 0,
  });
  const candidates = ranking.visible.map((item, index) => ({
    ...(originals.get(item.candidate.googlePlaceId) ?? item.candidate),
    ...item.metadata,
    presentationRank: index + 1,
  }));
  return {
    candidates,
    contextAvailable: ranking.telemetry.contextAvailable,
    contextSourceKind: reconstructed.sourceKind,
    before: normalized.length,
  };
}

function localityFromCandidate(candidate: ShareJobResultCandidate): {
  locality: string | null;
  region: string | null;
  country: string | null;
} {
  return geographicFieldsFromLabel(candidate.formattedAddress);
}

/** Only verified sibling slots are geographic evidence for another mention. */
function siblingContext(slots: readonly ShareJobMentionSlot[], targetMentionId: string): NearbyResolvedMention[] {
  const result: NearbyResolvedMention[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (slot.mentionId === targetMentionId || slot.outcome !== 'verified_single') continue;
    const candidate = slot.candidates[0];
    if (!candidate || seen.has(candidate.googlePlaceId)) continue;
    const lat = finite(candidate.latitude);
    const lng = finite(candidate.longitude);
    if (lat == null || lng == null) continue;
    seen.add(candidate.googlePlaceId);
    const geo = localityFromCandidate(candidate);
    result.push({
      googlePlaceId: candidate.googlePlaceId,
      name: candidate.name,
      coordinates: { lat, lng },
      locality: geo.locality,
      region: geo.region,
      country: geo.country,
      mentionTimestamp: slot.sourceTimestamps?.[0] ?? null,
    });
  }
  return result;
}

/**
 * Build the presentation payload for a CANDIDATE_SET hit. The returned payload
 * is intentionally for the share job only; callers must not write its top-3
 * presentation projection back over the full recognition cache row.
 */
export function rerankCachedCandidatePayload(payload: unknown): CachedCandidateRerankResult | null {
  const input = object(payload);
  if (!input) return null;
  const aggregate = normalizeResultCandidates(input.candidates);
  if (aggregate.length === 0) return null;
  const slots = normalizeMentionSlots(input.mentionSlots);
  const rawSlots = rawCandidates(input.mentionSlots);
  const rerankedSlots = slots.map((slot) => {
    const rawSlot = rawSlots.find((item) => text(item.mentionId) === slot.mentionId);
    const ranked = rerankCandidateArray({
      raw: slot.candidates,
      explicitContext: rawSlot?.recognitionContext ?? input.recognitionContext,
      query: slot.primaryVenueName ?? slot.displayName,
      contextLabel: slot.contextLabel,
      mentionTimestamp: slot.sourceTimestamps?.[0] ?? null,
      nearbyResolvedMentions: siblingContext(slots, slot.mentionId),
    });
    return { ...slot, candidates: ranked.candidates };
  });

  const slotSources = rerankedSlots.map((slot) => {
    const original = slots.find((item) => item.mentionId === slot.mentionId)!;
    return reconstructContext({
      candidates: original.candidates,
      explicitContext: rawSlots.find((item) => text(item.mentionId) === original.mentionId)?.recognitionContext ??
        input.recognitionContext,
      contextLabel: original.contextLabel,
      mentionTimestamp: original.sourceTimestamps?.[0] ?? null,
      nearbyResolvedMentions: siblingContext(slots, original.mentionId),
    }).sourceKind;
  });
  const priority: ResolutionEvidenceSource[] = [
    'exact_source_evidence', 'video_region', 'nearby_resolved_video_place',
    'creator_caption_geo', 'user_location', 'none',
  ];
  const singleSlot = slots.length === 1 ? slots[0] : null;
  const multiIndependent = input.selectionMode === 'multi_independent' && rerankedSlots.length > 0;
  const aggregateRanking = multiIndependent
    ? null
    : rerankCandidateArray({
        raw: input.candidates,
        explicitContext: input.recognitionContext,
        query: singleSlot?.primaryVenueName ?? singleSlot?.displayName,
        contextLabel: singleSlot?.contextLabel,
        mentionTimestamp: singleSlot?.sourceTimestamps?.[0] ?? null,
        nearbyResolvedMentions: singleSlot ? siblingContext(slots, singleSlot.mentionId) : [],
      });
  const aggregateCandidates = aggregateRanking
    ? aggregateRanking.candidates
    : (() => {
        const seen = new Set<string>();
        const candidates: JsonObject[] = [];
        for (const slot of rerankedSlots) {
          for (const candidate of rawCandidates(slot.candidates)) {
            const id = text(candidate.googlePlaceId);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            candidates.push(candidate);
            if (candidates.length === 10) return candidates;
          }
        }
        return candidates;
      })();
  const sourceKinds = [aggregateRanking?.contextSourceKind ?? 'none', ...slotSources];
  const contextSourceKind = priority.find((kind) => sourceKinds.includes(kind)) ?? 'none';
  const contextAvailable = (aggregateRanking?.contextAvailable ?? false) || contextSourceKind !== 'none';

  return {
    payload: {
      ...input,
      candidates: aggregateCandidates,
      ...(slots.length > 0 ? { mentionSlots: rerankedSlots } : {}),
      presentationRanking: {
        policy: CACHE_CANDIDATE_RANKING_POLICY,
        applied: true,
        contextAvailable,
        contextSourceKind,
        placesCallCount: 0,
      },
    },
    applied: true,
    contextAvailable,
    contextSourceKind,
    candidateCountBeforeRerank: aggregate.length,
    candidateCountAfterRerank: aggregateCandidates.length,
    placesCallCount: 0,
    rankingPolicy: CACHE_CANDIDATE_RANKING_POLICY,
  };
}

/**
 * A CANDIDATE_SET row is never trusted merely because only one row survived.
 * It may become saveable only after this request reconstructs non-user source
 * context and the provider identity independently passes the same canonical
 * singleton gate as a fresh metadata resolution.
 */
export function evaluateCachedSingletonAutoSave(
  reranked: CachedCandidateRerankResult,
): CachedSingletonAutoSaveDecision {
  const payload = object(reranked.payload);
  const candidates = rawCandidates(payload?.candidates);
  const slots = normalizeMentionSlots(payload?.mentionSlots);
  const rawSlots = rawCandidates(payload?.mentionSlots);
  const multi = payload?.selectionMode === 'multi_independent' || slots.length > 1;
  if (multi) {
    return {
      eligible: false,
      candidate: null,
      selectedProviderId: null,
      viableCandidateCount: 0,
      reason: 'multi_identity_payload',
      qualityReason: null,
    };
  }
  const contextObjects = [object(payload?.recognitionContext), ...rawSlots.map((slot) => object(slot.recognitionContext))]
    .filter((value): value is JsonObject => !!value);
  const hasConcreteSourceContext = contextObjects.some((context) => {
    const coordinates = object(context.coordinates);
    return !!text(context.locality) || !!text(context.region) || !!text(context.country) ||
      (finite(coordinates?.lat) != null && finite(coordinates?.lng) != null);
  }) || slots.some((slot) => !!text(slot.contextLabel)) || candidates.some((candidate) => !!text(candidate.contextLabel));
  if (!reranked.contextAvailable || !hasConcreteSourceContext || reranked.contextSourceKind === 'none' ||
      reranked.contextSourceKind === 'user_location') {
    return {
      eligible: false,
      candidate: null,
      selectedProviderId: null,
      viableCandidateCount: 0,
      reason: 'independent_source_context_missing',
      qualityReason: null,
    };
  }

  const quality = evaluateMetadataAutoSave({
    result: { candidates },
    evidence: {},
  });
  const selectedProviderId = quality.viableCandidateCount === 1
    ? quality.viableProviderIds[0] ?? null
    : null;
  const candidate = selectedProviderId
    ? candidates.find((item) => text(item.googlePlaceId) === selectedProviderId) ?? null
    : null;
  const eligible = quality.eligible && !!candidate;
  return {
    eligible,
    candidate: eligible ? candidate : null,
    selectedProviderId,
    viableCandidateCount: quality.viableCandidateCount,
    reason: eligible ? 'single_viable_contextual_candidate' : quality.reasonCodes[0] ?? 'quality_gate_blocked',
    qualityReason: quality.independentQualityReason,
  };
}

/** Cache-only contract: retain the complete recognition set and its retrieval order. */
export function candidateSetForRecognitionCache(payload: unknown): unknown {
  const input = object(payload);
  if (!input) return payload;
  const withRanks = (value: unknown): JsonObject[] => rawCandidates(value).map((candidate, index) => ({
    ...candidate,
    retrievalRank: finite(candidate.retrievalRank) ?? index + 1,
  }));
  const slots = rawCandidates(input.mentionSlots).map((slot) => ({
    ...slot,
    candidates: withRanks(slot.candidates),
  }));
  return {
    ...input,
    candidates: withRanks(input.candidates),
    ...(Array.isArray(input.mentionSlots) ? { mentionSlots: slots } : {}),
  };
}

export function cacheCandidateVisibleLimit(): number {
  return MAX_VISIBLE_CONTEXTUAL_CANDIDATES;
}
