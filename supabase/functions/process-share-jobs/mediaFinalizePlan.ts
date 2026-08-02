// supabase/functions/process-share-jobs/mediaFinalizePlan.ts
//
// PURE finalization decision logic for the media-worker callback. No Deno
// globals, no I/O — unit-tested from Node (scripts/testMediaFinalizePlan.ts).
//
// The Deno finalizer (index.ts) performs the DB reads/writes and the resolver
// call; ALL routing decisions live here so they can be tested directly against
// the cases the mission enumerates (terminal task, already-terminal parent,
// malformed evidence, insufficient evidence, safe auto-save, confirmation,
// manual fallback, retryable/permanent failure). Idempotency is guaranteed by
// treating any terminal task and any non-`processing_metadata` parent as a
// no-op — so duplicate callbacks and replays after save/needs_help cannot
// revive or double-finalize a job.

export type FinalizeOutcome = 'evidence' | 'unavailable' | 'failed';

// ---------------------------------------------------------------------------
// Request authorization. The media-worker calls the finalize endpoint with the
// Supabase SERVICE-ROLE key as a bearer token (the worker holds it for its own
// DB access); the worker's inbound-invocation secret is a SEPARATE credential
// and is NOT accepted here. Kept pure + exact-match so it can be unit-tested
// from Node and shared verbatim with the Deno request handler — a regression
// that weakened it (prefix match, empty-key accept, case slip) fails the test.
// ---------------------------------------------------------------------------

export function extractBearerToken(authorizationHeader: string | null | undefined): string {
  const header = authorizationHeader ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

export function authorizeServiceRoleBearer(
  authorizationHeader: string | null | undefined,
  serviceRoleKey: string | null | undefined,
): boolean {
  // An empty/absent expected key can never authorize (fail closed).
  if (!serviceRoleKey) return false;
  const bearer = extractBearerToken(authorizationHeader);
  if (!bearer) return false;
  return bearer === serviceRoleKey;
}

// ---------------------------------------------------------------------------
// Dedicated scheduler-secret authorization. The private per-minute worker
// endpoint is authenticated by a high-entropy shared secret that is
// INDEPENDENT of the Supabase service-role key — so a service-role key
// rotation can never silently break the scheduler again (the exact failure
// this replaces). The secret travels in the `x-nearr-worker-secret` header
// (never Authorization, so there is no gateway-JWT coupling) and is compared
// in constant time. Fail-closed: an unset expected secret or an empty
// presented value never authorizes. Pure + Node-testable.
// ---------------------------------------------------------------------------

export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Accumulate all differences without short-circuiting. The length XOR makes
  // a length mismatch always fail; the loop runs over the longer string so the
  // comparison time does not reveal the position of the first difference.
  const len = a.length > b.length ? a.length : b.length;
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

export function authorizeWorkerSecret(
  presentedSecret: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  if (!expectedSecret) return false; // fail closed: no configured secret
  if (!presentedSecret) return false;
  return constantTimeEqual(presentedSecret, expectedSecret);
}

const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'needs_help',
  'failed',
  'cancelled',
]);

export function isTerminalTaskStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Pre-resolve routing: decide what to do BEFORE running the deterministic
// resolver (which needs Google Places I/O).
// ---------------------------------------------------------------------------

export type PreResolveInput = {
  /** Current media task status (as loaded from the DB). */
  taskStatus: string;
  /** Current parent share_job status (loaded via the task's FK, never trusted
   *  from the callback body). */
  parentStatus: string;
  /** Worker-reported outcome. */
  outcome: FinalizeOutcome;
  /** Whether the evidence payload parsed into the schema. */
  evidenceParseOk: boolean;
  /** How many explicit-evidence places rendered (0 → nothing verifiable). */
  renderedPlaces: number;
};

export type PreResolvePlan =
  | { action: 'idempotent_task_terminal'; taskStatus: string }
  | { action: 'parent_already_terminal' }
  | {
      action: 'manual_fallback';
      failureCode: string;
      taskTerminalStatus: 'needs_help' | 'failed';
    }
  | { action: 'resolve' };

export function planPreResolve(input: PreResolveInput): PreResolvePlan {
  // A terminal task (incl. a duplicate/replayed callback) is a safe no-op.
  if (isTerminalTaskStatus(input.taskStatus)) {
    return { action: 'idempotent_task_terminal', taskStatus: input.taskStatus };
  }

  // The parent already left processing (cancelled elsewhere, or finalized by a
  // prior callback / the recovery sweep). Never revive it.
  if (input.parentStatus !== 'processing_metadata') {
    return { action: 'parent_already_terminal' };
  }

  // Media could not be analyzed.
  if (input.outcome === 'unavailable') {
    return { action: 'manual_fallback', failureCode: 'media_unavailable', taskTerminalStatus: 'needs_help' };
  }
  if (input.outcome === 'failed') {
    return { action: 'manual_fallback', failureCode: 'media_failed', taskTerminalStatus: 'failed' };
  }

  // outcome === 'evidence'
  if (!input.evidenceParseOk) {
    return { action: 'manual_fallback', failureCode: 'evidence_parse_failed', taskTerminalStatus: 'needs_help' };
  }
  if (input.renderedPlaces === 0) {
    return { action: 'manual_fallback', failureCode: 'insufficient_evidence', taskTerminalStatus: 'needs_help' };
  }

  return { action: 'resolve' };
}

// ---------------------------------------------------------------------------
// Post-resolve routing: map the deterministic resolver's decision + the media
// auto-save eligibility gate to the final parent outcome.
// ---------------------------------------------------------------------------

export type PostResolveInput = {
  /** The resolver decision mapped by planFromResolverDecision. */
  route: 'auto_save' | 'needs_help';
  /** needs_help sub-mode (only meaningful when route === 'needs_help'). */
  needsHelpMode: 'single' | 'multi' | 'manual';
  /** Whether the MEDIA evidence itself is strong enough for a silent save
   *  (mediaEvidenceAutoSaveEligible). This never LOOSENS safeToAutoSave — it can
   *  only downgrade a resolver auto_save to a confirmation. */
  autoSaveEligible: boolean;
};

export type PostResolvePlan =
  | { action: 'auto_save' }
  | { action: 'needs_help'; mode: 'single' | 'multi' | 'manual'; downgraded: boolean };

export function planPostResolve(input: PostResolveInput): PostResolvePlan {
  if (input.route === 'auto_save') {
    if (input.autoSaveEligible) return { action: 'auto_save' };
    // The resolver would silent-save, but the media evidence is not strong
    // enough (no explicit high-confidence street address) → require the user
    // to confirm. This is stricter than the metadata path, never looser.
    return { action: 'needs_help', mode: 'single', downgraded: true };
  }
  return { action: 'needs_help', mode: input.needsHelpMode, downgraded: false };
}
