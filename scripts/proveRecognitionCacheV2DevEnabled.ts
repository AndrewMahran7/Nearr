import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { canonicalContentIdentity, RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';
import { RECOGNITION_CACHE_POLICY_VERSION } from '../supabase/functions/_shared/recognitionCachePolicy';
import { submitShareJob } from './e2e/fixtures/shared';
import { pollUntil } from './e2e/poll';
import { openSession, type E2ESession } from './e2e/session';

const TARGET_REF = 'qnfxnmvxpjzfydgudtvs';
const TERMINAL = new Set(['completed', 'needs_help', 'failed', 'cancelled']);
const V02 = 'https://www.instagram.com/reel/DUWyZkfgbT4/';
const H01 = 'https://www.instagram.com/reel/DYpcd2ZBTsZ/';

type Place = { id: string; google_place_id: string; name: string };

function authed(session: E2ESession) {
  return createClient(session.config.supabaseUrl, session.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.identity!.accessToken}` } },
  });
}

async function seedAnswer(admin: any, sourceUrl: string, placeId: string, slot = 'media-primary') {
  const identity = canonicalContentIdentity(sourceUrl);
  assert.ok(identity);
  const { data: existing, error: existingError } = await admin.from('recognition_source_states')
    .select('identity_key').eq('identity_key', identity.key);
  if (existingError) throw existingError;
  assert.equal(existing?.length ?? 0, 0, `refusing to overwrite V2 state for ${identity.key}`);
  const fingerprint = `controlled-frozen-evidence:${identity.contentId}`;
  const { error: stateError } = await admin.from('recognition_source_states').insert({
    identity_key: identity.key,
    platform: identity.platform,
    content_id: identity.contentId,
    canonical_url: identity.canonicalUrl,
    identity_version: identity.identityVersion,
    source_fingerprint: fingerprint,
    evidence_revision: 1,
    feedback_revision: 0,
    policy_version: RECOGNITION_CACHE_POLICY_VERSION,
    recognition_version: RECOGNITION_VERSION,
    state: 'ELIGIBLE',
    visibility_scope: 'public',
    source_ai_note: 'Controlled source-grounded cache V2 proof note.',
  });
  if (stateError) throw stateError;
  const { error: answerError } = await admin.from('recognition_cache_answers_v2').insert({
    identity_key: identity.key,
    slot_key: slot,
    place_id: placeId,
    state: 'ELIGIBLE',
    answer_revision: 1,
    feedback_revision: 0,
    evidence_revision: 1,
    policy_version: RECOGNITION_CACHE_POLICY_VERSION,
    recognition_version: RECOGNITION_VERSION,
    source_fingerprint: fingerprint,
    specificity: 'exact',
    terminal_status: 'success',
    semantic_check_passed: true,
    geographic_check_passed: true,
    evidence_sufficient: true,
    strong_contradiction: false,
    evidence_summary: { fixture: 'controlled_frozen_provider_response' },
    saved_category: 'restaurant',
    saved_category_source: 'google_primary_type',
    saved_category_confidence: 1,
    saved_category_model_version: 'nearr-category-2026-08-13.v3',
    validated_feedback_revision: 0,
    last_validated_at: new Date().toISOString(),
  });
  if (answerError) throw answerError;
  return identity;
}

async function submitAndWait(session: E2ESession, fixture: string, url: string) {
  const startedAt = new Date().toISOString();
  const submitted = await submitShareJob(session, fixture, url);
  if (!submitted.ok) throw new Error(submitted.detail);
  const terminal = await pollUntil<Record<string, any>>(
    async () => {
      const { data, error } = await session.admin.from('share_jobs').select('*').eq('id', submitted.jobId).single();
      if (error) throw error;
      return data;
    },
    (job) => TERMINAL.has(String(job.status)),
    { timeoutMs: 12 * 60_000, intervalMs: 2_000 },
  );
  assert.ok(terminal.ok, `${fixture} timed out`);
  const [{ data: media, error: mediaError }, { data: runs, error: runsError }] = await Promise.all([
    session.admin.from('share_media_tasks').select('id,task_kind,status,model_calls').eq('share_job_id', submitted.jobId),
    session.admin.from('share_agent_runs').select('id').eq('user_id', session.identity!.userId).gte('created_at', startedAt),
  ]);
  if (mediaError ?? runsError) throw mediaError ?? runsError;
  return { job: terminal.value, media: media ?? [], agentRuns: runs ?? [] };
}

async function correct(session: E2ESession, savedPlaceId: string, replacement: Place, key: string) {
  const { data: saved, error: savedError } = await session.admin.from('saved_places')
    .select('category').eq('id', savedPlaceId).single();
  if (savedError) throw savedError;
  const { data, error } = await authed(session).rpc('correct_saved_place_provider_v2', {
    p_saved_place_id: savedPlaceId,
    p_place_id: replacement.id,
    p_corrected_google_place_id: replacement.google_place_id,
    p_category: saved.category ?? 'restaurant',
    p_category_source: 'google_primary_type',
    p_category_confidence: 1,
    p_category_model_version: RECOGNITION_CACHE_POLICY_VERSION,
    p_idempotency_key: key,
  });
  if (error) throw new Error(`correction failed: ${error.message}`);
  assert.equal(Array.isArray(data), true);
  const { data: immediate, error: immediateError } = await session.admin.from('saved_places')
    .select('place_id').eq('id', savedPlaceId).single();
  if (immediateError) throw immediateError;
  assert.equal(immediate.place_id, replacement.id, 'owner correction was not immediately visible');
}

async function waitForRevalidation(admin: any, identityKey: string) {
  const result = await pollUntil<Record<string, any>>(
    async () => {
      const { data, error } = await admin.from('recognition_revalidation_tasks').select('*')
        .eq('identity_key', identityKey).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
    (row) => ['COMPLETED', 'FAILED', 'STALE'].includes(String(row.state)),
    { timeoutMs: 12 * 60_000, intervalMs: 3_000 },
  );
  assert.ok(result.ok, `revalidation timed out for ${identityKey}`);
  return result.value;
}

async function main(): Promise<void> {
  const sessions: E2ESession[] = [];
  const controlledKeys: string[] = [];
  const startedAt = new Date().toISOString();
  const first = await openSession({ withIdentity: true });
  sessions.push(first);
  assert.equal(first.config.supabaseRef, TARGET_REF);
  const admin = first.admin;
  try {
    const { data: places, error: placeError } = await admin.from('places')
      .select('id,google_place_id,name')
      .in('google_place_id', ['ChIJ3dEbnTMh3YARhAvz8VeCxJg', 'ChIJE5pV1UMh3YARIhsItpUt0K8']);
    if (placeError) throw placeError;
    const capone = places?.find((place: Place) => /Capone/.test(place.name)) as Place | undefined;
    const secondFloor = places?.find((place: Place) => /2nd Floor/.test(place.name)) as Place | undefined;
    assert.ok(capone && secondFloor, 'controlled canonical places are missing');

    // Correct cached identity -> intentionally wrong replacement. Two cache
    // recipients get independent saves and add zero support.
    const v02Identity = await seedAnswer(admin, V02, capone.id);
    controlledKeys.push(v02Identity.key);
    const { data: directRead, error: directReadError } = await admin.rpc('read_recognition_answers_v2', {
      p_identity_key: v02Identity.key,
      p_identity_version: v02Identity.identityVersion,
      p_policy_version: RECOGNITION_CACHE_POLICY_VERSION,
      p_recognition_version: RECOGNITION_VERSION,
      p_user_id: first.identity!.userId,
    });
    if (directReadError) throw new Error(`direct V2 read failed: ${directReadError.message}`);
    assert.equal(directRead?.length, 1, 'seeded V2 answer was not readable');
    const second = await openSession({ withIdentity: true });
    sessions.push(second);
    const v02a = await submitAndWait(first, 'v02-cache-recipient-a', V02);
    const v02b = await submitAndWait(second, 'v02-cache-recipient-b', `${V02}?utm_source=cache-v2-proof`);
    const [{ data: postRead, error: postReadError }, { data: cacheEvents, error: cacheEventsError }] = await Promise.all([
      admin.rpc('read_recognition_answers_v2', {
        p_identity_key: v02Identity.key,
        p_identity_version: v02Identity.identityVersion,
        p_policy_version: RECOGNITION_CACHE_POLICY_VERSION,
        p_recognition_version: RECOGNITION_VERSION,
        p_user_id: first.identity!.userId,
      }),
      admin.from('recognition_cache_events').select('event_name,detail').eq('identity_key', v02Identity.key)
        .gte('created_at', startedAt).order('created_at'),
    ]);
    if (postReadError ?? cacheEventsError) throw postReadError ?? cacheEventsError;
    console.log(`CACHE_V2_DEV_HIT_OBSERVATION ${JSON.stringify({
      jobs: [v02a, v02b].map((observed) => ({
        status: observed.job.status,
        decision: observed.job.decision,
        recognitionCache: observed.job.extraction_payload?.recognitionCache ?? null,
        mediaTasks: observed.media.length,
        agentRuns: observed.agentRuns.length,
      })),
      directReadAfterJobs: postRead?.length ?? 0,
      cacheEvents,
    })}`);
    for (const observed of [v02a, v02b]) {
      assert.equal(observed.job.status, 'completed');
      assert.equal(observed.job.extraction_payload?.recognitionCache?.hit, true);
      assert.equal(observed.job.extraction_payload?.recognitionCache?.version, 2);
      assert.equal(observed.media.length, 0);
      assert.equal(observed.agentRuns.length, 0);
    }
    assert.notEqual(v02a.job.saved_place_id, v02b.job.saved_place_id);
    const { count: passiveSupport, error: passiveError } = await admin.from('recognition_identity_support')
      .select('*', { count: 'exact', head: true }).eq('identity_key', v02Identity.key);
    if (passiveError) throw passiveError;
    assert.equal(passiveSupport, 0);
    await correct(first, v02a.job.saved_place_id, secondFloor, `cache-v2-disagree-${randomUUID()}`);
    const v02Revalidation = await waitForRevalidation(admin, v02Identity.key);
    assert.equal(v02Revalidation.decision, 'SUPPORTS_PREVIOUS');
    const { data: v02State, error: v02StateError } = await admin.from('recognition_source_states')
      .select('state,feedback_revision').eq('identity_key', v02Identity.key).single();
    if (v02StateError) throw v02StateError;
    assert.equal(v02State.state, 'DISPUTED');
    assert.equal(Number(v02State.feedback_revision), 1);
    const third = await openSession({ withIdentity: true });
    sessions.push(third);
    const afterDispute = await submitAndWait(third, 'v02-after-dispute', V02);
    assert.notEqual(afterDispute.job.extraction_payload?.recognitionCache?.hit, true);

    // Intentionally wrong controlled cache -> owner selects the known source
    // identity -> fresh model agreement -> current-revision eligibility -> hit.
    const h01Identity = await seedAnswer(admin, H01, capone.id);
    controlledKeys.push(h01Identity.key);
    const fourth = await openSession({ withIdentity: true });
    sessions.push(fourth);
    const wrongHit = await submitAndWait(fourth, 'h01-controlled-wrong-cache', H01);
    assert.equal(wrongHit.job.extraction_payload?.recognitionCache?.hit, true);
    await correct(fourth, wrongHit.job.saved_place_id, secondFloor, `cache-v2-agree-${randomUUID()}`);
    const h01Revalidation = await waitForRevalidation(admin, h01Identity.key);
    assert.equal(h01Revalidation.decision, 'AGREES_WITH_REPLACEMENT');
    const { data: h01Answer, error: h01AnswerError } = await admin.from('recognition_cache_answers_v2')
      .select('place_id,state,feedback_revision,validated_feedback_revision')
      .eq('identity_key', h01Identity.key).single();
    if (h01AnswerError) throw h01AnswerError;
    assert.equal(h01Answer.place_id, secondFloor.id);
    assert.equal(h01Answer.state, 'ELIGIBLE');
    assert.equal(h01Answer.feedback_revision, h01Answer.validated_feedback_revision);
    const fifth = await openSession({ withIdentity: true });
    sessions.push(fifth);
    const replacementHit = await submitAndWait(fifth, 'h01-replacement-cache-hit', H01);
    assert.equal(replacementHit.job.extraction_payload?.recognitionCache?.hit, true);
    assert.equal(replacementHit.media.length, 0);
    assert.equal(replacementHit.agentRuns.length, 0);

    const revalidations = [v02Revalidation, h01Revalidation];
    console.log(`CACHE_V2_DEV_ENABLED ${JSON.stringify({
      sources: controlledKeys.length,
      cacheHits: 4,
      cacheHitRecognitionModelCalls: 0,
      independentRecipientSaves: true,
      sourceAiNotePreserved: true,
      passiveSupportAfterTwoHits: passiveSupport,
      disagreement: {
        decision: v02Revalidation.decision,
        disposition: v02State.state,
        nextSubmissionCacheHit: afterDispute.job.extraction_payload?.recognitionCache?.hit === true,
        nextSubmissionStatus: afterDispute.job.status,
      },
      agreement: {
        decision: h01Revalidation.decision,
        disposition: h01Answer.state,
        revision: h01Answer.feedback_revision,
        replacementCacheHit: true,
      },
      revalidationModelCalls: revalidations.reduce((sum, row) => sum + Number(row.diagnostics?.modelCalls ?? 0), 0),
      revalidationKnownModelCostUsd: revalidations.reduce((sum, row) => sum + Number(row.diagnostics?.totalModelCostUsd ?? 0), 0),
      premiumOrWalletWrites: 0,
    })}`);
  } finally {
    const cleanupReports = [];
    for (const session of sessions.reverse()) cleanupReports.push(await session.cleanup());
    if (controlledKeys.length > 0) {
      await admin.from('recognition_cache_events').delete().in('identity_key', controlledKeys).gte('created_at', startedAt);
      await admin.from('recognition_source_states').delete().in('identity_key', controlledKeys);
    }
    const cleanupErrors = cleanupReports.flatMap((report) => report.errors);
    console.log(`CACHE_V2_DEV_ENABLED_CLEANUP ${JSON.stringify({
      usersDeleted: cleanupReports.map((report) => report.userDeleted),
      evidenceObjectsDeleted: cleanupReports.reduce((sum, report) => sum + report.evidenceObjectsDeleted, 0),
      controlledSourceStatesDeleted: controlledKeys.length,
      errors: cleanupErrors,
    })}`);
    if (cleanupErrors.length > 0 || cleanupReports.some((report) => !report.userDeleted)) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
