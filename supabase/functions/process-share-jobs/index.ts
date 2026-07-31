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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { readEnv, validateEnv } from '../process-share-link/env.ts';
import { detectPlatform, legacySourceFor } from '../process-share-link/platform/detectPlatform.ts';
import { fetchPostMetadata } from '../process-share-link/metadata/fetchMetadata.ts';
import { extractHandles } from '../process-share-link/evidence/handleExtraction.ts';
import { extractEvidence } from '../process-share-link/evidence/extractEvidence.ts';
import { extractTaggedLocation } from '../process-share-link/evidence/taggedLocation.ts';
import { resolveSharedPlace } from '../process-share-link/resolver/resolveSharedPlace.ts';
import { saveForUser } from '../process-share-link/save.ts';
import { normalizeShareUrl } from '../../../lib/shareAgent/tiktokUrl.ts';

import { submitPushToUser, checkExpoReceipts, type TicketRef } from './push.ts';
import {
  planFromResolverDecision,
  buildCompletedNotification,
  buildNeedsHelpNotification,
} from './decisionMapping.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
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
        extraction_payload: { ...extractionPayload, savedPlaceName: candidate.name },
        progress_stage: 'completed',
        completed_at: nowIso(),
      },
      buildCompletedNotification({
        placeName: candidate.name,
        platform,
        jobId: job.id,
        savedPlaceId: saved.savedPlaceId,
      }),
    );
    return;
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

  // ---- Worker auth: bearer must equal the service-role key -------
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const headerAuth = req.headers.get('authorization') ?? '';
  const bearer = headerAuth.toLowerCase().startsWith('bearer ')
    ? headerAuth.slice(7).trim()
    : '';
  if (!serviceRoleKey || bearer !== serviceRoleKey) {
    return json({ error: 'unauthorized' }, 401);
  }

  const envRaw = readEnv();
  const envCheck = validateEnv(envRaw);
  if (!envCheck.ok) {
    return json({ error: envCheck.reason }, 500);
  }
  const env = envCheck.env;

  let body: { limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 25);

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

  return json({ claimed: jobs.length, processed });
});
