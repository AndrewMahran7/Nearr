// supabase/functions/process-share-link/failureLogging.ts
//
// Best-effort persistent failure logging for share extraction diagnostics.
//
// Design goals:
// - Never throw into the request path.
// - Never log secrets (tokens/cookies/auth headers/raw HTML).
// - Keep payloads bounded and LLM-friendly.
// - Deterministic failure classes for regression triage.

import type { Evidence } from './evidence/extractEvidence.ts';
import type { ResolverResult, ResolvedCandidate } from './types.ts';

export type WireStatus =
  | 'saved'
  | 'extracted'
  | 'ambiguous'
  | 'open_app'
  | 'failed_requires_app'
  | 'failed';

export type FailureClass =
  | 'manual_fallback_no_candidates'
  | 'manual_fallback_no_explicit_place_evidence'
  | 'address_present_but_no_verified_business'
  | 'platform_noise_rejected'
  | 'generic_caption_blocked'
  | 'metadata_unavailable'
  | 'metadata_too_weak'
  | 'places_no_results'
  | 'places_only_generic_address'
  | 'candidate_rejected_low_confidence'
  | 'candidate_rejected_platform_noise'
  | 'malformed_response'
  | 'unknown_failure';

export type FailureAssessment = {
  shouldLog: boolean;
  failureClass: FailureClass | null;
  triggerReasons: string[];
  addressPresent: boolean;
  addressCount: number;
  candidateCount: number;
  queryCount: number;
  suspiciousLowConfidence: boolean;
  allGenericAddressCandidates: boolean;
};

export type RecordShareExtractionFailureArgs = {
  adminClient: any;
  userId: string | null;
  originalUrl: string;
  canonicalUrl: string | null;
  platform: string | null;
  wireStatus: WireStatus;
  result: ResolverResult;
  extraction: {
    title?: string | null;
    description?: string | null;
    query?: string | null;
  };
  evidence: Evidence;
  requestId?: string | null;
  appVersion?: string | null;
  backendVersion?: string | null;
  logAllExtractions?: boolean;
};

const TITLE_PREVIEW_MAX = 240;
const DESCRIPTION_PREVIEW_MAX = 420;
const QUERY_PREVIEW_MAX = 320;
const MAX_QUERY_PLAN = 20;
const MAX_WARNINGS = 30;
const MAX_CANDIDATES = 10;
const MAX_REASON_LEN = 140;
const LOW_CONFIDENCE_SCORE = 0.35;

const SENSITIVE_KEY_RE = /(authorization|cookie|jwt|token|secret|password|access_token|refresh_token|set-cookie)/i;

const ADDRESS_NAME_RE = /^\s*\d{1,6}\s+\S+/i;
const STREET_SUFFIX_RE = /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|ter|terrace|pl|place)\b\.?/i;

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function isAddressLikeName(value: string | null | undefined): boolean {
  if (!value) return false;
  return ADDRESS_NAME_RE.test(value) && STREET_SUFFIX_RE.test(value);
}

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => truncate(item as string, MAX_REASON_LEN))
    .slice(0, max);
}

function scrubSecrets(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return truncate(value, 800);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => scrubSecrets(item));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) continue;
      output[k] = scrubSecrets(v);
    }
    return output;
  }
  return null;
}

function candidateScore(candidate: ResolvedCandidate | undefined): number | null {
  if (!candidate || !Number.isFinite(candidate.confidenceScore)) return null;
  return Number(candidate.confidenceScore.toFixed(4));
}

function pickDiagnosticsSubset(diagnostics: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'queryPlan',
    'decisionReasons',
    'timings',
    'searchAttempts',
    'addressVerification',
    'multiAddressVerification',
    'placesError',
    'rejectedCount',
    'evidenceSourceWon',
  ];
  const subset: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in diagnostics) subset[key] = diagnostics[key];
  }
  return (scrubSecrets(subset) as Record<string, unknown>) ?? {};
}

function hasWarning(warnings: string[], value: string): boolean {
  return warnings.includes(value);
}

function inferFailureClass(args: {
  wireStatus: WireStatus;
  decision: string;
  result: ResolverResult;
  addressPresent: boolean;
  candidateCount: number;
  allGenericAddressCandidates: boolean;
  suspiciousLowConfidence: boolean;
  evidenceEmptyForConfirmation: boolean;
}): FailureClass {
  const { wireStatus, decision, result, addressPresent, candidateCount } = args;
  const warnings = result.warnings ?? [];

  if (hasWarning(warnings, 'address_present_but_no_verified_business')) {
    return 'address_present_but_no_verified_business';
  }
  if (hasWarning(warnings, 'generic_caption_query_blocked')) {
    return 'generic_caption_blocked';
  }
  if (hasWarning(warnings, 'all_candidates_rejected_as_platform_noise')) {
    return 'platform_noise_rejected';
  }
  if (
    result.failureReason === 'all_candidates_rejected_as_platform_noise'
  ) {
    return 'candidate_rejected_platform_noise';
  }
  if (
    decision === 'manual_fallback' &&
    (result.failureReason === 'manual_fallback_no_explicit_place_evidence' ||
      hasWarning(warnings, 'manual_fallback_no_explicit_place_evidence'))
  ) {
    return 'manual_fallback_no_explicit_place_evidence';
  }
  if (decision === 'manual_fallback' && addressPresent && candidateCount === 0) {
    return 'manual_fallback_no_candidates';
  }
  if (wireStatus === 'failed_requires_app' && result.failureReason === 'metadata_failed') {
    return 'metadata_unavailable';
  }
  if (wireStatus === 'open_app' && !addressPresent && candidateCount === 0) {
    return 'metadata_too_weak';
  }
  if (candidateCount === 0 && addressPresent) {
    return 'places_no_results';
  }
  if (args.allGenericAddressCandidates) {
    return 'places_only_generic_address';
  }
  if (args.suspiciousLowConfidence || args.evidenceEmptyForConfirmation) {
    return 'candidate_rejected_low_confidence';
  }
  if (wireStatus === 'failed' && result.failureReason === 'no_query') {
    return 'malformed_response';
  }
  return 'unknown_failure';
}

export function assessShareFailureLogging(args: {
  wireStatus: WireStatus;
  result: ResolverResult;
  evidence: Evidence;
  logAllExtractions?: boolean;
}): FailureAssessment {
  const warnings = args.result.warnings ?? [];
  const queryPlan = toStringArray(args.result.diagnostics?.queryPlan, MAX_QUERY_PLAN);
  const addressCount = args.evidence.addresses?.length ?? (args.evidence.address ? 1 : 0);
  const addressPresent = addressCount > 0;
  const candidateCount = args.result.candidates?.length ?? 0;

  const selected = args.result.primaryCandidate ?? args.result.candidates?.[0];
  const selectedScore = selected?.confidenceScore ?? 1;
  const evidenceEmptyForConfirmation =
    args.result.decision === 'candidate_confirmation' &&
    (args.result.evidenceUsed?.length ?? 0) === 0;
  const suspiciousLowConfidence =
    !!selected &&
    args.result.decision === 'candidate_confirmation' &&
    selectedScore < LOW_CONFIDENCE_SCORE;

  const allGenericAddressCandidates =
    candidateCount > 0 &&
    args.result.candidates.every(
      (candidate) =>
        isAddressLikeName(candidate.name) ||
        candidate.reasons.includes('generic_address_card') ||
        candidate.reasons.includes('address_like_type_penalty'),
    );

  const triggerReasons: string[] = [];
  if (args.logAllExtractions) triggerReasons.push('env_log_all_share_extractions');
  if (args.result.decision === 'manual_fallback') triggerReasons.push('decision_manual_fallback');
  if (
    args.wireStatus === 'failed' ||
    args.wireStatus === 'open_app' ||
    args.wireStatus === 'failed_requires_app'
  ) {
    triggerReasons.push(`wire_status_${args.wireStatus}`);
  }
  if (addressPresent && candidateCount === 0) {
    triggerReasons.push('zero_candidates_with_address_evidence');
  }

  const warningTriggers = [
    'address_present_but_no_verified_business',
    'generic_caption_query_blocked',
    'manual_fallback_no_explicit_place_evidence',
    'all_candidates_rejected_as_platform_noise',
    'address_verify_no_business_near_address',
  ];
  for (const warning of warningTriggers) {
    if (warnings.includes(warning)) {
      triggerReasons.push(`warning_${warning}`);
    }
  }

  if (suspiciousLowConfidence) triggerReasons.push('suspicious_low_confidence_candidate');
  if (evidenceEmptyForConfirmation) triggerReasons.push('candidate_confirmation_without_evidence');
  if (allGenericAddressCandidates) triggerReasons.push('places_only_generic_address_candidates');

  const shouldLog = triggerReasons.length > 0;
  const failureClass = shouldLog
    ? inferFailureClass({
        wireStatus: args.wireStatus,
        decision: args.result.decision,
        result: args.result,
        addressPresent,
        candidateCount,
        allGenericAddressCandidates,
        suspiciousLowConfidence,
        evidenceEmptyForConfirmation,
      })
    : null;

  return {
    shouldLog,
    failureClass,
    triggerReasons,
    addressPresent,
    addressCount,
    candidateCount,
    queryCount: queryPlan.length,
    suspiciousLowConfidence,
    allGenericAddressCandidates,
  };
}

function buildLlmSummary(args: {
  failureClass: FailureClass;
  triggerReasons: string[];
  platform: string | null;
  wireStatus: WireStatus;
  result: ResolverResult;
  evidence: Evidence;
  queryPlan: string[];
  selected: ResolvedCandidate | undefined;
}): Record<string, unknown> {
  const addresses = (args.evidence.addresses ?? []).map((a) => {
    const parts = [a.raw, a.city, a.state, a.zip].filter(Boolean);
    return truncate(parts.join(', '), 180);
  });

  const candidates = args.result.candidates.slice(0, 5).map((candidate) => ({
    name: truncate(candidate.name, 120),
    address: truncate(candidate.formattedAddress, 160),
    score: candidateScore(candidate),
    rejected_because: candidate.reasons.includes('generic_address_card')
      ? 'generic_address_card'
      : null,
  }));

  const stepByClass: Record<FailureClass, string> = {
    manual_fallback_no_candidates:
      'Check address/venue query generation and Places recall for this address.',
    manual_fallback_no_explicit_place_evidence:
      'Inspect metadata quality and evidence extraction; add explicit place cues if available.',
    address_present_but_no_verified_business:
      'Review address verification fallback and venue/address pairing.',
    platform_noise_rejected:
      'Inspect platform-noise filtering and fallback query quality.',
    generic_caption_blocked:
      'Confirm that manual fallback is expected for generic-caption-only posts.',
    metadata_unavailable:
      'Inspect metadata fetch reliability and source URL accessibility.',
    metadata_too_weak:
      'Inspect metadata extraction quality and fallback parsing paths.',
    places_no_results:
      'Check normalized query forms and geocode/address context.',
    places_only_generic_address:
      'Improve venue-qualified query variants to beat generic address cards.',
    candidate_rejected_low_confidence:
      'Review ranking confidence thresholds and name/address matching signals.',
    candidate_rejected_platform_noise:
      'Audit platform-noise candidate filtering and fallback strategy.',
    malformed_response:
      'Check resolver output shape and query-plan generation.',
    unknown_failure:
      'Inspect diagnostics and warnings to determine the dominant failure path.',
  };

  return {
    problem_statement: summarizeProblemStatement(args.failureClass, args.result, args.wireStatus),
    platform: args.platform,
    decision: args.result.decision,
    wire_status: args.wireStatus,
    why_logged: args.triggerReasons.slice(0, 12),
    what_extracted: {
      addresses: addresses.slice(0, 8),
      venue_hints: (args.evidence.venueNameHints ?? []).slice(0, 8),
      handles: (args.evidence.handles?.taggedHandles ?? []).slice(0, 10),
    },
    what_was_queried: args.queryPlan.slice(0, 20),
    what_google_returned: candidates,
    selected_candidate: args.selected
      ? {
          name: truncate(args.selected.name, 120),
          address: truncate(args.selected.formattedAddress, 180),
          score: candidateScore(args.selected),
        }
      : null,
    expected_next_debug_step: stepByClass[args.failureClass],
  };
}

function summarizeProblemStatement(
  failureClass: FailureClass,
  result: ResolverResult,
  wireStatus: WireStatus,
): string {
  if (failureClass === 'address_present_but_no_verified_business') {
    return 'Manual fallback despite explicit address evidence.';
  }
  if (failureClass === 'manual_fallback_no_candidates') {
    return 'Manual fallback with zero candidates returned.';
  }
  if (failureClass === 'places_only_generic_address') {
    return 'Only generic address-card candidates were returned.';
  }
  if (failureClass === 'candidate_rejected_low_confidence') {
    return 'Candidate surfaced with low-confidence or weak evidence.';
  }
  if (wireStatus === 'failed_requires_app' || wireStatus === 'failed') {
    return `Backend returned ${wireStatus} (${result.failureReason ?? 'unknown reason'}).`;
  }
  return `Logged for ${failureClass}.`;
}

function buildRow(args: {
  assessment: FailureAssessment;
  wireStatus: WireStatus;
  userId: string | null;
  originalUrl: string;
  canonicalUrl: string | null;
  platform: string | null;
  result: ResolverResult;
  extraction: { title?: string | null; description?: string | null; query?: string | null };
  evidence: Evidence;
  requestId?: string | null;
  appVersion?: string | null;
  backendVersion?: string | null;
}): Record<string, unknown> {
  const selected = args.result.primaryCandidate ?? args.result.candidates?.[0];
  const warnings = toStringArray(args.result.warnings, MAX_WARNINGS);
  const queryPlan = toStringArray(args.result.diagnostics?.queryPlan, MAX_QUERY_PLAN);
  const diagnostics = pickDiagnosticsSubset(args.result.diagnostics ?? {});

  const evidencePayload = {
    keys: args.result.evidenceUsed ?? [],
    city_state: args.evidence.cityState ?? null,
    addresses: (args.evidence.addresses ?? []).slice(0, 10).map((address) => ({
      raw: truncate(address.raw, 200),
      city: truncate(address.city, 80) || null,
      state: truncate(address.state, 8) || null,
      zip: truncate(address.zip, 12) || null,
      venue: truncate(address.venue, 120) || null,
    })),
    venue_hints: (args.evidence.venueNameHints ?? []).slice(0, 12).map((hint) => truncate(hint, 120)),
    handles: {
      poster: truncate(args.evidence.handles?.posterHandle, 80) || null,
      tagged: (args.evidence.handles?.taggedHandles ?? []).slice(0, 20).map((h) => truncate(h, 80)),
      venue: (args.evidence.handles?.venueHandles ?? []).slice(0, 20).map((h) => truncate(h, 80)),
    },
    is_roundup: !!args.evidence.isRoundup,
  };

  const candidates = args.result.candidates.slice(0, MAX_CANDIDATES).map((candidate) => ({
    name: truncate(candidate.name, 140),
    address: truncate(candidate.formattedAddress, 180),
    place_id: truncate(candidate.googlePlaceId, 120),
    score: candidateScore(candidate),
    reasons: toStringArray(candidate.reasons, 12),
    evidence: toStringArray(candidate.evidence, 12),
    address_like_name: isAddressLikeName(candidate.name),
  }));

  const failureClass = args.assessment.failureClass ?? 'unknown_failure';

  return {
    user_id: args.userId,
    original_url: truncate(args.originalUrl, 1200),
    canonical_url: truncate(args.canonicalUrl, 1200) || null,
    platform: truncate(args.platform, 40) || null,

    status: args.wireStatus,
    user_facing_decision: args.result.decision,
    safe_to_auto_save: args.result.safeToAutoSave,
    confidence: truncate(args.result.confidence, 32) || null,

    failure_class: failureClass,
    failure_reason: truncate(args.result.failureReason ?? warnings[0] ?? '', 120) || null,

    selected_candidate_name: truncate(selected?.name, 160) || null,
    selected_candidate_address: truncate(selected?.formattedAddress, 200) || null,
    selected_candidate_place_id: truncate(selected?.googlePlaceId, 120) || null,
    selected_candidate_score: candidateScore(selected),

    address_present: args.assessment.addressPresent,
    address_count: args.assessment.addressCount,
    candidate_count: args.assessment.candidateCount,
    query_count: args.assessment.queryCount,

    title_preview: truncate(args.extraction.title, TITLE_PREVIEW_MAX) || null,
    description_preview: truncate(args.extraction.description, DESCRIPTION_PREVIEW_MAX) || null,
    suggested_query: truncate(args.result.cleanSearchQuery ?? args.extraction.query, QUERY_PREVIEW_MAX) || null,

    evidence: scrubSecrets(evidencePayload) ?? {},
    query_plan: scrubSecrets(queryPlan) ?? [],
    candidates: scrubSecrets(candidates) ?? [],
    warnings: scrubSecrets(warnings) ?? [],
    diagnostics,

    llm_summary: scrubSecrets(
      buildLlmSummary({
        failureClass,
        triggerReasons: args.assessment.triggerReasons,
        platform: args.platform,
        wireStatus: args.wireStatus,
        result: args.result,
        evidence: args.evidence,
        queryPlan,
        selected,
      }),
    ) ?? {},

    app_version: truncate(args.appVersion, 60) || null,
    backend_version: truncate(args.backendVersion, 60) || null,
    request_id: truncate(args.requestId, 120) || null,
  };
}

export async function recordShareExtractionFailure(
  args: RecordShareExtractionFailureArgs,
): Promise<{ id: string | null; assessment: FailureAssessment }> {
  const assessment = assessShareFailureLogging({
    wireStatus: args.wireStatus,
    result: args.result,
    evidence: args.evidence,
    logAllExtractions: !!args.logAllExtractions,
  });

  if (!assessment.shouldLog) {
    return { id: null, assessment };
  }

  const row = buildRow({
    assessment,
    wireStatus: args.wireStatus,
    userId: args.userId,
    originalUrl: args.originalUrl,
    canonicalUrl: args.canonicalUrl,
    platform: args.platform,
    result: args.result,
    extraction: args.extraction,
    evidence: args.evidence,
    requestId: args.requestId,
    appVersion: args.appVersion,
    backendVersion: args.backendVersion,
  });

  try {
    const { data, error } = await args.adminClient
      .from('share_extraction_failures')
      .insert(row)
      .select('id')
      .maybeSingle();

    if (error) {
      console.log(`[share-failure-log] insert_failed msg=${truncate(error.message, 180)}`);
      return { id: null, assessment };
    }
    return { id: (data?.id as string | null) ?? null, assessment };
  } catch (error) {
    console.log(
      `[share-failure-log] insert_failed msg=${truncate((error as Error)?.message ?? String(error), 180)}`,
    );
    return { id: null, assessment };
  }
}
