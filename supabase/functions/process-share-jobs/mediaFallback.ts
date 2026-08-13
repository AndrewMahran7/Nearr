// supabase/functions/process-share-jobs/mediaFallback.ts
//
// PURE, unit-testable decision for whether the async share worker should
// enqueue a durable media-analysis task (Phase 2) instead of moving the parent
// job straight to needs_help. No Deno globals, no I/O — unit-tested from Node
// via scripts/tsconfig.json (scripts/testMediaFallbackTrigger.ts).
//
// CORE PRODUCT RULE: this function NEVER saves anything and NEVER loosens
// auto-save. It only decides whether the (already-deterministic) metadata
// result is worth spending video analysis on. When every Phase 2 flag is off
// it always returns { run: false }, so Phase 1 behavior is byte-identical.
//
// Be conservative: do NOT trigger video for every share. Only trigger when
// metadata evidence was genuinely insufficient AND a supported platform's
// video could plausibly carry the missing spoken/visible place evidence.

export type MediaFallbackDecision =
  | 'auto_save'
  | 'candidate_confirmation'
  | 'candidate_picker'
  | 'multi_candidate_confirmation'
  | 'manual_fallback'
  | 'failed';

/** The (already-computed) metadata resolver outcome, reduced to the fields the
 *  trigger needs. Mirrors the relevant parts of `ResolverResult`. */
export type MediaFallbackInput = {
  decision: MediaFallbackDecision;
  safeToAutoSave: boolean;
  hasPrimaryCandidate: boolean;
  candidateCount: number;
  /** Evidence keys the resolver actually used (evidenceUsed). */
  evidenceUsed: string[];
  /** Non-fatal resolver warnings. */
  warnings: string[];
  /** Count of explicit street addresses found in the caption/metadata. */
  addressesCount: number;
  /** Resolver failureReason when decision === 'failed'/manual. */
  failureReason?: string | null;
};

export type MediaFallbackContext = {
  /** Detected platform for the share (lowercased). */
  platform: string;
  /** MEDIA_FALLBACK_ENABLED — master server flag (default false). */
  mediaFallbackEnabled: boolean;
  /** INSTAGRAM_MEDIA_RESOLVER_ENABLED (default false). */
  instagramResolverEnabled: boolean;
  /** True when a share_media_task already exists for this job. */
  mediaTaskExists: boolean;
  /** Parent share_jobs.status at decision time. */
  jobStatus: string;
};

export type MediaFallbackResult = {
  run: boolean;
  /** Machine-readable reason code for logs + tests. */
  reason: string;
};

export type MediaFlagState = {
  mediaFallbackEnabled: boolean;
  instagramResolverEnabled: boolean;
  canaryUserId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function effectiveMediaFlags(
  flags: MediaFlagState,
  jobUserId: string | null | undefined,
): { mediaFallbackEnabled: boolean; instagramResolverEnabled: boolean; canary: boolean } {
  const canaryUserId = flags.canaryUserId?.trim() ?? '';
  const canary = UUID_RE.test(canaryUserId) && canaryUserId === (jobUserId ?? '').trim();
  return {
    mediaFallbackEnabled: flags.mediaFallbackEnabled || canary,
    instagramResolverEnabled: flags.instagramResolverEnabled || canary,
    canary,
  };
}

export function mediaInfrastructureEnabled(flags: MediaFlagState): boolean {
  return flags.mediaFallbackEnabled || UUID_RE.test(flags.canaryUserId?.trim() ?? '');
}

// Evidence keys that make a single candidate strong enough that spending video
// analysis on it adds no value (a deterministic street-address match).
const STRONG_ADDRESS_EVIDENCE = new Set<string>([
  'places_address_verified',
  'caption_explicit_address',
]);

// Resolver failure reasons that are NOT about missing media evidence — video
// analysis cannot help these, so we must not spend it.
const NON_MEDIA_FAILURES = new Set<string>([
  'places_error', // Google Places infra error — retry metadata, not video.
  'roundup_post', // "Top N" list post — video won't disambiguate one place.
]);

/** Which platforms currently have a wired, flag-enabled media resolver. */
export function isSupportedMediaPlatform(ctx: MediaFallbackContext): boolean {
  const platform = (ctx.platform ?? '').toLowerCase();
  if (platform === 'instagram') return ctx.instagramResolverEnabled;
  // TikTok / Facebook / YouTube media retrieval intentionally NOT implemented
  // in Phase 2.
  return false;
}

/**
 * Decide whether to enqueue a media-analysis task for a metadata result.
 *
 * The order matters: every "do not run" guard is checked before any positive
 * trigger, so the function is conservative by construction.
 */
export function shouldRunMediaFallback(
  input: MediaFallbackInput,
  ctx: MediaFallbackContext,
): MediaFallbackResult {
  // 0. Master + platform gates (all default OFF → Phase 1 unchanged).
  if (!ctx.mediaFallbackEnabled) {
    return { run: false, reason: 'media_fallback_disabled' };
  }
  if (!isSupportedMediaPlatform(ctx)) {
    return { run: false, reason: 'unsupported_platform' };
  }

  // 1. Never touch a terminal / cancelled parent job.
  if (ctx.jobStatus !== 'processing_metadata') {
    return { run: false, reason: 'job_not_processing' };
  }

  // 2. Idempotency — one media task per job.
  if (ctx.mediaTaskExists) {
    return { run: false, reason: 'media_task_exists' };
  }

  // 3. Metadata already produced a SAFE auto-save — the strongest possible
  //    outcome. Do not delay a completed save to analyze video.
  if (
    input.decision === 'auto_save' &&
    input.safeToAutoSave &&
    input.hasPrimaryCandidate
  ) {
    return { run: false, reason: 'metadata_auto_saved' };
  }

  // 4. Explicit multi-place intent already resolved — do NOT delay an obvious
  //    multi-place confirmation solely to analyze video.
  if (input.decision === 'multi_candidate_confirmation' && input.candidateCount > 1) {
    return { run: false, reason: 'multi_place_resolved' };
  }
  if (input.addressesCount >= 2) {
    return { run: false, reason: 'multi_address_evidence' };
  }

  // 5. Failure is unrelated to missing media evidence (infra error / roundup).
  if (input.failureReason && NON_MEDIA_FAILURES.has(input.failureReason)) {
    return { run: false, reason: 'unrelated_failure' };
  }

  // ---- Positive triggers (metadata evidence was insufficient) -------------

  // 6. Manual fallback — the classic "no explicit place evidence" case.
  if (input.decision === 'manual_fallback') {
    return { run: true, reason: 'manual_fallback' };
  }

  // 7. Resolver failed but a human could still search → the video might carry
  //    the spoken/visible place. (Infra/roundup already excluded above.)
  if (input.decision === 'failed') {
    return { run: true, reason: 'resolver_failed_media_recoverable' };
  }

  // 8. Single candidate confirmation / picker that is NOT address-verified —
  //    weak/incomplete evidence the video may strengthen.
  if (
    input.decision === 'candidate_confirmation' ||
    input.decision === 'candidate_picker'
  ) {
    const hasStrongAddress = input.evidenceUsed.some((k) =>
      STRONG_ADDRESS_EVIDENCE.has(k),
    );
    if (hasStrongAddress) {
      return { run: false, reason: 'candidate_address_verified' };
    }
    return { run: true, reason: 'weak_candidate_confirmation' };
  }

  // 9. Defensive: auto_save decision that failed the safety gate (should have
  //    become needs_help) — the video may confirm it safely.
  if (input.decision === 'auto_save' && !input.safeToAutoSave) {
    return { run: true, reason: 'auto_save_gate_blocked' };
  }

  // 10. Degenerate multi with <=1 candidate → treat like manual.
  if (input.decision === 'multi_candidate_confirmation') {
    return { run: true, reason: 'multi_degenerate_manual' };
  }

  return { run: false, reason: 'no_trigger' };
}

/**
 * Successful place resolution and source enrichment are independent. A
 * supported social post therefore gets one media task even when metadata has
 * already completed the user-facing save. The queue's unique share_job_id is
 * the final concurrency guard; this pure decision keeps scheduling explicit
 * and testable.
 */
export function shouldRunPostSaveEnrichment(
  ctx: MediaFallbackContext,
): MediaFallbackResult {
  if (!ctx.mediaFallbackEnabled) {
    return { run: false, reason: 'media_enrichment_disabled' };
  }
  if (!isSupportedMediaPlatform(ctx)) {
    return { run: false, reason: 'unsupported_platform' };
  }
  if (ctx.mediaTaskExists) {
    return { run: false, reason: 'media_task_exists' };
  }
  if (ctx.jobStatus !== 'completed') {
    return { run: false, reason: 'saved_job_not_completed' };
  }
  return { run: true, reason: 'post_save_enrichment' };
}
