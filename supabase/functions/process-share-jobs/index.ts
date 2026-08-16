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
import { isNearrCategory, resolvePlaceCategory } from '../../../lib/placeCategory.ts';
import { generateAiPlaceNote, persistAiNoteSupplementally } from '../../../lib/aiPlaceNote.ts';

import { submitPushToUser, checkExpoReceipts, type TicketRef } from './push.ts';
import {
  classifyResolverFailure,
  formatResolverRetryLog,
  planResolverRetry,
} from './providerRetry.ts';
import {
  planFromResolverDecision,
  buildCompletedNotification,
  buildMediaResultNotification,
  buildNeedsHelpNotification,
} from './decisionMapping.ts';
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
} from './mediaEvidence.ts';
import {
  parseMediaSourceMetadata,
  mergeMediaCaption,
  summarizeSourceMetadata,
} from './mediaSourceMetadata.ts';
import { buildVenueMentions, normalizeVenueName } from './mediaMentions.ts';
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
import {
  buildCandidateReviewSnapshot,
  decisionForPlausibleCandidates,
  mediaFailureReview,
  persistedCandidateCount,
} from './ambiguityReview.ts';

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
    matchScore: typeof c.confidenceScore === 'number' ? c.confidenceScore : null,
    evidence: Array.isArray(c.evidence) ? c.evidence.filter((value: unknown) => typeof value === 'string').slice(0, 12) : [],
    reasons: Array.isArray(c.reasons) ? c.reasons.filter((value: unknown) => typeof value === 'string').slice(0, 12) : [],
    aiNote,
  };
}

function noteForLogicalMention(parsed: any, mention: any): string | null {
  if (!parsed?.ok || !mention) return null;
  const logicalName = mention.primaryVenueName ?? mention.displayName ?? '';
  const normalizedName = mention.normalizedName ?? normalizeVenueName(logicalName);
  const scopedPlaces = parsed.value.places.filter(
    (place: any) => normalizeVenueName(place.name ?? '') === normalizedName,
  );
  for (const place of scopedPlaces) {
    const note = generateAiPlaceNote({
      placeName: logicalName,
      proposedNote: place.memoryCue,
      evidence: place.memoryCueEvidence ?? [],
    });
    if (note) return note;
  }
  return null;
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
      evidence: boundedJson(evidenceSummary),
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
  },
): Promise<Response> {
  const { job, task, taskId, mediaRunId, result, mentionResults, aiNoteByMentionId, parsed } = args;
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
async function finalizeParentManual(admin: any, job: any): Promise<void> {
  const candidateCount = persistedCandidateCount(job?.candidate_payload);
  const fallback = mediaFailureReview(job?.candidate_payload);
  const mode = fallback.mode === 'auto' ? 'single' : fallback.mode;
  await finalize(
    admin,
    job,
    {
      status: 'needs_help',
      decision: fallback.decision,
      needs_help_reason: candidateCount > 0 ? 'media_unavailable_candidates_preserved' : 'manual_search',
      ...(candidateCount === 0 ? { suggested_query: null } : {}),
      progress_stage: mode,
    },
    buildNeedsHelpNotification({
      mode,
      jobId: job.id,
      candidateCount,
      candidateName: candidateCount === 1 ? job?.candidate_payload?.candidates?.[0]?.name ?? null : null,
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
    parentSavedPlaceId: job?.saved_place_id ?? null,
    outcome,
    evidenceParseOk: parsed.ok,
    renderedPlaces: rendered.renderedPlaces,
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

  // Diagnostics for every actionable callback.
  const evidenceSummary = parsed.ok ? summarizeMediaEvidence(parsed.value) : { reason: outcome };
  const mediaRunId = await insertMediaRun(admin, task, job, body, evidenceSummary);

  // Parent already terminal → mark task done, never revive the parent.
  if (pre.action === 'parent_already_terminal') {
    await markMediaTask(admin, taskId, 'completed', { progress_stage: 'cleanup', completed_at: nowIso() });
    logFinalStatus('parent_already_terminal');
    return json({ ok: true, parentAlreadyTerminal: true, jobStatus: job.status });
  }

  // Media unusable / parse failure / no explicit places → safe manual fallback.
  if (pre.action === 'manual_fallback') {
    if (!pre.supplemental) await finalizeParentManual(admin, job);
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
  const sourceMetadata = parseMediaSourceMetadata(body.sourceMetadata);
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
  const aiNoteByMentionId = new Map(
    mediaMentions.mentions.map((mention: any) => [
      mention.id,
      noteForLogicalMention(parsed, mention),
    ]),
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

    if (pre.mode !== 'enrich_saved_place') await finalizeParentManual(admin, job);
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
  const canonicalUrl = task.canonical_url || task.source_url;

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
        mentionId: mention.mentionId,
        displayName: mention.displayName,
        contextLabel: (() => {
          const sourceMention = mentionById.get(mention.mentionId);
          return [sourceMention?.geo?.city, sourceMention?.geo?.region].filter(Boolean).join(', ') || null;
        })(),
        primaryVenueName: mention.primaryVenueName ?? null,
        hostVenueName: mention.hostVenueName ?? null,
        relationshipType: mention.relationshipType ?? null,
        outcome: mention.outcome,
        aiNote: aiNoteByMentionId.get(mention.mentionId) ?? null,
        saveState: savedResultByMentionId.get(mention.mentionId)?.saveState ?? 'pending',
        savedPlaceId: savedResultByMentionId.get(mention.mentionId)?.savedPlaceId ?? null,
        candidates: Array.isArray(mention.candidates)
          ? mention.candidates.map((candidate: any) =>
              safeCandidate(candidate, aiNoteByMentionId.get(mention.mentionId) ?? null))
          : [],
      })),
    );
    candidatePayload.savedPlaceIds = allSavedPlaceIds;
    const mediaResultSummary = {
      createdCount: createdSavedPlaceIds.length,
      alreadySavedCount: alreadySavedPlaceIds.length,
      reviewCount: unresolvedResults.length,
      savedPlaceIds: allSavedPlaceIds,
      results: perPlaceSummary,
    };
    const notification = buildMediaResultNotification({
      jobId: job.id,
      createdSavedPlaceIds,
      alreadySavedPlaceIds,
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
          extraction_payload: { platform: task.platform, via: 'media', mediaResultSummary },
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
        suggested_query: unresolvedResults.map((mention: any) => mention.displayName).filter(Boolean).join(' | ') || null,
        candidate_payload: candidatePayload,
        canonical_url: canonicalUrl,
        source_platform: task.platform,
        extraction_payload: { platform: task.platform, via: 'media', mediaResultSummary },
        progress_stage: unresolvedWithCandidates > 0 ? 'multi' : 'manual',
      },
      notification,
    );
    await markMediaTask(admin, taskId, 'completed', { resolver_name: 'media', progress_stage: 'cleanup', completed_at: nowIso() });
    return json({ ok: true, route: 'needs_help', mode: 'mixed', ...mediaResultSummary });
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
  const candidatePayload = buildShareJobCandidatePayload(
    result.candidates.slice(0, 10).map((candidate: any) => safeCandidate(
      candidate,
      noteForAggregateCandidate(candidate.googlePlaceId, mentionResults, aiNoteByMentionId),
    )),
    mentionResults.map((mention: any) => ({
      mentionId: mention.mentionId,
      displayName: mention.displayName,
      contextLabel: (() => {
        const sourceMention = mediaMentions.mentions.find((item: any) => item.id === mention.mentionId);
        return [sourceMention?.geo?.city, sourceMention?.geo?.region].filter(Boolean).join(', ') || null;
      })(),
      primaryVenueName: mention.primaryVenueName ?? null,
      hostVenueName: mention.hostVenueName ?? null,
      relationshipType: mention.relationshipType ?? null,
      outcome: mention.outcome,
      aiNote: aiNoteByMentionId.get(mention.mentionId) ?? null,
      candidates: Array.isArray(mention.candidates)
        ? mention.candidates.map((candidate: any) =>
            safeCandidate(candidate, aiNoteByMentionId.get(mention.mentionId) ?? null))
        : [],
    })),
  );
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
  const suggestedQuery = plan.route === 'needs_help' ? plan.suggestedQuery : (result.cleanSearchQuery ?? null);
  const note =
    mode === 'manual'
      ? buildNeedsHelpNotification({ mode: 'manual', jobId: job.id })
      : mode === 'picker'
      ? buildNeedsHelpNotification({ mode: 'picker', jobId: job.id, candidateCount: result.candidates.length })
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
    // Metadata unavailable is NOT the same as "this place cannot be
    // identified". It is the case where the video is the only evidence left,
    // so try durable media fallback BEFORE giving up. Without this the job
    // finalized to needs_help in ~1s, pushed "We couldn't quite find this
    // one", and never inserted a share_media_tasks row.
    const metaFailFlags = effectiveMediaFlags(readMediaFlags(), job.user_id);
    if (metaFailFlags.mediaFallbackEnabled) {
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
            extraction_payload: { platform, reason: 'metadata_failed' },
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

  // Enforce the user-facing single-option invariant before routing. Media
  // enrichment is scheduled separately after a successful save.
  const metadataAutoSave = evaluateMetadataAutoSave({ result, evidence });
  console.log(formatMetadataAutoSaveDecisionLog({ jobId: job.id, decision: metadataAutoSave }));

  const plausibleProviderIds = new Set(metadataAutoSave.plausibleProviderIds);
  const plausibleCandidates = result.candidates.filter((candidate: any) =>
    plausibleProviderIds.has(candidate.googlePlaceId)
  );
  const hasConcreteBlocker = metadataAutoSave.explicitConflictFlags.length > 0;
  const countDecision = decisionForPlausibleCandidates(plausibleCandidates.length, hasConcreteBlocker);
  const effectiveDecision = countDecision.decision;
  const metadataResult = {
    ...result,
    decision: effectiveDecision,
    candidates: plausibleCandidates,
    primaryCandidate: plausibleCandidates[0],
    safeToAutoSave: effectiveDecision === 'auto_save',
  };

  const extractionPayload = {
    platform,
    confidence: result.confidence,
    cleanSearchQuery: result.cleanSearchQuery ?? null,
    evidenceUsed: result.evidenceUsed,
    warnings: result.warnings,
    autoSaveDecision: metadataAutoSave,
    rawResolverCandidates: result.candidates.slice(0, 10).map(safeCandidate),
    plausibleCandidates: plausibleCandidates.slice(0, 10).map(safeCandidate),
  };

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
  const candidatePayload = buildCandidateReviewSnapshot(metadataResult.candidates.map(safeCandidate));
  const metadataReviewReason =
    metadataAutoSave.plausibleCandidateCount === 1 && metadataAutoSave.explicitConflictFlags.length > 0
      ? `metadata_${metadataAutoSave.explicitConflictFlags[0]}`
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

  const note =
    plan.mode === 'manual'
      ? buildNeedsHelpNotification({ mode: 'manual', jobId: job.id })
      : plan.mode === 'picker'
      ? buildNeedsHelpNotification({
          mode: 'picker',
          jobId: job.id,
          candidateCount: metadataResult.candidates.length,
        })
      : plan.mode === 'multi'
      ? buildNeedsHelpNotification({
          mode: 'multi',
          jobId: job.id,
          candidateCount: metadataResult.candidates.length,
        })
      : buildNeedsHelpNotification({
          mode: 'single',
          jobId: job.id,
          candidateName: metadataResult.candidates[0]?.name ?? metadataResult.primaryCandidate?.name ?? null,
        });

  await finalize(
    admin,
    job,
    {
      status: 'needs_help',
      decision: decisionForRow,
      needs_help_reason: metadataReviewReason,
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
