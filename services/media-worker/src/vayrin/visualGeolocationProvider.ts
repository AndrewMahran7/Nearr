// services/media-worker/src/vayrin/visualGeolocationProvider.ts
//
// Vayrin's strong-model FALLBACK, wired as a `ModelProvider` decorator.
//
// It wraps whichever provider is already configured (heuristic or gemini),
// always runs that one FIRST, and escalates to GPT-5.6 Sol only when the cheap
// pass failed to identify a specific place. That ordering is deliberate:
//
//   - the existing pass keeps handling every share it already handles, byte for
//     byte, so no working TikTok case changes behavior;
//   - the expensive call is spent only on the shares that are currently
//     failing, which is where the flagship experience actually lives;
//   - with the flag off, `analyze` is a pass-through and no OpenAI call is
//     constructed at all.
//
// This module maps hypotheses into the EXISTING `MediaPlaceEvidence` contract.
// It invents no new wire format, so everything downstream — the finalizer, the
// resolver, `safeToAutoSave`, `mediaEvidenceAutoSaveEligible`, the job routes —
// is unchanged and still has the final word. A Vayrin hypothesis is a proposal
// that gets verified, exactly like a Gemini one.

import type { WorkerConfig } from '../config/env.js';
import type { AnalyzeInput, AnalyzeOutput, ModelProvider } from '../providers/model.js';
import {
  emptyEvidence,
  type MediaPlaceEvidence,
  type PlaceCandidateEvidence,
  type EvidenceItem,
  type PartialPlaceEvidence,
} from '../types/evidence.js';
import { MediaError } from '../types/media.js';
import { log } from '../util/logger.js';
import {
  DEFAULT_VAYRIN_FRAME_BUDGET,
  selectFramesForVayrin,
  type FrameStrategy,
} from './frameSelection.js';
import {
  isRetryableFailure,
  runVisualGeolocation,
  estimateVayrinCostUsd,
  type VayrinHypothesisRaw,
  type VayrinOutsideCandidateProposalRaw,
  type VayrinPayload,
  type VayrinResult,
} from './visualGeolocationClient.js';
import { VAYRIN_PROMPT_VERSION } from './visualGeolocationPrompt.js';
import {
  detectStrongRegionEvidence,
  expandRegionToPoiCandidatesV3,
  type RegionPoiExpansionResult,
} from './regionPoiV3.js';
import {
  serializeCandidatesForVerificationV3,
  userFacingVerificationCandidates,
  verificationV3IdentityEvidenceKind,
  verifyRetrievedCandidatesV3,
  type CandidateVerificationRecord,
  type VerificationCandidate,
  type VerificationV3Result,
} from './verificationV3.js';
import { isCategoryOnlyPlaceName } from './placeIdentityGuard.js';

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

/** What the cheap pass produced, reduced to the fields the trigger needs. */
export type VayrinTriggerInput = {
  enabled: boolean;
  frameCount: number;
  /** The default provider said it had nothing. */
  insufficientEvidence: boolean;
  /** Places carrying at least one explicit evidence item. */
  explicitPlaceCount: number;
  /** Places whose only identity is an administrative label (city/region/
   *  country restated as the place name). Coarse geography, not a destination. */
  geographicOnlyPlaceCount: number;
  /** Explicit places whose phrase is only a category/scene description. */
  genericOnlyPlaceCount?: number;
  /** Review-only evidence already useful to ordinary Places/area recovery. */
  usefulPartialPlaceCount?: number;
  /** The cheap pass ended because extraction/validation broke, not because the
   * scene truthfully contained no evidence. */
  technicalFailure?: boolean;
};

export type VayrinTriggerResult = { run: boolean; reason: VayrinTriggerReason };

export type VayrinTriggerReason =
  | 'flag_disabled'
  | 'no_frames'
  | 'no_specific_place_identified'
  | 'only_coarse_geography'
  | 'only_generic_place_type'
  | 'partial_recovery_sufficient'
  | 'technical_output_recovery'
  | 'no_grounded_recovery_input'
  | 'cheap_pass_sufficient';

/**
 * Should the expensive visual pass run?
 *
 * The load-bearing case is `only_coarse_geography`. A post tagged "Los
 * Angeles, California" that produces a place literally named "Los Angeles" has
 * NOT been resolved — the specific-place problem is untouched and the share is
 * still eligible for the visual fallback. Treating the presence of a location
 * tag as resolution is the exact behaviour this feature exists to remove.
 */
export function shouldRunVayrinFallback(input: VayrinTriggerInput): VayrinTriggerResult {
  if (!input.enabled) return { run: false, reason: 'flag_disabled' };
  // No frames means no visual evidence to reason over. Nothing to escalate to.
  if (input.frameCount === 0) return { run: false, reason: 'no_frames' };

  // A grounded name/locality is already useful to the cheaper deterministic
  // Places/area ladder. Do not spend Sol merely to turn a review lead into a
  // more confident-looking model assertion.
  if ((input.usefulPartialPlaceCount ?? 0) > 0) {
    return { run: false, reason: 'partial_recovery_sufficient' };
  }

  if (input.technicalFailure) {
    return { run: true, reason: 'technical_output_recovery' };
  }

  if (input.insufficientEvidence || input.explicitPlaceCount === 0) {
    return { run: false, reason: 'no_grounded_recovery_input' };
  }

  // Every place the cheap pass found is administrative context.
  if (
    input.geographicOnlyPlaceCount > 0 &&
    input.geographicOnlyPlaceCount >= input.explicitPlaceCount
  ) {
    return { run: true, reason: 'only_coarse_geography' };
  }
  if ((input.genericOnlyPlaceCount ?? 0) > 0 &&
      (input.genericOnlyPlaceCount ?? 0) >= input.explicitPlaceCount) {
    return { run: true, reason: 'only_generic_place_type' };
  }

  return { run: false, reason: 'cheap_pass_sufficient' };
}

/** Whether a place's only identity is an administrative label it also claims as
 *  its own city/region/country. Mirrors the Deno-side
 *  `isGeographicContextOnlySource` predicate structurally — no gazetteer, no
 *  name list, just self-reference. */
export function isCoarseGeographicPlace(place: PlaceCandidateEvidence): boolean {
  const fold = (v: string | null | undefined) =>
    typeof v === 'string'
      ? v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      : '';
  const name = fold(place.name);
  if (!name) return false;
  return [place.city, place.region, place.country].some((v) => fold(v) === name);
}

function partialRecoveryField(place: NonNullable<MediaPlaceEvidence['partialPlaces']>[number]): string | null {
  const fold = (value: string) => value.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const value of [place.nameHint, place.city, place.region, place.country]) {
    if (!value) continue;
    const field = fold(value);
    if (field.length >= 3 && place.explicitEvidence.some((item) => fold(item.value).includes(field))) {
      return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hypothesis -> MediaPlaceEvidence
// ---------------------------------------------------------------------------

/** Model specificity levels that name an actual destination, as opposed to an
 *  area containing one. Only these may become a place Nearr tries to resolve. */
const SPECIFIC_LEVELS = new Set(['exact_location', 'venue', 'landmark', 'natural_feature']);

/** Conservative `place_type` -> Nearr category mapping. Deliberately partial:
 *  an unrecognized type maps to null, and the existing category pipeline fills
 *  it in from the verified Google result. Guessing here would put a model's
 *  free-text into a closed vocabulary it never agreed to. */
const CATEGORY_HINTS: Array<[RegExp, PlaceCandidateEvidence['category']]> = [
  [/\bbeach|shore|cove|sand\b/i, 'beach'],
  [/\bcliff|bluff|headland|viewpoint|overlook|lookout|scenic\b/i, 'scenic_spot'],
  [/\btrail|hike|hiking|trailhead\b/i, 'hiking_trail'],
  [/\bwaterfall|falls\b/i, 'waterfall'],
  [/\blake|lagoon|reservoir\b/i, 'lake'],
  [/\bisland|islet\b/i, 'island'],
  [/\bmarina|harbou?r|pier|dock\b/i, 'marina'],
  [/\bpark\b/i, 'park'],
  [/\bmuseum|gallery\b/i, 'museum'],
  [/\bhotel|hostel|inn\b/i, 'hotel'],
  [/\bresort\b/i, 'resort'],
  [/\bcaf[eé]|coffee\b/i, 'cafe'],
  [/\bbakery|patisserie\b/i, 'bakery'],
  [/\bbar|pub|cocktail\b/i, 'bar'],
  [/\bbrewery|taproom\b/i, 'brewery'],
  [/\bwinery|vineyard\b/i, 'winery'],
  [/\brestaurant|taqueria|trattoria|bistro|diner|eatery|steakhouse|sushi|ramen\b/i, 'restaurant'],
  [/\blandmark|monument|temple|shrine|church|cathedral|castle|fort\b/i, 'attraction'],
];

function categoryFor(placeType: string): PlaceCandidateEvidence['category'] {
  for (const [pattern, category] of CATEGORY_HINTS) {
    if (pattern.test(placeType)) return category;
  }
  return null;
}

function environmentFor(category: PlaceCandidateEvidence['category']): NonNullable<PlaceCandidateEvidence['sceneSignature']>['environmentType'] {
  if (category && ['beach', 'waterfall', 'lake', 'marina', 'island'].includes(category)) return 'natural_water';
  if (category && ['hiking_trail', 'park', 'scenic_spot'].includes(category)) return 'natural_land';
  if (category && ['restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert'].includes(category)) return 'food_venue';
  if (category === 'hotel' || category === 'resort') return 'lodging';
  if (category === 'museum' || category === 'education') return 'cultural';
  if (category === 'shopping') return 'retail';
  if (category === 'transportation') return 'transport';
  return 'unknown';
}

/**
 * Turn one hypothesis into a place.
 *
 * EVIDENCE SOURCING IS HONEST. Visual clues are emitted as `source: 'frame'`,
 * which is truthful (they are observations of a supplied frame) and which the
 * existing `groundClaimedEvidence` admits for exactly that reason. Textual
 * clues are emitted as `source: 'caption'` and are therefore CHECKED against
 * the real caption text by that same function — an unsupported textual claim is
 * dropped rather than trusted. Nothing here bypasses a grounding rule; the
 * clues are labelled with the source they actually came from and the existing
 * guard is left to judge them.
 */
export function hypothesisToPlace(
  hypothesis: VayrinHypothesisRaw,
  role: PlaceCandidateEvidence['role'],
  timestamps: number[] = [],
  logicalPlaceId: string | null = null,
  hypothesisRank = 0,
): PlaceCandidateEvidence | null {
  const name = hypothesis.name.trim();
  if (!name) return null;
  if (!SPECIFIC_LEVELS.has(hypothesis.specificity)) return null;
  if (isCategoryOnlyPlaceName(name)) return null;

  const firstTimestamp = timestamps.length > 0 ? timestamps[0]! : null;

  const explicitEvidence: EvidenceItem[] = hypothesis.supporting_visual_clues
    .slice(0, 8)
    .map((value) => ({ timestampSeconds: firstTimestamp, source: 'frame' as const, value }));

  for (const value of hypothesis.supporting_textual_clues.slice(0, 6)) {
    explicitEvidence.push({ timestampSeconds: firstTimestamp, source: 'caption', value });
  }

  // A hypothesis with no observable support is a bare assertion. The downstream
  // renderer drops explicit-evidence-free places anyway; refusing here keeps the
  // reason legible.
  if (explicitEvidence.length === 0) return null;

  const inferredEvidence: EvidenceItem[] = [];
  if (hypothesis.reasoning_summary) {
    inferredEvidence.push({
      timestampSeconds: firstTimestamp,
      source: 'frame',
      value: hypothesis.reasoning_summary,
    });
  }
  for (const value of hypothesis.conflicting_clues.slice(0, 4)) {
    inferredEvidence.push({ timestampSeconds: firstTimestamp, source: 'frame', value });
  }

  const category = categoryFor(hypothesis.place_type);
  return {
    logicalPlaceId,
    identityEvidenceKind:
      hypothesis.evidence_basis === 'contextual_or_memory_prior' ||
      hypothesis.evidence_basis === 'insufficient'
        ? 'model_prior'
        : 'observable',
    hypothesisRank,
    momentTimestamps: timestamps.slice(0, 24),
    sceneSignature: {
      environmentType: environmentFor(category),
      setting: 'unknown',
      visualAnchors: hypothesis.supporting_visual_clues.slice(0, 8),
      activity: null,
      regionClue: [hypothesis.city, hypothesis.region, hypothesis.country].filter(Boolean).join(', ') || null,
    },
    distinctPlaceSignals: [],
    name,
    entityType: hypothesis.entity_type ?? (
      hypothesis.specificity === 'natural_feature' ? 'NAMED_NATURAL_FEATURE' :
      hypothesis.specificity === 'landmark' ? 'LANDMARK' :
      hypothesis.specificity === 'city' ? 'CITY' :
      hypothesis.specificity === 'region' ? 'REGION' :
      hypothesis.specificity === 'country' ? 'COUNTRY' :
      hypothesis.specificity === 'venue' ? 'BUSINESS_OR_VENUE' : 'UNKNOWN'
    ),
    category,
    categoryConfidence: 0,
    categoryEvidenceTags: [],
    address: null, // never fabricated — Places supplies the address
    city: hypothesis.city,
    region: hypothesis.region,
    country: hypothesis.country,
    coordinates: null, // never trusted from a model; dropped downstream regardless
    role,
    confidence: hypothesis.confidence,
    explicitEvidence: explicitEvidence.slice(0, 24),
    inferredEvidence: inferredEvidence.slice(0, 24),
    memoryCue: null,
    memoryCueEvidence: [],
  };
}

function hypothesisToPartialPlace(
  hypothesis: VayrinHypothesisRaw,
  timestamps: number[] = [],
): PartialPlaceEvidence | null {
  const categoryOnly = isCategoryOnlyPlaceName(hypothesis.name);
  if (!categoryOnly && !['neighborhood', 'city', 'region', 'country'].includes(hypothesis.specificity)) return null;
  const firstTimestamp = timestamps[0] ?? null;
  const explicitEvidence: EvidenceItem[] = hypothesis.supporting_visual_clues.slice(0, 8)
    .map((value) => ({ timestampSeconds: firstTimestamp, source: 'frame' as const, value }));
  for (const value of hypothesis.supporting_textual_clues.slice(0, 6)) {
    explicitEvidence.push({ timestampSeconds: firstTimestamp, source: 'caption', value });
  }
  if (explicitEvidence.length === 0) return null;
  const areaName = hypothesis.name.trim() || null;
  return {
    // Area labels live in administrative fields, not canonical/search identity.
    nameHint: categoryOnly ? hypothesis.name.trim() || null : null,
    category: categoryFor(hypothesis.place_type),
    categoryConfidence: 0,
    categoryEvidenceTags: [],
    addressHint: null,
    city: hypothesis.city ?? (hypothesis.specificity === 'city' ? areaName : null),
    region: hypothesis.region ?? (hypothesis.specificity === 'region' ? areaName : null),
    country: hypothesis.country ?? (hypothesis.specificity === 'country' ? areaName : null),
    role: 'primary',
    confidence: hypothesis.confidence,
    explicitEvidence: explicitEvidence.slice(0, 24),
    validationErrors: ['vayrin_noncanonical_geography'],
  };
}

function hypothesisIdentityKey(hypothesis: VayrinHypothesisRaw): string {
  return [hypothesis.name, hypothesis.city, hypothesis.region, hypothesis.country]
    .map((value) => (value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ''))
    .join('::');
}

/** Keep model order while collapsing spelling/punctuation variants of the same
 * identity inside one scene. Distinct scenes are deduplicated independently. */
export function deduplicateSceneHypotheses(
  hypotheses: VayrinHypothesisRaw[],
): VayrinHypothesisRaw[] {
  const seen = new Set<string>();
  const out: VayrinHypothesisRaw[] = [];
  for (const hypothesis of hypotheses) {
    const key = hypothesisIdentityKey(hypothesis);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hypothesis);
  }
  return out;
}

/**
 * Map a full payload into evidence.
 *
 * MULTI-PLACE. One place is emitted per SCENE SEGMENT — the primary, then one
 * per entry in `additional_place_segments` — and `multipleIntentionalPlaces` is
 * set from the model's own scene judgement. Alternative hypotheses FOR THE SAME
 * place are deliberately NOT emitted as extra places: they are competing
 * answers to one question, and rendering them as siblings would make a single
 * uncertain restaurant look like a five-restaurant itinerary. They are returned
 * separately in `alternatives` so the decision layer can route them to a picker.
 */
export function payloadToEvidence(payload: VayrinPayload): {
  evidence: MediaPlaceEvidence;
  alternatives: VayrinHypothesisRaw[];
} {
  const places: PlaceCandidateEvidence[] = [];
  const partialPlaces: PartialPlaceEvidence[] = [];
  const alternatives: VayrinHypothesisRaw[] = [];

  const primaryHypotheses = deduplicateSceneHypotheses(payload.place_hypotheses);
  primaryHypotheses.forEach((hypothesis, rank) => {
    const place = hypothesisToPlace(
      hypothesis,
      'primary',
      [],
      'vayrin-scene-1',
      rank,
    );
    if (place) places.push(place);
    else {
      const partial = hypothesisToPartialPlace(hypothesis);
      if (partial) partialPlaces.push(partial);
      alternatives.push(hypothesis);
    }
  });

  for (let segmentIndex = 0; segmentIndex < payload.additional_place_segments.length; segmentIndex += 1) {
    const segment = payload.additional_place_segments[segmentIndex]!;
    const hypotheses = deduplicateSceneHypotheses(segment.hypotheses);
    hypotheses.forEach((hypothesis, rank) => {
      const place = hypothesisToPlace(
        hypothesis,
        places.length === 0 ? 'primary' : 'secondary',
        segment.frame_timestamps_seconds,
        `vayrin-scene-${segmentIndex + 2}`,
        rank,
      );
      if (place) places.push(place);
      else {
        const partial = hypothesisToPartialPlace(hypothesis, segment.frame_timestamps_seconds);
        if (partial) partialPlaces.push(partial);
        alternatives.push(hypothesis);
      }
    });
  }

  const warnings: string[] = ['vayrin_visual_geolocation'];
  if (payload.metadata_was_sufficient) warnings.push('vayrin_metadata_already_specific');

  return {
    evidence: {
      places: places.slice(0, 12),
      partialPlaces: partialPlaces.slice(0, 12),
      // Trust the model's scene judgement only when it is corroborated by more
      // than one place actually surviving the mapping. A `true` flag with one
      // place would make the finalizer expect siblings that do not exist.
      multipleIntentionalPlaces:
        payload.multiple_distinct_places_visible &&
        new Set(places.map((place) => place.logicalPlaceId)).size > 1,
      insufficientEvidence: places.length === 0 && partialPlaces.length === 0,
      warnings,
    },
    alternatives,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type VayrinProviderOptions = {
  enabled: boolean;
  model: string;
  frameBudget: number;
  frameStrategy: FrameStrategy;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  pricing: {
    inputPerMillion: number;
    cachedInputPerMillion: number;
    outputPerMillion: number;
  };
  verificationV3: {
    enabled: boolean;
    googlePlacesApiKey: string;
    regionPoiCandidateLimit: number;
  };
};

/** Bounded, secret-free diagnostics for one Vayrin escalation. */
export type VayrinDiagnostics = {
  invoked: boolean;
  triggerReason: VayrinTriggerReason;
  model?: string;
  promptVersion?: string;
  frameCount?: number;
  sentFrameCount?: number;
  sentTimestampsSeconds?: number[];
  framesConsidered?: number;
  frameBudget?: number;
  selectedFrameCount?: number;
  selectedTimestampsSeconds?: number[];
  selectionDecisions?: ReturnType<typeof selectFramesForVayrin>['decisions'];
  frameStrategy?: FrameStrategy;
  meanPairwiseDistance?: number;
  baselineModel?: string;
  baselineFrameCount?: number;
  baselineTimestampsSeconds?: number[];
  baselineTextContextCategories?: string[];
  baselineResultClass?: 'insufficient' | 'no_place' | 'coarse_geography' | 'explicit_place';
  latencyMs?: number;
  usage?: Record<string, number | null>;
  estimatedCostUsd?: number | null;
  hypothesisCount?: number;
  alternativeCount?: number;
  multipleDistinctPlaces?: boolean;
  failureCode?: string;
  verificationV3?: {
    enabled: boolean;
    regionDetected: boolean;
    regionLabel: string | null;
    placesExpansionInvoked: boolean;
    placesExternalCallCount: number;
    placesLatencyMs: number;
    placesFailureCode: RegionPoiExpansionResult['failureCode'];
    candidateCount: number;
    candidateNames: string[];
    evaluatedCount: number;
    missingEvaluationCount: number;
    outsideShortlistAllowed: boolean;
    records: CandidateVerificationRecord[];
    visionEnabled: false;
  };
};

function foldCandidateName(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\b(?:the|beach|cove|bay)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function verifiedCandidatePlace(
  candidate: VerificationCandidate,
  record: CandidateVerificationRecord,
): PlaceCandidateEvidence | null {
  if (isCategoryOnlyPlaceName(candidate.candidateName)) return null;
  const explicitEvidence: EvidenceItem[] = [];
  for (const claim of record.supportingEvidence) {
    if (claim.basis === 'visual') explicitEvidence.push({ timestampSeconds: null, source: 'frame', value: claim.statement });
    if (claim.basis === 'textual') explicitEvidence.push({ timestampSeconds: null, source: 'caption', value: claim.statement });
    if (explicitEvidence.length >= 12) break;
  }
  // UNKNOWN-only candidates stay in the explicit verification record, but are
  // not mislabeled as observable place evidence for the finalizer.
  if (explicitEvidence.length === 0) return null;
  const inferredEvidence: EvidenceItem[] = [
    ...record.unknownEvidence,
    ...record.contradictingEvidence,
  ].map((claim) => ({ timestampSeconds: null, source: 'frame' as const, value: claim.statement })).slice(0, 16);
  return {
    logicalPlaceId: 'vayrin-scene-1',
    // Reaching this mapper requires at least one explicit SUPPORTS claim.
    // That claim may identify a candidate for the ordinary Places resolver;
    // it does not itself authorize a save. UNKNOWN-only records return above,
    // and the downstream canonical identity / score / ambiguity gates remain
    // authoritative.
    identityEvidenceKind: verificationV3IdentityEvidenceKind(record),
    hypothesisRank: Math.max(0, (record.finalRank ?? record.initialRank) - 1),
    name: candidate.candidateName,
    category: categoryFor(candidate.category ?? candidate.candidateName),
    categoryConfidence: 0,
    categoryEvidenceTags: [],
    address: null,
    city: candidate.locality ?? null,
    region: null,
    country: candidate.country ?? null,
    coordinates: null,
    role: 'primary',
    confidence: Math.min(0.49, record.finalScore / 200),
    explicitEvidence,
    inferredEvidence,
    memoryCue: null,
    memoryCueEvidence: [],
  };
}

export function mergeVerificationV3Evidence(input: {
  mappedEvidence: MediaPlaceEvidence;
  candidates: readonly VerificationCandidate[];
  verification: VerificationV3Result;
  outsideProposals: readonly VayrinOutsideCandidateProposalRaw[];
}): MediaPlaceEvidence {
  if (input.candidates.length === 0) return input.mappedEvidence;
  const records = new Map(input.verification.records.map((record) => [record.candidateId, record]));
  const verifiedPlaces = userFacingVerificationCandidates(input.verification).flatMap((candidate) => {
    const record = records.get(candidate.candidateId);
    const place = record ? verifiedCandidatePlace(candidate, record) : null;
    return place ? [place] : [];
  });
  const outsidePlaces: PlaceCandidateEvidence[] = input.verification.outsideShortlistAllowed
    ? input.outsideProposals.filter((proposal) => !isCategoryOnlyPlaceName(proposal.placeName)).slice(0, 2).map((proposal, index) => ({
      logicalPlaceId: 'vayrin-scene-1',
      identityEvidenceKind: 'model_prior',
      hypothesisRank: index,
      name: proposal.placeName,
      category: categoryFor(proposal.placeName),
      categoryConfidence: 0,
      categoryEvidenceTags: [],
      address: null,
      city: null,
      region: null,
      country: null,
      coordinates: null,
      role: 'primary',
      confidence: 0.4,
      explicitEvidence: proposal.supportingEvidence.slice(0, 3)
        .map((value) => ({ timestampSeconds: null, source: 'frame' as const, value })),
      inferredEvidence: proposal.contradictingEvidence.slice(0, 3)
        .map((value) => ({ timestampSeconds: null, source: 'frame' as const, value })),
      memoryCue: null,
      memoryCueEvidence: [],
    }))
    : [];
  const places = [...outsidePlaces, ...verifiedPlaces].slice(0, 3)
    .map((place, index) => ({ ...place, hypothesisRank: index }));
  return {
    ...input.mappedEvidence,
    places,
    insufficientEvidence: places.length === 0,
    warnings: [...new Set([
      ...input.mappedEvidence.warnings,
      'vayrin_verification_v3',
      input.verification.outsideShortlistAllowed ? 'v3_outside_shortlist_allowed' : 'v3_ranked_within_shortlist',
    ])].slice(0, 24),
  };
}

export class VayrinFallbackModel implements ModelProvider {
  readonly name = 'vayrin';

  constructor(
    private readonly inner: ModelProvider,
    private readonly options: VayrinProviderOptions,
  ) {}

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const baseline = await this.inner.analyze(input);
    const usefulPartialPlaceCount = (baseline.evidence.partialPlaces ?? [])
      .filter((place) => partialRecoveryField(place) !== null).length;

    const trigger = shouldRunVayrinFallback({
      enabled: this.options.enabled,
      frameCount: input.frames.length,
      insufficientEvidence: baseline.evidence.insufficientEvidence,
      explicitPlaceCount: baseline.evidence.places.filter((p) => p.explicitEvidence.length > 0)
        .length,
      geographicOnlyPlaceCount: baseline.evidence.places.filter(isCoarseGeographicPlace).length,
      genericOnlyPlaceCount: baseline.evidence.places.filter((place) =>
        place.explicitEvidence.length > 0 && isCategoryOnlyPlaceName(place.name)).length,
      usefulPartialPlaceCount,
      technicalFailure: baseline.recognitionFailureClass !== undefined,
    });

    if (!trigger.run) {
      return {
        ...baseline,
        provider: `${this.inner.name}`,
        vayrin: { invoked: false, triggerReason: trigger.reason },
      } as AnalyzeOutput & { vayrin: VayrinDiagnostics };
    }

    const selection = selectFramesForVayrin(
      input.frames,
      this.options.frameStrategy,
      this.options.frameBudget,
    );

    const caption = [input.metadataTitle, input.metadataDescription].filter(Boolean).join('\n') || null;
    const partialRegions = (baseline.evidence.partialPlaces ?? []).flatMap((place) => {
      const grounded = partialRecoveryField(place);
      const name = [place.city, place.region, place.country].includes(grounded) ? grounded : null;
      return name ? [{ name, specificity: 'REGION' as const }] : [];
    });
    const region = detectStrongRegionEvidence({
      locationMetadata: input.metadataLocation,
      caption,
      coarseCandidates: baseline.evidence.places.filter(isCoarseGeographicPlace)
        .map((place) => ({ name: place.name, specificity: 'REGION' as const }))
        .concat(partialRegions),
    });
    const regionExpansion: RegionPoiExpansionResult = this.options.verificationV3.enabled
      ? await expandRegionToPoiCandidatesV3({
          apiKey: this.options.verificationV3.googlePlacesApiKey,
          region,
          sceneCategory:
            baseline.evidence.places[0]?.category ?? baseline.evidence.partialPlaces?.[0]?.category ?? null,
          signal: input.signal,
          maxCandidates: this.options.verificationV3.regionPoiCandidateLimit,
        })
      : { candidates: [], places: [], externalCallCount: 0, latencyMs: 0, failureCode: 'not_configured', confirmationOnly: true };
    const verificationCandidates = regionExpansion.candidates;

    log.info('sol_recovery_attempted', {
      reason: trigger.reason,
      frameCount: selection.frames.length,
      partialPlaceCount: baseline.evidence.partialPlaces?.length ?? 0,
      failureClass: baseline.recognitionFailureClass ?? 'none',
    });

    const result = await runVisualGeolocation({
      model: this.options.model,
      reasoningEffort: this.options.reasoningEffort,
      signal: input.signal,
      frames: selection.frames.map((f) => ({
        path: f.path,
        timestampSeconds: f.timestampSeconds,
      })),
      context: {
        platform: input.platform,
        caption,
        transcript: input.transcript.map((s) => `[${s.startSeconds.toFixed(1)}] ${s.text}`).join('\n'),
        visibleText: input.ocr.map((o) => o.text).join('\n'),
        visibleTextExtracted: input.ocrExtracted === true,
        locationMetadata: input.metadataLocation ?? null,
        retrievedCandidatesJson: verificationCandidates.length > 0
          ? serializeCandidatesForVerificationV3(verificationCandidates)
          : null,
      },
    });

    return this.merge(baseline, result, selection, trigger, input, region, regionExpansion, verificationCandidates);
  }

  private merge(
    baseline: AnalyzeOutput,
    result: VayrinResult,
    selection: ReturnType<typeof selectFramesForVayrin>,
    trigger: VayrinTriggerResult,
    input: AnalyzeInput,
    region: ReturnType<typeof detectStrongRegionEvidence>,
    regionExpansion: RegionPoiExpansionResult,
    verificationCandidates: VerificationCandidate[],
  ): AnalyzeOutput {
    const diagnostics: VayrinDiagnostics = {
      invoked: true,
      triggerReason: trigger.reason,
      model: result.model,
      promptVersion: result.promptVersion,
      frameCount: result.frameCount,
      sentFrameCount: result.sentFrameCount,
      sentTimestampsSeconds: result.sentTimestampsSeconds,
      framesConsidered: selection.consideredCount,
      frameBudget: this.options.frameBudget,
      selectedFrameCount: selection.frames.length,
      selectedTimestampsSeconds: selection.frames.map((frame) => frame.timestampSeconds),
      selectionDecisions: selection.decisions,
      frameStrategy: selection.strategy,
      meanPairwiseDistance: selection.meanPairwiseDistance,
      baselineModel: baseline.modelInput?.model ?? this.inner.name,
      baselineFrameCount: baseline.modelInput?.frameCount,
      baselineTimestampsSeconds: baseline.modelInput?.timestampsSeconds,
      baselineTextContextCategories: baseline.modelInput?.textContextCategories,
      baselineResultClass: baseline.evidence.insufficientEvidence
        ? 'insufficient'
        : baseline.evidence.places.length === 0
        ? 'no_place'
        : baseline.evidence.places.every(isCoarseGeographicPlace)
        ? 'coarse_geography'
        : 'explicit_place',
      latencyMs: result.latencyMs,
      verificationV3: {
        enabled: this.options.verificationV3.enabled,
        regionDetected: region.detected,
        regionLabel: region.label,
        placesExpansionInvoked: regionExpansion.externalCallCount > 0,
        placesExternalCallCount: regionExpansion.externalCallCount,
        placesLatencyMs: regionExpansion.latencyMs,
        placesFailureCode: regionExpansion.failureCode,
        candidateCount: verificationCandidates.length,
        candidateNames: verificationCandidates.map((candidate) => candidate.candidateName),
        evaluatedCount: 0,
        missingEvaluationCount: 0,
        outsideShortlistAllowed: false,
        records: [],
        visionEnabled: false,
      },
    };

    if (!result.ok) {
      diagnostics.failureCode = result.code;
      log.warn('vayrin_failed', {
        code: result.code,
        kind: result.kind,
        frameCount: result.frameCount,
        latencyMs: result.latencyMs,
      });

      // Only a genuinely transient provider fault becomes a retryable task
      // error. A malformed or refused answer degrades to the cheap pass's
      // result — the share still completes with whatever the baseline found,
      // which is never worse than not having tried.
      if (isRetryableFailure(result.kind) && input.signal.aborted === false) {
        throw new MediaError(
          result.code.includes('429') ? 'provider_rate_limited' : 'provider_unavailable',
          result.code,
          result.retryAfterSeconds ?? undefined,
        );
      }

      return {
        ...baseline,
        evidence: {
          ...baseline.evidence,
          warnings: [...baseline.evidence.warnings, result.code].slice(0, 24),
        },
        recognitionFailureClass: baseline.recognitionFailureClass ?? 'recovery_invalid',
        vayrin: diagnostics,
      } as AnalyzeOutput & { vayrin: VayrinDiagnostics };
    }

    const mapped = payloadToEvidence(result.payload);
    let evidence = mapped.evidence;
    const alternatives = mapped.alternatives;
    if (verificationCandidates.length > 0) {
      const verification = verifyRetrievedCandidatesV3({
        candidates: verificationCandidates,
        evaluations: result.payload.retrieved_candidate_evaluations ?? [],
      });
      evidence = mergeVerificationV3Evidence({
        mappedEvidence: mapped.evidence,
        candidates: verificationCandidates,
        verification,
        outsideProposals: result.payload.outside_candidate_proposals ?? [],
      });
      diagnostics.verificationV3 = {
        ...diagnostics.verificationV3!,
        evaluatedCount: verification.records.length,
        missingEvaluationCount: verification.missingEvaluationCount,
        outsideShortlistAllowed: verification.outsideShortlistAllowed,
        records: verification.records,
      };
    }
    diagnostics.usage = { ...result.usage };
    diagnostics.estimatedCostUsd = estimateVayrinCostUsd(result.usage, this.options.pricing);
    diagnostics.hypothesisCount = evidence.places.length;
    diagnostics.alternativeCount = alternatives.length + Math.max(
      0,
      evidence.places.length - new Set(evidence.places.map((place) => place.logicalPlaceId)).size,
    );
    diagnostics.multipleDistinctPlaces = evidence.multipleIntentionalPlaces;

    if (evidence.places.length === 0 && (evidence.partialPlaces?.length ?? 0) > 0) {
      const partialPlaces = [
        ...(baseline.evidence.partialPlaces ?? []),
        ...(evidence.partialPlaces ?? []),
      ].slice(0, 12);
      log.info('sol_recovery_completed', {
        resultClass: 'partial_evidence',
        hypothesisCount: 0,
        partialPlaceCount: partialPlaces.length,
      });
      return {
        provider: `${this.inner.name}+vayrin`,
        promptVersion: `${baseline.promptVersion}+${VAYRIN_PROMPT_VERSION}`,
        evidence: {
          ...baseline.evidence,
          partialPlaces,
          insufficientEvidence: false,
          warnings: [...baseline.evidence.warnings, ...evidence.warnings].slice(0, 24),
        },
        modelRawPreview: result.rawPreview,
        // Keep the baseline technical class until the outer grounding pass
        // confirms this partial evidence survives. A surviving partial wins in
        // the final classifier; an ungrounded one must not turn technical
        // extraction failure into apparent evidence exhaustion.
        recognitionFailureClass: baseline.recognitionFailureClass,
        vayrin: diagnostics,
      } as AnalyzeOutput & { vayrin: VayrinDiagnostics };
    }

    // The visual pass found nothing specific either. Keep the baseline rather
    // than replacing a real (if coarse) answer with an empty one.
    if (evidence.places.length === 0) {
      log.info('sol_recovery_completed', {
        resultClass: (baseline.evidence.partialPlaces?.length ?? 0) > 0 ? 'partial_evidence' : 'empty',
        hypothesisCount: 0,
      });
      return {
        ...baseline,
        evidence: {
          ...baseline.evidence,
          warnings: [...baseline.evidence.warnings, 'vayrin_no_hypotheses'].slice(0, 24),
        },
        recognitionFailureClass: baseline.recognitionFailureClass ?? 'recovery_empty',
        vayrin: diagnostics,
      } as AnalyzeOutput & { vayrin: VayrinDiagnostics };
    }

    log.info('sol_recovery_completed', {
      resultClass: 'canonical_evidence',
      hypothesisCount: evidence.places.length,
    });
    return {
      provider: `${this.inner.name}+vayrin`,
      promptVersion: `${baseline.promptVersion}+${VAYRIN_PROMPT_VERSION}`,
      evidence: {
        ...evidence,
        warnings: [...baseline.evidence.warnings, ...evidence.warnings].slice(0, 24),
      },
      modelRawPreview: result.rawPreview,
      recognitionFailureClass: undefined,
      vayrin: diagnostics,
    } as AnalyzeOutput & { vayrin: VayrinDiagnostics };
  }
}

/** Wrap a provider with the Vayrin fallback. Returns the provider UNCHANGED
 *  when the flag is off, so a disabled build cannot construct an OpenAI call
 *  even by accident. */
export function withVayrinFallback(inner: ModelProvider, cfg: WorkerConfig): ModelProvider {
  if (!cfg.vayrinVisualGeolocationEnabled) return inner;
  return new VayrinFallbackModel(inner, {
    enabled: true,
    model: cfg.vayrinModel,
    frameBudget: Math.min(cfg.vayrinFrameBudget || DEFAULT_VAYRIN_FRAME_BUDGET, cfg.maxSelectedFrames),
    frameStrategy: cfg.vayrinFrameStrategy,
    reasoningEffort: cfg.vayrinReasoningEffort,
    pricing: {
      inputPerMillion: cfg.vayrinInputPricePerMillion,
      cachedInputPerMillion: cfg.vayrinCachedInputPricePerMillion,
      outputPerMillion: cfg.vayrinOutputPricePerMillion,
    },
    verificationV3: {
      enabled: cfg.vayrinVerificationV3Enabled === true,
      googlePlacesApiKey: cfg.googlePlacesServerApiKey ?? '',
      regionPoiCandidateLimit: Math.min(8, cfg.vayrinRegionPoiCandidateLimit ?? 8),
    },
  });
}
