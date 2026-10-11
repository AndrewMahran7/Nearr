/**
 * Pure finalization decisions shared by the Edge callback and local evaluation.
 * Deliberately preserves the three existing media lanes, including their different
 * authorization gates. Provider calls, claim fences, retries and writes stay outside.
 */
import { buildShareJobCandidatePayload } from '../../../lib/shareJobResult.ts';
import { nativeNearrPlaceId, planAutomaticCompletion } from '../../../lib/automaticCompletion.ts';
import { evaluateGeographyAutoSave, type SourceGeographyEvidence } from '../../../lib/geographyConsistency.ts';
import { extractHandles } from '../process-share-link/evidence/handleExtraction.ts';
import { extractEvidence } from '../process-share-link/evidence/extractEvidence.ts';
import type { SourcePlatform } from '../process-share-link/types.ts';
import { buildVenueMentions, type BuildMentionsResult } from './mediaMentions.ts';
import { mergeMediaCaption, type MediaSourceMetadata } from './mediaSourceMetadata.ts';
import { renderMediaEvidenceCaption, mediaEvidenceExactIdentityStrength, mediaEvidenceAutoSaveEligible,
  type MediaPlaceEvidence, type RenderedCaption } from './mediaEvidence.ts';
import { evaluateMediaAutoSave, MEDIA_AUTO_SAVE_RULE_VERSION } from './mediaAutoSaveGate.ts';
import { planFromResolverDecision } from './decisionMapping.ts';
import { planPostResolve } from './mediaFinalizePlan.ts';
import { evaluateLegacyCandidateIdentity } from './adaptiveLegacyIdentity.ts';

export function safeCandidate(c: any, aiNote: string | null = null) {
  const roleLimited = Array.isArray(c.reasons) && c.reasons.some((reason: unknown) =>
    reason === 'ambiguous_entity_text_only' || reason === 'non_location_entity_text_only'
  );
  return {
    googlePlaceId: c.googlePlaceId,
    name: c.name,
    formattedAddress: c.formattedAddress ?? null,
    latitude: typeof c.latitude === 'number' ? c.latitude : null,
    longitude: typeof c.longitude === 'number' ? c.longitude : null,
    types: Array.isArray(c.types) ? c.types.slice(0, 8) : [],
    primaryType: typeof c.primaryType === 'string' ? c.primaryType : null,
    primaryTypeDisplayName: typeof c.primaryTypeDisplayName === 'string' ? c.primaryTypeDisplayName : null,
    googleMapsTypeLabel: typeof c.googleMapsTypeLabel === 'string' ? c.googleMapsTypeLabel : null,
    shortFormattedAddress: typeof c.shortFormattedAddress === 'string' ? c.shortFormattedAddress : null,
    businessStatus: typeof c.businessStatus === 'string' ? c.businessStatus : null,
    matchScore: typeof c.confidenceScore === 'number'
      ? c.confidenceScore
      : typeof c.matchScore === 'number'
      ? c.matchScore
      : null,
    evidence: Array.isArray(c.evidence) ? c.evidence.filter((value: unknown) => typeof value === 'string').slice(0, 12) : [],
    reasons: Array.isArray(c.reasons) ? c.reasons.filter((value: unknown) => typeof value === 'string').slice(0, 12) : [],
    matchStrength: roleLimited ? 'low' : (['high', 'medium', 'low'].includes(c.matchStrength) ? c.matchStrength : null),
    discoveryOnly: roleLimited || c.discoveryOnly === true,
    provenance: roleLimited ? { identityEvidence: [] } : c.provenance ?? null,
    contextReason: typeof c.contextReason === 'string' ? c.contextReason : null,
    contextLabel: typeof c.contextLabel === 'string' ? c.contextLabel : null,
    distanceKm: typeof c.distanceKm === 'number' && Number.isFinite(c.distanceKm)
      ? Math.max(0, Math.round(c.distanceKm * 10) / 10)
      : null,
    localityMatch: c.localityMatch === true,
    wideningTierKm: c.wideningTierKm === 25 || c.wideningTierKm === 75 || c.wideningTierKm === 200
      ? c.wideningTierKm
      : null,
    aiNote,
  };
}

function premiumRuntimeCandidate(hypothesis: any): any | null {
  const canonical = hypothesis?.canonical;
  if (!canonical || typeof canonical !== 'object') return null;
  const googlePlaceId = typeof canonical.googlePlaceId === 'string' ? canonical.googlePlaceId.trim() : '';
  const name = typeof canonical.name === 'string' ? canonical.name.trim() : '';
  if (!googlePlaceId || !name) return null;
  return safeCandidate({
    googlePlaceId,
    name,
    formattedAddress: typeof canonical.formattedAddress === 'string' ? canonical.formattedAddress : null,
    latitude: typeof canonical.latitude === 'number' && Number.isFinite(canonical.latitude) ? canonical.latitude : null,
    longitude: typeof canonical.longitude === 'number' && Number.isFinite(canonical.longitude) ? canonical.longitude : null,
    types: Array.isArray(canonical.types) ? canonical.types : [],
    primaryType: Array.isArray(canonical.types) && typeof canonical.types[0] === 'string' ? canonical.types[0] : null,
    confidenceScore: hypothesis.confidence === 'HIGH' ? 0.9 : hypothesis.confidence === 'MEDIUM' ? 0.65 : 0.35,
    evidence: Array.isArray(hypothesis.supportingClues) ? hypothesis.supportingClues : [],
    reasons: [hypothesis.evidenceBasis, hypothesis.canonicalStatus].filter(Boolean),
    contextLabel: [hypothesis.city, hypothesis.region, hypothesis.country].filter(Boolean).join(', ') || null,
  });
}

export function premiumRuntimePlan(value: any): null | {
  outcome: string;
  chargeability: string;
  autoSaveCandidate: any | null;
  candidatePayload: any;
  suggestedQuery: string | null;
  costs: Record<string, unknown>;
  rankedCandidates: any[];
} {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.destinations)) return null;
  const slots: any[] = [];
  const aggregate: any[] = [];
  const rankedCandidates: any[] = [];
  for (const [destinationIndex, destination] of value.destinations.slice(0, 10).entries()) {
    if (!destination || !Array.isArray(destination.hypotheses) || destination.hypotheses.length === 0) continue;
    const hypotheses = destination.hypotheses.slice(0, 3);
    for (const hypothesis of hypotheses) {
      const canonical = hypothesis?.canonical && typeof hypothesis.canonical === 'object'
        ? hypothesis.canonical
        : null;
      const providerParent = hypothesis?.providerParent && typeof hypothesis.providerParent === 'object'
        ? hypothesis.providerParent
        : null;
      const name = typeof hypothesis?.name === 'string' ? hypothesis.name.trim() : '';
      if (!name) continue;
      rankedCandidates.push({
        rank: rankedCandidates.length + 1,
        name: name.slice(0, 200),
        locality: typeof hypothesis?.city === 'string' ? hypothesis.city.slice(0, 120) : null,
        region: typeof hypothesis?.region === 'string' ? hypothesis.region.slice(0, 120) : null,
        country: typeof hypothesis?.country === 'string' ? hypothesis.country.slice(0, 120) : null,
        latitude: typeof canonical?.latitude === 'number' ? canonical.latitude
          : typeof providerParent?.latitude === 'number' ? providerParent.latitude : null,
        longitude: typeof canonical?.longitude === 'number' ? canonical.longitude
          : typeof providerParent?.longitude === 'number' ? providerParent.longitude : null,
        canonicalPlaceId: typeof canonical?.googlePlaceId === 'string' ? canonical.googlePlaceId : null,
        providerParent: providerParent && typeof providerParent.googlePlaceId === 'string' && typeof providerParent.name === 'string'
          ? {
              name: providerParent.name.slice(0, 200),
              placeId: providerParent.googlePlaceId.slice(0, 200),
              formattedAddress: typeof providerParent.formattedAddress === 'string' ? providerParent.formattedAddress.slice(0, 300) : null,
              latitude: typeof providerParent.latitude === 'number' ? providerParent.latitude : null,
              longitude: typeof providerParent.longitude === 'number' ? providerParent.longitude : null,
            }
          : null,
        canonicalizationStatus: typeof hypothesis?.canonicalStatus === 'string' ? hypothesis.canonicalStatus.slice(0, 80) : null,
        candidateType: typeof hypothesis?.entityType === 'string' ? hypothesis.entityType.slice(0, 80) : 'UNKNOWN',
        evidenceClass: typeof hypothesis?.evidenceBasis === 'string' ? hypothesis.evidenceBasis.slice(0, 80) : 'UNKNOWN',
        contradictions: Array.isArray(hypothesis?.contradictions)
          ? hypothesis.contradictions.filter((value: unknown) => typeof value === 'string').slice(0, 8)
          : [],
        safetyDecision: typeof destination?.decision === 'string' ? destination.decision : null,
        safetyReasons: Array.isArray(destination?.safetyReasons)
          ? destination.safetyReasons.filter((value: unknown) => typeof value === 'string').slice(0, 8)
          : [],
      });
    }
    const candidates = hypotheses.flatMap((hypothesis: any) => {
      const candidate = premiumRuntimeCandidate(hypothesis);
      return candidate ? [candidate] : [];
    });
    aggregate.push(...candidates);
    const primary = hypotheses[0];
    slots.push({
      mentionId: typeof destination.logicalDestinationId === 'string'
        ? destination.logicalDestinationId.slice(0, 80)
        : `premium-destination-${destinationIndex + 1}`,
      displayName: typeof primary?.name === 'string' ? primary.name.slice(0, 200) : 'Premium result',
      contextLabel: [primary?.city, primary?.region, primary?.country].filter(Boolean).join(', ') || null,
      primaryVenueName: typeof primary?.name === 'string' ? primary.name.slice(0, 200) : null,
      hostVenueName: null,
      relationshipType: null,
      outcome: candidates.length === 1 ? 'verified_single' : candidates.length > 1 ? 'ambiguous_candidates' : 'no_match',
      candidates,
      sourceTimestamps: Array.isArray(primary?.timestamps) ? primary.timestamps : [],
      identityHypotheses: hypotheses.map((hypothesis: any) => ({
        name: typeof hypothesis?.name === 'string' ? hypothesis.name.slice(0, 200) : 'Unknown',
        contextLabel: [hypothesis?.city, hypothesis?.region, hypothesis?.country].filter(Boolean).join(', ') || null,
        confidence: hypothesis?.confidence === 'HIGH' ? 0.9 : hypothesis?.confidence === 'MEDIUM' ? 0.65 : 0.35,
        upstreamSafetyDecision: destination?.decision === 'AUTO_SAVE'
          ? 'AUTO_SAVE'
          : destination?.decision === 'NO_MATCH' ? 'NO_MATCH' : 'REVIEW',
        evidenceKind: hypothesis?.evidenceBasis === 'CONTEXTUAL_OR_MEMORY_PRIOR' ? 'model_prior' : 'observable',
        timestamps: Array.isArray(hypothesis?.timestamps) ? hypothesis.timestamps.slice(0, 12) : [],
        providerParent: hypothesis?.providerParent && typeof hypothesis.providerParent === 'object'
          ? {
              name: typeof hypothesis.providerParent.name === 'string' ? hypothesis.providerParent.name.slice(0, 200) : null,
              placeId: typeof hypothesis.providerParent.googlePlaceId === 'string' ? hypothesis.providerParent.googlePlaceId.slice(0, 200) : null,
            }
          : null,
      })),
    });
  }
  const candidatePayload = buildShareJobCandidatePayload(aggregate, slots);
  (candidatePayload as any).rankedCandidates = rankedCandidates.slice(0, 3);
  if (aggregate.length === 0 && rankedCandidates.length > 0) {
    const first = rankedCandidates[0];
    (candidatePayload as any).partialResult = {
      version: 1,
      reviewOnly: true,
      resultClass: 'search_lead',
      locality: [first.locality, first.region, first.country].filter(Boolean).join(', ') || null,
      category: first.candidateType,
      searchQuery: first.name,
      clueCount: rankedCandidates.length,
    };
  }
  const onlyDestination = value.destinations.length === 1 ? value.destinations[0] : null;
  const solePrimary = onlyDestination?.hypotheses?.[0];
  const autoSaveCandidate = onlyDestination?.decision === 'AUTO_SAVE'
    ? premiumRuntimeCandidate(solePrimary)
    : null;
  const telemetry = value.telemetry && typeof value.telemetry === 'object' ? value.telemetry : {};
  return {
    outcome: typeof value.outcome === 'string' ? value.outcome : 'PREMIUM_TECHNICAL_FAILURE',
    chargeability: typeof value.chargeability === 'string' ? value.chargeability : 'NON_CHARGEABLE_TECHNICAL_FAILURE',
    autoSaveCandidate,
    candidatePayload,
    suggestedQuery: slots.map((slot) => slot.displayName).filter(Boolean).join(' | ') || null,
    costs: {
      sol: {
        model: telemetry.model ?? 'gpt-5.6-sol',
        usage: telemetry.usage ?? null,
        knownCostUsd: typeof telemetry.knownModelCostUsd === 'number' ? telemetry.knownModelCostUsd : 'UNKNOWN',
      },
      places: {
        requestCount: typeof telemetry.placesRequests === 'number' ? telemetry.placesRequests : 0,
        requestTypes: Array.isArray(telemetry.placesRequestTypes) ? telemetry.placesRequestTypes : [],
        costUsd: 'UNKNOWN',
      },
      acquisition: 'UNKNOWN',
      transcription: 'UNKNOWN',
      latencyMs: telemetry.timingsMs ?? null,
      evidenceReuse: telemetry.evidenceReuse ?? null,
      parityDiagnostics: {
        engineVersion: telemetry.engineVersion ?? null,
        safetyVersion: telemetry.safetyVersion ?? null,
        evidenceVersion: telemetry.evidenceVersion ?? null,
        evidenceReuseState: telemetry.evidenceReuseState ?? null,
        inferenceFingerprint: telemetry.inferenceFingerprint ?? null,
        solBoundary: telemetry.solBoundary ?? null,
        canonicalizationFingerprint: telemetry.canonicalizationFingerprint ?? null,
        finalFingerprint: telemetry.finalFingerprint ?? null,
      },
    },
    rankedCandidates: rankedCandidates.slice(0, 3),
  };
}

export function automaticDeepCandidates(plan: NonNullable<ReturnType<typeof premiumRuntimePlan>>): any[] {
  const canonicalById = new Map<string, any>(
    (plan.candidatePayload?.candidates ?? []).map((candidate: any) => [candidate.googlePlaceId, candidate]),
  );
  return plan.rankedCandidates.flatMap<any>((ranked: any) => {
    const canonical = ranked.canonicalPlaceId ? canonicalById.get(ranked.canonicalPlaceId) : null;
    if (canonical) {
      return [{
        ...canonical,
        exactIdentityStrength: ranked.safetyDecision === 'AUTO_SAVE'
          ? 'candidate_bound'
          : undefined,
        upstreamSafetyDecision: ranked.safetyDecision,
        reasons: [
          ...(Array.isArray(canonical.reasons) ? canonical.reasons : []),
          ...(ranked.safetyDecision === 'REJECT' ? ['semantic_contradiction'] : []),
        ],
      }];
    }
    if (!ranked.name || !Number.isFinite(ranked.latitude) || !Number.isFinite(ranked.longitude)) return [];
    return [safeCandidate({
      googlePlaceId: nativeNearrPlaceId(ranked.name, ranked.latitude, ranked.longitude),
      name: ranked.name,
      formattedAddress: ranked.providerParent?.formattedAddress ??
        [ranked.locality, ranked.region, ranked.country].filter(Boolean).join(', ') ?? null,
      latitude: ranked.latitude,
      longitude: ranked.longitude,
      types: ['nearr_native_identity'],
      primaryType: 'nearr_native_identity',
      confidenceScore: ranked.evidenceClass === 'CONTEXTUAL_OR_MEMORY_PRIOR' ? 0.35 : 0.6,
      evidence: [ranked.evidenceClass],
      exactIdentityStrength: ranked.safetyDecision === 'AUTO_SAVE'
        ? 'candidate_bound'
        : undefined,
      upstreamSafetyDecision: ranked.safetyDecision,
      reasons: [
        'specificity_preserved_provider_parent_metadata_only',
        ...(ranked.safetyDecision === 'REJECT' ? ['semantic_contradiction'] : []),
      ],
      contextLabel: [ranked.locality, ranked.region, ranked.country].filter(Boolean).join(', ') || null,
    })];
  });
}


export type FinalizationContext = {
  autoSaveAuthorized: boolean;
  auditRecordPresent: boolean;
};

export type PreparedMediaMentions = Pick<BuildMentionsResult,
  'mentions' | 'geoContext' | 'relationships' | 'partialMentions'>;

export function prepareMediaResolverInput(args: {
  platform: SourcePlatform;
  groundedEvidence: MediaPlaceEvidence | null;
  sourceMetadata: MediaSourceMetadata | null;
  rendered?: RenderedCaption;
}) {
  const { platform, groundedEvidence, sourceMetadata } = args;
  const rendered = args.rendered ?? (groundedEvidence
    ? renderMediaEvidenceCaption(groundedEvidence)
    : { title: '', description: '', renderedPlaces: 0 });
  const handles = sourceMetadata
    ? extractHandles({
        platform, title: sourceMetadata.title, description: sourceMetadata.description,
        html: null, knownPosterHandle: sourceMetadata.creatorHandle,
      })
    : { posterHandle: null, taggedHandles: [], venueHandles: [], posterNameHint: null };
  const mergedCaption = mergeMediaCaption(sourceMetadata, rendered);
  const mediaEvidence = extractEvidence({
    platform, title: mergedCaption.title, description: mergedCaption.description,
    handles, taggedLocation: null, creatorName: sourceMetadata?.creatorName ?? null,
  });
  const mediaMentions: PreparedMediaMentions = groundedEvidence
    ? buildVenueMentions(groundedEvidence)
    : { mentions: [], geoContext: { city: null, region: null, country: null }, relationships: [], partialMentions: 0 };
  return { rendered, handles, mediaEvidence, mediaMentions };
}

type GeographyInput = {
  sourceGeography: SourceGeographyEvidence | null;
  candidate: any;
  path: string;
  decisiveIndependentEvidence: boolean;
  upstreamAutoSaveEligible: boolean;
};

function planGeography(input: GeographyInput) {
  return {
    ...evaluateGeographyAutoSave({
      source: input.sourceGeography, candidate: input.candidate,
      decisiveIndependentEvidence: input.decisiveIndependentEvidence,
    }),
    // Edge passes these same values to its existing structured log. They are
    // deliberately not folded into the geography policy's own eligibility.
    input,
  };
}

export function planMediaMentionFinalization(args: {
  mention: any;
  mentionResult: any;
  mentionResults: any[];
  sourceGeography: SourceGeographyEvidence | null;
  context: FinalizationContext;
}) {
  const { mention, mentionResult, mentionResults, sourceGeography } = args;
  const { autoSaveAuthorized, auditRecordPresent } = args.context;
  const gate = mention
    ? evaluateMediaAutoSave(
        { mention, result: mentionResult, allResults: mentionResults },
      )
    : {
        eligible: false,
        confidenceScore: null,
        ruleVersion: MEDIA_AUTO_SAVE_RULE_VERSION,
        reasonCodes: ['mention_evidence_missing'],
        rawCandidateCount: Array.isArray(mentionResult.scoring)
          ? mentionResult.scoring.length
          : 0,
        plausibleCandidateCount: 0,
        selectedProviderId: null,
        plausibleProviderIds: [],
        candidateRejectionReasons: ['mention_evidence_missing'],
        explicitConflictFlags: [],
        semanticCompatibility: 'UNKNOWN',
        sceneCategory: null,
        candidateCategory: null,
        semanticOverrideApplied: false,
        exactIdentityRuleVersion: 'exact-identity-safety-2026-09-09.v1',
        exactIdentityStrength: 'none' as const,
        exactIdentityReason: 'mention_evidence_missing',
      };
  const blockingReasons = [...gate.reasonCodes];
  if (gate.eligible && !autoSaveAuthorized) blockingReasons.push('auto_save_disabled_or_user_not_allowlisted');
  if (gate.eligible && !auditRecordPresent) blockingReasons.push('media_run_audit_missing');
  const candidate = gate.selectedProviderId
    ? mentionResult.candidates?.find(
        (entry: any) => entry.googlePlaceId === gate.selectedProviderId,
      ) ?? null
    : null;
  const geography = candidate
    ? planGeography({
        sourceGeography,
        candidate,
        path: 'media_mention',
        decisiveIndependentEvidence: (gate.confidenceScore ?? 0) >= 0.9 &&
          ['candidate_bound', 'distinctive_visual'].includes(gate.exactIdentityStrength),
        upstreamAutoSaveEligible: gate.eligible && autoSaveAuthorized && auditRecordPresent,
      })
    : null;
  const mayAutoSave = gate.eligible && autoSaveAuthorized && auditRecordPresent &&
    geography?.autoSaveEligible !== false;
  if (gate.eligible && geography?.autoSaveEligible === false) {
    blockingReasons.push('source_geography_conflict');
  }

  const blockedOutcome = mentionResult.outcome === 'provider_error'
    ? 'failed'
    : mentionResult.outcome === 'no_match' || mentionResult.outcome === 'rejected_insufficient_evidence'
    ? 'manual_fallback'
    : 'candidate_confirmation';
  return { gate, blockingReasons, candidate, geography, mayAutoSave, blockedOutcome };
}

export function planLegacyMediaFinalization(args: {
  ordinaryResult: any;
  groundedEvidence: MediaPlaceEvidence;
  sourceGeography: SourceGeographyEvidence | null;
  requireCandidateIdentity?: boolean;
}) {
  const { ordinaryResult: result, groundedEvidence, sourceGeography } = args;
  const plan = planFromResolverDecision({
    decision: result.decision,
    safeToAutoSave: result.safeToAutoSave,
    hasPrimaryCandidate: !!result.primaryCandidate,
    candidateCount: result.candidates.length,
    cleanSearchQuery: result.cleanSearchQuery,
    failureReason: result.failureReason,
  });
  const legacyExactIdentityStrength = mediaEvidenceExactIdentityStrength(groundedEvidence);
  const identityChecks = args.requireCandidateIdentity
    ? (result.candidates ?? []).map((candidate: any) => evaluateLegacyCandidateIdentity(candidate, groundedEvidence)) : null;
  const legacyMediaCompletion = planAutomaticCompletion(
    (result.candidates ?? []).map((candidate: any, index: number) => ({
      ...candidate,
      exactIdentityStrength: legacyExactIdentityStrength === 'none'
        ? undefined
        : legacyExactIdentityStrength === 'candidate_bound' &&
            !candidate.reasons?.some((reason: string) =>
              reason === 'address_verified' || reason === 'address_verified_multi'
            )
        ? undefined
        : legacyExactIdentityStrength,
      ...(identityChecks && !identityChecks[index].eligible ? {
        upstreamSafetyDecision: 'REVIEW',
        reasons: [...(candidate.reasons ?? []), identityChecks[index].reason],
      } : {}),
    })),
  );
  const legacyCandidate = legacyMediaCompletion.action === 'save'
    ? legacyMediaCompletion.primary
    : result.primaryCandidate;
  const legacyGeography = legacyCandidate
    ? planGeography({
        sourceGeography,
        candidate: legacyCandidate,
        path: 'legacy_media',
        decisiveIndependentEvidence: legacyMediaCompletion.action === 'save' &&
          (legacyCandidate.matchScore ?? legacyCandidate.confidenceScore ?? 0) >= 0.9 &&
          ['candidate_bound', 'distinctive_visual'].includes(legacyCandidate.exactIdentityStrength),
        upstreamAutoSaveEligible: legacyMediaCompletion.action === 'save' &&
          mediaEvidenceAutoSaveEligible(groundedEvidence),
      })
    : null;
  // Post-resolve routing + the EXTRA media auto-save gate (never loosens
  // safeToAutoSave; can only downgrade a resolver auto_save to a confirmation).
  const post = planPostResolve({
    route: legacyMediaCompletion.action === 'save' ? 'auto_save' : 'needs_help',
    // The existing Edge path also passes picker at runtime. Preserve that value;
    // planPostResolve's older declaration omits it but the function passes it on.
    needsHelpMode: (plan.route === 'needs_help' ? plan.mode : 'manual') as Parameters<typeof planPostResolve>[0]['needsHelpMode'],
    autoSaveEligible: legacyMediaCompletion.action === 'save' && mediaEvidenceAutoSaveEligible(groundedEvidence) &&
      legacyGeography?.autoSaveEligible !== false,
  });

  return { plan, legacyExactIdentityStrength, legacyMediaCompletion, legacyCandidate, legacyGeography, post,
    ...(identityChecks ? { legacyIdentityChecks: identityChecks } : {}) };
}

export function planAutomaticDeepFinalization(args: {
  runtimePlan: NonNullable<ReturnType<typeof premiumRuntimePlan>>;
  sourceGeography: SourceGeographyEvidence | null;
}) {
  const { runtimePlan: automaticDeep, sourceGeography } = args;
  const mentionSlots = automaticDeep.candidatePayload.mentionSlots ?? [];
  const completion = planAutomaticCompletion(automaticDeepCandidates(automaticDeep));
  const geography = completion.action === 'save'
    ? planGeography({
        sourceGeography, candidate: completion.primary, path: 'automatic_deep',
        decisiveIndependentEvidence: (completion.primary.matchScore ?? 0) >= 0.9 &&
          completion.primary.exactIdentityStrength === 'candidate_bound',
        upstreamAutoSaveEligible: completion.action === 'save' && mentionSlots.length <= 1,
      })
    : null;
  const mayAutoSave = completion.action === 'save' && mentionSlots.length <= 1 &&
    geography?.autoSaveEligible !== false;
  return { completion, geography, mayAutoSave };
}

export type PlannedAutonomousPlace = { logicalResultId: string; candidate: any };
export type MediaFinalizationInput = {
  groundedEvidence: MediaPlaceEvidence;
  ordinaryResult?: any;
  mediaMentions?: PreparedMediaMentions;
  /** Raw worker automaticDeepRecognition payload, not public model evidence. */
  automaticDeepRuntime?: unknown;
  sourceGeography: SourceGeographyEvidence | null;
  context: FinalizationContext;
  requireLegacyCandidateIdentity?: boolean;
};

export type MediaFinalizationResult = {
  lane: 'automatic_deep' | 'mentions' | 'legacy';
  status: 'auto_save' | 'needs_help' | 'retry' | 'invalid';
  autonomousPlaces: PlannedAutonomousPlace[];
  /** These are review options, never extra autonomous destinations. */
  reviewCandidates: any[];
  perPlaceDecisions: any[];
  multiPlaceDetected: boolean;
  reasonCodes: string[];
  detail: any;
};

/**
 * Evaluation view of the exact Edge final decisions. The caller has already
 * performed provider resolution, evidence grounding, and lifecycle/retry checks.
 * No confidence shortcut or benchmark-only acceptance policy belongs here.
 */
export function planMediaFinalization(input: MediaFinalizationInput): MediaFinalizationResult {
  const sourceGeography = input.sourceGeography;
  if (input.automaticDeepRuntime) {
    const runtimePlan = premiumRuntimePlan(input.automaticDeepRuntime);
    const base = { lane: 'automatic_deep' as const, autonomousPlaces: [],
      reviewCandidates: [], perPlaceDecisions: [], multiPlaceDetected: false };
    if (!runtimePlan) return { ...base, status: 'invalid', reasonCodes: ['automatic_deep_payload_invalid'], detail: null };
    const slots = runtimePlan.candidatePayload.mentionSlots ?? [];
    const candidates = runtimePlan.candidatePayload.candidates ?? [];
    if (runtimePlan.outcome !== 'PREMIUM_ACTIONABLE_RESULT' || runtimePlan.rankedCandidates.length === 0) {
      return { ...base, status: 'retry', multiPlaceDetected: slots.length > 1,
        reasonCodes: [runtimePlan.outcome], detail: { runtimePlan } };
    }
    const planned = planAutomaticDeepFinalization({ runtimePlan, sourceGeography });
    const logicalResultId = slots[0]?.mentionId ?? 'automatic-deep-primary';
    const reasonCodes = [planned.completion.reason,
      ...(slots.length > 1 ? ['multiple_destinations_require_review'] : []),
      ...(planned.geography?.autoSaveEligible === false ? ['source_geography_conflict'] : [])];
    return {
      ...base, status: planned.mayAutoSave ? 'auto_save' : 'needs_help',
      autonomousPlaces: planned.mayAutoSave ? [{ logicalResultId, candidate: planned.completion.primary }] : [],
      reviewCandidates: planned.mayAutoSave ? planned.completion.alternatives : candidates,
      perPlaceDecisions: [{ logicalResultId, ...planned }],
      multiPlaceDetected: slots.length > 1, reasonCodes, detail: { runtimePlan, ...planned },
    };
  }
  const result = input.ordinaryResult;
  if (!result) throw new Error('ordinary_resolver_result_required');
  const mediaMentions = input.mediaMentions ?? buildVenueMentions(input.groundedEvidence);
  const mentionResults = Array.isArray(result.diagnostics?.mentionResults) ? result.diagnostics.mentionResults : [];
  if (mentionResults.length > 0) {
    const mentionById = new Map(mediaMentions.mentions.map((mention) => [mention.id, mention]));
    const decisions = mentionResults.map((mentionResult: any) => ({
      logicalResultId: mentionResult.mentionId,
      ...planMediaMentionFinalization({ mention: mentionById.get(mentionResult.mentionId),
        mentionResult, mentionResults, sourceGeography, context: input.context }),
    }));
    const unresolvedIds = new Set(mentionResults.flatMap((mention: any, index: number) =>
      decisions[index].mayAutoSave ? [] : (mention.candidates ?? []).map((candidate: any) => candidate.googlePlaceId)));
    return {
      lane: 'mentions', status: decisions.every((decision: any) => decision.mayAutoSave) ? 'auto_save' : 'needs_help',
      autonomousPlaces: decisions.filter((decision: any) => decision.mayAutoSave)
        .map((decision: any) => ({ logicalResultId: decision.logicalResultId, candidate: decision.candidate })),
      reviewCandidates: (result.candidates ?? []).filter((candidate: any) => unresolvedIds.has(candidate.googlePlaceId)),
      perPlaceDecisions: decisions, multiPlaceDetected: mentionResults.length > 1,
      reasonCodes: [...new Set<string>(decisions.flatMap((decision: any) => decision.blockingReasons))],
      detail: { mentionResults },
    };
  }
  const planned = planLegacyMediaFinalization({ ordinaryResult: result, groundedEvidence: input.groundedEvidence, sourceGeography,
    requireCandidateIdentity: input.requireLegacyCandidateIdentity });
  const autoSave = planned.post.action === 'auto_save';
  return {
    lane: 'legacy', status: autoSave ? 'auto_save' : 'needs_help',
    autonomousPlaces: autoSave ? [{ logicalResultId: 'media-primary', candidate: planned.legacyCandidate }] : [],
    reviewCandidates: autoSave ? planned.legacyMediaCompletion.alternatives : result.candidates.slice(0, 10).map((candidate: any) => safeCandidate(candidate)),
    perPlaceDecisions: [{ logicalResultId: 'media-primary', ...planned }],
    multiPlaceDetected: false,
    reasonCodes: [planned.legacyMediaCompletion.reason,
      ...(planned.legacyGeography?.autoSaveEligible === false ? ['source_geography_conflict'] : []),
      ...(planned.post.action === 'needs_help' && planned.post.downgraded ? ['media_autosave_ineligible'] : [])],
    detail: planned,
  };
}
