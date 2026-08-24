import assert from 'node:assert/strict';

import { createClient } from '@supabase/supabase-js';

import { canonicalContentIdentity } from '../lib/shareAgent/contentIdentity';
import { placeSourceCards, shouldShowMoreVideos } from '../lib/placeSources';
import type { SavedPlaceWithPlace } from '../types';
import { submitShareJob } from './e2e/fixtures/shared';
import { pollUntil } from './e2e/poll';
import { openSession } from './e2e/session';

type Row = Record<string, any>;

const TERMINAL = new Set(['completed', 'needs_help', 'failed', 'cancelled']);
const TARGET_REF = 'qnfxnmvxpjzfydgudtvs';
const FIXTURES = {
  cache: {
    canonical: 'https://www.instagram.com/p/DYpcd2ZBTsZ/',
    variant: 'https://instagram.com/p/DYpcd2ZBTsZ/?igsh=cache-proof&utm_source=share',
    googlePlaceId: 'ChIJE5pV1UMh3YARIhsItpUt0K8',
  },
  sources: {
    first: 'https://www.instagram.com/p/DWUI9fvDCck/',
    second: 'https://www.instagram.com/p/DVUMt3DkmnK/',
    googlePlaceId: 'ChIJnRX-2FJrjoARoeQkm8tJ08E',
  },
  singleFlight: 'https://www.instagram.com/p/DVUMt3DkmnK/',
} as const;

function identity(url: string) {
  const result = canonicalContentIdentity(url);
  assert.ok(result, `fixture must have a canonical identity: ${url}`);
  return result;
}

function rowArray(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

async function readJob(admin: any, jobId: string): Promise<Row | null> {
  const { data, error } = await admin
    .from('share_jobs')
    .select('id,status,decision,saved_place_id,candidate_payload,extraction_payload,recognition_identity_key,source_platform,created_at,updated_at,last_error')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

async function submitAndWait(session: Awaited<ReturnType<typeof openSession>>, fixture: string, url: string) {
  const startedAt = Date.now();
  const submitted = await submitShareJob(session, fixture, url);
  if (!submitted.ok) throw new Error(`${fixture}: ${submitted.detail}`);
  const result = await pollUntil<Row>(
    () => readJob(session.admin, submitted.jobId),
    (row) => TERMINAL.has(String(row.status)),
    { timeoutMs: 600_000, intervalMs: 2_000 },
  );
  if (!result.ok) {
    throw new Error(`${fixture}: job ${submitted.jobId} did not terminate; last=${JSON.stringify(result.last)}`);
  }
  return { job: result.value, latencyMs: Date.now() - startedAt };
}

async function confirmReviewedSource(
  session: Awaited<ReturnType<typeof openSession>>,
  job: Row,
  savedPlaceId: string,
  sourceUrl: string,
  expectedGooglePlaceId: string,
): Promise<Row> {
  assert.equal(job.status, 'needs_help', 'only a review result may use the confirmation path');
  const candidate = rowArray(job.candidate_payload?.candidates)
    .find((item) => item.googlePlaceId === expectedGooglePlaceId);
  assert.ok(candidate, 'review candidates must contain the expected canonical place');
  const sourceIdentity = identity(sourceUrl);
  const authed = createClient(session.config.supabaseUrl, session.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.identity!.accessToken}` } },
  });
  const sourceMetadata = job.extraction_payload?.sourceMetadata ?? {};
  const { error: attachError } = await authed.rpc('attach_saved_place_source', {
    p_user_id: session.identity!.userId,
    p_saved_place_id: savedPlaceId,
    p_identity_key: sourceIdentity.key,
    p_identity_version: sourceIdentity.identityVersion,
    p_platform: sourceIdentity.platform,
    p_content_id: sourceIdentity.contentId,
    p_canonical_url: sourceIdentity.canonicalUrl,
    p_original_url: sourceUrl,
    p_creator_handle: sourceMetadata.creatorHandle ?? null,
    p_creator_name: sourceMetadata.creatorName ?? null,
    p_caption_excerpt: sourceMetadata.description ?? null,
    p_ai_note: candidate.aiNote ?? null,
    p_thumbnail_url: sourceMetadata.thumbnailUrl ?? null,
  });
  if (attachError) throw new Error(`review source attach: ${JSON.stringify(attachError)}`);
  const { data: resolved, error: resolveError } = await authed.rpc('resolve_share_job', {
    p_job_id: job.id,
    p_saved_place_id: savedPlaceId,
  });
  if (resolveError) throw new Error(`review resolution: ${JSON.stringify(resolveError)}`);
  assert.equal(resolved, true);
  const completed = await readJob(session.admin, job.id);
  assert.ok(completed);
  return completed;
}

async function waitForClaimedAiNoteTask(admin: any, savedPlaceId: string, waitForTerminal = false): Promise<Row> {
  const created = await pollUntil<Row>(
    async () => {
      const { data, error } = await admin
        .from('share_media_tasks')
        .select('*')
        .eq('saved_place_id', savedPlaceId)
        .eq('task_kind', 'ai_note_enrichment')
        .maybeSingle();
      if (error) throw error;
      return data as Row | null;
    },
    () => true,
    { timeoutMs: 60_000, intervalMs: 1_000 },
  );
  if (!created.ok) throw new Error('cold recognition did not enqueue the post-save AI-note task');

  const claimed = await pollUntil<Row>(
    async () => {
      const { data, error } = await admin.from('share_media_tasks').select('*').eq('id', created.value.id).single();
      if (error) throw error;
      return data as Row;
    },
    (row) => Number(row.attempts) > 0 || TERMINAL.has(String(row.status)),
    { timeoutMs: 180_000, intervalMs: 2_000 },
  );
  if (!claimed.ok) throw new Error(`AI-note task ${created.value.id} was not claimed`);
  if (!waitForTerminal) return claimed.value;
  const terminal = await pollUntil<Row>(
    async () => {
      const { data, error } = await admin.from('share_media_tasks').select('*').eq('id', created.value.id).single();
      if (error) throw error;
      return data as Row;
    },
    (row) => TERMINAL.has(String(row.status)),
    { timeoutMs: 480_000, intervalMs: 3_000 },
  );
  if (!terminal.ok) throw new Error(`AI-note task ${created.value.id} did not terminate`);
  return terminal.value;
}

async function main(): Promise<void> {
  const allIdentities = [
    identity(FIXTURES.cache.canonical),
    identity(FIXTURES.sources.first),
    identity(FIXTURES.sources.second),
    identity(FIXTURES.singleFlight),
  ];
  assert.equal(identity(FIXTURES.cache.variant).key, allIdentities[0].key, 'tracking variant must canonicalize to the same identity');
  const keys = allIdentities.map((item) => item.key);
  const session = await openSession({ withIdentity: true });
  assert.equal(session.config.supabaseRef, TARGET_REF, 'proof may only run against Nearr-Dev');

  let ownsCacheKeys = false;
  let duplicateSession: Awaited<ReturnType<typeof openSession>> | null = null;
  try {
    const { data: preexisting, error: preexistingError } = await session.admin
      .from('recognition_cache')
      .select('identity_key')
      .in('identity_key', keys);
    if (preexistingError) throw preexistingError;
    const useExisting = process.env.NEARR_PROOF_USE_EXISTING_CACHE === '1';
    if (rowArray(preexisting).length > 0) {
      assert.equal(useExisting, true, 'proof refuses to overwrite or clean up a pre-existing shared recognition row');
      assert.deepEqual(
        rowArray(preexisting).map((row) => row.identity_key),
        [keys[0]],
        'existing-cache mode accepts only the designated canonical cache fixture',
      );
      const startedAt = new Date().toISOString();
      const warm = await submitAndWait(session, 'cache-existing-warm', FIXTURES.cache.canonical);
      assert.equal(warm.job.status, 'completed');
      assert.equal(warm.job.extraction_payload?.recognitionCache?.hit, true);
      const [{ data: tasks, error: tasksError }, { data: runs, error: runsError }] = await Promise.all([
        session.admin.from('share_media_tasks').select('id').eq('user_id', session.identity!.userId).gte('created_at', startedAt),
        session.admin.from('share_agent_runs').select('id').eq('user_id', session.identity!.userId).gte('created_at', startedAt),
      ]);
      if (tasksError) throw tasksError;
      if (runsError) throw runsError;
      assert.equal(rowArray(tasks).length, 0, 'existing cache hit must not enqueue media work');
      assert.equal(rowArray(runs).length, 0, 'existing cache hit must not invoke the recognition agent');
      console.log(`CACHE_EXISTING_PROOF_RESULT ${JSON.stringify({
        jobId: warm.job.id,
        identityKey: keys[0],
        cacheHit: true,
        mediaTasks: 0,
        recognitionAgentRuns: 0,
        latencyMs: warm.latencyMs,
      })}`);
      return;
    }
    ownsCacheKeys = true;

    console.log(`CACHE_PROOF_STAGE target=${session.config.supabaseRef} correlation=${session.correlationId}`);

    const cold = await submitAndWait(session, 'cache-cold', FIXTURES.cache.canonical);
    assert.equal(cold.job.status, 'completed');
    assert.equal(cold.job.decision, 'auto_save');
    assert.ok(cold.job.saved_place_id);

    const [{ data: cacheRow, error: cacheError }, { data: cachePlace, error: placeError }] = await Promise.all([
      session.admin.from('recognition_cache').select('*').eq('identity_key', keys[0]).single(),
      session.admin.from('places').select('id,google_place_id,name').eq('google_place_id', FIXTURES.cache.googlePlaceId).single(),
    ]);
    if (cacheError) throw cacheError;
    if (placeError) throw placeError;
    assert.ok(cachePlace);
    assert.equal(cacheRow.trust_level, 'VERIFIED_AUTO_SAVE');
    assert.equal(cacheRow.canonical_place_id, cachePlace.id);
    const cacheOnly = process.env.NEARR_PROOF_CACHE_ONLY === '1';
    const aiTask = await waitForClaimedAiNoteTask(session.admin, cold.job.saved_place_id, cacheOnly);
    assert.ok(Number(aiTask.attempts) > 0, 'cold path media work must be claimed');

    const warmStarted = new Date().toISOString();
    const warm = await submitAndWait(session, 'cache-warm-variant', FIXTURES.cache.variant);
    console.log(`CACHE_PROOF_WARM_JOB ${JSON.stringify(warm.job)}`);
    assert.equal(warm.job.status, 'completed');
    assert.equal(warm.job.saved_place_id, cold.job.saved_place_id);
    assert.equal(warm.job.extraction_payload?.recognitionCache?.hit, true);
    const [{ data: warmTasks, error: warmTasksError }, { data: warmAgentRuns, error: warmRunsError }, { data: hitEvents, error: hitError }] = await Promise.all([
      session.admin.from('share_media_tasks').select('id').eq('user_id', session.identity!.userId).gte('created_at', warmStarted),
      session.admin.from('share_agent_runs').select('id').eq('user_id', session.identity!.userId).gte('created_at', warmStarted),
      session.admin.from('recognition_cache_events').select('*').eq('identity_key', keys[0]).eq('event_name', 'recognition_cache_hit').gte('created_at', warmStarted),
    ]);
    if (warmTasksError) throw new Error(`warm task telemetry: ${JSON.stringify(warmTasksError)}`);
    if (warmRunsError) throw new Error(`warm agent telemetry: ${JSON.stringify(warmRunsError)}`);
    if (hitError) throw new Error(`warm cache-event telemetry: ${JSON.stringify(hitError)}`);
    const hitEventRows = rowArray(hitEvents);
    assert.equal(rowArray(warmTasks).length, 0, 'warm cache hit must not create media work');
    assert.equal(rowArray(warmAgentRuns).length, 0, 'warm cache hit must not call the place-recognition agent');
    assert.ok(hitEventRows.some((event) => event.media_download_avoided === true));
    console.log(`CACHE_PROOF_RESULT ${JSON.stringify({
      coldJobId: cold.job.id, warmJobId: warm.job.id, coldMediaTaskId: aiTask.id,
      identityKey: keys[0], coldLatencyMs: cold.latencyMs, warmLatencyMs: warm.latencyMs,
      sameSavedPlace: true, cacheTrust: cacheRow.trust_level, recognitionVersion: cacheRow.recognition_version,
      canonicalPlace: cachePlace, cacheCreationSource: cacheRow.evidence_summary,
      mediaDownloadAvoided: true, placesAvoided: rowArray(warmAgentRuns).length === 0,
      geminiCallsAvoided: hitEventRows[0]?.gemini_calls_avoided ?? null,
      solCallsAvoided: hitEventRows[0]?.sol_calls_avoided ?? null,
      coldMedia: {
        status: aiTask.status, attempts: aiTask.attempts, mediaAcquired: aiTask.media_acquired_once,
        provider: aiTask.analysis_provider, model: aiTask.analysis_model, modelCalls: aiTask.model_calls,
        inputTokens: aiTask.model_input_tokens, outputTokens: aiTask.model_output_tokens,
      },
    })}`);
    if (cacheOnly) return;

    const firstSource = await submitAndWait(session, 'source-first', FIXTURES.sources.first);
    assert.equal(firstSource.job.status, 'completed');
    const { data: firstPlace, error: firstPlaceError } = await session.admin
      .from('places').select('id,google_place_id').eq('google_place_id', FIXTURES.sources.googlePlaceId).single();
    if (firstPlaceError) throw firstPlaceError;
    const { data: beforeSource, error: beforeSourceError } = await session.admin
      .from('saved_place_sources').select('*').eq('saved_place_id', firstSource.job.saved_place_id).eq('identity_key', keys[1]).single();
    if (beforeSourceError) throw beforeSourceError;

    const flightStartedAt = Date.now();
    const flightA = await submitShareJob(session, 'source-second-owner', FIXTURES.singleFlight);
    if (!flightA.ok) throw new Error(flightA.detail);
    const owner = await pollUntil<Row>(
      async () => {
        const { data, error } = await session.admin.from('recognition_inflight').select('*')
          .eq('identity_key', keys[3]).maybeSingle();
        if (error) throw error;
        return data as Row | null;
      },
      () => true,
      { timeoutMs: 90_000, intervalMs: 250 },
    );
    assert.ok(owner.ok, 'first same-content request must visibly own the recognition lease');
    duplicateSession = await openSession({ withIdentity: true });
    assert.equal(duplicateSession.config.supabaseRef, TARGET_REF);
    const flightB = await submitShareJob(duplicateSession, 'source-second-joined', FIXTURES.singleFlight);
    if (!flightB.ok) throw new Error(flightB.detail);
    assert.notEqual(flightB.jobId, flightA.jobId, 'cross-user submissions must remain distinct jobs');
    const { data: secondClaimData, error: secondClaimError } = await session.admin.rpc('claim_recognition_identity', {
      p_identity_key: keys[3], p_owner_token: flightB.jobId, p_lease_seconds: 600,
    });
    if (secondClaimError) throw new Error(`second recognition claim: ${JSON.stringify(secondClaimError)}`);
    const secondClaim = rowArray(secondClaimData)[0];
    assert.equal(secondClaim?.claimed, false, 'concurrent duplicate must join the in-flight owner');
    assert.equal(secondClaim?.owner_token, owner.value.owner_token);
    const observedTasks = await pollUntil<Row[]>(
      async () => {
        const { data, error } = await session.admin.from('share_media_tasks').select('*')
          .in('share_job_id', [flightA.jobId, flightB.jobId]);
        if (error) throw error;
        return rowArray(data);
      },
      (rows) => rows.length >= 1,
      { timeoutMs: 90_000, intervalMs: 1_000 },
    );
    assert.ok(observedTasks.ok, 'recognition owner must enqueue its expensive media task');
    assert.equal(observedTasks.value.some((row) => row.share_job_id === flightB.jobId), false);
    const claimedExpensiveTasks = observedTasks.value.filter((row) => Number(row.attempts) > 0);
    assert.ok(claimedExpensiveTasks.length <= 1);
    console.log(`SINGLEFLIGHT_PROOF_RESULT ${JSON.stringify({
      identityKey: keys[3], jobIds: [flightA.jobId, flightB.jobId], ownerCount: 1,
      joinedCount: 1, secondClaimed: secondClaim.claimed,
      claimedExpensiveTasks: claimedExpensiveTasks.length,
    })}`);
    const flightTerminal = await pollUntil<Row>(
      () => readJob(session.admin, flightA.jobId),
      (row) => TERMINAL.has(String(row.status)),
      { timeoutMs: 600_000, intervalMs: 2_000 },
    );
    assert.ok(flightTerminal.ok, 'single-flight owner must reach a terminal candidate result');
    const secondSource = { job: flightTerminal.value, latencyMs: Date.now() - flightStartedAt };
    console.log(`MULTI_SOURCE_SECOND_JOB ${JSON.stringify(secondSource.job)}`);
    const completedSecond = secondSource.job.status === 'needs_help'
      ? await confirmReviewedSource(
          session,
          secondSource.job,
          firstSource.job.saved_place_id,
          FIXTURES.sources.second,
          FIXTURES.sources.googlePlaceId,
        )
      : secondSource.job;
    assert.equal(completedSecond.status, 'completed');
    assert.equal(completedSecond.saved_place_id, firstSource.job.saved_place_id);
    const [{ data: savedRows, error: savedRowsError }, { data: sourceRows, error: sourceRowsError }] = await Promise.all([
      session.admin.from('saved_places').select('*').eq('user_id', session.identity!.userId).eq('place_id', firstPlace.id),
      session.admin.from('saved_place_sources').select('*').eq('saved_place_id', firstSource.job.saved_place_id).order('first_attached_at'),
    ]);
    if (savedRowsError) throw savedRowsError;
    if (sourceRowsError) throw sourceRowsError;
    const savedPlaceRows = rowArray(savedRows);
    const savedSourceRows = rowArray(sourceRows);
    assert.equal(savedPlaceRows.length, 1, 'same-place shares must converge to one saved place');
    assert.deepEqual(new Set(savedSourceRows.map((row) => row.identity_key)), new Set([keys[1], keys[2]]));
    const afterFirst = savedSourceRows.find((row) => row.identity_key === keys[1]);
    for (const field of ['canonical_url', 'creator_handle', 'creator_name', 'caption_excerpt', 'ai_note', 'thumbnail_url']) {
      if (beforeSource[field] !== null && beforeSource[field] !== undefined) {
        assert.equal(afterFirst?.[field], beforeSource[field], `later source must preserve first source ${field}`);
      }
    }
    const savedForUi = { ...savedPlaceRows[0], sources: savedSourceRows } as unknown as SavedPlaceWithPlace;
    const cards = placeSourceCards(savedForUi);
    assert.equal(cards.length, 2);
    assert.equal(shouldShowMoreVideos(cards), true);
    console.log(`MULTI_SOURCE_PROOF_RESULT ${JSON.stringify({
      googlePlaceId: FIXTURES.sources.googlePlaceId, savedPlaceCount: savedPlaceRows.length,
      sourceCount: savedSourceRows.length, sourceIdentityKeys: savedSourceRows.map((row: Row) => row.identity_key),
      cardUrls: cards.map((card) => card.url), firstSourceMetadataPreserved: true, showMoreVideos: true,
      secondDecisionBeforeConfirmation: secondSource.job.decision,
    })}`);

    const { data: userSaved, error: userSavedError } = await session.admin.from('saved_places').select('place_id')
      .eq('user_id', session.identity!.userId);
    if (userSavedError) throw userSavedError;
    const usedPlaceIds = new Set(rowArray(userSaved).map((row) => row.place_id));
    const { data: alternatePlaces, error: alternateError } = await session.admin.from('places').select('id,google_place_id,name')
      .neq('id', cacheRow.canonical_place_id).limit(20);
    if (alternateError) throw alternateError;
    const alternatePlace = rowArray(alternatePlaces).find((row) => !usedPlaceIds.has(row.id));
    assert.ok(alternatePlace, 'a distinct unsaved place is required for correction proof');
    const { error: correctionError } = await session.admin.from('saved_places').update({ place_id: alternatePlace.id })
      .eq('id', cold.job.saved_place_id).eq('user_id', session.identity!.userId);
    if (correctionError) throw correctionError;
    const { data: invalidated, error: invalidatedError } = await session.admin.from('recognition_cache').select('*')
      .eq('identity_key', keys[0]).single();
    if (invalidatedError) throw invalidatedError;
    assert.equal(invalidated.canonical_place_id, cacheRow.canonical_place_id, 'one user correction must not rewrite global truth');
    assert.equal(invalidated.invalidation_reason, 'user_correction');
    assert.ok(invalidated.invalidated_at);
    assert.ok(Number(invalidated.dispute_count) >= 1);
    const { data: correctionSources, error: correctionSourcesError } = await session.admin.from('saved_place_sources').select('id')
      .eq('saved_place_id', cold.job.saved_place_id);
    if (correctionSourcesError) throw correctionSourcesError;
    assert.ok(rowArray(correctionSources).length >= 1, 'correction must retain attached source provenance');
    console.log(`CORRECTION_PROOF_RESULT ${JSON.stringify({
      identityKey: keys[0], globalCanonicalPlaceUnchanged: true, invalidationReason: invalidated.invalidation_reason,
      disputeCount: invalidated.dispute_count, retainedSourceCount: correctionSources.length,
    })}`);
  } finally {
    const proofUserIds = [session.identity!.userId, duplicateSession?.identity?.userId].filter(Boolean) as string[];
    const { error: agentCleanupError } = await session.admin.from('share_agent_runs').delete().in('user_id', proofUserIds);
    const duplicateCleanup = duplicateSession ? await duplicateSession.cleanup() : null;
    const cleanup = await session.cleanup();
    const cacheCleanupErrors: string[] = agentCleanupError
      ? [`share_agent_runs: ${agentCleanupError.message}`]
      : [];
    if (ownsCacheKeys) {
      for (const table of ['recognition_cache_events', 'recognition_inflight', 'recognition_cache'] as const) {
        const { error } = await session.admin.from(table).delete().in('identity_key', keys);
        if (error) cacheCleanupErrors.push(`${table}: ${error.message}`);
      }
    }
    const sessionErrors = [...cleanup.errors, ...(duplicateCleanup?.errors ?? [])];
    console.log(`CACHE_PROOF_CLEANUP ${JSON.stringify({
      usersDeleted: [cleanup.userDeleted, duplicateCleanup?.userDeleted ?? true], sessionErrors, cacheCleanupErrors,
    })}`);
    if (sessionErrors.length || cacheCleanupErrors.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
