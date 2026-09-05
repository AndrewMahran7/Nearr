// supabase/functions/process-share-jobs/index.ts
//
// Durable, retry-safe worker for the async share flow.
//
// Invoked by:
//   - pg_cron per-minute sweep (the durability backstop), AND
//   - an AFTER INSERT pg_net trigger (low-latency pickup)
//   both defined in migration 20260731000003_share_jobs_worker.sql.
//   Also invokable manually with the service-role key for testing/backfill.
//
// It claims queued jobs with `claim_share_jobs()` (FOR UPDATE SKIP LOCKED),
// runs the EXISTING process-share-link resolver + save path (no duplicated
// extraction logic), maps the decision to a terminal job state, and sends a
// single Expo push per terminal state.
//
// Auth: caller MUST present the service-role key as the bearer token.

// @ts-nocheck — Deno runtime.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

import { readEnv, validateEnv } from '../process-share-link/env.ts';
import { detectPlatform, legacySourceFor } from '../process-share-link/platform/detectPlatform.ts';
import {
  fetchPostMetadata,
  isPermanentMetadataFailure,
} from '../process-share-link/metadata/fetchMetadata.ts';
import { extractHandles } from '../process-share-link/evidence/handleExtraction.ts';
import { extractEvidence } from '../process-share-link/evidence/extractEvidence.ts';
import { extractTaggedLocation } from '../process-share-link/evidence/taggedLocation.ts';
import { resolveSharedPlace } from '../process-share-link/resolver/resolveSharedPlace.ts';
import { isRetryableNameDrivenProviderFailure } from '../process-share-link/resolver/nameDrivenResolver.ts';
import { saveForUser } from '../process-share-link/save.ts';
import { normalizeShareUrl } from '../../../lib/shareAgent/tiktokUrl.ts';
import { canonicalContentIdentity, type CanonicalContentIdentity } from '../../../lib/shareAgent/contentIdentity.ts';
import {
  inspectFacebookUrl,
  planFacebookDiscoveredCanonicalUrl,
} from '../../../lib/shareAgent/facebookUrl.ts';
import { buildShareJobCandidatePayload, normalizeEvidenceFrames } from '../../../lib/shareJobResult.ts';
import { selectionModeForPlaceResult } from '../../../lib/placeSelection.ts';
import {
  classifyShareFailure,
  type ShareFailureCategory,
} from '../../../lib/shareFailurePresentation.ts';
import { isNearrCategory, resolvePlaceCategory } from '../../../lib/placeCategory.ts';
import {
  evaluateDeliverableAiPlaceNote,
  generateAiPlaceNote,
  persistAiNoteSupplementally,
  type AiPlaceNoteResult,
} from '../../../lib/aiPlaceNote.ts';
import {
  classifyVideoAiNoteFailure,
  videoAiNoteCallbackMatchesTarget,
} from '../../../lib/videoDerivedAiNote.ts';

import { submitPushToUser, checkExpoReceipts, type TicketRef } from './push.ts';
import {
  classifyResolverFailure,
  formatResolverRetryLog,
  planResolverRetry,
} from './providerRetry.ts';
import {
  planFromResolverDecision,
} from './decisionMapping.ts';
import {
  composeShareCompletionNotification,
  type NotificationLocality,
  type ShareCompletionNotification,
} from './shareCompletionNotification.ts';
import {
  effectiveMediaFlags,
  mediaInfrastructureEnabled,
  shouldRunMediaFallback,
  shouldRunMediaFallbackForMetadataFailure,
  shouldRunPostSaveEnrichment,
} from './mediaFallback.ts';
import {
  parseMediaEvidence,
  renderMediaEvidenceCaption,
  summarizeMediaEvidence,
  mediaEvidenceAutoSaveEligible,
  buildVayrinPartialResult,
} from './mediaEvidence.ts';
import { buildRecognitionFunnel } from './mediaRunDiagnostics.ts';
import {
  parseMediaSourceMetadata,
  mergeMediaCaption,
  mergeRetainedSourceMetadata,
  sourceMetadataFromExtractionPayload,
  summarizeSourceMetadata,
  withRetainedSourceMetadata,
  type MediaSourceMetadata,
} from './mediaSourceMetadata.ts';
import { buildVenueMentions, normalizeVenueName, sharedCountryForEvidence } from './mediaMentions.ts';
import {
  evaluateMediaAutoSave,
  formatMediaAutoSaveDecisionLog,
  mediaAutoSaveAuthorized,
  mediaReviewDecision,
  MEDIA_AUTO_SAVE_RULE_VERSION,
  resolveMediaAutoSaveThreshold,
} from './mediaAutoSaveGate.ts';
import {
  METADATA_AUTO_SAVE_RULE_VERSION,
  evaluateMetadataAutoSave,
  formatMetadataAutoSaveDecisionLog,
} from './metadataAutoSaveGate.ts';
import { authorizeMediaFinalizeSecret, authorizeWorkerSecret, planPreResolve, planPostResolve } from './mediaFinalizePlan.ts';
import {
  classifyFinalizeException,
  formatFinalizeReliabilityLog,
  planProviderUnavailable,
} from './mediaFinalizeReliability.ts';
import { planMediaCanonicalUrl } from './sourceCanonicalization.ts';
import {
  buildCandidateReviewSnapshot,
  decisionForSelectionSemantics,
  mediaFailureReview,
  persistedCandidateCount,
} from './ambiguityReview.ts';
import {
  attachSavedPlaceSource,
  claimRecognition,
  lookupRecognition,
  persistRecognition,
  recordIdentityOnJob,
  recordRecognitionEvent,
  releaseRecognition,
  type RecognitionCacheDecision,
} from './recognitionCache.ts';
import {
  candidateSetForRecognitionCache,
  evaluateCachedSingletonAutoSave,
  rerankCachedCandidatePayload,
} from './contextAwareCacheReranking.ts';
import { placeFindSettlementForTerminalJob } from '../../../lib/placeFindSettlement.ts';
import {
  isPremiumResultChargeable,
  premiumEligibilityForResult,
} from '../../../lib/premiumRequestMonetization.ts';
import { premiumRequestsEnabled } from '../_shared/premiumRequests.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function addSecondsIso(seconds: number): string {
  return new Date(Date.now() + Math.max(seconds, 1) * 1000).toISOString();
}

function notificationBackoffSeconds(attempts: number): number {
  const exp = Math.max(attempts - 1, 0);
  return Math.min(900, 30 * 2 ** exp);
}

function truncate(s: string | null | undefined, max = 300): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function isMultiPlaceCachePayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return payload.selectionMode === 'multi_independent' ||
    (Array.isArray(payload.mentionSlots) && payload.mentionSlots.length > 1) ||
    (Array.isArray(payload.savedPlaceIds) && payload.savedPlaceIds.length > 1);
}

function safeCandidate(c: any, aiNote: string | null = null) {
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

const MEDIA_FAILURE_CODES = new Set([
  'unsupported_platform',
  'unsupported_url',
  'private_or_unavailable',
  'authentication_required',
  'provider_changed',
  'redirect_limit',
  'download_timeout',
  'download_failed',
  'provider_rate_limited',
  'provider_unavailable',
  'finalizer_unavailable',
  'file_too_large',
  'duration_too_long',
  'invalid_media',
  'missing_video',
  'ssrf_blocked',
  'cancelled',
  'insufficient_evidence',
  'recognition_recovery_exhausted',
  'partial_evidence_invalid',
  'premium_no_useful_result',
  'premium_model_failure',
]);

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

function premiumRuntimePlan(value: any): null | {
  outcome: string;
  chargeability: string;
  autoSaveCandidate: any | null;
  candidatePayload: any;
  suggestedQuery: string | null;
  costs: Record<string, unknown>;
} {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.destinations)) return null;
  const slots: any[] = [];
  const aggregate: any[] = [];
  for (const [destinationIndex, destination] of value.destinations.slice(0, 10).entries()) {
    if (!destination || !Array.isArray(destination.hypotheses) || destination.hypotheses.length === 0) continue;
    const hypotheses = destination.hypotheses.slice(0, 3);
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
        evidenceKind: hypothesis?.evidenceBasis === 'CONTEXTUAL_OR_MEMORY_PRIOR' ? 'model_prior' : 'observable',
        timestamps: Array.isArray(hypothesis?.timestamps) ? hypothesis.timestamps.slice(0, 12) : [],
      })),
    });
  }
  const candidatePayload = buildShareJobCandidatePayload(aggregate, slots);
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
  };
}

function safeMediaFailureCode(value: unknown): string | null {
  return typeof value === 'string' && MEDIA_FAILURE_CODES.has(value) ? value : null;
}

const SAFE_WEAK_CLUE_KEYS = new Set([
  'caption_explicit_address',
  'caption_multiple_addresses',
  'caption_city_state',
  'caption_venue_hint',
  'venue_handle_tagged',
  'tagged_location',
  'media_name_mention',
]);

function hasSafeWeakClues(evidenceUsed: unknown): boolean {
  return Array.isArray(evidenceUsed) && evidenceUsed.some(
    (value) => typeof value === 'string' && SAFE_WEAK_CLUE_KEYS.has(value),
  );
}

function observableLeadSummary(mentionResults: any[]): {
  strongestLead: { name: string; evidenceKind: 'observable' } | null;
  observableLeadCount: number;
} {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const mention of Array.isArray(mentionResults) ? mentionResults : []) {
    for (const identity of Array.isArray(mention?.identityHypotheses) ? mention.identityHypotheses : []) {
      const name = typeof identity?.name === 'string' ? identity.name.trim() : '';
      const key = name.toLowerCase();
      if (!name || identity?.evidenceKind !== 'observable' || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return {
    strongestLead: names[0] ? { name: names[0], evidenceKind: 'observable' } : null,
    observableLeadCount: names.length,
  };
}

function trustedLocalityFromGeoContext(geo: any): NotificationLocality | null {
  const city = geo?.cityStrength === 'strong' && typeof geo?.city === 'string' ? geo.city.trim() : '';
  const region = geo?.regionStrength === 'strong' && typeof geo?.region === 'string' ? geo.region.trim() : '';
  const country = geo?.countryStrength === 'strong' && typeof geo?.country === 'string' ? geo.country.trim() : '';
  const label = city ? [city, region].filter(Boolean).join(', ') : region || country;
  return label ? { label, basis: 'observable_corroborated' } : null;
}

function trustedMediaNotificationLocality(parsed: any): NotificationLocality | null {
  if (!parsed?.ok) return null;
  // A model-prior identity may be retained for review, but cannot turn its
  // city/region guess into factual lock-screen copy.
  const observableOnly = {
    ...parsed.value,
    places: parsed.value.places.filter((place: any) => place?.identityEvidenceKind !== 'model_prior'),
  };
  return trustedLocalityFromGeoContext(buildVenueMentions(observableOnly).geoContext);
}

function trustedMetadataNotificationLocality(evidence: any, result: any): NotificationLocality | null {
  const providerClassifiedGeographic =
    result?.diagnostics?.sourceLocationTagGranularity === 'geographic_context';
  const label = typeof evidence?.taggedLocation?.placeName === 'string'
    ? evidence.taggedLocation.placeName.trim()
    : '';
  return providerClassifiedGeographic && label
    ? { label, basis: 'provider_verified' }
    : null;
}

function reviewNotification(args: {
  jobId: string;
  status?: 'needs_help' | 'failed';
  mode: string;
  candidates?: any[];
  mentionResults?: any[];
  notificationLocality?: NotificationLocality | null;
  hasWeakClues?: boolean;
  technicalFailure?: boolean;
  failureCategory?: ShareFailureCategory | null;
  failureCode?: string | null;
  provider?: string | null;
  analysisAttempted?: boolean | null;
  savedPlaceId?: string | null;
  savedPlaceIds?: string[];
  createdSavedPlaceIds?: string[];
  reviewCount?: number;
}): ShareCompletionNotification {
  const candidates = Array.isArray(args.candidates) ? args.candidates : [];
  const mentionResults = Array.isArray(args.mentionResults) ? args.mentionResults : [];
  const leads = observableLeadSummary(mentionResults);
  const savedPlaceIds = Array.isArray(args.savedPlaceIds) ? args.savedPlaceIds : [];
  const multiPlace = mentionResults.length > 1
    ? {
        totalCount: mentionResults.length,
        savedCount: savedPlaceIds.length,
        unresolvedCandidateGroupCount: mentionResults.filter(
          (mention: any) => Array.isArray(mention?.candidates) && mention.candidates.length > 0 && !mention?.savedPlaceId,
        ).length,
      }
    : null;
  return composeShareCompletionNotification({
    jobId: args.jobId,
    status: args.status ?? 'needs_help',
    technicalFailure: args.technicalFailure,
    failureCategory: args.failureCategory,
    failureCode: args.failureCode,
    provider: args.provider,
    analysisAttempted: args.analysisAttempted,
    candidateCount: multiPlace ? 0 : candidates.length,
    strongestCandidateName: multiPlace ? null : candidates[0]?.name ?? null,
    notificationLocality: args.notificationLocality,
    strongestLead: leads.strongestLead,
    observableLeadCount: leads.observableLeadCount,
    hasWeakClues: args.hasWeakClues,
    multiPlace,
    savedPlaceId: args.savedPlaceId,
    savedPlaceIds,
    createdSavedPlaceIds: args.createdSavedPlaceIds,
    reviewMode: args.mode === 'picker' ? 'candidate_picker' : args.mode,
    reviewCount: args.reviewCount,
  });
}

/**
 * Evaluate this mention's cue. Returns the note plus the bounded status code
 * that explains an absent one — "the model proposed nothing" and "the model
 * proposed something we refused" are different bugs, and before this the
 * pipeline reported both as a silent null.
 */
function noteResultForLogicalMention(parsed: any, mention: any): AiPlaceNoteResult {
  if (!parsed?.ok || !mention) return { note: null, status: 'not_requested', reason: null };
  const logicalName = mention.primaryVenueName ?? mention.displayName ?? '';
  const normalizedName = mention.normalizedName ?? normalizeVenueName(logicalName);
  const scopedPlaces = parsed.value.places.filter(
    (place: any) => normalizeVenueName(place.name ?? '') === normalizedName,
  );
  let last: AiPlaceNoteResult = { note: null, status: 'not_requested', reason: null };
  for (const place of scopedPlaces) {
    last = evaluateDeliverableAiPlaceNote({
      placeName: logicalName,
      proposedNote: place.memoryCue,
      evidence: place.memoryCueEvidence ?? [],
    });
    if (last.note) return last;
  }
  return last;
}

/** Bounded place-scoped handoff for the post-save note task. Observations and
 * scene timestamps are retained; candidate notes and frame bytes are not. */
function noteEvidenceForLogicalMention(parsed: any, mention: any): {
  noteEvidence: any[];
  noteTimestamps: number[];
} {
  if (!parsed?.ok || !mention) return { noteEvidence: [], noteTimestamps: [] };
  const logicalName = mention.primaryVenueName ?? mention.displayName ?? '';
  const normalizedName = mention.normalizedName ?? normalizeVenueName(logicalName);
  const evidence = parsed.value.places
    .filter((place: any) => normalizeVenueName(place.name ?? '') === normalizedName)
    .flatMap((place: any) => Array.isArray(place.explicitEvidence) ? place.explicitEvidence : [])
    .filter((item: any) => item && typeof item.value === 'string')
    .map((item: any) => ({
      source: item.source,
      value: item.value.replace(/\s+/g, ' ').trim().slice(0, 240),
      timestampSeconds: typeof item.timestampSeconds === 'number' && Number.isFinite(item.timestampSeconds)
        ? item.timestampSeconds
        : null,
    }))
    .filter((item: any) => item.value.length >= 3)
    .slice(0, 16);
  const timestamps = [...new Set([
    ...(Array.isArray(mention.timestamps) ? mention.timestamps : []),
    ...evidence.map((item: any) => item.timestampSeconds),
  ].filter((value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
  ))].sort((a, b) => a - b).slice(0, 16);
  return { noteEvidence: evidence, noteTimestamps: timestamps };
}

function noteForAggregateCandidate(
  candidateId: string,
  mentionResults: any[],
  notesByMentionId: Map<string, string | null>,
): string | null {
  const scopedNotes: string[] = [];
  for (const mention of mentionResults) {
    if (!mention.candidates?.some((candidate: any) => candidate.googlePlaceId === candidateId)) continue;
    const note = notesByMentionId.get(mention.mentionId);
    if (note) scopedNotes.push(note);
  }
  // The aggregate candidate loses logical mention boundaries. Attach a cue
  // only when exactly one mention owns it; slot candidates keep their cue.
  return scopedNotes.length === 1 ? scopedNotes[0]! : null;
}

// ---------------------------------------------------------------------------
// Terminal transition + single-push. The status guard (`.eq('status',
// 'processing_metadata')`) means only the lease-owning worker transitions the
// row; the notification is reserved BEFORE sending so it can only fire once.
// ---------------------------------------------------------------------------
async function finalize(
  admin: any,
  job: any,
  patch: Record<string, unknown>,
  note: { title: string; body: string; data: Record<string, unknown> } | null,
): Promise<void> {
  const updatePatch: Record<string, unknown> = { ...patch };
  const skipRecognitionCachePersist = updatePatch.__skipRecognitionCachePersist === true;
  const premiumChargeabilityOverride = updatePatch.__premiumChargeability === 'CHARGEABLE_ACTIONABLE'
    ? { chargeable: true, reason: 'premium_specific_candidates' as const }
    : null;
  delete updatePatch.__skipRecognitionCachePersist;
  delete updatePatch.__premiumChargeability;
  const finalUrl = typeof patch.canonical_url === 'string'
    ? patch.canonical_url
    : job.canonical_url || job.source_url;
  const identity = canonicalContentIdentity(job.source_url, finalUrl);
  if (identity) {
    updatePatch.recognition_identity_key = identity.key;
    updatePatch.recognition_identity_version = identity.identityVersion;
    updatePatch.recognition_content_id = identity.contentId;
  }
  if (note) {
    updatePatch.notification_status = 'pending';
    updatePatch.notification_attempts = 0;
    updatePatch.notification_last_attempt_at = null;
    updatePatch.notification_next_attempt_at = nowIso();
    updatePatch.notification_ticket_ids = null;
    updatePatch.notification_error_code = null;
    updatePatch.notification_submitted_at = null;
    updatePatch.notification_receipts_checked_at = null;
    updatePatch.notification_payload = note;
  }
  const finalFacts = { ...job, ...updatePatch };
  const billingMode = job.billing_mode ?? 'unmetered_legacy';
  const legacySettlement = placeFindSettlementForTerminalJob(finalFacts);
  // The authenticated Premium worker has already applied canonicalization and
  // safety before emitting CHARGEABLE_ACTIONABLE. Preserve that typed decision
  // for named review leads that intentionally have no single Places candidate.
  const premiumSettlement = premiumChargeabilityOverride ?? isPremiumResultChargeable(finalFacts);
  const eligibility = premiumEligibilityForResult(finalFacts);
  const becamePremiumEligible = billingMode !== 'premium_request' && eligibility.eligible && job.premium_state !== 'eligible';
  if (billingMode === 'premium_request') {
    updatePatch.billing_outcome = `pending_${premiumSettlement.chargeable ? 'consume' : 'release'}:${premiumSettlement.reason}`;
    updatePatch.billing_settled_at = null;
  } else if (billingMode === 'metered') {
    updatePatch.billing_outcome = `pending_${legacySettlement.action}:${legacySettlement.reason}`;
    updatePatch.billing_settled_at = null;
  } else {
    updatePatch.billing_outcome = 'unmetered:normal_free';
    updatePatch.billing_settled_at = job.billing_settled_at ?? nowIso();
    updatePatch.premium_state = eligibility.eligible ? 'eligible' : 'not_eligible';
    updatePatch.premium_eligibility_reason = eligibility.reason;
  }

  const { data: updated } = await admin
    .from('share_jobs')
    .update(updatePatch)
    .eq('id', job.id)
    .eq('status', 'processing_metadata')
    .select('id')
    .maybeSingle();

  if (!updated) {
    console.log(`[share-job] finalize_skipped job_id=${job.id} already_terminal=true`);
    // A prior invocation may have committed the terminal job transition and
    // lost its response before the idempotent ledger settlement. Reconcile on
    // every replay so a callback retry cannot strand a reservation.
    const { data: terminal } = await admin
      .from('share_jobs')
      .select('id,status,decision,saved_place_id,candidate_payload,failure_reason,failure_category,failure_code,needs_help_reason,analysis_attempted,billing_mode,premium_request_id,premium_state,premium_cost_components')
      .eq('id', job.id)
      .maybeSingle();
    if (terminal && terminal.status !== 'queued' && terminal.status !== 'processing_metadata' && terminal.status !== 'awaiting_purchase') {
      const premium = terminal.billing_mode === 'premium_request';
      const settlement = premium
        ? isPremiumResultChargeable(terminal)
        : placeFindSettlementForTerminalJob(terminal);
      const { error: settlementError } = premium
        ? await admin.rpc('settle_premium_request', {
            p_share_job_id: job.id,
            p_action: settlement.chargeable ? 'consume' : 'release',
            p_reason_code: settlement.reason,
            p_terminal_state: settlement.chargeable
              ? 'useful_result'
              : terminal.status === 'cancelled'
              ? 'cancelled'
              : terminal.status === 'failed' || terminal.failure_category === 'technical_failure'
              ? 'failed'
              : 'no_useful_result',
            p_chargeable: settlement.chargeable,
            p_cost_components: terminal.premium_cost_components ?? {},
          })
        : terminal.billing_mode === 'metered'
        ? await admin.rpc('settle_place_find_use', {
            p_share_job_id: job.id,
            p_action: settlement.action,
            p_reason_code: settlement.reason,
          })
        : { error: null };
      if (settlementError) throw new Error(`place_find_settlement_failed:${settlementError.code ?? 'unknown'}`);
    }
    return;
  }
  console.log(`[share-job] status from=processing_metadata to=${patch.status} job_id=${job.id}`);

  if (becamePremiumEligible) {
    await admin.from('analytics_events').insert({
      user_id: job.user_id,
      event_name: premiumRequestsEnabled()
        ? 'premium_request_offered'
        : 'premium_eligible_while_suspended',
      properties: { share_job_id: job.id, reason: eligibility.reason },
    });
  }

  // Legacy per-share reservations are reconciled for rollout safety. The new
  // free lane never calls the ledger. Premium uses its own atomic settlement.
  const { error: settlementError } = billingMode === 'premium_request'
    ? await admin.rpc('settle_premium_request', {
        p_share_job_id: job.id,
        p_action: premiumSettlement.chargeable ? 'consume' : 'release',
        p_reason_code: premiumSettlement.reason,
        p_terminal_state: premiumSettlement.chargeable
          ? 'useful_result'
          : patch.status === 'cancelled'
          ? 'cancelled'
          : patch.status === 'failed' || patch.failure_category === 'technical_failure'
          ? 'failed'
          : 'no_useful_result',
        p_chargeable: premiumSettlement.chargeable,
        p_cost_components: finalFacts.premium_cost_components ?? {},
      })
    : billingMode === 'metered'
    ? await admin.rpc('settle_place_find_use', {
        p_share_job_id: job.id,
        p_action: legacySettlement.action,
        p_reason_code: legacySettlement.reason,
      })
    : { error: null };
  if (settlementError) {
    throw new Error(`place_find_settlement_failed:${settlementError.code ?? 'unknown'}`);
  }

  // Auxiliary cache write after the user-facing transition commits. Cache
  // outages never roll back a save or candidate review.
  if (identity && !skipRecognitionCachePersist) {
    const candidatePayload = patch.candidate_payload ?? job.candidate_payload ?? null;
    if (patch.status === 'completed' && patch.saved_place_id && isMultiPlaceCachePayload(candidatePayload)) {
      await persistRecognition({
        admin,
        identity,
        trust: 'CANDIDATE_SET',
        candidatePayload: candidateSetForRecognitionCache(candidatePayload),
        evidenceSummary: { decision: 'multi_place_review' },
      });
    } else if (patch.status === 'completed' && patch.saved_place_id) {
      const { data: saved } = await admin
        .from('saved_places')
        .select('place_id')
        .eq('id', patch.saved_place_id)
        .maybeSingle();
      if (saved?.place_id) {
        await persistRecognition({
          admin,
          identity,
          trust: 'VERIFIED_AUTO_SAVE',
          canonicalPlaceId: saved.place_id,
          candidatePayload,
          evidenceSummary: { decision: patch.decision ?? null },
        });
      }
    } else if (patch.status === 'needs_help' && persistedCandidateCount(candidatePayload) > 0) {
      await persistRecognition({
        admin,
        identity,
        trust: 'CANDIDATE_SET',
        candidatePayload: candidateSetForRecognitionCache(candidatePayload),
        evidenceSummary: { decision: patch.decision ?? null },
      });
    }
    await releaseRecognition(admin, identity.key, job.id);
    if (job.recognition_identity_key && job.recognition_identity_key !== identity.key) {
      await releaseRecognition(admin, job.recognition_identity_key, job.id);
    }
  }
}

async function handleProcessingError(admin: any, job: any, err: unknown): Promise<void> {
  const message = truncate(err instanceof Error ? err.message : String(err));
  const attempts = typeof job.attempts === 'number' ? job.attempts : 1;
  const maxAttempts = typeof job.max_attempts === 'number' ? job.max_attempts : 5;
  await releaseRecognition(admin, job.recognition_identity_key, job.id);

  if (attempts >= maxAttempts) {
    await finalize(
      admin,
      job,
      {
        status: 'failed',
        decision: 'failed',
        failure_reason: 'processing_error',
        failure_code: 'processing_error',
        failure_category: 'technical_failure',
        analysis_attempted: false,
        last_error: message,
        completed_at: nowIso(),
      },
      composeShareCompletionNotification({
        jobId: job.id,
        status: 'failed',
        failureCategory: 'technical_failure',
        failureCode: 'processing_error',
        analysisAttempted: false,
        reviewMode: 'manual',
      }),
    );
    return;
  }

  // Release for retry — the next sweep reclaims it (attempts < max_attempts).
  const { data: updated } = await admin
    .from('share_jobs')
    .update({ status: 'queued', locked_until: null, last_error: message })
    .eq('id', job.id)
    .eq('status', 'processing_metadata')
    .select('id')
    .maybeSingle();
  if (updated) {
    console.log(
      `[share-job] status from=processing_metadata to=queued job_id=${job.id} retry attempts=${attempts}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — media fallback (durable video analysis). Everything here is gated
// behind the SERVER-ONLY `MEDIA_FALLBACK_ENABLED` flag. When it is off, none of
// this code path runs (no extra DB calls) and the Phase 1 metadata behavior is
// byte-identical.
// ---------------------------------------------------------------------------
function readMediaFlags(): {
  mediaFallbackEnabled: boolean;
  instagramResolverEnabled: boolean;
  tiktokResolverEnabled: boolean;
  youtubeResolverEnabled: boolean;
  facebookResolverEnabled: boolean;
  snapchatResolverEnabled: boolean;
  canaryUserId: string | null;
  autoSaveEnabled: boolean;
  autoSaveCanaryUserId: string | null;
  autoSaveThreshold: number;
  autoSaveThresholdValid: boolean;
} {
  const on = (k: string) => (Deno.env.get(k) ?? '').trim().toLowerCase() === 'true';
  const threshold = resolveMediaAutoSaveThreshold(Deno.env.get('MEDIA_AUTO_SAVE_THRESHOLD'));
  return {
    mediaFallbackEnabled: on('MEDIA_FALLBACK_ENABLED'),
    instagramResolverEnabled: on('INSTAGRAM_MEDIA_RESOLVER_ENABLED'),
    tiktokResolverEnabled: on('TIKTOK_MEDIA_RESOLVER_ENABLED'),
    youtubeResolverEnabled: on('YOUTUBE_MEDIA_RESOLVER_ENABLED'),
    facebookResolverEnabled: on('FACEBOOK_MEDIA_RESOLVER_ENABLED'),
    snapchatResolverEnabled: on('SNAPCHAT_MEDIA_RESOLVER_ENABLED'),
    canaryUserId: (Deno.env.get('PHASE2_CANARY_USER_ID') ?? '').trim() || null,
    autoSaveEnabled: on('MEDIA_AUTO_SAVE_ENABLED'),
    autoSaveCanaryUserId: (Deno.env.get('MEDIA_AUTO_SAVE_CANARY_USER_ID') ?? '').trim() || null,
    autoSaveThreshold: threshold.value,
    autoSaveThresholdValid: threshold.valid,
  };
}

function mediaAutoSaveEnabledForUser(
  flags: ReturnType<typeof readMediaFlags>,
  userId: string,
): boolean {
  return mediaAutoSaveAuthorized({
    enabled: flags.autoSaveEnabled,
    canaryUserId: flags.autoSaveCanaryUserId,
    userId,
  });
}

async function mediaTaskExistsFor(admin: any, jobId: string): Promise<boolean> {
  const { data } = await admin
    .from('share_media_tasks')
    .select('id')
    .eq('share_job_id', jobId)
    .maybeSingle();
  return !!data;
}

// Enqueue exactly one media task and PARK the parent. No needs_help
// notification is sent yet — the media worker (or the recovery sweep) decides.
async function enqueueMediaTask(
  admin: any,
  job: any,
  platform: string,
  canonicalUrl: string,
  sourceUrl: string,
  options: { parkParent?: boolean; parkPatch?: Record<string, unknown> } = {},
): Promise<void> {
  // Persist the best metadata review contract before the media task can run.
  // A failed media lookup may enrich this state, but must never erase known
  // candidates and strand the user in blank manual search.
  if (options.parkParent !== false && options.parkPatch) {
    const { error: parkSnapshotError } = await admin
      .from('share_jobs')
      .update({ ...options.parkPatch, progress_stage: 'checking_video' })
      .eq('id', job.id)
      .eq('status', 'processing_metadata');
    if (parkSnapshotError) throw new Error(`park_media_review_failed: ${parkSnapshotError.message}`);
  }
  const { error: insErr } = await admin.from('share_media_tasks').insert({
    share_job_id: job.id,
    user_id: job.user_id,
    source_url: sourceUrl,
    canonical_url: canonicalUrl,
    platform,
    status: 'queued',
    progress_stage: 'queued',
  });
  // A concurrent insert (unique share_job_id) is fine — one task per job.
  if (insErr && !/duplicate key|unique|23505/i.test(insErr.message ?? '')) {
    throw new Error(`enqueue_media_task_failed: ${insErr.message}`);
  }
  // Park the parent WITHOUT a lease. claim_share_jobs only reclaims a
  // processing_metadata row when locked_until IS NOT NULL and in the past, so a
  // NULL lease means the metadata claim NEVER steals it. Bounded recovery is
  // handled explicitly by recoverStrandedMediaJobs(), not by lease expiry.
  if (options.parkParent !== false) {
    await admin
      .from('share_jobs')
      .update({ progress_stage: 'checking_video', locked_until: null })
      .eq('id', job.id)
      .eq('status', 'processing_metadata');
  }
}

async function markMediaTask(
  admin: any,
  taskId: string,
  status: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin.from('share_media_tasks').update({ status, ...patch }).eq('id', taskId);
}

/** Guard supplemental task state by the generation snapshot. The row is
 * reusable across source changes/corrections, so id alone is not ownership. */
async function markVideoAiNoteTask(
  admin: any,
  task: any,
  status: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  let query = admin
    .from('share_media_tasks')
    .update({ status, ...patch })
    .eq('id', task.id)
    .eq('task_kind', 'ai_note_enrichment')
    .eq('saved_place_id', task.saved_place_id)
    .eq('target_place_id', task.target_place_id)
    .eq('source_url', task.source_url);
  query = task.canonical_url == null
    ? query.is('canonical_url', null)
    : query.eq('canonical_url', task.canonical_url);
  const { data, error } = await query.select('id');
  if (error) throw new Error(`ai_note_task_update_failed: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

function boundedJson(value: unknown, max = 8000): unknown {
  try {
    const s = JSON.stringify(value);
    if (!s) return null;
    if (s.length <= max) return value;
    return { truncated: true, preview: s.slice(0, max) };
  } catch {
    return null;
  }
}

// Append a service-role-only diagnostics row. Never stores media URLs, signed
// URLs, secrets, or raw bytes; caller passes only sanitized summaries.
async function insertMediaRun(
  admin: any,
  task: any,
  job: any,
  body: any,
  evidenceSummary: unknown,
): Promise<string | null> {
  try {
    const d = body?.diagnostics && typeof body.diagnostics === 'object' ? body.diagnostics : {};
    const int = (v: unknown) => (Number.isFinite(v) ? Number(v) : null);
    const premiumDiagnostics = body?.premiumRecognition?.telemetry &&
      typeof body.premiumRecognition.telemetry === 'object'
      ? {
          inferenceFingerprint: body.premiumRecognition.telemetry.inferenceFingerprint ?? null,
          solBoundary: body.premiumRecognition.telemetry.solBoundary ?? null,
          canonicalizationFingerprint: body.premiumRecognition.telemetry.canonicalizationFingerprint ?? null,
          finalFingerprint: body.premiumRecognition.telemetry.finalFingerprint ?? null,
        }
      : null;
    const { data, error } = await admin.from('share_media_runs').insert({
      share_media_task_id: task.id,
      share_job_id: job.id,
      user_id: job.user_id,
      platform: task.platform,
      resolver_name: typeof d.resolverName === 'string' ? d.resolverName : null,
      model_provider: typeof d.modelProvider === 'string' ? d.modelProvider : null,
      transcription_provider: typeof d.transcriptionProvider === 'string' ? d.transcriptionProvider : null,
      duration_ms: int(d.durationMs),
      media_duration_seconds: int(d.mediaDurationSeconds),
      frame_count: int(d.frameCount),
      transcript_segment_count: int(d.transcriptSegmentCount),
      ocr_segment_count: int(d.ocrSegmentCount),
      evidence: boundedJson({
        ...evidenceSummary,
        ...(premiumDiagnostics ? { premiumDiagnostics } : {}),
      }),
      model_output: boundedJson(d.modelOutput ?? null),
      warnings: Array.isArray(d.warnings) ? d.warnings.slice(0, 24) : [],
      errors: Array.isArray(d.errors) ? d.errors.slice(0, 24) : [],
    }).select('id').single();
    if (error) throw error;
    return typeof data?.id === 'string' ? data.id : null;
  } catch (err) {
    console.log(`[media-task] diagnostics_insert_failed task_id=${task.id} msg=${truncate((err as Error)?.message)}`);
    return null;
  }
}

async function persistBlockedPlaceResult(
  admin: any,
  args: {
    job: any;
    task: any;
    mediaRunId: string | null;
    mentionResult: any;
    outcome: 'candidate_confirmation' | 'manual_fallback' | 'failed';
    confidenceScore: number | null;
    reasonCodes: string[];
  },
): Promise<void> {
  const candidate = args.mentionResult.candidates?.[0] ?? null;
  const { error } = await admin.from('share_job_place_results').upsert({
    share_job_id: args.job.id,
    share_media_task_id: args.task.id,
    share_media_run_id: args.mediaRunId,
    user_id: args.job.user_id,
    logical_result_id: args.mentionResult.mentionId,
    google_place_id: candidate?.googlePlaceId ?? null,
    outcome: args.outcome,
    origin: 'automatic',
    confidence_score: args.confidenceScore,
    rule_version: MEDIA_AUTO_SAVE_RULE_VERSION,
    reason_codes: args.reasonCodes,
    finalized_at: nowIso(),
  }, { onConflict: 'share_job_id,logical_result_id' });
  if (error) throw new Error(`place_result_upsert_failed: ${error.message}`);
}

const POST_SAVE_ENRICHMENT_RULE_VERSION = 'post-save-enrichment.v1';
const VIDEO_AI_NOTE_RULE_VERSION = 'video-ai-note-authenticity.v3';
const MAX_AI_NOTE_GENERATION_RETRY_CYCLES = 1;

/**
 * Finalize the supplemental task against the authoritative saved place. This
 * path never invokes recognition or save/upsert logic: the place is final, and
 * the only permitted product-data write is fill-if-blank `ai_note` while the
 * same source URL is still attached.
 */
async function finalizeVideoAiNoteTask(
  admin: any,
  task: any,
  body: any,
  logFinalStatus: (status: string, errorClass?: string | null) => void,
): Promise<Response> {
  if (['completed', 'needs_help', 'failed', 'cancelled'].includes(task.status)) {
    logFinalStatus('idempotent_task_terminal');
    return json({ ok: true, idempotent: true, taskStatus: task.status });
  }

  const { data: saved, error: savedError } = await admin
    .from('saved_places')
    .select('id,user_id,place_id,source_url,source_type,notes,ai_note,place:places(id,name)')
    .eq('id', task.saved_place_id)
    .eq('user_id', task.user_id)
    .maybeSingle();
  if (savedError) throw new Error(`ai_note_target_lookup_failed: ${savedError.message}`);
  const finalPlace = Array.isArray(saved?.place) ? saved.place[0] : saved?.place;
  if (!saved?.id || !finalPlace?.name) {
    await markVideoAiNoteTask(admin, task, 'failed', {
      failure_code: 'ai_note_target_missing',
      ai_note_outcome: 'target_missing',
      progress_stage: 'cleanup',
      completed_at: nowIso(),
    });
    logFinalStatus('target_missing', 'permanent_processing_error');
    return json({ ok: true, route: 'ai_note_enrichment', enriched: false, reason: 'target_missing' });
  }

  if ((saved.ai_note ?? '').trim()) {
    await markVideoAiNoteTask(admin, task, 'completed', {
      failure_code: null,
      ai_note_outcome: 'already_present',
      progress_stage: 'cleanup',
      completed_at: nowIso(),
    });
    logFinalStatus('already_present');
    return json({ ok: true, route: 'ai_note_enrichment', enriched: false, alreadyPresent: true });
  }

  const callbackTargetPlaceId = typeof body.targetPlaceId === 'string'
    ? body.targetPlaceId
    : null;
  const callbackTargetSourceUrl = typeof body.targetSourceUrl === 'string'
    ? body.targetSourceUrl
    : null;
  const taskSourceUrl = task.canonical_url || task.source_url;
  if (!videoAiNoteCallbackMatchesTarget({
    savedPlaceId: saved.place_id,
    taskPlaceId: task.target_place_id,
    callbackPlaceId: callbackTargetPlaceId,
    savedSourceUrl: saved.source_url,
    taskSourceUrl,
    callbackSourceUrl: callbackTargetSourceUrl,
  })) {
    // The reusable task row was reset for a correction after this worker run
    // began. Never let Place A's callback modify Place B or its queued work.
    logFinalStatus('stale_target', 'claim_conflict');
    return json({ ok: true, route: 'ai_note_enrichment', enriched: false, reason: 'stale_target' });
  }

  const representedSource = taskSourceUrl;
  if (
    !representedSource ||
    saved.source_url !== representedSource ||
    (saved.source_type ?? '').trim().toLowerCase() === 'manual'
  ) {
    await markVideoAiNoteTask(admin, task, 'completed', {
      failure_code: 'ai_note_source_changed',
      ai_note_outcome: 'stale_source',
      progress_stage: 'cleanup',
      completed_at: nowIso(),
    });
    logFinalStatus('stale_source', 'claim_conflict');
    return json({ ok: true, route: 'ai_note_enrichment', enriched: false, reason: 'stale_source' });
  }

  const outcome = typeof body.outcome === 'string' ? body.outcome : 'failed';
  const parsed = outcome === 'evidence'
    ? parseMediaEvidence(body.evidence)
    : ({ ok: false, error: outcome } as const);
  const targetName = normalizeVenueName(finalPlace.name);
  const matches = parsed.ok
    ? parsed.value.places.filter(
        (place: any) => normalizeVenueName(place.name ?? '') === targetName,
      )
    : [];

  const targetMatch = matches.length === 1
    ? 'matched'
    : matches.length > 1
      ? 'ambiguous'
      : 'missing';
  const noteResult = matches.length === 1
    ? evaluateDeliverableAiPlaceNote({
        placeName: finalPlace.name,
        proposedNote: matches[0].memoryCue,
        evidence: matches[0].memoryCueEvidence ?? [],
      })
    : { note: null, status: 'insufficient_evidence', reason: null, groundedFallbackUsed: false };

  const diagnostics = body?.diagnostics ?? {};
  const diagnosticPatch = {
    analysis_provider: typeof diagnostics.modelProvider === 'string'
      ? diagnostics.modelProvider.slice(0, 120)
      : null,
    analysis_model: typeof diagnostics.modelName === 'string'
      ? diagnostics.modelName.slice(0, 160)
      : null,
    prompt_version: typeof diagnostics.promptVersion === 'string'
      ? diagnostics.promptVersion.slice(0, 160)
      : null,
    latency_ms: Number.isFinite(diagnostics.durationMs)
      ? Math.max(0, Math.round(diagnostics.durationMs))
      : null,
    model_calls: Number.isFinite(diagnostics.modelCalls)
      ? Math.max(0, Math.round(diagnostics.modelCalls))
      : null,
    model_input_tokens: Number.isFinite(diagnostics.modelInputTokens)
      ? Math.max(0, Math.round(diagnostics.modelInputTokens))
      : null,
    model_output_tokens: Number.isFinite(diagnostics.modelOutputTokens)
      ? Math.max(0, Math.round(diagnostics.modelOutputTokens))
      : null,
    model_thinking_tokens: Number.isFinite(diagnostics.modelThinkingTokens)
      ? Math.max(0, Math.round(diagnostics.modelThinkingTokens))
      : null,
    model_latency_ms: Number.isFinite(diagnostics.modelLatencyMs)
      ? Math.max(0, Math.round(diagnostics.modelLatencyMs))
      : null,
  };

  if (!noteResult.note) {
    const failureCode = outcome !== 'evidence'
      ? `ai_note_${outcome}`
      : targetMatch !== 'matched'
        ? `ai_note_target_${targetMatch}`
        : `ai_note_${noteResult.status}${noteResult.reason ? `_${noteResult.reason}` : ''}`;
    const observableEvidenceCount = [
      diagnostics.frameCount,
      diagnostics.transcriptSegmentCount,
      diagnostics.ocrSegmentCount,
      diagnostics.noteInputEvidenceCount,
      diagnostics.metadataTextPresent ? 1 : 0,
      Array.isArray(task.evidence_snapshot) ? task.evidence_snapshot.length : 0,
    ].reduce((total, value) => total + (Number(value) || 0), 0);
    const disposition = classifyVideoAiNoteFailure({
      outcome,
      errorCodes: Array.isArray(diagnostics.errors) ? diagnostics.errors : [],
      observableEvidenceCount,
      mediaAcquiredOnce: task.media_acquired_once === true,
    });
    const retryCycles = Math.max(0, Number(task.retry_cycles) || 0);
    const generationRetryExhausted =
      disposition === 'retry_after_generation' &&
      retryCycles >= MAX_AI_NOTE_GENERATION_RETRY_CYCLES;
    const terminalDisposition = generationRetryExhausted
      ? 'omitted_after_generation_failure'
      : disposition;
    if (disposition !== 'awaiting_evidence' && !generationRetryExhausted) {
      const delaySeconds = Math.min(86_400, 3_600 * 2 ** Math.min(retryCycles, 5));
      const updatedTask = await markVideoAiNoteTask(admin, task, 'queued', {
        ...diagnosticPatch,
        attempts: 0,
        retry_cycles: retryCycles + 1,
        next_attempt_at: addSecondsIso(delaySeconds),
        failure_code: failureCode.slice(0, 200),
        ai_note_outcome: disposition,
        progress_stage: 'queued',
        locked_at: null,
        locked_until: null,
        completed_at: null,
      });
      if (!updatedTask) {
        logFinalStatus('stale_target_during_retry', 'claim_conflict');
        return json({ ok: true, route: 'ai_note_enrichment', enriched: false, reason: 'stale_target' });
      }
    } else {
      const updatedTask = await markVideoAiNoteTask(admin, task, 'failed', {
        ...diagnosticPatch,
        failure_code: failureCode.slice(0, 200),
        ai_note_outcome: terminalDisposition,
        progress_stage: 'cleanup',
        locked_until: null,
        completed_at: nowIso(),
      });
      if (!updatedTask) {
        logFinalStatus('stale_target_during_evidence_wait', 'claim_conflict');
        return json({ ok: true, route: 'ai_note_enrichment', enriched: false, reason: 'stale_target' });
      }
    }
    console.log(JSON.stringify({
      event: 'video_ai_note_enrichment',
      savedPlaceId: saved.id,
      taskId: task.id,
      videoDerived: true,
      generationAttempted: outcome === 'evidence' || outcome === 'insufficient_evidence',
      generationOutcome: terminalDisposition,
      targetMatch,
      retryCount: Number(task.attempts) || 0,
      provider: diagnosticPatch.analysis_provider,
      model: diagnosticPatch.analysis_model,
      latencyMs: diagnosticPatch.latency_ms,
      modelCalls: diagnosticPatch.model_calls,
      modelInputTokens: diagnosticPatch.model_input_tokens,
      modelOutputTokens: diagnosticPatch.model_output_tokens,
      modelThinkingTokens: diagnosticPatch.model_thinking_tokens,
      modelLatencyMs: diagnosticPatch.model_latency_ms,
      errorClass: failureCode,
      userNotePreserved: true,
      ruleVersion: VIDEO_AI_NOTE_RULE_VERSION,
    }));
    logFinalStatus(
      disposition !== 'awaiting_evidence' && !generationRetryExhausted
        ? 'note_retry_scheduled'
        : generationRetryExhausted
          ? 'note_omitted_after_generation_failure'
          : 'note_awaiting_evidence',
      disposition === 'retry_after_outage'
        ? 'transient_provider_error'
        : disposition === 'retry_after_generation'
          ? 'generation_quality_error'
          : 'literal_information_absence',
    );
    return json({
      ok: true,
      route: 'ai_note_enrichment',
      enriched: false,
      reason: failureCode,
      disposition: terminalDisposition,
    });
  }

  let update = admin
    .from('saved_places')
    .update({ ai_note: noteResult.note })
    .eq('id', saved.id)
    .eq('user_id', saved.user_id)
    .eq('place_id', task.target_place_id)
    .eq('source_url', representedSource);
  update = saved.ai_note == null
    ? update.is('ai_note', null)
    : update.eq('ai_note', saved.ai_note);
  const { data: updated, error: updateError } = await update.select('id');
  if (updateError) throw new Error(`ai_note_write_failed: ${updateError.message}`);

  if (!Array.isArray(updated) || updated.length !== 1) {
    const { data: current } = await admin
      .from('saved_places')
      .select('ai_note,place_id,source_url')
      .eq('id', saved.id)
      .maybeSingle();
    if ((current?.ai_note ?? '').trim()) {
      await markVideoAiNoteTask(admin, task, 'completed', {
        ...diagnosticPatch,
        failure_code: null,
        ai_note_outcome: 'already_present',
        progress_stage: 'cleanup',
        locked_until: null,
        completed_at: nowIso(),
      });
      logFinalStatus('concurrent_note_preserved');
      return json({ ok: true, route: 'ai_note_enrichment', enriched: false, alreadyPresent: true });
    }
    if (current?.place_id !== task.target_place_id || current?.source_url !== representedSource) {
      logFinalStatus('stale_target_after_guard', 'claim_conflict');
      return json({ ok: true, route: 'ai_note_enrichment', enriched: false, reason: 'stale_target' });
    }
    const exhausted = Number(task.attempts) >= Number(task.max_attempts);
    const retryCycles = Math.max(0, Number(task.retry_cycles) || 0);
    const updatedTask = await markVideoAiNoteTask(admin, task, 'queued', {
      ...diagnosticPatch,
      attempts: exhausted ? 0 : Number(task.attempts) || 0,
      retry_cycles: exhausted ? retryCycles + 1 : retryCycles,
      next_attempt_at: exhausted
        ? addSecondsIso(Math.min(86_400, 3_600 * 2 ** Math.min(retryCycles, 5)))
        : addSecondsIso(60),
      failure_code: 'ai_note_guard_conflict',
      ai_note_outcome: 'retry_after_guard_conflict',
      progress_stage: 'queued',
      locked_at: null,
      locked_until: null,
      completed_at: null,
    });
    if (!updatedTask) {
      logFinalStatus('stale_target_during_guard_retry', 'claim_conflict');
      return json({ ok: true, route: 'ai_note_enrichment', enriched: false, reason: 'stale_target' });
    }
    logFinalStatus('guard_conflict_retry_scheduled', 'claim_conflict');
    return json({ ok: true, route: 'ai_note_enrichment', enriched: false, reason: 'guard_conflict_retry' });
  }

  await markVideoAiNoteTask(admin, task, 'completed', {
    ...diagnosticPatch,
    failure_code: null,
    ai_note_outcome: 'generated',
    progress_stage: 'cleanup',
    locked_until: null,
    completed_at: nowIso(),
  });
  console.log(JSON.stringify({
    event: 'video_ai_note_enrichment',
    savedPlaceId: saved.id,
    taskId: task.id,
    videoDerived: true,
    aiNotePresent: true,
    generationAttempted: true,
    generationOutcome: 'generated',
    groundedFallbackUsed: noteResult.groundedFallbackUsed,
    targetMatch,
    retryCount: Number(task.attempts) || 0,
    provider: diagnosticPatch.analysis_provider,
    model: diagnosticPatch.analysis_model,
    latencyMs: diagnosticPatch.latency_ms,
    modelCalls: diagnosticPatch.model_calls,
    modelInputTokens: diagnosticPatch.model_input_tokens,
    modelOutputTokens: diagnosticPatch.model_output_tokens,
    modelThinkingTokens: diagnosticPatch.model_thinking_tokens,
    modelLatencyMs: diagnosticPatch.model_latency_ms,
    errorClass: null,
    userNotePreserved: true,
    ruleVersion: VIDEO_AI_NOTE_RULE_VERSION,
  }));
  logFinalStatus('note_stored');
  return json({
    ok: true,
    route: 'ai_note_enrichment',
    enriched: true,
    savedPlaceId: saved.id,
    groundedFallbackUsed: noteResult.groundedFallbackUsed,
  });
}

/**
 * Enrich a metadata-auto-saved row without invoking any save/upsert path.
 * Provider identity is the join key: a fuzzy name match is never sufficient.
 * Other logical places are recorded independently for audit/review, but this
 * supplemental callback cannot reopen the completed parent or create places.
 */
async function finalizePostSaveEnrichment(
  admin: any,
  args: {
    job: any;
    task: any;
    taskId: string;
    mediaRunId: string | null;
    result: any;
    mentionResults: any[];
    aiNoteByMentionId: Map<string, string | null>;
    parsed: any;
    sourceMetadata: MediaSourceMetadata | null;
  },
): Promise<Response> {
  const { job, task, taskId, mediaRunId, result, mentionResults, aiNoteByMentionId, parsed, sourceMetadata } = args;
  const { data: saved, error: savedError } = await admin
    .from('saved_places')
    .select('id,user_id,place_id,notes,ai_note,place:places(id,google_place_id,name)')
    .eq('id', job.saved_place_id)
    .eq('user_id', job.user_id)
    .maybeSingle();
  if (savedError) throw new Error(`post_save_target_lookup_failed: ${savedError.message}`);
  const targetPlace = Array.isArray(saved?.place) ? saved.place[0] : saved?.place;
  const targetProviderId = targetPlace?.google_place_id ?? null;
  if (!saved?.id || !saved?.place_id || !targetProviderId) {
    await markMediaTask(admin, taskId, 'failed', {
      failure_code: 'post_save_target_missing_provider',
      progress_stage: 'cleanup',
      completed_at: nowIso(),
    });
    console.log(JSON.stringify({
      event: 'media_identity_disagreement',
      jobId: job.id,
      taskId,
      savedPlaceId: job.saved_place_id,
      savedProviderId: targetProviderId,
      mediaProviderIds: [],
      action: 'withhold_note',
      reason: 'authoritative_target_missing',
    }));
    return json({ ok: true, route: 'post_save_enrichment', enriched: false, reason: 'target_missing' });
  }

  const matches = mentionResults.filter((mention: any) =>
    Array.isArray(mention.candidates) &&
    mention.candidates.some((candidate: any) => candidate.googlePlaceId === targetProviderId)
  );
  const aggregateCandidate = Array.isArray(result?.candidates)
    ? result.candidates.find((candidate: any) => candidate.googlePlaceId === targetProviderId)
    : null;
  const mediaProviderIds = [...new Set([
    ...(result?.candidates ?? []).map((candidate: any) => candidate.googlePlaceId),
    ...mentionResults.flatMap((mention: any) =>
      (mention.candidates ?? []).map((candidate: any) => candidate.googlePlaceId)),
  ].filter(Boolean))];

  let matchedMention: any | null = matches.length === 1 ? matches[0] : null;
  let logicalResultId = matchedMention?.mentionId ?? 'post-save-primary';
  let aiNote = matchedMention ? (aiNoteByMentionId.get(matchedMention.mentionId) ?? null) : null;
  let identityMatched = !!matchedMention;

  // Legacy address-only resolver results do not expose mentionResults. They
  // may still enrich when their one exact provider candidate matches; scope
  // the cue by normalized place name, never by fuzzy provider identity.
  if (!identityMatched && mentionResults.length === 0 && aggregateCandidate) {
    identityMatched = true;
    const matchingEvidencePlace = parsed?.ok
      ? parsed.value.places.find(
          (place: any) => normalizeVenueName(place.name ?? '') === normalizeVenueName(aggregateCandidate.name ?? ''),
        )
      : null;
    aiNote = matchingEvidencePlace
      ? generateAiPlaceNote({
          placeName: aggregateCandidate.name,
          proposedNote: matchingEvidencePlace.memoryCue,
          evidence: matchingEvidencePlace.memoryCueEvidence ?? [],
        })
      : null;
  }

  if (!identityMatched || matches.length > 1) {
    console.log(JSON.stringify({
      event: 'media_identity_disagreement',
      jobId: job.id,
      taskId,
      savedPlaceId: saved.id,
      savedProviderId: targetProviderId,
      mediaProviderIds,
      matchingMentionCount: matches.length,
      action: 'preserve_saved_identity_and_withhold_note',
    }));
    aiNote = null;
  }

  for (const mentionResult of mentionResults) {
    if (matchedMention && mentionResult.mentionId === matchedMention.mentionId) continue;
    const blockedOutcome = mentionResult.outcome === 'provider_error'
      ? 'failed'
      : mentionResult.outcome === 'no_match' || mentionResult.outcome === 'rejected_insufficient_evidence'
      ? 'manual_fallback'
      : 'candidate_confirmation';
    await persistBlockedPlaceResult(admin, {
      job,
      task,
      mediaRunId,
      mentionResult,
      outcome: blockedOutcome,
      confidenceScore: typeof mentionResult.confidenceScore === 'number' ? mentionResult.confidenceScore : null,
      reasonCodes: [
        matchedMention ? 'post_save_secondary_logical_place' : 'post_save_identity_disagreement',
      ],
    });
  }

  let aiNoteSave: 'stored' | 'skipped' | 'failed' = 'skipped';
  if (aiNote && !(saved.ai_note ?? '').trim()) {
    aiNoteSave = await persistAiNoteSupplementally(aiNote, async (note) => {
      // PROVENANCE: this job's metadata auto-save may have REUSED a saved place
      // that already carried a different post, in which case the row does not
      // represent this media — and a cue from it would caption the attached
      // post with another post's words.
      let update = admin
        .from('saved_places')
        .update({ ai_note: note })
        .eq('id', saved.id)
        .eq('user_id', job.user_id)
        .eq('source_url', task.canonical_url || task.source_url);
      update = saved.ai_note == null
        ? update.is('ai_note', null)
        : update.eq('ai_note', saved.ai_note);
      const { error } = await update;
      if (error) throw error;
    });
    if (aiNoteSave === 'failed') {
      console.warn(`[media-task] supplemental ai note save failed task_id=${taskId}`);
    }
  }

  // The source child owns this video's context even when the compatibility
  // saved_places row still represents an earlier primary video.
  await attachSavedPlaceSource({
    admin,
    userId: job.user_id,
    savedPlaceId: saved.id,
    sourceUrl: task.source_url,
    sourceType: task.platform,
    resolvedUrl: task.canonical_url || task.source_url,
    creatorHandle: sourceMetadata?.creatorHandle ?? null,
    creatorName: sourceMetadata?.creatorName ?? null,
    caption: sourceMetadata?.description ?? null,
    aiNote,
  });

  // Publish the authoritative per-place completion only after the note write.
  // share_job_place_results is already in Supabase Realtime, so this becomes
  // the app's cache-refresh signal without a saved_places publication change.
  if (identityMatched) {
    const candidate = matchedMention
      ? matchedMention.candidates.find((entry: any) => entry.googlePlaceId === targetProviderId)
      : aggregateCandidate;
    const { error: resultError } = await admin.from('share_job_place_results').upsert({
      share_job_id: job.id,
      share_media_task_id: task.id,
      share_media_run_id: mediaRunId,
      user_id: job.user_id,
      logical_result_id: logicalResultId,
      google_place_id: targetProviderId,
      place_id: saved.place_id,
      saved_place_id: saved.id,
      outcome: 'already_saved',
      origin: 'automatic',
      confidence_score: typeof candidate?.confidenceScore === 'number' ? candidate.confidenceScore : null,
      rule_version: POST_SAVE_ENRICHMENT_RULE_VERSION,
      reason_codes: [aiNote ? 'ai_note_grounded' : 'no_useful_memory_cue'],
      finalized_at: nowIso(),
    }, { onConflict: 'share_job_id,logical_result_id' });
    if (resultError) throw new Error(`post_save_result_upsert_failed: ${resultError.message}`);
  }

  await markMediaTask(admin, taskId, 'completed', {
    resolver_name: 'media-post-save-enrichment',
    progress_stage: 'cleanup',
    completed_at: nowIso(),
  });
  console.log(JSON.stringify({
    event: 'post_save_enrichment_completed',
    jobId: job.id,
    taskId,
    savedPlaceId: saved.id,
    providerId: targetProviderId,
    identityMatched,
    noteStatus: aiNoteSave,
    userNotePreserved: true,
  }));
  return json({
    ok: true,
    route: 'post_save_enrichment',
    enriched: aiNoteSave === 'stored',
    identityMatched,
    savedPlaceId: saved.id,
  });
}

// Move a parent job to its best safe needs_help state after unusable media.
// The persisted metadata snapshot wins; manual search is used only when that
// snapshot truly has zero candidates.
async function finalizeParentManual(
  admin: any,
  job: any,
  presentation: {
    failureCode?: string | null;
    analysisAttempted?: boolean;
    provider?: string | null;
    notificationLocality?: NotificationLocality | null;
    hasWeakClues?: boolean;
    evidenceFrames?: unknown;
    premiumCostComponents?: Record<string, unknown>;
    skipRecognitionCachePersist?: boolean;
  } = {},
  sourceMetadata: MediaSourceMetadata | null = null,
): Promise<void> {
  const candidateCount = persistedCandidateCount(job?.candidate_payload);
  const fallback = mediaFailureReview(job?.candidate_payload);
  const mode = fallback.mode === 'auto' ? 'single' : fallback.mode;
  const candidates = Array.isArray(job?.candidate_payload?.candidates)
    ? job.candidate_payload.candidates
    : [];
  const mentionSlots = Array.isArray(job?.candidate_payload?.mentionSlots)
    ? job.candidate_payload.mentionSlots
    : [];
  const failureCode = presentation.failureCode ?? 'media_failed';
  const analysisAttempted = presentation.analysisAttempted === true;
  const failureCategory = classifyShareFailure({
    failureCode,
    provider: presentation.provider,
    analysisAttempted,
  });
  const terminalStatus = candidateCount === 0 && failureCategory === 'technical_failure'
    ? 'failed'
    : 'needs_help';
  const evidenceFrames = normalizeEvidenceFrames(presentation.evidenceFrames);
  const candidatePayload = evidenceFrames.length > 0
    ? {
        ...(job?.candidate_payload && typeof job.candidate_payload === 'object'
          ? job.candidate_payload
          : {}),
        evidenceFrames,
      }
    : job?.candidate_payload ?? null;
  await finalize(
    admin,
    job,
    {
      status: terminalStatus,
      decision: terminalStatus === 'failed' ? 'failed' : fallback.decision,
      needs_help_reason: candidateCount > 0 ? 'media_unavailable_candidates_preserved' : failureCode,
      failure_reason: failureCode,
      failure_code: failureCode,
      failure_category: failureCategory,
      analysis_attempted: analysisAttempted,
      candidate_payload: candidatePayload,
      ...(presentation.premiumCostComponents
        ? { premium_cost_components: presentation.premiumCostComponents }
        : {}),
      ...(presentation.skipRecognitionCachePersist
        ? { __skipRecognitionCachePersist: true }
        : {}),
      ...(candidateCount === 0 ? { suggested_query: null } : {}),
      ...(sourceMetadata
        ? {
            extraction_payload: withRetainedSourceMetadata(
              job?.extraction_payload,
              { platform: job?.source_platform ?? null, via: 'media' },
              sourceMetadata,
            ),
          }
        : {}),
      progress_stage: mode,
    },
    reviewNotification({
      mode,
      jobId: job.id,
      candidates,
      mentionResults: mentionSlots,
      notificationLocality: presentation.notificationLocality,
      hasWeakClues: presentation.hasWeakClues,
      failureCategory,
      failureCode,
      provider: presentation.provider,
      analysisAttempted,
    }),
  );
}

// Explicit, bounded recovery for parents whose media task can no longer make
// progress. Runs every worker cycle (defensive try/catch). Replaces the removed
// far-future-lease rescue: a parent parked in processing_metadata is finalized
// to needs_help(manual) as soon as its media task becomes terminal-failed /
// cancelled (worker crashed, exhausted retries, or a rollback stopped it). Safe
// no-op when there are no media tasks (flags off), so Phase 1 is unaffected.
async function recoverStrandedMediaJobs(admin: any): Promise<void> {
  try {
    // 1. Reap tasks that exhausted their retry budget → failed.
    await admin.rpc('expire_media_tasks', { p_limit: 25 });
    // 2. Finalize parents still parked despite a terminal-failed/cancelled task.
    const { data: parents, error } = await admin.rpc('claim_stranded_media_parents', { p_limit: 25 });
    if (error) {
      console.log(`[media-task] recovery_claim_error msg=${truncate(error.message)}`);
      return;
    }
    for (const job of Array.isArray(parents) ? parents : []) {
      await finalizeParentManual(admin, job, {
        failureCode: 'media_failed',
        analysisAttempted: false,
        provider: job.source_platform,
      });
      console.log(`[media-task] recovered_stranded_parent job_id=${job.id}`);
    }
  } catch (err) {
    console.log(`[media-task] recovery_sweep_error msg=${truncate((err as Error)?.message)}`);
  }
}

// Media worker callback. Converts proposed evidence into the SAME deterministic
// resolver + safeToAutoSave + save path used by the metadata flow. The video
// model never picks a Place ID, never decides safeToAutoSave, and never saves.
// ALL routing decisions come from the pure mediaFinalizePlan module.
//
// Idempotency: a terminal task is always a no-op. A completed parent with an
// authoritative saved_place_id may receive supplemental enrichment; every
// other parent outside processing_metadata remains immutable. The parent is
// ALWAYS derived from the task's FK, never trusted from the callback body.
async function finalizeMediaTask(
  admin: any,
  env: any,
  body: any,
  invocation: { id: string; startedAt: number },
): Promise<Response> {
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  if (!taskId) return json({ error: 'missing_task_id' }, 400);

  const { data: task } = await admin
    .from('share_media_tasks').select('*').eq('id', taskId).maybeSingle();
  if (!task) return json({ error: 'task_not_found' }, 404);

  // Parent derived from the task's FK (never from the body).
  const { data: job } = task.share_job_id
    ? await admin.from('share_jobs').select('*').eq('id', task.share_job_id).maybeSingle()
    : { data: null };

  const logFinalStatus = (finalStatus: string, errorClass: string | null = null) => {
    console.log(formatFinalizeReliabilityLog({
      invocationId: invocation.id,
      jobId: job?.id ?? task.share_job_id ?? 'missing',
      taskId,
      operation: 'finalize_media_task',
      attempt: Number(task.attempts) || 0,
      claimState: String(task.status ?? 'unknown'),
      elapsedMs: Date.now() - invocation.startedAt,
      finalStatus,
      errorClass,
    }));
  };

  if (task.task_kind === 'ai_note_enrichment') {
    return await finalizeVideoAiNoteTask(admin, task, body, logFinalStatus);
  }

  const outcome = typeof body.outcome === 'string' ? body.outcome : 'evidence';
  const failureCode = safeMediaFailureCode(body.failureCode);
  const analysisAttempted = body.analysisAttempted === true;
  const parsed = outcome === 'evidence' || outcome === 'partial_evidence'
    ? parseMediaEvidence(body.evidence)
    : ({ ok: false, error: outcome } as const);
  const evidenceFrames = normalizeEvidenceFrames(body.evidenceFrames);
  const rendered = parsed.ok
    ? renderMediaEvidenceCaption(parsed.value)
    : { title: '', description: '', renderedPlaces: 0 };
  const partialResult = parsed.ok ? buildVayrinPartialResult(parsed.value) : null;
  const notificationLocality = trustedMediaNotificationLocality(parsed) ?? (
    partialResult?.locality
      ? { label: partialResult.locality, basis: 'observable_corroborated' as const }
      : null
  );

  const pre = planPreResolve({
    taskStatus: task.status,
    parentStatus: job?.status ?? 'missing',
    parentSavedPlaceId: job?.saved_place_id ?? null,
    outcome,
    failureCode,
    evidenceParseOk: parsed.ok,
    renderedPlaces: rendered.renderedPlaces,
    // Count only a field-grounded partial. Parser-authored structure alone is
    // not enough to claim a useful result at this trust boundary.
    partialPlaces: partialResult ? 1 : 0,
  });

  // Terminal task → idempotent no-op (duplicate / replayed callback).
  if (pre.action === 'idempotent_task_terminal') {
    logFinalStatus('idempotent_task_terminal');
    return json({ ok: true, idempotent: true, taskStatus: pre.taskStatus });
  }

  if (!job) {
    await markMediaTask(admin, taskId, 'failed', { failure_code: 'parent_job_missing', completed_at: nowIso() });
    logFinalStatus('parent_job_missing', 'permanent_processing_error');
    return json({ error: 'parent_job_missing' }, 404);
  }

  // A TikTok short link may resolve only inside yt-dlp. Accept that discovery
  // at this trust boundary only when it is an exact TikTok post and does not
  // contradict a post id already known from the task input.
  const canonicalPlan = planMediaCanonicalUrl({
    platform: task.platform,
    sourceUrl: task.source_url,
    canonicalUrl: task.canonical_url,
    discoveredCanonicalUrl: body.canonicalUrl,
  });
  if (canonicalPlan.changed) {
    const { error: canonicalUpdateError } = await admin
      .from('share_media_tasks')
      .update({ canonical_url: canonicalPlan.canonicalUrl })
      .eq('id', taskId)
      .eq('status', task.status);
    if (canonicalUpdateError) {
      throw new Error(`media_canonical_update_failed: ${canonicalUpdateError.message}`);
    }
    task.canonical_url = canonicalPlan.canonicalUrl;
    if (job.status === 'processing_metadata') {
      const { error: jobCanonicalError } = await admin
        .from('share_jobs')
        .update({ canonical_url: canonicalPlan.canonicalUrl })
        .eq('id', job.id)
        .eq('status', 'processing_metadata');
      if (jobCanonicalError) {
        throw new Error(`job_canonical_update_failed: ${jobCanonicalError.message}`);
      }
      job.canonical_url = canonicalPlan.canonicalUrl;
    }
  }
  if (task.platform === 'tiktok') {
    console.log(
      `[media-task] canonical task_id=${taskId} accepted=${canonicalPlan.acceptedDiscoveredUrl} ` +
      `changed=${canonicalPlan.changed} reason=${canonicalPlan.reason}`,
    );
  }

  const sourceMetadata = mergeRetainedSourceMetadata(
    sourceMetadataFromExtractionPayload(job.extraction_payload),
    parseMediaSourceMetadata(body.sourceMetadata),
  );

  // Diagnostics for every actionable callback. The summary carries the whole
  // RECOGNITION FUNNEL — model places emitted, how many survived our schema,
  // how many were suppressed as geographic context, and how many reached the
  // resolver — so one persisted run explains an outcome without anyone needing
  // an uncapped raw model response. (During the Rio audit the 500-char preview
  // could not even enumerate the six emitted places.) The funnel's tail —
  // per-slot candidates and decisions — is already persisted on the job itself
  // in `candidate_payload.mentionSlots`.
  const evidenceSummary = parsed.ok
    ? {
        ...summarizeMediaEvidence(parsed.value),
        ...buildRecognitionFunnel(
          body?.diagnostics,
          parsed.value,
          rendered.renderedPlaces,
          sharedCountryForEvidence(parsed.value),
        ),
      }
    : { reason: outcome, ...buildRecognitionFunnel(body?.diagnostics, null, 0) };
  const mediaRunId = await insertMediaRun(admin, task, job, body, evidenceSummary);

  // Premium Sol already formed the identity and performed its tightly bounded
  // canonicalization. Map that typed result directly into the existing result
  // contract; never run legacy Places discovery or publish a machine cache row.
  const premium = task.task_kind === 'premium_recognition'
    ? premiumRuntimePlan(body.premiumRecognition)
    : null;
  if (task.task_kind === 'premium_recognition' && pre.action !== 'parent_already_terminal') {
    // A valid Premium payload is authoritative at this boundary. The legacy
    // media-evidence pre-resolver is useful for normal recognition but cannot
    // erase a typed, actionable Sol result merely because its lossy adapter
    // rendered zero old-style places. Acquisition/transport failures still
    // arrive without a Premium payload and retain the established release path.
    if (!premium && pre.action !== 'manual_fallback') {
      await markMediaTask(admin, taskId, 'failed', {
        failure_code: 'premium_model_failure', progress_stage: 'cleanup', completed_at: nowIso(),
      });
      logFinalStatus('premium_payload_invalid', 'permanent_processing_error');
      return json({ error: 'premium_payload_invalid' }, 400);
    }
    if (premium?.outcome === 'PREMIUM_ACTIONABLE_RESULT') {
      const taskCanonicalUrl = task.canonical_url || task.source_url;
      const candidates = premium.candidatePayload.candidates ?? [];
      const mentionSlots = premium.candidatePayload.mentionSlots ?? [];
      const canSave = premium.autoSaveCandidate &&
        typeof premium.autoSaveCandidate.latitude === 'number' &&
        typeof premium.autoSaveCandidate.longitude === 'number';
      if (canSave) {
        const saved = await saveForUser({
          client: admin,
          userId: job.user_id,
          candidate: premium.autoSaveCandidate,
          sourceUrl: taskCanonicalUrl,
          source: legacySourceFor(task.platform),
          sourceMetadata: {
            resolvedUrl: taskCanonicalUrl,
            creatorHandle: sourceMetadata?.creatorHandle ?? null,
            creatorName: sourceMetadata?.creatorName ?? null,
            caption: sourceMetadata?.description ?? null,
          },
        });
        await finalize(admin, job, {
          status: 'completed',
          decision: 'auto_save',
          saved_place_id: saved.savedPlaceId,
          candidate_payload: premium.candidatePayload,
          canonical_url: taskCanonicalUrl,
          source_platform: task.platform,
          premium_cost_components: premium.costs,
          __premiumChargeability: premium.chargeability,
          extraction_payload: {
            ...(job.extraction_payload ?? {}),
            premiumRecognition: { outcome: premium.outcome, chargeability: premium.chargeability },
          },
          __skipRecognitionCachePersist: true,
          progress_stage: 'completed',
          completed_at: nowIso(),
        }, composeShareCompletionNotification({
          status: 'completed', placeName: premium.autoSaveCandidate.name, jobId: job.id,
          savedPlaceId: saved.savedPlaceId, googlePlaceId: premium.autoSaveCandidate.googlePlaceId,
          alreadySaved: saved.reused,
        }));
        await markMediaTask(admin, taskId, 'completed', {
          resolver_name: 'premium-sol', progress_stage: 'cleanup', completed_at: nowIso(),
        });
        logFinalStatus('premium_auto_save');
        return json({ ok: true, route: 'auto_save', premium: true });
      }

      const hasCandidates = candidates.length > 0;
      const mode = mentionSlots.length > 1 || candidates.length > 1 ? 'picker' : hasCandidates ? 'single' : 'manual';
      await finalize(admin, job, {
        status: 'needs_help',
        decision: mentionSlots.length > 1 || candidates.length > 1 ? 'candidate_picker' : 'candidate_confirmation',
        needs_help_reason: hasCandidates ? 'premium_review_required' : 'premium_named_lead',
        suggested_query: premium.suggestedQuery,
        candidate_payload: premium.candidatePayload,
        canonical_url: taskCanonicalUrl,
        source_platform: task.platform,
        premium_cost_components: premium.costs,
        __premiumChargeability: premium.chargeability,
        extraction_payload: {
          ...(job.extraction_payload ?? {}),
          premiumRecognition: { outcome: premium.outcome, chargeability: premium.chargeability },
        },
        __skipRecognitionCachePersist: true,
        progress_stage: mode,
      }, reviewNotification({ jobId: job.id, mode, candidates, mentionResults: mentionSlots }));
      await markMediaTask(admin, taskId, 'completed', {
        resolver_name: 'premium-sol', progress_stage: 'cleanup', completed_at: nowIso(),
      });
      logFinalStatus('premium_review');
      return json({ ok: true, route: 'needs_help', mode, premium: true });
    }
  }

  // Parent already terminal → mark task done, never revive the parent.
  if (pre.action === 'parent_already_terminal') {
    await markMediaTask(admin, taskId, 'completed', { progress_stage: 'cleanup', completed_at: nowIso() });
    logFinalStatus('parent_already_terminal');
    return json({ ok: true, parentAlreadyTerminal: true, jobStatus: job.status });
  }

  // Media unusable / parse failure / no explicit places → safe manual fallback.
  if (pre.action === 'manual_fallback') {
    if (!pre.supplemental) {
      await finalizeParentManual(admin, job, {
        failureCode: pre.failureCode,
        analysisAttempted,
        provider: task.platform,
        notificationLocality,
        hasWeakClues: parsed.ok && parsed.value.places.some(
          (place: any) => place?.identityEvidenceKind !== 'model_prior' && place?.explicitEvidence?.length > 0,
        ),
        evidenceFrames,
        premiumCostComponents: premium?.costs,
        skipRecognitionCachePersist: task.task_kind === 'premium_recognition',
      }, sourceMetadata);
    }
    await markMediaTask(admin, taskId, pre.taskTerminalStatus, {
      failure_code: pre.failureCode,
      progress_stage: 'cleanup',
      completed_at: nowIso(),
    });
    console.log(`[media-task] finalize route=${pre.supplemental ? 'post_save_failed' : 'manual'} task_id=${taskId} reason=${pre.failureCode}`);
    logFinalStatus(pre.supplemental ? 'post_save_enrichment_failed' : 'manual', 'permanent_processing_error');
    return json({ ok: true, route: pre.supplemental ? 'post_save_enrichment' : 'manual', enriched: false, reason: pre.failureCode });
  }

  // pre.action === 'resolve' — reuse the EXISTING deterministic resolver.
  //
  // Source metadata the media resolver already fetched (post caption + the
  // author's handle) is normalized through the SAME `extractHandles` /
  // `extractEvidence` pipeline the ordinary metadata path uses — not a second
  // parser. Previously this passed an empty handle set and the model-rendered
  // caption only, so `venue_handle_tagged` could never be emitted from a media
  // job and a post that named its venue in text degraded to an address-only
  // guess. Absent/older payloads parse to null and behave exactly as before.
  const mediaSourceIdentity = sourceMetadata?.postId || sourceMetadata?.creatorHandle
    ? { postId: sourceMetadata.postId, creatorHandle: sourceMetadata.creatorHandle }
    : null;
  const handles = sourceMetadata
    ? extractHandles({
        platform: task.platform,
        title: sourceMetadata.title,
        description: sourceMetadata.description,
        html: null,
        // Excludes the creator from the venue set AND suppresses the
        // page-shaped "lone handle is the poster" shortcut, which would
        // otherwise mislabel a caption's single TAGGED venue as the poster.
        knownPosterHandle: sourceMetadata.creatorHandle,
      })
    : { posterHandle: null, taggedHandles: [], venueHandles: [], posterNameHint: null };
  const mergedCaption = mergeMediaCaption(sourceMetadata, rendered);
  const mediaEvidence = extractEvidence({
    platform: task.platform,
    title: mergedCaption.title,
    description: mergedCaption.description,
    handles,
    taggedLocation: null,
  });
  console.log(
    `[media-task] source_evidence task_id=${taskId} ` +
      Object.entries(
        summarizeSourceMetadata({
          source: sourceMetadata,
          venueHandles: handles.venueHandles,
          posterHandlePresent: !!handles.posterHandle,
          venueNameHints: mediaEvidence.venueNameHints,
          addressCount: mediaEvidence.addresses.length,
        }),
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
  );
  // Structured explicit venue-name mentions enable the name-driven multi-place
  // path (e.g. a "top 5 pizza" reel with names but no street addresses).
  const mediaMentions = parsed.ok
    ? buildVenueMentions(parsed.value)
    : { mentions: [], geoContext: { city: null, region: null, country: null }, relationships: [], partialMentions: 0 };
  if (partialResult) {
    console.log(
      `[media-task] partial_recovery task_id=${taskId} deterministic_recovery_attempted=true ` +
      `places_recovery_attempted=${mediaMentions.partialMentions > 0} ` +
      `recovery_outcome=${partialResult.resultClass} final_result_class=${partialResult.resultClass} ` +
      `clue_count=${partialResult.clueCount}`,
    );
  }
  const result = await resolveSharedPlace({
    evidence: mediaEvidence,
    env,
    mentions: mediaMentions.mentions,
    geoContext: mediaMentions.geoContext,
    relationships: mediaMentions.relationships,
  });
  const mentionResults = Array.isArray(result.diagnostics?.mentionResults)
    ? result.diagnostics.mentionResults
    : [];
  // Bounded recognition-failure funnel, persisted on the job so a
  // zero-suggestion outcome can be explained after the request is gone.
  // `mentionResults` itself stays in memory: it carries candidate names and the
  // raw Places query, neither of which belongs in stored diagnostics.
  const resolutionDiagnostics = result.diagnostics?.resolutionDiagnostics ?? null;
  // Recognition retains place-scoped observations but never creates candidate
  // notes. Only a task for an already-saved final place may ask for memoryCue.
  const aiNoteByMentionId = new Map<string, string | null>(
    mediaMentions.mentions.map((mention: any) => [mention.id, null]),
  );
  const nameDrivenResult = {
    mentionResults,
    aggregateCandidates: result.candidates ?? [],
    providerErrorCount: mentionResults.filter((mention: any) => mention?.outcome === 'provider_error').length,
  } as any;
  if (isRetryableNameDrivenProviderFailure(nameDrivenResult)) {
    const retryPlan = planProviderUnavailable({
      attempts: Number(task.attempts) || 1,
      maxAttempts: Number(task.max_attempts) || 3,
      failures: mentionResults,
    });
    if (retryPlan.action === 'requeue') {
      const { data: requeued, error: requeueError } = await admin.rpc('requeue_media_task', {
        p_task_id: taskId,
        p_backoff_seconds: retryPlan.delaySeconds,
        p_failure_code: 'places_provider_unavailable',
      });
      if (requeueError) throw new Error(`media_retry_schedule_failed: ${requeueError.message}`);
      if (!requeued) {
        const { data: current } = await admin
          .from('share_media_tasks').select('status').eq('id', taskId).maybeSingle();
        logFinalStatus('retry_schedule_conflict', 'claim_conflict');
        return json({
          ok: true,
          idempotent: true,
          taskStatus: current?.status ?? 'unknown',
        });
      }
      logFinalStatus('retry_scheduled', retryPlan.errorClass);
      return json(
        {
          ok: true,
          accepted: true,
          route: 'retry_scheduled',
          errorClass: retryPlan.errorClass,
          retryAfterSeconds: retryPlan.delaySeconds,
        },
        retryPlan.responseStatus,
        { 'Retry-After': String(retryPlan.delaySeconds) },
      );
    }

    if (pre.mode !== 'enrich_saved_place') {
      await finalizeParentManual(admin, job, {
        failureCode: 'places_provider_unavailable_exhausted',
        analysisAttempted: true,
        provider: task.platform,
        notificationLocality,
        evidenceFrames,
      });
    }
    await markMediaTask(admin, taskId, 'failed', {
      failure_code: 'places_provider_unavailable_exhausted',
      progress_stage: 'cleanup',
      completed_at: nowIso(),
    });
    logFinalStatus('retry_exhausted', retryPlan.errorClass);
    return json({
      ok: true,
      route: 'manual',
      reason: 'places_provider_unavailable_exhausted',
      errorClass: retryPlan.errorClass,
    });
  }
  const taskCanonicalUrl = task.canonical_url || task.source_url;
  const discoveredCanonicalUrl = typeof body.canonicalUrl === 'string'
    ? body.canonicalUrl
    : '';
  // A resolver may discover the stable id while expanding an opaque Facebook
  // share. Accept that stronger URL only when it remains on the task's own
  // platform; otherwise fail closed to the already-validated task URL.
  const normalizedMediaCanonical = discoveredCanonicalUrl
    ? normalizeShareUrl(discoveredCanonicalUrl).url
    : '';
  const canonicalUrl = task.platform === 'facebook'
    ? planFacebookDiscoveredCanonicalUrl(taskCanonicalUrl, discoveredCanonicalUrl).canonicalUrl
    : normalizedMediaCanonical && detectPlatform(normalizedMediaCanonical) === task.platform
    ? normalizedMediaCanonical
    : taskCanonicalUrl;
  const sourceProvenance = {
    platform: task.platform,
    canonicalUrl,
    postId: sourceMetadata?.postId ?? null,
    sourceId: sourceMetadata?.sourceId ?? null,
    creatorHandle: sourceMetadata?.creatorHandle ?? null,
    creatorName: sourceMetadata?.creatorName ?? null,
    creatorId: sourceMetadata?.creatorId ?? null,
    captionSource: sourceMetadata?.description ? 'public_provider_metadata' : null,
    mediaAcquired: true,
  };
  if (pre.mode === 'enrich_saved_place') {
    return await finalizePostSaveEnrichment(admin, {
      job,
      task,
      taskId,
      mediaRunId,
      result,
      mentionResults,
      aiNoteByMentionId,
      parsed,
      sourceMetadata,
    });
  }

  // Name-driven media results have stable logical mention IDs, so they can be
  // finalized independently. Address-only legacy media results continue below
  // through the existing post-level confirmation path.
  if (mentionResults.length > 0) {
    const configuredFlags = readMediaFlags();
    const autoSaveAuthorized = mediaAutoSaveEnabledForUser(configuredFlags, job.user_id);
    const mentionById = new Map(mediaMentions.mentions.map((mention: any) => [mention.id, mention]));
    const createdSavedPlaceIds: string[] = [];
    const alreadySavedPlaceIds: string[] = [];
    const unresolvedResults: any[] = [];
    const savedResultByMentionId = new Map<string, { savedPlaceId: string; saveState: 'auto_saved' | 'already_saved' }>();
    const perPlaceSummary: Array<Record<string, unknown>> = [];
    const source = legacySourceFor(task.platform);

    for (const mentionResult of mentionResults) {
      const mention = mentionById.get(mentionResult.mentionId);
      const aiNote = aiNoteByMentionId.get(mentionResult.mentionId) ?? null;
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
            candidateRejectionReasons: ['mention_evidence_missing'],
            explicitConflictFlags: [],
            semanticCompatibility: 'UNKNOWN',
            sceneCategory: null,
            candidateCategory: null,
            semanticOverrideApplied: false,
          };
      const blockingReasons = [...gate.reasonCodes];
      if (gate.eligible && !autoSaveAuthorized) blockingReasons.push('auto_save_disabled_or_user_not_allowlisted');
      if (gate.eligible && !mediaRunId) blockingReasons.push('media_run_audit_missing');
      const mayAutoSave = gate.eligible && autoSaveAuthorized && !!mediaRunId;
      const candidate = gate.selectedProviderId
        ? mentionResult.candidates?.find(
            (entry: any) => entry.googlePlaceId === gate.selectedProviderId,
          ) ?? null
        : null;
      console.log(formatMediaAutoSaveDecisionLog({
        jobId: job.id,
        logicalPlaceId: mentionResult.mentionId,
        decision: gate,
        finalDecision: mayAutoSave ? 'auto_save' : 'review',
        finalReasonCodes: blockingReasons,
      }));
      if (gate.semanticCompatibility === 'CONTRADICTS') {
        await recordRecognitionEvent(
          admin,
          gate.semanticOverrideApplied ? 'candidate_semantic_override' : 'candidate_semantic_mismatch',
          canonicalContentIdentity(job.source_url, canonicalUrl),
          {
            sceneCategory: gate.sceneCategory,
            candidateCategory: gate.candidateCategory,
            logicalPlaceId: mentionResult.mentionId,
            ruleVersion: gate.ruleVersion,
          },
        );
        if (!gate.semanticOverrideApplied) {
          await recordRecognitionEvent(
            admin,
            'autosave_blocked_semantic_mismatch',
            canonicalContentIdentity(job.source_url, canonicalUrl),
            {
              sceneCategory: gate.sceneCategory,
              candidateCategory: gate.candidateCategory,
              ruleVersion: gate.ruleVersion,
            },
          );
        }
      }

      if (mayAutoSave) {
        const categoryResolution = resolvePlaceCategory({
          placeName: candidate.name,
          googlePrimaryType: candidate.primaryType,
          googleTypes: candidate.types,
          ai: isNearrCategory(mention?.category)
            ? {
                category: mention.category,
                confidence: typeof mention.categoryConfidence === 'number' ? mention.categoryConfidence : 0,
                modelVersion: 'media-evidence-category.v1',
                evidenceTags: mention.categoryEvidenceTags?.length
                  ? mention.categoryEvidenceTags
                  : ['structured_media_category'],
              }
            : null,
        });
        const { data: savedRows, error: saveError } = await admin.rpc(
          'auto_save_share_job_place_result',
          {
            p_share_job_id: job.id,
            p_share_media_task_id: task.id,
            p_share_media_run_id: mediaRunId,
            p_logical_result_id: mentionResult.mentionId,
            p_google_place_id: candidate.googlePlaceId,
            p_name: candidate.name,
            p_formatted_address: candidate.formattedAddress,
            p_latitude: candidate.latitude,
            p_longitude: candidate.longitude,
            p_category: categoryResolution.category,
            p_source_type: source,
            p_source_url: canonicalUrl,
            p_confidence_score: gate.confidenceScore,
            p_rule_version: gate.ruleVersion,
            p_reason_codes: gate.reasonCodes,
          },
        );
        if (saveError) throw new Error(`media_auto_save_failed: ${saveError.message}`);
        const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;
        if (!saved?.saved_place_id) throw new Error('media_auto_save_missing_saved_place_id');
        await attachSavedPlaceSource({
          admin,
          userId: job.user_id,
          savedPlaceId: saved.saved_place_id,
          sourceUrl: canonicalUrl,
          sourceType: source,
          resolvedUrl: canonicalUrl,
          creatorHandle: sourceMetadata?.creatorHandle ?? null,
          creatorName: sourceMetadata?.creatorName ?? null,
          caption: sourceMetadata?.description ?? null,
          aiNote: aiNoteByMentionId.get(mention.mentionId) ?? null,
        });
        if (aiNote) {
          const aiNoteSave = await persistAiNoteSupplementally(aiNote, async (note) => {
            // PROVENANCE: the cue describes THIS post, and the place page shows
            // it beside whichever source is attached. `saved.reused` rows may
            // already carry a different post (the RPC preserves it), and a
            // racing job may have won the empty slot — so the note is written
            // only while the row still names this exact source.
            const { error } = await admin
              .from('saved_places')
              .update({ ai_note: note })
              .eq('id', saved.saved_place_id)
              .eq('user_id', job.user_id)
              .eq('source_url', canonicalUrl)
              .is('ai_note', null);
            if (error) throw error;
          });
          if (aiNoteSave === 'failed') {
            console.warn(`[media-task] supplemental ai note save failed task_id=${taskId}`);
          }
        }
        const { error: categoryError } = await admin
          .from('saved_places')
          .update({
            category: categoryResolution.category,
            category_source: categoryResolution.source,
            category_confidence: categoryResolution.confidence,
            category_model_version: categoryResolution.modelVersion,
            category_user_overridden: false,
            categorized_at: nowIso(),
          })
          .eq('id', saved.saved_place_id)
          .eq('user_id', job.user_id)
          .eq('category_user_overridden', false);
        if (categoryError) throw new Error(`media_category_save_failed: ${categoryError.message}`);
        await admin.from('places').update({
          short_formatted_address: candidate.shortFormattedAddress ?? null,
          google_primary_type: candidate.primaryType ?? null,
          google_types: candidate.types ?? null,
          google_type_label: candidate.googleMapsTypeLabel ?? candidate.primaryTypeDisplayName ?? null,
          business_status: candidate.businessStatus ?? null,
        }).eq('id', saved.place_id);
        if (saved.reused) alreadySavedPlaceIds.push(saved.saved_place_id);
        else createdSavedPlaceIds.push(saved.saved_place_id);
        savedResultByMentionId.set(mentionResult.mentionId, {
          savedPlaceId: saved.saved_place_id,
          saveState: saved.reused ? 'already_saved' : 'auto_saved',
        });
        perPlaceSummary.push({
          logicalResultId: mentionResult.mentionId,
          outcome: saved.reused ? 'already_saved' : 'auto_saved',
          savedPlaceId: saved.saved_place_id,
          confidenceScore: gate.confidenceScore,
          ruleVersion: gate.ruleVersion,
          reasonCodes: gate.reasonCodes,
        });
        continue;
      }

      const blockedOutcome =
        mentionResult.outcome === 'provider_error'
          ? 'failed'
          : mentionResult.outcome === 'no_match' || mentionResult.outcome === 'rejected_insufficient_evidence'
          ? 'manual_fallback'
          : 'candidate_confirmation';
      await persistBlockedPlaceResult(admin, {
        job,
        task,
        mediaRunId,
        mentionResult,
        outcome: blockedOutcome,
        confidenceScore: gate.confidenceScore,
        reasonCodes: blockingReasons,
      });
      unresolvedResults.push(mentionResult);
      perPlaceSummary.push({
        logicalResultId: mentionResult.mentionId,
        outcome: blockedOutcome,
        confidenceScore: gate.confidenceScore,
        ruleVersion: gate.ruleVersion,
        reasonCodes: blockingReasons,
      });
    }

    const allSavedPlaceIds = [...new Set([...createdSavedPlaceIds, ...alreadySavedPlaceIds])];
    const unresolvedCandidateIds = new Set(
      unresolvedResults.flatMap((mention: any) =>
        Array.isArray(mention.candidates)
          ? mention.candidates.map((candidate: any) => candidate.googlePlaceId)
          : [],
      ),
    );
    const candidatePayload = buildShareJobCandidatePayload(
      result.candidates
        .filter((candidate: any) => unresolvedCandidateIds.has(candidate.googlePlaceId))
        .map((candidate: any) => safeCandidate(
          candidate,
          noteForAggregateCandidate(candidate.googlePlaceId, unresolvedResults, aiNoteByMentionId),
        )),
      mentionResults.map((mention: any) => ({
        ...noteEvidenceForLogicalMention(parsed, mentionById.get(mention.mentionId)),
        mentionId: mention.mentionId,
        displayName: mention.displayName,
        contextLabel: (() => {
          const sourceMention = mentionById.get(mention.mentionId);
          return mention.contextLabel ?? (
            [sourceMention?.geo?.city, sourceMention?.geo?.region].filter(Boolean).join(', ') || null
          );
        })(),
        primaryVenueName: mention.primaryVenueName ?? null,
        hostVenueName: mention.hostVenueName ?? null,
        relationshipType: mention.relationshipType ?? null,
        outcome: mention.outcome,
        noNearbyMatch: mention.noNearbyMatch === true,
        identityHypotheses: mention.identityHypotheses ?? [],
        aiNote: aiNoteByMentionId.get(mention.mentionId) ?? null,
        saveState: savedResultByMentionId.get(mention.mentionId)?.saveState ?? 'pending',
        savedPlaceId: savedResultByMentionId.get(mention.mentionId)?.savedPlaceId ?? null,
        sourceTimestamps: mentionById.get(mention.mentionId)?.timestamps ?? [],
        candidates: Array.isArray(mention.candidates)
          ? mention.candidates.map((candidate: any) =>
              safeCandidate(candidate, aiNoteByMentionId.get(mention.mentionId) ?? null))
          : [],
      })),
    );
    candidatePayload.evidenceFrames = evidenceFrames;
    candidatePayload.savedPlaceIds = allSavedPlaceIds;
    if (partialResult) (candidatePayload as any).partialResult = partialResult;
    const mediaResultSummary = {
      createdCount: createdSavedPlaceIds.length,
      alreadySavedCount: alreadySavedPlaceIds.length,
      reviewCount: unresolvedResults.length,
      savedPlaceIds: allSavedPlaceIds,
      results: perPlaceSummary,
    };
    const notification = unresolvedResults.length === 0
      ? composeShareCompletionNotification({
          jobId: job.id,
          status: 'completed',
          alreadySaved: createdSavedPlaceIds.length === 0,
          placeName: mentionResults.length === 1 ? mentionResults[0]?.candidates?.[0]?.name ?? null : null,
          multiPlace: mentionResults.length > 1
            ? {
                totalCount: mentionResults.length,
                savedCount: mentionResults.length,
                unresolvedCandidateGroupCount: 0,
              }
            : null,
          savedPlaceId: allSavedPlaceIds[0] ?? null,
          savedPlaceIds: allSavedPlaceIds,
          createdSavedPlaceIds,
        })
      : reviewNotification({
          jobId: job.id,
          mode: unresolvedResults.some((mention: any) => mention?.candidates?.length > 0) ? 'multi' : 'manual',
          candidates: candidatePayload.candidates,
          mentionResults: candidatePayload.mentionSlots,
          notificationLocality,
          hasWeakClues: hasSafeWeakClues(result.evidenceUsed) || !!partialResult,
          savedPlaceId: allSavedPlaceIds[0] ?? null,
          savedPlaceIds: allSavedPlaceIds,
          createdSavedPlaceIds,
          reviewCount: unresolvedResults.length,
        });

    if (unresolvedResults.length === 0) {
      await finalize(
        admin,
        job,
        {
          status: 'completed',
          decision: 'auto_save',
          saved_place_id: allSavedPlaceIds[0] ?? null,
          candidate_payload: candidatePayload,
          canonical_url: canonicalUrl,
          source_platform: task.platform,
          extraction_payload: withRetainedSourceMetadata(
            job.extraction_payload,
            {
              platform: task.platform,
              via: 'media',
              sourceIdentity: mediaSourceIdentity,
              sourceProvenance,
              mediaResultSummary,
              resolutionDiagnostics,
            },
            sourceMetadata,
          ),
          progress_stage: 'completed',
          completed_at: nowIso(),
        },
        notification,
      );
      await markMediaTask(admin, taskId, 'completed', { resolver_name: 'media', progress_stage: 'cleanup', completed_at: nowIso() });
      return json({ ok: true, route: 'auto_save', ...mediaResultSummary });
    }

    const unresolvedWithCandidates = unresolvedResults.filter(
      (mention: any) => Array.isArray(mention.candidates) && mention.candidates.length > 0,
    ).length;
    await finalize(
      admin,
      job,
      {
        status: 'needs_help',
        decision: mediaReviewDecision(unresolvedResults),
        saved_place_id: allSavedPlaceIds[0] ?? null,
        needs_help_reason: allSavedPlaceIds.length > 0 ? 'media_partial_review' : 'media_review_required',
        suggested_query: unresolvedResults.map((mention: any) => mention.displayName).filter(Boolean).join(' | ') || partialResult?.searchQuery || null,
        candidate_payload: candidatePayload,
        canonical_url: canonicalUrl,
        source_platform: task.platform,
        extraction_payload: withRetainedSourceMetadata(
          job.extraction_payload,
          {
            platform: task.platform,
            via: 'media',
            sourceIdentity: mediaSourceIdentity,
            sourceProvenance,
            mediaResultSummary,
            resolutionDiagnostics,
          },
          sourceMetadata,
        ),
        progress_stage: unresolvedWithCandidates > 0 ? 'multi' : 'manual',
      },
      notification,
    );
    await markMediaTask(admin, taskId, 'completed', { resolver_name: 'media', progress_stage: 'cleanup', completed_at: nowIso() });
    return json({ ok: true, route: 'needs_help', mode: 'mixed', ...mediaResultSummary });
  }

  const extractionPayload = withRetainedSourceMetadata(
    job.extraction_payload,
    {
      platform: task.platform,
      via: 'media',
      sourceIdentity: mediaSourceIdentity,
      sourceProvenance,
      confidence: result.confidence,
      cleanSearchQuery: result.cleanSearchQuery ?? null,
      evidenceUsed: result.evidenceUsed,
      warnings: result.warnings,
      resolutionDiagnostics,
    },
    sourceMetadata,
  );
  const plan = planFromResolverDecision({
    decision: result.decision,
    safeToAutoSave: result.safeToAutoSave,
    hasPrimaryCandidate: !!result.primaryCandidate,
    candidateCount: result.candidates.length,
    cleanSearchQuery: result.cleanSearchQuery,
    failureReason: result.failureReason,
  });
  // Post-resolve routing + the EXTRA media auto-save gate (never loosens
  // safeToAutoSave; can only downgrade a resolver auto_save to a confirmation).
  const post = planPostResolve({
    route: plan.route === 'auto_save' ? 'auto_save' : 'needs_help',
    needsHelpMode: plan.route === 'needs_help' ? plan.mode : 'manual',
    autoSaveEligible: plan.route === 'auto_save' && mediaEvidenceAutoSaveEligible(parsed.value),
  });

  if (post.action === 'auto_save') {
    const candidate = result.primaryCandidate;
    const source = legacySourceFor(task.platform);
    const saved = await saveForUser({
      client: admin,
      userId: job.user_id,
      candidate,
      sourceUrl: canonicalUrl,
      source,
      sourceMetadata: {
        resolvedUrl: canonicalUrl,
        creatorHandle: sourceMetadata?.creatorHandle ?? null,
        creatorName: sourceMetadata?.creatorName ?? null,
        caption: sourceMetadata?.description ?? null,
      },
    });
    await finalize(
      admin,
      job,
      {
        status: 'completed',
        decision: 'auto_save',
        saved_place_id: saved.savedPlaceId,
        candidate_payload: buildCandidateReviewSnapshot([safeCandidate(candidate)], 10, 'single'),
        canonical_url: canonicalUrl,
        source_platform: task.platform,
        extraction_payload: { ...extractionPayload, savedPlaceName: candidate.name },
        progress_stage: 'completed',
        completed_at: nowIso(),
      },
      composeShareCompletionNotification({
        status: 'completed',
        placeName: candidate.name,
        jobId: job.id,
        savedPlaceId: saved.savedPlaceId,
        googlePlaceId: candidate.googlePlaceId,
        alreadySaved: saved.reused,
      }),
    );
    await markMediaTask(admin, taskId, 'completed', { resolver_name: 'media', progress_stage: 'cleanup', completed_at: nowIso() });
    console.log(`[media-task] finalize route=auto_save task_id=${taskId} job_id=${job.id}`);
    return json({ ok: true, route: 'auto_save' });
  }

  // needs_help (single / multi / manual). `post.mode` accounts for a downgrade
  // from a resolver auto_save that failed the media evidence eligibility gate.
  const mode = post.mode;
  const candidatePayload = buildShareJobCandidatePayload(
    result.candidates.slice(0, 10).map((candidate: any) => safeCandidate(
      candidate,
      noteForAggregateCandidate(candidate.googlePlaceId, mentionResults, aiNoteByMentionId),
    )),
    mentionResults.map((mention: any) => ({
      ...noteEvidenceForLogicalMention(
        parsed,
        mediaMentions.mentions.find((item: any) => item.id === mention.mentionId),
      ),
      mentionId: mention.mentionId,
      displayName: mention.displayName,
      contextLabel: (() => {
        const sourceMention = mediaMentions.mentions.find((item: any) => item.id === mention.mentionId);
        return mention.contextLabel ?? (
          [sourceMention?.geo?.city, sourceMention?.geo?.region].filter(Boolean).join(', ') || null
        );
      })(),
      primaryVenueName: mention.primaryVenueName ?? null,
      hostVenueName: mention.hostVenueName ?? null,
      relationshipType: mention.relationshipType ?? null,
      outcome: mention.outcome,
      noNearbyMatch: mention.noNearbyMatch === true,
      sourceTimestamps: mediaMentions.mentions.find((item: any) => item.id === mention.mentionId)?.timestamps ?? [],
      identityHypotheses: mention.identityHypotheses ?? [],
      aiNote: aiNoteByMentionId.get(mention.mentionId) ?? null,
      candidates: Array.isArray(mention.candidates)
        ? mention.candidates.map((candidate: any) =>
            safeCandidate(candidate, aiNoteByMentionId.get(mention.mentionId) ?? null))
        : [],
    })),
  );
  candidatePayload.evidenceFrames = evidenceFrames;
  if (partialResult) (candidatePayload as any).partialResult = partialResult;
  const decisionForRow =
    mode === 'manual'
      ? 'manual_fallback'
      : mode === 'picker'
      ? 'candidate_picker'
      : result.decision === 'multi_candidate_confirmation'
      ? 'multi_candidate_confirmation'
      : result.decision === 'candidate_picker'
      ? 'candidate_picker'
      : 'candidate_confirmation';
  const needsHelpReason = post.downgraded
    ? 'media_autosave_ineligible'
    : plan.route === 'needs_help'
    ? plan.needsHelpReason
    : 'candidate_confirmation';
  const suggestedQuery = (plan.route === 'needs_help' ? plan.suggestedQuery : result.cleanSearchQuery)
    ?? partialResult?.searchQuery
    ?? null;
  const note = reviewNotification({
    mode,
    jobId: job.id,
    candidates: result.candidates,
    mentionResults: candidatePayload.mentionSlots,
    notificationLocality,
    hasWeakClues: hasSafeWeakClues(result.evidenceUsed) || !!partialResult,
  });
  await finalize(
    admin,
    job,
    {
      status: 'needs_help',
      decision: decisionForRow,
      needs_help_reason: needsHelpReason,
      suggested_query: suggestedQuery,
      candidate_payload: candidatePayload,
      canonical_url: canonicalUrl,
      source_platform: task.platform,
      extraction_payload: extractionPayload,
      progress_stage: mode,
    },
    note,
  );
  await markMediaTask(admin, taskId, 'completed', { resolver_name: 'media', progress_stage: 'cleanup', completed_at: nowIso() });
  console.log(`[media-task] finalize route=needs_help mode=${mode} downgraded=${post.downgraded} task_id=${taskId} job_id=${job.id}`);
  return json({ ok: true, route: 'needs_help', mode });
}

function cacheCandidateFromPlace(place: any): any | null {
  if (!place?.id || !place?.google_place_id || !place?.name) return null;
  return {
    googlePlaceId: place.google_place_id,
    name: place.name,
    formattedAddress: place.formatted_address ?? null,
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    types: Array.isArray(place.google_types) ? place.google_types : [],
    primaryType: place.google_primary_type ?? null,
    primaryTypeDisplayName: place.google_type_label ?? null,
    googleMapsTypeLabel: place.google_type_label ?? null,
    shortFormattedAddress: place.short_formatted_address ?? null,
    businessStatus: place.business_status ?? null,
  };
}

async function useRecognitionCache(args: {
  admin: any;
  job: any;
  identity: CanonicalContentIdentity;
  decision: RecognitionCacheDecision;
}): Promise<boolean> {
  const { admin, job, identity } = args;
  let decision = args.decision;
  let disputedHit = false;
  if (decision.kind === 'disputed') {
    disputedHit = true;
    await recordRecognitionEvent(admin, 'cache_hit_disputed_result', identity, {
      suppressedCandidateCount: decision.suppressedCandidateCount,
      reusableEvidence: decision.reusableEvidence,
      cacheTrust: decision.row.trust_level,
    });
    if (decision.suppressedCandidateCount > 0) {
      await recordRecognitionEvent(admin, 'disputed_candidate_suppressed', identity, {
        suppressedCandidateCount: decision.suppressedCandidateCount,
      });
    }
    const remaining = persistedCandidateCount(decision.candidatePayload);
    if (remaining < 1) return false;
    decision = {
      kind: 'candidate_set',
      row: { ...decision.row, candidate_payload: decision.candidatePayload },
    };
  }
  if (decision.kind === 'miss') return false;

  if (decision.kind === 'candidate_set') {
    const payload = decision.row.candidate_payload;
    const reranked = rerankCachedCandidatePayload(payload);
    if (!reranked) return false;
    const presentationPayload = reranked.payload;
    const count = persistedCandidateCount(presentationPayload);
    if (count < 1) return false;
    const selectionMode = selectionModeForPlaceResult({
      explicitMode: (presentationPayload as any)?.selectionMode,
      mentionSlots: (presentationPayload as any)?.mentionSlots,
    });
    const singletonGate = evaluateCachedSingletonAutoSave(reranked);
    if (!disputedHit && singletonGate.eligible && singletonGate.candidate) {
      const candidate = singletonGate.candidate as any;
      const saved = await saveForUser({
        client: admin,
        userId: job.user_id,
        candidate,
        sourceUrl: identity.canonicalUrl,
        source: legacySourceFor(identity.platform),
        sourceMetadata: { resolvedUrl: identity.canonicalUrl },
      });
      await recordRecognitionEvent(admin, 'recognition_cache_candidate_auto_save', identity, {
        mediaDownloadAvoided: true,
        geminiCallsAvoided: 1,
        solCallsAvoided: 1,
        cacheHit: true,
        cacheTrust: 'CANDIDATE_SET',
        contextualRerankApplied: true,
        contextSourceKind: reranked.contextSourceKind,
        contextAvailable: reranked.contextAvailable,
        candidateCountBeforeRerank: reranked.candidateCountBeforeRerank,
        candidateCountAfterRerank: reranked.candidateCountAfterRerank,
        viableCandidateCount: singletonGate.viableCandidateCount,
        singletonGateReason: singletonGate.reason,
        singletonQualityReason: singletonGate.qualityReason,
        placesCallCount: 0,
      });
      await finalize(
        admin,
        job,
        {
          status: 'completed',
          decision: 'auto_save',
          saved_place_id: saved.savedPlaceId,
          candidate_payload: buildCandidateReviewSnapshot([safeCandidate(candidate)], 10, 'single'),
          canonical_url: identity.canonicalUrl,
          source_platform: identity.platform,
          extraction_payload: {
            ...(job.extraction_payload ?? {}),
            savedPlaceName: candidate.name,
            alreadySaved: saved.reused,
            recognitionCache: {
              hit: true,
              trust: 'CANDIDATE_SET',
              contextualRerankApplied: true,
              contextSourceKind: reranked.contextSourceKind,
              singletonGateReason: singletonGate.reason,
            },
          },
          // This is a safe decision over the current request's reranked
          // presentation, not authority to overwrite the full cache row.
          __skipRecognitionCachePersist: true,
          progress_stage: 'completed',
          completed_at: nowIso(),
        },
        composeShareCompletionNotification({
          status: 'completed',
          placeName: candidate.name,
          jobId: job.id,
          savedPlaceId: saved.savedPlaceId,
          googlePlaceId: candidate.googlePlaceId,
          alreadySaved: saved.reused,
        }),
      );
      return true;
    }
    // Every candidate set that failed the contextual singleton gate remains
    // review-only, with single-vs-multi confirmation semantics preserved.
    const review = decisionForSelectionSemantics(count, selectionMode, true);
    const mode = review.mode === 'auto' ? 'single' : review.mode;
    await recordRecognitionEvent(admin, 'recognition_cache_candidate_hit', identity, {
      mediaDownloadAvoided: true,
      geminiCallsAvoided: 1,
      solCallsAvoided: 1,
      cacheHit: true,
      cacheTrust: 'CANDIDATE_SET',
      candidateCountBeforeRerank: reranked.candidateCountBeforeRerank,
      candidateCountAfterRerank: reranked.candidateCountAfterRerank,
      contextualRerankApplied: reranked.applied,
      contextSourceKind: reranked.contextSourceKind,
      contextAvailable: reranked.contextAvailable,
      rankingPolicy: reranked.rankingPolicy,
      placesCallCount: reranked.placesCallCount,
      viableCandidateCount: singletonGate.viableCandidateCount,
      singletonGateReason: singletonGate.reason,
      singletonQualityReason: singletonGate.qualityReason,
    });
    await finalize(
      admin,
      job,
      {
        status: 'needs_help',
        decision: review.decision,
        needs_help_reason: 'recognition_cache_candidate_review',
        candidate_payload: presentationPayload,
        canonical_url: identity.canonicalUrl,
        source_platform: identity.platform,
        extraction_payload: {
          ...(job.extraction_payload ?? {}),
          recognitionCache: {
            hit: true,
            trust: 'CANDIDATE_SET',
            contextualRerankApplied: true,
            candidateCountBeforeRerank: reranked.candidateCountBeforeRerank,
            candidateCountAfterRerank: reranked.candidateCountAfterRerank,
            contextSourceKind: reranked.contextSourceKind,
            contextAvailable: reranked.contextAvailable,
            rankingPolicy: reranked.rankingPolicy,
            placesCallCount: 0,
          },
        },
        __skipRecognitionCachePersist: true,
        progress_stage: mode,
      },
      reviewNotification({
        mode,
        jobId: job.id,
        candidates: (presentationPayload as any)?.candidates,
        mentionResults: (presentationPayload as any)?.mentionSlots,
      }),
    );
    return true;
  }

  const { data: place, error } = await admin
    .from('places')
    .select('id,google_place_id,name,formatted_address,latitude,longitude,short_formatted_address,google_primary_type,google_types,google_type_label,business_status')
    .eq('id', decision.row.canonical_place_id)
    .maybeSingle();
  if (error || !place) return false;
  const candidate = cacheCandidateFromPlace(place);
  if (!candidate || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) return false;

  const saved = await saveForUser({
    client: admin,
    userId: job.user_id,
    candidate,
    sourceUrl: identity.canonicalUrl,
    source: legacySourceFor(identity.platform),
    sourceMetadata: { resolvedUrl: identity.canonicalUrl },
  });
  const candidatePayload = buildCandidateReviewSnapshot([safeCandidate(candidate)], 10, 'single');
  await recordRecognitionEvent(admin, 'recognition_cache_hit', identity, {
    mediaDownloadAvoided: true,
    geminiCallsAvoided: 1,
    solCallsAvoided: 1,
    trust: decision.row.trust_level,
  });
  await finalize(
    admin,
    job,
    {
      status: 'completed',
      decision: 'auto_save',
      saved_place_id: saved.savedPlaceId,
      candidate_payload: candidatePayload,
      canonical_url: identity.canonicalUrl,
      source_platform: identity.platform,
      extraction_payload: {
        ...(job.extraction_payload ?? {}),
        savedPlaceName: candidate.name,
        alreadySaved: saved.reused,
        recognitionCache: { hit: true, trust: decision.row.trust_level },
      },
      progress_stage: 'completed',
      completed_at: nowIso(),
    },
    composeShareCompletionNotification({
      status: 'completed',
      placeName: candidate.name,
      jobId: job.id,
      savedPlaceId: saved.savedPlaceId,
      googlePlaceId: candidate.googlePlaceId,
      alreadySaved: saved.reused,
    }),
  );
  return true;
}

async function prepareRecognitionIdentity(
  admin: any,
  job: any,
  identity: CanonicalContentIdentity,
): Promise<'owner' | 'parked' | 'continue'> {
  job.recognition_identity_key = identity.key;
  job.recognition_identity_version = identity.identityVersion;
  job.recognition_content_id = identity.contentId;
  job.canonical_url = identity.canonicalUrl;
  await recordIdentityOnJob(admin, job.id, identity);
  const decision = await lookupRecognition(admin, identity, job.user_id);
  if (await useRecognitionCache({ admin, job, identity, decision })) return 'parked';
  if (decision.kind === 'disputed') {
    await recordRecognitionEvent(admin, 'recognition_recomputed_after_rejection', identity, {
      reusableEvidence: decision.reusableEvidence,
      suppressedCandidateCount: decision.suppressedCandidateCount,
    });
  }
  await recordRecognitionEvent(admin, 'recognition_cache_miss', identity, { reason: decision.kind === 'miss' ? decision.reason : 'unusable' });
  const claim = await claimRecognition(admin, identity, job.id);
  if (claim === 'joined') {
    await recordRecognitionEvent(admin, 'recognition_singleflight_joined', identity);
    await admin.from('share_jobs').update({
      locked_until: addSecondsIso(30),
      attempts: Math.max(0, (Number(job.attempts) || 1) - 1),
      last_error: 'recognition_singleflight_joined',
      progress_stage: 'checking_video',
    }).eq('id', job.id).eq('status', 'processing_metadata');
    return 'parked';
  }
  return claim === 'owner' ? 'owner' : 'continue';
}

async function processOne(admin: any, env: any, job: any): Promise<void> {
  const rawUrl = job.canonical_url || job.source_url;
  const normalized = normalizeShareUrl(rawUrl);
  const requestUrl = normalized.url || rawUrl;
  const platform = detectPlatform(requestUrl);

  let activeIdentity = canonicalContentIdentity(job.source_url, requestUrl);
  if (activeIdentity) {
    const preparation = await prepareRecognitionIdentity(admin, job, activeIdentity);
    if (preparation === 'parked') return;
  }

  if (platform === 'facebook' && !inspectFacebookUrl(requestUrl)?.supported) {
    await finalize(
      admin,
      job,
      {
        status: 'needs_help',
        decision: 'manual_fallback',
        needs_help_reason: 'unsupported_facebook_url',
        canonical_url: requestUrl,
        source_platform: platform,
        extraction_payload: { platform, reason: 'unsupported_facebook_url' },
        progress_stage: 'manual',
      },
      reviewNotification({ mode: 'manual', jobId: job.id }),
    );
    return;
  }

  const meta = await fetchPostMetadata(requestUrl, platform);
  if (!meta.ok) {
    // Metadata unavailable is NOT the same as "this place cannot be
    // identified". It is the case where the video is the only evidence left,
    // so try durable media fallback BEFORE giving up. Without this the job
    // finalized to needs_help in ~1s, pushed "We couldn't quite find this
    // one", and never inserted a share_media_tasks row.
    const metaFailFlags = effectiveMediaFlags(readMediaFlags(), job.user_id);
    if (metaFailFlags.mediaFallbackEnabled && !isPermanentMetadataFailure(meta.reason)) {
      const mediaTaskExists = await mediaTaskExistsFor(admin, job.id);
      const trigger = shouldRunMediaFallbackForMetadataFailure({
        platform,
        mediaFallbackEnabled: metaFailFlags.mediaFallbackEnabled,
        instagramResolverEnabled: metaFailFlags.instagramResolverEnabled,
        tiktokResolverEnabled: metaFailFlags.tiktokResolverEnabled,
        youtubeResolverEnabled: metaFailFlags.youtubeResolverEnabled,
        facebookResolverEnabled: metaFailFlags.facebookResolverEnabled,
        snapchatResolverEnabled: metaFailFlags.snapchatResolverEnabled,
        mediaTaskExists,
        jobStatus: 'processing_metadata',
      });
      console.log(
        `[share-job] metadata_failed_media_fallback job_id=${job.id} platform=${platform} run=${trigger.run} reason=${trigger.reason}`,
      );
      if (trigger.run) {
        // Park (never finalize) so no premature needs_help push is emitted.
        // The job stays non-terminal at progress_stage=checking_video until
        // the media task itself resolves or fails.
        await enqueueMediaTask(admin, job, platform, requestUrl, requestUrl, {
          parkPatch: {
            decision: 'manual_fallback',
            needs_help_reason: 'metadata_unavailable',
            suggested_query: null,
            candidate_payload: { candidates: [] },
            extraction_payload: { platform, reason: meta.reason },
            canonical_url: requestUrl,
            source_platform: platform,
          },
        });
        return;
      }
    }
    // Media fallback unavailable for this platform/flag state — the user can
    // still search by hand.
    await finalize(
      admin,
      job,
      {
        status: 'failed',
        decision: 'failed',
        needs_help_reason: 'metadata_unavailable',
        failure_reason: 'metadata_unavailable',
        failure_code: 'metadata_unavailable',
        failure_category: 'technical_failure',
        analysis_attempted: false,
        suggested_query: null,
        candidate_payload: { candidates: [] },
        canonical_url: requestUrl,
        source_platform: platform,
        extraction_payload: { platform, reason: meta.reason },
        progress_stage: 'manual',
      },
      composeShareCompletionNotification({
        jobId: job.id,
        status: 'failed',
        failureCategory: 'technical_failure',
        failureCode: 'metadata_unavailable',
        provider: platform,
        analysisAttempted: false,
        reviewMode: 'manual',
      }),
    );
    return;
  }

  const {
    title: fetchedTitle,
    description: fetchedDescription,
    html,
    creatorHandle,
    postId,
  } = meta.metadata;
  // A provider retry can return a thinner caption than an earlier attempt.
  // Resolve and persist from the richer retained source instead of shortening
  // evidence merely because this fetch degraded.
  const metadataSourceMetadata = mergeRetainedSourceMetadata(
    sourceMetadataFromExtractionPayload(job.extraction_payload),
    parseMediaSourceMetadata({
      title: fetchedTitle,
      description: fetchedDescription,
      creatorHandle,
      postId,
    }),
  );
  const title = metadataSourceMetadata?.title ?? fetchedTitle;
  const description = metadataSourceMetadata?.description ?? fetchedDescription;
  const canonicalUrl = meta.resolvedUrl || requestUrl;
  const resolvedIdentity = canonicalContentIdentity(job.source_url, canonicalUrl);
  if (resolvedIdentity && resolvedIdentity.key !== activeIdentity?.key) {
    if (activeIdentity) await releaseRecognition(admin, activeIdentity.key, job.id);
    activeIdentity = resolvedIdentity;
    const preparation = await prepareRecognitionIdentity(admin, job, resolvedIdentity);
    if (preparation === 'parked') return;
  }
  const handles = extractHandles({ platform, title, description, html });
  const taggedLocation = extractTaggedLocation({
    platform,
    html,
    resolvedUrl: canonicalUrl,
    title,
    description,
  });
  const evidence = extractEvidence({ platform, title, description, handles, taggedLocation });
  const result = await resolveSharedPlace({ evidence, env });

  // Enforce the user-facing single-option invariant before routing. Media
  // enrichment is scheduled separately after a successful save.
  const metadataAutoSave = evaluateMetadataAutoSave({ result, evidence });
  console.log(formatMetadataAutoSaveDecisionLog({ jobId: job.id, decision: metadataAutoSave }));

  const plausibleProviderIds = new Set(metadataAutoSave.plausibleProviderIds);
  const plausibleCandidates = result.candidates.filter((candidate: any) =>
    plausibleProviderIds.has(candidate.googlePlaceId)
  );
  const viableProviderIds = new Set(metadataAutoSave.viableProviderIds);
  const viableCandidates = result.candidates.filter((candidate: any) =>
    viableProviderIds.has(candidate.googlePlaceId)
  );
  const routingCandidates = metadataAutoSave.eligible ? viableCandidates : plausibleCandidates;
  const hasConcreteBlocker = metadataAutoSave.explicitConflictFlags.length > 0 ||
    (routingCandidates.length === 1 && !metadataAutoSave.eligible);
  const metadataSelectionMode = selectionModeForPlaceResult({
    decision: result.decision,
    diagnostics: result.diagnostics,
  });
  const countDecision = decisionForSelectionSemantics(
    routingCandidates.length,
    metadataSelectionMode,
    hasConcreteBlocker,
  );
  const effectiveDecision = countDecision.decision;
  const metadataResult = {
    ...result,
    decision: effectiveDecision,
    candidates: routingCandidates,
    primaryCandidate: routingCandidates[0],
    safeToAutoSave: effectiveDecision === 'auto_save',
  };

  const extractionPayload = withRetainedSourceMetadata(
    job.extraction_payload,
    {
      platform,
      metadataProvenance: {
        title: meta.metadata.titleSource,
        description: meta.metadata.descriptionSource,
      },
      sourceIdentity: platform === 'tiktok'
        ? (postId || creatorHandle ? { postId, creatorHandle } : null)
        : platform === 'facebook'
        ? (() => {
            const identity = inspectFacebookUrl(canonicalUrl);
            return identity
              ? {
                  kind: identity.kind,
                  contentId: identity.contentId,
                  canonicalUrl: identity.canonicalUrl,
                  creatorOrPage: identity.creatorOrPage,
                  redirectResolved: !identity.needsRedirectResolution,
                }
              : null;
          })()
        : null,
      confidence: result.confidence,
      cleanSearchQuery: result.cleanSearchQuery ?? null,
      evidenceUsed: result.evidenceUsed,
      warnings: result.warnings,
      autoSaveDecision: metadataAutoSave,
      rawResolverCandidates: result.candidates.slice(0, 10).map(safeCandidate),
      plausibleCandidates: plausibleCandidates.slice(0, 10).map(safeCandidate),
      viableCandidates: viableCandidates.slice(0, 10).map(safeCandidate),
      // Present only when the metadata path ran name-driven mention resolution;
      // the address/query-ladder path produces no mentions and so no traces.
      resolutionDiagnostics: (result.diagnostics as any)?.resolutionDiagnostics ?? null,
    },
    metadataSourceMetadata,
  );

  // ---- transient provider failure -> retry, don't blame the user ----------
  // A Google Places 429/5xx/timeout previously fell straight through to
  // needs_help(manual_search): the resolver RETURNS `failed/places_error`
  // rather than throwing, so handleProcessingError's retry harness never saw
  // it. Classify first, and when nothing usable was collected, park the job
  // with a backoff instead of telling the user to find the place themselves.
  // Candidates found on an EARLIER attempt count too: once the pipeline has
  // produced usable candidates they must never be retried away, even if a
  // later degraded attempt comes back empty.
  const alreadyPersistedCandidates = persistedCandidateCount(job.candidate_payload);
  const providerFailureClass = classifyResolverFailure({
    decision: metadataResult.decision,
    failureReason: metadataResult.failureReason,
    candidateCount: Math.max(metadataResult.candidates.length, alreadyPersistedCandidates),
    warnings: result.warnings,
    retryAfterSeconds: (result.diagnostics as any)?.placesError?.retryAfterSeconds ?? null,
  });
  const jobAttempts = typeof job.attempts === 'number' ? job.attempts : 1;
  const jobMaxAttempts = typeof job.max_attempts === 'number' ? job.max_attempts : 5;
  const retryPlan = planResolverRetry({
    failureClass: providerFailureClass,
    attempts: jobAttempts,
    maxAttempts: jobMaxAttempts,
    retryAfterSeconds: (result.diagnostics as any)?.placesError?.retryAfterSeconds ?? null,
  });
  if (providerFailureClass === 'transient_provider') {
    console.log(
      formatResolverRetryLog({
        jobId: job.id,
        step: 'metadata_places',
        failureClass: providerFailureClass,
        failureCode: metadataResult.failureReason ?? null,
        plan: retryPlan,
        attempts: jobAttempts,
        maxAttempts: jobMaxAttempts,
      }),
    );
  }
  if (retryPlan.action === 'retry') {
    // Reuse the EXISTING lease: claim_share_jobs re-claims a
    // processing_metadata row once locked_until passes, and already refuses
    // once attempts >= max_attempts. No new retry system, no migration.
    // The guard on status keeps a cancelled job cancelled.
    const { data: parked } = await admin
      .from('share_jobs')
      .update({
        locked_until: addSecondsIso(retryPlan.delaySeconds),
        progress_stage: 'metadata',
        last_error: `provider_retry:${metadataResult.failureReason ?? 'places_error'}`,
        // Park whatever we already found so a degraded later attempt cannot
        // erase it. Same mechanism the media path uses before falling back.
        ...(metadataResult.candidates.length > 0
          ? {
              candidate_payload: buildCandidateReviewSnapshot(
                metadataResult.candidates.map(safeCandidate),
                10,
                metadataSelectionMode,
              ),
            }
          : {}),
      })
      .eq('id', job.id)
      .eq('status', 'processing_metadata')
      .select('id')
      .maybeSingle();
    if (parked) return;
    // Status moved underneath us (cancelled/terminal) — fall through to the
    // normal routing rather than resurrecting the job.
    console.log(`[share-job] provider_retry_skipped job_id=${job.id} reason=status_changed`);
    return;
  }

  const plan = planFromResolverDecision({
    decision: metadataResult.decision,
    safeToAutoSave: metadataResult.safeToAutoSave,
    hasPrimaryCandidate: !!metadataResult.primaryCandidate,
    candidateCount: metadataResult.candidates.length,
    cleanSearchQuery: metadataResult.cleanSearchQuery,
    failureReason: metadataResult.failureReason,
  });

  if (plan.route === 'auto_save') {
    const candidate = metadataAutoSave.selectedProviderId
      ? result.candidates.find(
          (entry: any) => entry.googlePlaceId === metadataAutoSave.selectedProviderId,
        ) ?? metadataResult.primaryCandidate
      : metadataResult.primaryCandidate;
    const source = legacySourceFor(platform);
    const saved = await saveForUser({
      client: admin,
      userId: job.user_id,
      candidate,
      sourceUrl: canonicalUrl,
      source,
      sourceMetadata: {
        resolvedUrl: canonicalUrl,
        creatorHandle,
        caption: description,
      },
    });
    await finalize(
      admin,
      job,
      {
        status: 'completed',
        decision: 'auto_save',
        saved_place_id: saved.savedPlaceId,
        candidate_payload: buildCandidateReviewSnapshot([safeCandidate(candidate)], 10, 'single'),
        canonical_url: canonicalUrl,
        source_platform: platform,
        extraction_payload: {
          ...extractionPayload,
          savedPlaceName: candidate.name,
          alreadySaved: saved.reused,
        },
        progress_stage: 'completed',
        completed_at: nowIso(),
      },
      composeShareCompletionNotification({
        status: 'completed',
        placeName: candidate.name,
        jobId: job.id,
        savedPlaceId: saved.savedPlaceId,
        googlePlaceId: candidate.googlePlaceId,
        alreadySaved: saved.reused,
      }),
    );

    // Save completion is user-facing and terminal. Source enrichment is a
    // separate durable concern: schedule it only after the save is committed,
    // and never move the parent back out of `completed`.
    const configuredFlags = readMediaFlags();
    const effectiveFlags = effectiveMediaFlags(configuredFlags, job.user_id);
    const mediaTaskExists = await mediaTaskExistsFor(admin, job.id);
    const enrichment = shouldRunPostSaveEnrichment(
      {
        platform,
        mediaFallbackEnabled: effectiveFlags.mediaFallbackEnabled,
        instagramResolverEnabled: effectiveFlags.instagramResolverEnabled,
        tiktokResolverEnabled: effectiveFlags.tiktokResolverEnabled,
        youtubeResolverEnabled: effectiveFlags.youtubeResolverEnabled,
        facebookResolverEnabled: effectiveFlags.facebookResolverEnabled,
        snapchatResolverEnabled: effectiveFlags.snapchatResolverEnabled,
        mediaTaskExists,
        jobStatus: 'completed',
      },
    );
    console.log(
      `[share-job] post_save_enrichment job_id=${job.id} run=${enrichment.run} reason=${enrichment.reason}`,
    );
    if (enrichment.run) {
      await enqueueMediaTask(admin, job, platform, canonicalUrl, requestUrl, { parkParent: false });
    }
    return;
  }

  // ---- Phase 2: media fallback (durable video analysis) ----------
  // Only when the server-only MEDIA_FALLBACK_ENABLED flag is on. When off this
  // whole block is skipped (no extra DB calls) and the needs_help path below is
  // byte-identical to Phase 1.
  const configuredMediaFlags = readMediaFlags();
  const mediaFlags = effectiveMediaFlags(configuredMediaFlags, job.user_id);
  if (mediaFlags.mediaFallbackEnabled) {
    const mediaTaskExists = await mediaTaskExistsFor(admin, job.id);
    const trigger = shouldRunMediaFallback(
      {
        decision: metadataResult.decision,
        safeToAutoSave: metadataResult.safeToAutoSave,
        hasPrimaryCandidate: !!metadataResult.primaryCandidate,
        candidateCount: metadataResult.candidates.length,
        evidenceUsed: metadataResult.evidenceUsed,
        warnings: metadataResult.warnings,
        addressesCount: evidence.addresses.length,
        failureReason: result.failureReason ?? null,
      },
      {
        platform,
        mediaFallbackEnabled: mediaFlags.mediaFallbackEnabled,
        instagramResolverEnabled: mediaFlags.instagramResolverEnabled,
        tiktokResolverEnabled: mediaFlags.tiktokResolverEnabled,
        youtubeResolverEnabled: mediaFlags.youtubeResolverEnabled,
        facebookResolverEnabled: mediaFlags.facebookResolverEnabled,
        snapchatResolverEnabled: mediaFlags.snapchatResolverEnabled,
        mediaTaskExists,
        jobStatus: 'processing_metadata',
      },
    );
    if (trigger.run) {
      const parkedCandidatePayload = buildCandidateReviewSnapshot(
        metadataResult.candidates.map(safeCandidate),
        10,
        metadataSelectionMode,
      );
      await enqueueMediaTask(admin, job, platform, canonicalUrl, requestUrl, {
        parkPatch: {
          decision: metadataResult.decision,
          needs_help_reason: metadataResult.candidates.length > 1 ? 'multiple_candidates' : 'candidate_confirmation',
          suggested_query: plan.route === 'needs_help' ? plan.suggestedQuery : metadataResult.cleanSearchQuery ?? null,
          candidate_payload: parkedCandidatePayload,
          extraction_payload: extractionPayload,
          canonical_url: canonicalUrl,
          source_platform: platform,
        },
      });
      console.log(`[share-job] media_fallback_enqueued job_id=${job.id} reason=${trigger.reason}`);
      return;
    }
    console.log(`[share-job] media_fallback_skipped job_id=${job.id} reason=${trigger.reason}`);
  }

  // needs_help (single / multi / manual)
  const candidatePayload = buildCandidateReviewSnapshot(
    metadataResult.candidates.map(safeCandidate),
    10,
    metadataSelectionMode,
  );
  const metadataReviewReason =
    metadataAutoSave.plausibleCandidateCount === 1 && metadataAutoSave.explicitConflictFlags.length > 0
      ? `metadata_${metadataAutoSave.explicitConflictFlags[0]}`
      : metadataAutoSave.viableCandidateCount === 0 && metadataAutoSave.plausibleCandidateCount > 0
      ? `metadata_${metadataAutoSave.reasonCodes[0] ?? 'weak_singleton'}`
      : metadataAutoSave.plausibleCandidateCount === 0 && metadataAutoSave.candidateRejectionReasons.length > 0
      ? `metadata_${metadataAutoSave.candidateRejectionReasons[0]}`
      : plan.needsHelpReason;
  const decisionForRow =
    plan.mode === 'manual'
      ? 'manual_fallback'
      : metadataResult.decision === 'multi_candidate_confirmation'
      ? 'multi_candidate_confirmation'
      : metadataResult.decision === 'candidate_picker'
      ? 'candidate_picker'
      : 'candidate_confirmation';

  const metadataTechnicalFailure =
    metadataResult.candidates.length === 0 &&
    providerFailureClass === 'transient_provider' &&
    retryPlan.action === 'degrade' &&
    retryPlan.reason === 'attempts_exhausted';
  const metadataFailureCode = metadataResult.candidates.length === 0
    ? metadataTechnicalFailure
      ? metadataResult.failureReason ?? 'places_provider_unavailable_exhausted'
      : 'media_unavailable'
    : null;
  const metadataFailureCategory = metadataFailureCode
    ? classifyShareFailure({
        failureCode: metadataFailureCode,
        provider: platform,
        analysisAttempted: false,
      })
    : null;
  const note = reviewNotification({
    mode: plan.mode,
    jobId: job.id,
    candidates: metadataResult.candidates,
    notificationLocality: trustedMetadataNotificationLocality(evidence, metadataResult),
    hasWeakClues: hasSafeWeakClues(metadataResult.evidenceUsed),
    failureCategory: metadataFailureCategory,
    failureCode: metadataFailureCode,
    provider: platform,
    analysisAttempted: metadataFailureCode ? false : null,
  });

  await finalize(
    admin,
    job,
    {
      status: metadataTechnicalFailure ? 'failed' : 'needs_help',
      decision: metadataTechnicalFailure ? 'failed' : decisionForRow,
      needs_help_reason: metadataReviewReason,
      ...(metadataFailureCode
        ? {
            failure_reason: metadataFailureCode,
            failure_code: metadataFailureCode,
            failure_category: metadataFailureCategory,
            analysis_attempted: false,
          }
        : {}),
      suggested_query: plan.suggestedQuery,
      candidate_payload: candidatePayload,
      canonical_url: canonicalUrl,
      source_platform: platform,
      extraction_payload: extractionPayload,
      progress_stage: plan.mode,
    },
    note,
  );
}

function parseNotificationPayload(raw: any): { title: string; body: string; data: Record<string, unknown> } | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.title !== 'string' || typeof raw.body !== 'string') return null;
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  return { title: raw.title, body: raw.body, data };
}

async function processPendingNotifications(admin: any, limit = 25): Promise<void> {
  const { data: claimed, error } = await admin.rpc('claim_share_job_notifications', {
    p_limit: limit,
    p_stale_seconds: 180,
  });
  if (error) {
    console.log(`[share-job] notification_claim_failed msg=${truncate(error.message)}`);
    return;
  }

  const rows = Array.isArray(claimed) ? claimed : [];
  for (const row of rows) {
    const payload = parseNotificationPayload(row.notification_payload);
    if (!payload) {
      await admin
        .from('share_jobs')
        .update({
          notification_status: 'permanently_failed',
          notification_error_code: 'invalid_notification_payload',
          notification_next_attempt_at: null,
        })
        .eq('id', row.id)
        .eq('notification_status', 'sending');
      continue;
    }

    const result = await submitPushToUser(admin, row.user_id, payload);
    if (result.status === 'submitted') {
      await admin
        .from('share_jobs')
        .update({
          notification_status: 'submitted',
          notification_ticket_ids: result.ticketRefs,
          notification_submitted_at: nowIso(),
          notification_error_code: null,
          notification_next_attempt_at: null,
        })
        .eq('id', row.id)
        .eq('notification_status', 'sending');
      console.log(`[share-job] notification_submitted job_id=${row.id} tickets=${result.ticketRefs.length}`);
      continue;
    }

    if (result.status === 'retryable_failed') {
      const attempts = typeof row.notification_attempts === 'number' ? row.notification_attempts : 1;
      const maxAttempts = typeof row.notification_max_attempts === 'number' ? row.notification_max_attempts : 6;
      const nextStatus = attempts >= maxAttempts ? 'permanently_failed' : 'retryable_failed';
      const nextAttempt =
        nextStatus === 'retryable_failed' ? addSecondsIso(notificationBackoffSeconds(attempts)) : null;

      await admin
        .from('share_jobs')
        .update({
          notification_status: nextStatus,
          notification_error_code:
            nextStatus === 'permanently_failed'
              ? 'notification_retry_budget_exhausted'
              : (result.errorCode ?? 'notification_retryable_error'),
          notification_next_attempt_at: nextAttempt,
        })
        .eq('id', row.id)
        .eq('notification_status', 'sending');
      console.log(`[share-job] notification_retry_scheduled job_id=${row.id} attempts=${attempts}`);
      continue;
    }

    await admin
      .from('share_jobs')
      .update({
        notification_status: 'permanently_failed',
        notification_error_code: result.errorCode ?? 'notification_permanent_error',
        notification_next_attempt_at: null,
      })
      .eq('id', row.id)
      .eq('notification_status', 'sending');
    console.log(`[share-job] notification_permanent_failure job_id=${row.id}`);
  }
}

async function processNotificationReceipts(admin: any, limit = 25): Promise<void> {
  const { data: claimed, error } = await admin.rpc('claim_share_job_receipts', {
    p_limit: limit,
    p_recheck_seconds: 90,
  });
  if (error) {
    console.log(`[share-job] receipt_claim_failed msg=${truncate(error.message)}`);
    return;
  }

  const rows = Array.isArray(claimed) ? claimed : [];
  for (const row of rows) {
    const refsRaw = Array.isArray(row.notification_ticket_ids) ? row.notification_ticket_ids : [];
    const refs: TicketRef[] = refsRaw
      .filter((r: any) => r && typeof r.ticketId === 'string' && typeof r.tokenId === 'string')
      .map((r: any) => ({ ticketId: r.ticketId, tokenId: r.tokenId }));

    if (refs.length === 0) continue;

    const receipt = await checkExpoReceipts(admin, refs);
    if (receipt.errorCode === 'expo_receipts_retryable') {
      await admin
        .from('share_jobs')
        .update({ notification_error_code: receipt.errorCode })
        .eq('id', row.id)
        .eq('notification_status', 'submitted');
      continue;
    }

    if (receipt.allPermanentFailures) {
      await admin
        .from('share_jobs')
        .update({
          notification_status: 'permanently_failed',
          notification_error_code: receipt.errorCode ?? 'expo_receipts_permanent_failure',
          notification_next_attempt_at: null,
        })
        .eq('id', row.id)
        .eq('notification_status', 'submitted');
      continue;
    }

    await admin
      .from('share_jobs')
      .update({ notification_error_code: receipt.errorCode })
      .eq('id', row.id)
      .eq('notification_status', 'submitted');
  }
}

const standaloneTestPort = Number(Deno.env.get('NEARR_EDGE_TEST_PORT') ?? '');
const standaloneServeOptions = Number.isInteger(standaloneTestPort) && standaloneTestPort > 0
  ? { port: standaloneTestPort }
  : undefined;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // ---- Worker auth --------------------------------------------------------
  // Primary: a dedicated, high-entropy scheduler secret in the
  // `x-nearr-worker-secret` header (decoupled from the rotating service-role
  // key). Fallback: a SEPARATE dedicated `MEDIA_FINALIZE_SECRET` bearer, used
  // ONLY by the media-worker's finalize callback (verifyPlaceEvidence) — also
  // decoupled from the service-role key, so a key rotation can never silently
  // break this callback again (the exact failure this replaced). Both are
  // constant-time compared and fail closed. This endpoint is deployed with
  // verify_jwt disabled (a private scheduler URL), so these dedicated-secret
  // checks are the sole gate and run before any work.
  const workerSecret = Deno.env.get('SHARE_JOBS_WORKER_SECRET') ?? '';
  const presentedWorkerSecret = req.headers.get('x-nearr-worker-secret') ?? '';
  const mediaFinalizeSecret = Deno.env.get('MEDIA_FINALIZE_SECRET') ?? '';
  const headerAuth = req.headers.get('authorization') ?? '';
  const authorized =
    authorizeWorkerSecret(presentedWorkerSecret, workerSecret) ||
    authorizeMediaFinalizeSecret(headerAuth, mediaFinalizeSecret);
  if (!authorized) {
    return json({ error: 'unauthorized' }, 401);
  }

  const envRaw = readEnv();
  const envCheck = validateEnv(envRaw);
  if (!envCheck.ok) {
    return json({ error: envCheck.reason }, 500);
  }
  const env = envCheck.env;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Phase 2: media-worker callback — finalize a media task through the EXISTING
  // resolver + safeToAutoSave + save path. Same service-role auth as the sweep.
  if (body && body.mode === 'finalize_media_task') {
    const invocation = {
      id: req.headers.get('x-request-id') || crypto.randomUUID(),
      startedAt: Date.now(),
    };
    console.log(JSON.stringify({
      marker: 'phase2_reliability',
      invocationId: invocation.id,
      jobId: null,
      taskId: typeof body.taskId === 'string' ? body.taskId : null,
      operation: 'finalize_media_task',
      attempt: null,
      claimState: 'unknown',
      elapsedMs: 0,
      finalStatus: 'started',
      errorClass: null,
    }));
    try {
      const response = await finalizeMediaTask(admin, env, body, invocation);
      console.log(JSON.stringify({
        marker: 'phase2_reliability',
        invocationId: invocation.id,
        jobId: null,
        taskId: typeof body.taskId === 'string' ? body.taskId : null,
        operation: 'finalize_media_task',
        attempt: null,
        claimState: 'unknown',
        elapsedMs: Date.now() - invocation.startedAt,
        finalStatus: 'http_complete',
        httpStatus: response.status,
        errorClass: null,
      }));
      return response;
    } catch (err) {
      console.log(JSON.stringify({
        marker: 'phase2_reliability',
        invocationId: invocation.id,
        jobId: null,
        taskId: typeof body.taskId === 'string' ? body.taskId : null,
        operation: 'finalize_media_task',
        attempt: null,
        claimState: 'unknown',
        elapsedMs: Date.now() - invocation.startedAt,
        finalStatus: 'failed',
        errorClass: classifyFinalizeException(err),
      }));
      return json({ error: 'media_finalize_failed' }, 500);
    }
  }

  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 25);

  // Release only demonstrably dead technical reservations (missing/failed/
  // cancelled jobs, or exhausted expired leases). Active long-running jobs
  // are never released by wall-clock age alone.
  const { error: reapError } = await admin.rpc('release_stale_place_find_reservations', {
    p_limit: 100,
  });
  if (reapError) console.log(`[share-job] reservation_reap_failed code=${reapError.code ?? 'unknown'}`);

  const { data: claimed, error: claimErr } = await admin.rpc('claim_share_jobs', {
    p_limit: limit,
    p_lock_seconds: 120,
  });
  if (claimErr) {
    console.log(`[share-job] claim_failed msg=${truncate(claimErr.message)}`);
    return json({ error: 'claim_failed' }, 500);
  }

  const jobs = Array.isArray(claimed) ? claimed : [];
  let processed = 0;
  for (const job of jobs) {
    console.log(`[share-job] claimed job_id=${job.id} platform=${job.source_platform ?? 'unknown'}`);
    try {
      await processOne(admin, env, job);
      processed += 1;
    } catch (err) {
      console.log(`[share-job] processing_error job_id=${job.id} msg=${truncate((err as Error)?.message)}`);
      await handleProcessingError(admin, job, err);
    }
  }

  await processPendingNotifications(admin, limit);
  await processNotificationReceipts(admin, limit);
  // Media recovery only runs when Phase 2 media fallback is enabled; otherwise
  // its Phase 2 RPCs are absent and this stays a no-op (Phase 1 sweep clean).
  if (mediaInfrastructureEnabled(readMediaFlags())) {
    await recoverStrandedMediaJobs(admin);
  }

  const flags = readMediaFlags();
  return json({
    claimed: jobs.length,
    processed,
    mediaAutoSave: {
      threshold: flags.autoSaveThreshold,
      thresholdValid: flags.autoSaveThresholdValid,
      ruleVersion: MEDIA_AUTO_SAVE_RULE_VERSION,
    },
    metadataAutoSave: {
      ruleVersion: METADATA_AUTO_SAVE_RULE_VERSION,
    },
  });
}, standaloneServeOptions);
