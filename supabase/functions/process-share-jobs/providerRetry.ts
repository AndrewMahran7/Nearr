// supabase/functions/process-share-jobs/providerRetry.ts
//
// PURE classification of "the resolver could not identify a place" into:
//
//   transient_provider — an external dependency failed (Google Places 429/5xx,
//     timeout, network). Waiting and replaying the SAME work can succeed, so
//     the job stays in a processing state and is re-claimed after a backoff.
//
//   deterministic — the provider answered successfully and the answer was
//     "no match" / "ambiguous" / "not enough evidence". Retrying replays the
//     identical request and gets the identical answer, so the user is asked.
//
// This boundary is the whole point: a provider ERROR is not a provider
// RESULT. Collapsing them is what turned a Google outage into "search for the
// place yourself".
//
// No imports on purpose — runs under Deno in the edge function and under
// ts-node in scripts/testProviderRetry.ts.

/** Resolver failure reasons that mean an external dependency broke. */
const TRANSIENT_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'places_error',
  'places_provider_unavailable',
  'geocode_provider_error',
  'extraction_provider_error',
  'transcription_provider_error',
  'model_provider_error',
]);

/**
 * Warnings the resolver pushes when a Places call failed at the transport or
 * API level. `places_http_error` is a fetch/timeout failure; `places_api_error`
 * is a non-OK Google status (OVER_QUERY_LIMIT, UNKNOWN_ERROR, …).
 */
const TRANSIENT_WARNINGS: ReadonlySet<string> = new Set([
  'places_http_error',
  'places_api_error',
  // Address verification hit a provider fault rather than concluding anything
  // about the address. The resolver falls through to a plain text search, so
  // the job can still end up WITH candidates that a successful verification
  // would have improved (a verified business at the extracted address, scored
  // far higher, and often collapsing an ambiguous pair to one).
  'address_verify_provider_error',
]);

/**
 * Deterministic reasons. Listed explicitly so a new reason defaults to
 * deterministic (ask the user) rather than silently entering a retry loop.
 */
const DETERMINISTIC_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'no_candidates',
  'no_match',
  'insufficient_evidence',
  'rejected_insufficient_evidence',
  'ambiguous',
  'name_mismatch',
  'no_business_near_address',
  'no_candidates_near_address',
  'roundup_detected',
  'unsupported_platform',
  'manual_search',
  // Google answered fine; every result was geographic context (a city /
  // county / country), so there is nothing to retry.
  'all_candidates_rejected_as_geographic_context',
]);

export type ResolverFailureClass = 'transient_provider' | 'deterministic';

export type ResolverOutcome = {
  decision?: string | null;
  failureReason?: string | null;
  candidateCount?: number;
  warnings?: readonly string[] | null;
  /** Provider-supplied Retry-After, in seconds, when one was present. */
  retryAfterSeconds?: number | null;
};

/**
 * Classify a resolver outcome.
 *
 * Candidates are NEVER destroyed by this decision — parking a job leaves the
 * whole resolver result untouched and finalizes nothing. So the question is
 * not "do we have candidates?" but "did a provider actually fault, and could
 * replaying it still improve the answer?":
 *
 *   • provider faulted, result not yet auto-savable  → retry (candidates kept)
 *   • provider faulted, already auto_save            → deterministic; that is
 *       the best possible outcome, retrying only delays the save
 *   • no provider fault (genuine ambiguity/no-match) → deterministic; replaying
 *       the same successful call returns the same answer
 */
export function classifyResolverFailure(outcome: ResolverOutcome | null | undefined): ResolverFailureClass {
  if (!outcome) return 'deterministic';

  const reason = (outcome.failureReason ?? '').trim();
  // An explicit deterministic reason means the provider answered successfully
  // and the resolver concluded something real. That wins over a stale warning.
  if (reason && DETERMINISTIC_FAILURE_REASONS.has(reason)) return 'deterministic';

  const warnings = Array.isArray(outcome.warnings) ? outcome.warnings : [];
  const providerFaulted =
    (!!reason && TRANSIENT_FAILURE_REASONS.has(reason)) ||
    warnings.some((w) => typeof w === 'string' && TRANSIENT_WARNINGS.has(w));
  if (!providerFaulted) return 'deterministic';

  // Already the best result the pipeline can produce — save it, don't stall it.
  if ((outcome.candidateCount ?? 0) > 0 && outcome.decision === 'auto_save') {
    return 'deterministic';
  }
  return 'transient_provider';
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

/** Base delay; doubles per attempt. Mirrors the media task convention. */
export const RESOLVER_RETRY_BASE_SECONDS = 20;
export const RESOLVER_RETRY_MAX_SECONDS = 600;

export type ResolverRetryPlan =
  | { action: 'retry'; delaySeconds: number; attempt: number }
  | { action: 'degrade'; reason: 'attempts_exhausted' | 'not_transient' };

/**
 * Bounded exponential backoff with jitter, honoring a sane provider
 * Retry-After. Returns `degrade` once the job's attempt budget is spent so the
 * caller falls through to normal user-help routing — a job must never sit in a
 * processing state forever.
 *
 * `attempts` is the job's CURRENT attempt count (claim already incremented it).
 */
export function planResolverRetry(args: {
  failureClass: ResolverFailureClass;
  attempts: number;
  maxAttempts: number;
  retryAfterSeconds?: number | null;
  /** Injectable for deterministic tests. Expected in [0, 1). */
  random?: () => number;
}): ResolverRetryPlan {
  if (args.failureClass !== 'transient_provider') {
    return { action: 'degrade', reason: 'not_transient' };
  }
  const attempts = Number.isFinite(args.attempts) ? Math.max(1, Math.floor(args.attempts)) : 1;
  const maxAttempts = Number.isFinite(args.maxAttempts) ? Math.floor(args.maxAttempts) : 0;
  // One more claim must remain available, otherwise the job would be parked in
  // a processing state that claim_share_jobs can never pick up again.
  if (attempts >= maxAttempts) {
    return { action: 'degrade', reason: 'attempts_exhausted' };
  }

  const exponential = RESOLVER_RETRY_BASE_SECONDS * 2 ** Math.max(0, attempts - 1);
  const capped = Math.min(exponential, RESOLVER_RETRY_MAX_SECONDS);
  const rand = typeof args.random === 'function' ? args.random() : Math.random();
  const jitter = 1 + (Math.min(Math.max(rand, 0), 0.999) * 0.4 - 0.2); // ±20%
  let delaySeconds = Math.round(capped * jitter);

  // A provider that tells us when to come back wins, as long as the value is
  // sane — never let a hostile/garbage header park a job for hours.
  const retryAfter = args.retryAfterSeconds;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
    delaySeconds = Math.min(Math.max(Math.ceil(retryAfter), delaySeconds), RESOLVER_RETRY_MAX_SECONDS);
  }

  return {
    action: 'retry',
    delaySeconds: Math.max(1, Math.min(delaySeconds, RESOLVER_RETRY_MAX_SECONDS)),
    attempt: attempts,
  };
}

/** Low-cardinality, secret-free log line for a retry decision. */
export function formatResolverRetryLog(args: {
  jobId: string;
  step: string;
  failureClass: ResolverFailureClass;
  failureCode: string | null;
  plan: ResolverRetryPlan;
  attempts: number;
  maxAttempts: number;
}): string {
  const parts = [
    '[share-job] provider_failure',
    `job_id=${args.jobId}`,
    `step=${args.step}`,
    `class=${args.failureClass}`,
    `code=${args.failureCode ?? 'none'}`,
    `attempts=${args.attempts}/${args.maxAttempts}`,
    `action=${args.plan.action}`,
  ];
  if (args.plan.action === 'retry') parts.push(`retry_in_s=${args.plan.delaySeconds}`);
  else parts.push(`degrade_reason=${args.plan.reason}`);
  return parts.join(' ');
}
