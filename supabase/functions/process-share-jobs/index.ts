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
import { fetchPostMetadata } from '../process-share-link/metadata/fetchMetadata.ts';
import { extractHandles } from '../process-share-link/evidence/handleExtraction.ts';
import { extractEvidence } from '../process-share-link/evidence/extractEvidence.ts';
import { extractTaggedLocation } from '../process-share-link/evidence/taggedLocation.ts';
import { resolveSharedPlace } from '../process-share-link/resolver/resolveSharedPlace.ts';
import { isRetryableNameDrivenProviderFailure } from '../process-share-link/resolver/nameDrivenResolver.ts';
import { saveForUser } from '../process-share-link/save.ts';
import { normalizeShareUrl } from '../../../lib/shareAgent/tiktokUrl.ts';
import { buildShareJobCandidatePayload } from '../../../lib/shareJobResult.ts';

import { submitPushToUser, checkExpoReceipts, type TicketRef } from './push.ts';
import {
  planFromResolverDecision,
  buildCompletedNotification,
  buildNeedsHelpNotification,
} from './decisionMapping.ts';
import { effectiveMediaFlags, mediaInfrastructureEnabled, shouldRunMediaFallback } from './mediaFallback.ts';
import {
  parseMediaEvidence,
  renderMediaEvidenceCaption,
  summarizeMediaEvidence,
  mediaEvidenceAutoSaveEligible,
} from './mediaEvidence.ts';
import { buildVenueMentions } from './mediaMentions.ts';
import { authorizeServiceRoleBearer, authorizeWorkerSecret, planPreResolve, planPostResolve } from './mediaFinalizePlan.ts';

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

function safeCandidate(c: any) {
  return {
    googlePlaceId: c.googlePlaceId,
    name: c.name,
    formattedAddress: c.formattedAddress ?? null,
    latitude: typeof c.latitude === 'number' ? c.latitude : null,
    longitude: typeof c.longitude === 'number' ? c.longitude : null,
    types: Array.isArray(c.types) ? c.types.slice(0, 8) : [],
    matchScore: typeof c.confidenceScore === 'number' ? c.confidenceScore : null,
  };
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

  const { data: updated } = await admin
    .from('share_jobs')
    .update(updatePatch)
    .eq('id', job.id)
    .eq('status', 'processing_metadata')
    .select('id')
    .maybeSingle();

  if (!updated) {
    console.log(`[share-job] finalize_skipped job_id=${job.id} already_terminal=true`);
    return;
  }
  console.log(`[share-job] status from=processing_metadata to=${patch.status} job_id=${job.id}`);
}

async function handleProcessingError(admin: any, job: any, err: unknown): Promise<void> {
  const message = truncate(err instanceof Error ? err.message : String(err));
  const attempts = typeof job.attempts === 'number' ? job.attempts : 1;
  const maxAttempts = typeof job.max_attempts === 'number' ? job.max_attempts : 5;

  if (attempts >= maxAttempts) {
    const { data: updated } = await admin
      .from('share_jobs')
      .update({
        status: 'failed',
        decision: 'failed',
        failure_reason: 'processing_error',
        last_error: message,
        completed_at: nowIso(),
      })
      .eq('id', job.id)
      .eq('status', 'processing_metadata')
      .select('id')
      .maybeSingle();
    if (updated) {
      console.log(
        `[share-job] status from=processing_metadata to=failed job_id=${job.id} attempts=${attempts}`,
      );
    }
    // No push for hard failures (nothing actionable for the user).
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
  canaryUserId: string | null;
} {
  const on = (k: string) => (Deno.env.get(k) ?? '').trim().toLowerCase() === 'true';
  return {
    mediaFallbackEnabled: on('MEDIA_FALLBACK_ENABLED'),
    instagramResolverEnabled: on('INSTAGRAM_MEDIA_RESOLVER_ENABLED'),
    canaryUserId: (Deno.env.get('PHASE2_CANARY_USER_ID') ?? '').trim() || null,
  };
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
): Promise<void> {
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
  await admin
    .from('share_jobs')
    .update({ progress_stage: 'checking_video', locked_until: null })
    .eq('id', job.id)
    .eq('status', 'processing_metadata');
}

async function markMediaTask(
  admin: any,
  taskId: string,
  status: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin.from('share_media_tasks').update({ status, ...patch }).eq('id', taskId);
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
): Promise<void> {
  try {
    const d = body?.diagnostics && typeof body.diagnostics === 'object' ? body.diagnostics : {};
    const int = (v: unknown) => (Number.isFinite(v) ? Number(v) : null);
    await admin.from('share_media_runs').insert({
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
      evidence: boundedJson(evidenceSummary),
      model_output: boundedJson(d.modelOutput ?? null),
      warnings: Array.isArray(d.warnings) ? d.warnings.slice(0, 24) : [],
      errors: Array.isArray(d.errors) ? d.errors.slice(0, 24) : [],
    });
  } catch (err) {
    console.log(`[media-task] diagnostics_insert_failed task_id=${task.id} msg=${truncate((err as Error)?.message)}`);
  }
}

// Move a parent job to a safe needs_help(manual) state (media analysis produced
// no usable evidence). Reuses the Phase 1 terminal-transition + push machinery.
async function finalizeParentManual(admin: any, job: any): Promise<void> {
  await finalize(
    admin,
    job,
    {
      status: 'needs_help',
      decision: 'manual_fallback',
      needs_help_reason: 'manual_search',
      suggested_query: null,
      progress_stage: 'manual',
    },
    buildNeedsHelpNotification({ mode: 'manual', jobId: job.id }),
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
      await finalizeParentManual(admin, job);
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
// Idempotency (mission): a terminal task (duplicate / replayed callback) and any
// parent that already left processing_metadata (cancelled elsewhere, finalized
// by a prior callback or the recovery sweep) are safe no-ops — a replay after a
// save or a needs_help can never revive or double-finalize the job. The parent
// is ALWAYS derived from the task's FK, never trusted from the callback body.
async function finalizeMediaTask(admin: any, env: any, body: any): Promise<Response> {
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  if (!taskId) return json({ error: 'missing_task_id' }, 400);

  const { data: task } = await admin
    .from('share_media_tasks').select('*').eq('id', taskId).maybeSingle();
  if (!task) return json({ error: 'task_not_found' }, 404);

  // Parent derived from the task's FK (never from the body).
  const { data: job } = task.share_job_id
    ? await admin.from('share_jobs').select('*').eq('id', task.share_job_id).maybeSingle()
    : { data: null };

  const outcome = typeof body.outcome === 'string' ? body.outcome : 'evidence';
  const parsed = outcome === 'evidence'
    ? parseMediaEvidence(body.evidence)
    : ({ ok: false, error: outcome } as const);
  const rendered = parsed.ok
    ? renderMediaEvidenceCaption(parsed.value)
    : { title: '', description: '', renderedPlaces: 0 };

  const pre = planPreResolve({
    taskStatus: task.status,
    parentStatus: job?.status ?? 'missing',
    outcome,
    evidenceParseOk: parsed.ok,
    renderedPlaces: rendered.renderedPlaces,
  });

  // Terminal task → idempotent no-op (duplicate / replayed callback).
  if (pre.action === 'idempotent_task_terminal') {
    return json({ ok: true, idempotent: true, taskStatus: pre.taskStatus });
  }

  if (!job) {
    await markMediaTask(admin, taskId, 'failed', { failure_code: 'parent_job_missing', completed_at: nowIso() });
    return json({ error: 'parent_job_missing' }, 404);
  }

  // Diagnostics for every actionable callback.
  const evidenceSummary = parsed.ok ? summarizeMediaEvidence(parsed.value) : { reason: outcome };
  await insertMediaRun(admin, task, job, body, evidenceSummary);

  // Parent already terminal → mark task done, never revive the parent.
  if (pre.action === 'parent_already_terminal') {
    await markMediaTask(admin, taskId, 'completed', { progress_stage: 'cleanup', completed_at: nowIso() });
    return json({ ok: true, parentAlreadyTerminal: true, jobStatus: job.status });
  }

  // Media unusable / parse failure / no explicit places → safe manual fallback.
  if (pre.action === 'manual_fallback') {
    await finalizeParentManual(admin, job);
    await markMediaTask(admin, taskId, pre.taskTerminalStatus, {
      failure_code: pre.failureCode,
      progress_stage: 'cleanup',
      completed_at: nowIso(),
    });
    console.log(`[media-task] finalize route=manual task_id=${taskId} reason=${pre.failureCode}`);
    return json({ ok: true, route: 'manual', reason: pre.failureCode });
  }

  // pre.action === 'resolve' — reuse the EXISTING deterministic resolver.
  const emptyHandles = { posterHandle: null, taggedHandles: [], venueHandles: [], posterNameHint: null };
  const mediaEvidence = extractEvidence({
    platform: task.platform,
    title: rendered.title,
    description: rendered.description,
    handles: emptyHandles,
    taggedLocation: null,
  });
  // Structured explicit venue-name mentions enable the name-driven multi-place
  // path (e.g. a "top 5 pizza" reel with names but no street addresses).
  const mediaMentions = parsed.ok
    ? buildVenueMentions(parsed.value)
    : { mentions: [], geoContext: { city: null, region: null, country: null }, relationships: [] };
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
  const nameDrivenResult = {
    mentionResults,
    aggregateCandidates: result.candidates ?? [],
    providerErrorCount: mentionResults.filter((mention: any) => mention?.outcome === 'provider_error').length,
  } as any;
  if (isRetryableNameDrivenProviderFailure(nameDrivenResult)) {
    const retryAfter = Math.min(
      900,
      Math.max(
        30,
        ...mentionResults.map((mention: any) => Number(mention?.providerRetryAfterSeconds) || 0),
      ),
    );
    console.warn(`[media-task] places provider unavailable task_id=${taskId}`);
    return json(
      { error: 'places_provider_unavailable', retryable: true },
      503,
      { 'Retry-After': String(retryAfter) },
    );
  }
  const extractionPayload = {
    platform: task.platform,
    via: 'media',
    confidence: result.confidence,
    cleanSearchQuery: result.cleanSearchQuery ?? null,
    evidenceUsed: result.evidenceUsed,
    warnings: result.warnings,
  };
  const plan = planFromResolverDecision({
    decision: result.decision,
    safeToAutoSave: result.safeToAutoSave,
    hasPrimaryCandidate: !!result.primaryCandidate,
    candidateCount: result.candidates.length,
    cleanSearchQuery: result.cleanSearchQuery,
    failureReason: result.failureReason,
  });
  const canonicalUrl = task.canonical_url || task.source_url;

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
    });
    await finalize(
      admin,
      job,
      {
        status: 'completed',
        decision: 'auto_save',
        saved_place_id: saved.savedPlaceId,
        canonical_url: canonicalUrl,
        source_platform: task.platform,
        extraction_payload: { ...extractionPayload, savedPlaceName: candidate.name },
        progress_stage: 'completed',
        completed_at: nowIso(),
      },
      buildCompletedNotification({
        placeName: candidate.name,
        platform: task.platform,
        jobId: job.id,
        savedPlaceId: saved.savedPlaceId,
      }),
    );
    await markMediaTask(admin, taskId, 'completed', { resolver_name: 'media', progress_stage: 'cleanup', completed_at: nowIso() });
    console.log(`[media-task] finalize route=auto_save task_id=${taskId} job_id=${job.id}`);
    return json({ ok: true, route: 'auto_save' });
  }

  // needs_help (single / multi / manual). `post.mode` accounts for a downgrade
  // from a resolver auto_save that failed the media evidence eligibility gate.
  const mode = post.mode;
  const mentionResults = Array.isArray(result.diagnostics?.mentionResults)
    ? result.diagnostics.mentionResults
    : [];
  const candidatePayload = buildShareJobCandidatePayload(
    result.candidates.slice(0, 10).map(safeCandidate),
    mentionResults.map((mention: any) => ({
      mentionId: mention.mentionId,
      displayName: mention.displayName,
      primaryVenueName: mention.primaryVenueName ?? null,
      hostVenueName: mention.hostVenueName ?? null,
      relationshipType: mention.relationshipType ?? null,
      outcome: mention.outcome,
      candidates: Array.isArray(mention.candidates) ? mention.candidates.map(safeCandidate) : [],
    })),
  );
  const decisionForRow =
    mode === 'manual'
      ? 'manual_fallback'
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
  const suggestedQuery = plan.route === 'needs_help' ? plan.suggestedQuery : (result.cleanSearchQuery ?? null);
  const note =
    mode === 'manual'
      ? buildNeedsHelpNotification({ mode: 'manual', jobId: job.id })
      : mode === 'multi'
      ? buildNeedsHelpNotification({ mode: 'multi', jobId: job.id, candidateCount: result.candidates.length })
      : buildNeedsHelpNotification({
          mode: 'single',
          jobId: job.id,
          candidateName: result.candidates[0]?.name ?? result.primaryCandidate?.name ?? null,
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

async function processOne(admin: any, env: any, job: any): Promise<void> {
  const rawUrl = job.canonical_url || job.source_url;
  const normalized = normalizeShareUrl(rawUrl);
  const requestUrl = normalized.url || rawUrl;
  const platform = detectPlatform(requestUrl);

  const meta = await fetchPostMetadata(requestUrl, platform);
  if (!meta.ok) {
    // Post metadata unavailable — the user can still search by hand.
    await finalize(
      admin,
      job,
      {
        status: 'needs_help',
        decision: 'manual_fallback',
        needs_help_reason: 'metadata_unavailable',
        suggested_query: null,
        candidate_payload: { candidates: [] },
        canonical_url: requestUrl,
        source_platform: platform,
        extraction_payload: { platform, reason: 'metadata_failed' },
        progress_stage: 'manual',
      },
      buildNeedsHelpNotification({ mode: 'manual', jobId: job.id }),
    );
    return;
  }

  const { title, description, html } = meta.metadata;
  const canonicalUrl = meta.resolvedUrl || requestUrl;
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

  const extractionPayload = {
    platform,
    confidence: result.confidence,
    cleanSearchQuery: result.cleanSearchQuery ?? null,
    evidenceUsed: result.evidenceUsed,
    warnings: result.warnings,
  };

  const plan = planFromResolverDecision({
    decision: result.decision,
    safeToAutoSave: result.safeToAutoSave,
    hasPrimaryCandidate: !!result.primaryCandidate,
    candidateCount: result.candidates.length,
    cleanSearchQuery: result.cleanSearchQuery,
    failureReason: result.failureReason,
  });

  if (plan.route === 'auto_save') {
    const candidate = result.primaryCandidate;
    const source = legacySourceFor(platform);
    const saved = await saveForUser({
      client: admin,
      userId: job.user_id,
      candidate,
      sourceUrl: canonicalUrl,
      source,
    });
    await finalize(
      admin,
      job,
      {
        status: 'completed',
        decision: 'auto_save',
        saved_place_id: saved.savedPlaceId,
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
      buildCompletedNotification({
        placeName: candidate.name,
        platform,
        jobId: job.id,
        savedPlaceId: saved.savedPlaceId,
        googlePlaceId: candidate.googlePlaceId,
        alreadySaved: saved.reused,
      }),
    );
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
        decision: result.decision,
        safeToAutoSave: result.safeToAutoSave,
        hasPrimaryCandidate: !!result.primaryCandidate,
        candidateCount: result.candidates.length,
        evidenceUsed: result.evidenceUsed,
        warnings: result.warnings,
        addressesCount: evidence.addresses.length,
        failureReason: result.failureReason ?? null,
      },
      {
        platform,
        mediaFallbackEnabled: mediaFlags.mediaFallbackEnabled,
        instagramResolverEnabled: mediaFlags.instagramResolverEnabled,
        mediaTaskExists,
        jobStatus: 'processing_metadata',
      },
    );
    if (trigger.run) {
      await enqueueMediaTask(admin, job, platform, canonicalUrl, requestUrl);
      console.log(`[share-job] media_fallback_enqueued job_id=${job.id} reason=${trigger.reason}`);
      return;
    }
    console.log(`[share-job] media_fallback_skipped job_id=${job.id} reason=${trigger.reason}`);
  }

  // needs_help (single / multi / manual)
  const candidatePayload = { candidates: result.candidates.slice(0, 10).map(safeCandidate) };
  const decisionForRow =
    plan.mode === 'manual'
      ? 'manual_fallback'
      : result.decision === 'multi_candidate_confirmation'
      ? 'multi_candidate_confirmation'
      : result.decision === 'candidate_picker'
      ? 'candidate_picker'
      : 'candidate_confirmation';

  const note =
    plan.mode === 'manual'
      ? buildNeedsHelpNotification({ mode: 'manual', jobId: job.id })
      : plan.mode === 'multi'
      ? buildNeedsHelpNotification({
          mode: 'multi',
          jobId: job.id,
          candidateCount: result.candidates.length,
        })
      : buildNeedsHelpNotification({
          mode: 'single',
          jobId: job.id,
          candidateName: result.candidates[0]?.name ?? result.primaryCandidate?.name ?? null,
        });

  await finalize(
    admin,
    job,
    {
      status: 'needs_help',
      decision: decisionForRow,
      needs_help_reason: plan.needsHelpReason,
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
  // key). Fallback: the service-role key as a bearer, kept ONLY for manual /
  // admin invocation. Both are constant-time compared and fail closed. This
  // endpoint is deployed with verify_jwt disabled (a private scheduler URL),
  // so this dedicated-secret check is the sole gate and runs before any work.
  const workerSecret = Deno.env.get('SHARE_JOBS_WORKER_SECRET') ?? '';
  const presentedWorkerSecret = req.headers.get('x-nearr-worker-secret') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const headerAuth = req.headers.get('authorization') ?? '';
  const authorized =
    authorizeWorkerSecret(presentedWorkerSecret, workerSecret) ||
    authorizeServiceRoleBearer(headerAuth, serviceRoleKey);
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
    try {
      return await finalizeMediaTask(admin, env, body);
    } catch (err) {
      console.log(`[media-task] finalize_error msg=${truncate((err as Error)?.message)}`);
      return json({ error: 'media_finalize_failed' }, 500);
    }
  }

  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 25);

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

  return json({ claimed: jobs.length, processed });
});
