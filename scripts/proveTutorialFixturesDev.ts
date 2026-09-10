import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { canonicalContentIdentity } from '../lib/shareAgent/contentIdentity';
import { pollUntil } from './e2e/poll';
import { openSession } from './e2e/session';
import { FIXTURE_HEALTH_TTL_DAYS, readFixture, sourceHealthProbe, type FixtureRow } from './tutorialFixtures/core';

const FIXTURE_ID = '1c19f2d2-a020-4508-9fe3-ef9ef8bb052a';
const PLACE_ID = '1896322f-b910-4f0c-ab69-0a9648ee3790';
const GOOGLE_PLACE_ID = 'ChIJHxRxLN2p6DgRMd2q59otvqI';
const IDENTITY_KEY = 'v1:youtube:rrKmN3zZ0lM';
const SHORTS_URL = 'https://www.youtube.com/shorts/rrKmN3zZ0lM';
const WATCH_URL = 'https://www.youtube.com/watch?v=rrKmN3zZ0lM';
const SHORT_URL = 'https://youtu.be/rrKmN3zZ0lM?si=fixture-proof';
const ORDINARY_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const TERMINAL = new Set(['completed','needs_help','failed','cancelled']);

type Job = {
  id: string; user_id: string; status: string; decision: string | null; saved_place_id: string | null;
  resolution_source: string | null; tutorial_fixture_id: string | null; tutorial_fixture_revision: number | null;
  tutorial_fixture_role: string | null; recognition_identity_key: string | null; candidate_payload: any;
  extraction_payload: any; created_at: string; completed_at: string | null;
};

async function submit(config: any, token: string, url: string, clientRequestId: string): Promise<{ jobId: string; duplicate: boolean; elapsedMs: number }> {
  const started = Date.now();
  const response = await fetch(`${config.supabaseUrl}/functions/v1/create-share-job`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, apikey: config.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ url, clientRequestId }),
  });
  const body = await response.json() as any;
  if (!response.ok || !body.jobId) throw new Error(`create_share_job_failed:${response.status}:${body.error ?? 'invalid'}`);
  return { jobId: body.jobId, duplicate: body.duplicate === true, elapsedMs: Date.now() - started };
}

async function terminalJob(admin: SupabaseClient, jobId: string): Promise<{ job: Job; elapsedMs: number }> {
  const poll = await pollUntil(async () => {
    const { data, error } = await admin.from('share_jobs').select('id,user_id,status,decision,saved_place_id,resolution_source,tutorial_fixture_id,tutorial_fixture_revision,tutorial_fixture_role,recognition_identity_key,candidate_payload,extraction_payload,created_at,completed_at').eq('id', jobId).maybeSingle();
    if (error) throw error;
    return data as Job | null;
  }, (job) => TERMINAL.has(job.status), { timeoutMs: 180_000, intervalMs: 500 });
  if (!poll.ok) throw new Error(`job_terminal_timeout:${jobId}:${JSON.stringify(poll.last)}`);
  return { job: poll.value, elapsedMs: poll.elapsedMs };
}

async function organicEvidence(admin: SupabaseClient, jobId: string): Promise<any> {
  const poll = await pollUntil(async () => {
    const [{ data: job, error: jobError }, { data: tasks, error: taskError }] = await Promise.all([
      admin.from('share_jobs').select('id,status,resolution_source,tutorial_fixture_id,recognition_identity_key,extraction_payload').eq('id', jobId).maybeSingle(),
      admin.from('share_media_tasks').select('id,status,task_kind').eq('share_job_id', jobId),
    ]);
    if (jobError || taskError) throw jobError ?? taskError;
    return { job, tasks: tasks ?? [] };
  }, (value) => Boolean(value.job && (TERMINAL.has(value.job.status) || value.tasks.length > 0)), { timeoutMs: 120_000, intervalMs: 750 });
  if (!poll.ok) throw new Error(`organic_fallback_not_observed:${jobId}`);
  const observed = poll.value;
  assert.ok(observed.job);
  assert.equal(observed.job.tutorial_fixture_id, null);
  assert.notEqual(observed.job.resolution_source, 'tutorial_fixture');
  return { ...observed, elapsedMs: poll.elapsedMs };
}

async function cacheSnapshot(admin: SupabaseClient): Promise<Record<string, unknown>> {
  const [state, answers, support, legacy] = await Promise.all([
    admin.from('recognition_source_states').select('*').eq('identity_key', IDENTITY_KEY),
    admin.from('recognition_cache_answers_v2').select('*').eq('identity_key', IDENTITY_KEY),
    admin.from('recognition_identity_support').select('*').eq('identity_key', IDENTITY_KEY),
    admin.from('recognition_cache').select('*').eq('identity_key', IDENTITY_KEY),
  ]);
  for (const result of [state, answers, support, legacy]) if (result.error) throw result.error;
  return { state: state.data, answers: answers.data, support: support.data, legacy: legacy.data };
}

function assertFixtureJob(job: Job): void {
  assert.equal(job.status, 'completed');
  assert.equal(job.decision, 'auto_save');
  assert.equal(job.resolution_source, 'tutorial_fixture');
  assert.equal(job.tutorial_fixture_id, FIXTURE_ID);
  assert.equal(job.recognition_identity_key, IDENTITY_KEY);
  assert.equal(job.extraction_payload?.tutorialFixture?.modelInvoked, false);
  assert.equal(job.extraction_payload?.tutorialFixture?.mediaInvoked, false);
  assert.equal(job.extraction_payload?.tutorialFixture?.cacheRead, false);
  assert.equal(job.extraction_payload?.tutorialFixture?.cacheAdmitted, false);
  assert.equal(job.extraction_payload?.tutorialFixture?.placesCalls, 0);
}

async function setActiveAfterProbe(admin: SupabaseClient, fixture: FixtureRow, actor: string, reason: string): Promise<number> {
  const probe = await sourceHealthProbe(fixture, false);
  const now = new Date();
  const revision = Number(fixture.verification_revision) + 1;
  const { error } = await admin.from('onboarding_tutorial_fixtures').update({
    status: 'active', health_state: 'healthy', verification_revision: revision,
    verified_at: now.toISOString(), verified_by: actor,
    last_health_checked_at: now.toISOString(),
    health_expires_at: new Date(now.getTime() + FIXTURE_HEALTH_TTL_DAYS * 86400_000).toISOString(),
    last_health_error_code: null, disabled_at: null, disabled_reason: null, updated_at: now.toISOString(),
  }).eq('id', FIXTURE_ID).eq('verification_revision', fixture.verification_revision);
  if (error) throw error;
  const event = await admin.from('onboarding_tutorial_fixture_events').insert({
    fixture_id: FIXTURE_ID, event_type: 'reactivated', from_status: fixture.status, to_status: 'active',
    verification_revision: revision, actor, reason_code: reason,
    detail: { source_probe_format_count: probe.formatCount, proof_recovery: true },
  });
  if (event.error) throw event.error;
  return revision;
}

async function run(): Promise<void> {
  if (process.env.RUN_LIVE_TUTORIAL_FIXTURE_PROOF !== '1') throw new Error('live_proof_not_opted_in:set_RUN_LIVE_TUTORIAL_FIXTURE_PROOF=1');
  const first = await openSession({ withIdentity: true, withEdgeSecrets: false });
  const second = await openSession({ withIdentity: true, withEdgeSecrets: false });
  assert.ok(first.identity && second.identity);
  const actor = `fixture-proof-${first.correlationId}`.slice(0, 160);
  const userClient = createClient(first.config.supabaseUrl, first.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${first.identity.accessToken}` } },
  });
  const proof: any = { target: first.config.supabaseRef, correlation: first.correlationId };
  let fixture = await readFixture(first.admin, FIXTURE_ID);
  assert.equal(fixture.status, 'active', 'live proof refuses to override an ineligible fixture precondition');
  let fixtureMutatedByProof = false;

  try {
    const beforeCache = await cacheSnapshot(first.admin);
    const exactKey = `${first.correlationId}:exact`;
    const exactSubmit = await submit(first.config, first.identity.accessToken, SHORTS_URL, exactKey);
    first.trackedJobIds.push(exactSubmit.jobId);
    const exact = await terminalJob(first.admin, exactSubmit.jobId);
    assertFixtureJob(exact.job);

    const exactRetry = await submit(first.config, first.identity.accessToken, SHORTS_URL, exactKey);
    assert.equal(exactRetry.jobId, exactSubmit.jobId);
    assert.equal(exactRetry.duplicate, true);

    const laterSubmit = await submit(first.config, first.identity.accessToken, WATCH_URL, `${first.correlationId}:later`);
    first.trackedJobIds.push(laterSubmit.jobId);
    assert.notEqual(laterSubmit.jobId, exactSubmit.jobId);
    const later = await terminalJob(first.admin, laterSubmit.jobId);
    assertFixtureJob(later.job);
    assert.equal(later.job.saved_place_id, exact.job.saved_place_id);

    const equivalentSubmit = await submit(first.config, first.identity.accessToken, SHORT_URL, `${first.correlationId}:equivalent`);
    first.trackedJobIds.push(equivalentSubmit.jobId);
    const equivalent = await terminalJob(first.admin, equivalentSubmit.jobId);
    assertFixtureJob(equivalent.job);
    assert.equal(equivalent.job.saved_place_id, exact.job.saved_place_id);

    const otherSubmit = await submit(second.config, second.identity.accessToken, WATCH_URL, `${second.correlationId}:other-user`);
    second.trackedJobIds.push(otherSubmit.jobId);
    const other = await terminalJob(second.admin, otherSubmit.jobId);
    assertFixtureJob(other.job);
    assert.notEqual(other.job.saved_place_id, exact.job.saved_place_id);

    const [
      { data: result }, { data: source }, { data: firstSave }, { data: secondSave },
      mediaTasks, mediaRuns, agentRuns, extractionFailures,
    ] = await Promise.all([
      first.admin.from('share_job_place_results').select('*').eq('share_job_id', exact.job.id).eq('logical_result_id', 'tutorial-fixture-primary').single(),
      first.admin.from('saved_place_sources').select('*').eq('saved_place_id', exact.job.saved_place_id).eq('identity_key', IDENTITY_KEY).single(),
      first.admin.from('saved_places').select('id,user_id,place_id').eq('id', exact.job.saved_place_id).single(),
      first.admin.from('saved_places').select('id,user_id,place_id').eq('id', other.job.saved_place_id).single(),
      first.admin.from('share_media_tasks').select('*', { count: 'exact', head: true }).eq('share_job_id', exact.job.id),
      first.admin.from('share_media_runs').select('*', { count: 'exact', head: true }).eq('share_job_id', exact.job.id),
      first.admin.from('share_agent_runs').select('*', { count: 'exact', head: true }).eq('user_id', first.identity.userId),
      first.admin.from('share_extraction_failures').select('*', { count: 'exact', head: true }).eq('user_id', first.identity.userId),
    ]);
    for (const work of [mediaTasks, mediaRuns, agentRuns, extractionFailures]) if (work.error) throw work.error;
    assert.equal(result?.rule_version, 'tutorial-fixture.v1');
    assert.equal(result?.google_place_id, GOOGLE_PLACE_ID);
    assert.equal(source?.identity_key, IDENTITY_KEY);
    assert.equal(firstSave?.user_id, first.identity.userId);
    assert.equal(secondSave?.user_id, second.identity.userId);
    assert.equal(firstSave?.place_id, PLACE_ID);
    assert.equal(secondSave?.place_id, PLACE_ID);
    assert.deepEqual(
      [mediaTasks.count, mediaRuns.count, agentRuns.count, extractionFailures.count],
      [0, 0, 0, 0],
      'fixture resolution must create no media, Gemini, Sol, Automatic Deep, or extraction work',
    );

    const afterCache = await cacheSnapshot(first.admin);
    assert.deepEqual(afterCache, beforeCache, 'fixture hits must not change Cache V2 truth/support');

    const ordinarySubmit = await submit(second.config, second.identity.accessToken, ORDINARY_URL, `${second.correlationId}:ordinary`);
    second.trackedJobIds.push(ordinarySubmit.jobId);
    const ordinary = await organicEvidence(second.admin, ordinarySubmit.jobId);

    fixture = await readFixture(first.admin, FIXTURE_ID);
    const disabledAt = new Date().toISOString();
    fixtureMutatedByProof = true;
    const disabled = await first.admin.from('onboarding_tutorial_fixtures').update({
      status: 'disabled', disabled_at: disabledAt, disabled_reason: 'dev_proof', updated_at: disabledAt,
    }).eq('id', FIXTURE_ID);
    if (disabled.error) throw disabled.error;
    const disabledSubmit = await submit(first.config, first.identity.accessToken, SHORTS_URL, `${first.correlationId}:disabled`);
    first.trackedJobIds.push(disabledSubmit.jobId);
    const disabledFallback = await organicEvidence(first.admin, disabledSubmit.jobId);
    fixture = await readFixture(first.admin, FIXTURE_ID);
    const reactivatedRevision = await setActiveAfterProbe(first.admin, fixture, actor, 'disabled_fallback_proven');

    const wrongSubmit = await submit(first.config, first.identity.accessToken, SHORTS_URL, `${first.correlationId}:wrong-place`);
    first.trackedJobIds.push(wrongSubmit.jobId);
    const wrong = await terminalJob(first.admin, wrongSubmit.jobId);
    assertFixtureJob(wrong.job);
    const rejectionKey = `${first.correlationId}:wrong-place:${randomUUID()}`.slice(0, 190);
    const rejected = await userClient.rpc('reject_saved_place_recognition_v2', {
      p_saved_place_id: wrong.job.saved_place_id,
      p_reason: 'wrong_place',
      p_idempotency_key: rejectionKey,
    });
    if (rejected.error) throw rejected.error;
    const quarantined = await readFixture(first.admin, FIXTURE_ID);
    assert.equal(quarantined.status, 'quarantined');
    assert.equal(quarantined.health_state, 'quarantined');
    assert.equal(quarantined.place_id, PLACE_ID, 'Wrong Place must not remap the fixture');
    const { data: correction, error: correctionError } = await first.admin.from('recognition_correction_events')
      .select('id,assertion_kind,identity_key,previous_place_id').eq('user_id', first.identity.userId)
      .eq('saved_place_id', wrong.job.saved_place_id).single();
    if (correctionError) throw correctionError;
    assert.equal(correction.assertion_kind, 'WRONG_PLACE');
    const identity = canonicalContentIdentity(SHORTS_URL)!;
    const lookupAfterQuarantine = await first.admin.rpc('resolve_onboarding_tutorial_fixture', {
      p_identity_key: identity.key, p_identity_version: identity.identityVersion, p_platform: identity.platform,
      p_content_id: identity.contentId, p_canonical_url: identity.canonicalUrl,
    });
    if (lookupAfterQuarantine.error) throw lookupAfterQuarantine.error;
    assert.deepEqual(lookupAfterQuarantine.data, []);

    const finalRevision = await setActiveAfterProbe(first.admin, quarantined, actor, 'synthetic_wrong_place_proof_complete');
    proof.happyPath = { jobId: exact.job.id, fixtureId: FIXTURE_ID, savedPlaceId: exact.job.saved_place_id, placeId: PLACE_ID, sourceId: source?.id, resolutionSource: exact.job.resolution_source, edgeResolutionMs: exact.elapsedMs, fixtureDiagnostics: exact.job.extraction_payload.tutorialFixture, workRows: { mediaTasks: mediaTasks.count, mediaRuns: mediaRuns.count, agentRuns: agentRuns.count, extractionFailures: extractionFailures.count } };
    proof.idempotency = { sameRequestSameJob: exactRetry.jobId === exact.job.id, laterNewJob: later.job.id !== exact.job.id, sameUserSaveReused: later.job.saved_place_id === exact.job.saved_place_id };
    proof.equivalentUrl = { url: SHORT_URL, identityKey: equivalent.job.recognition_identity_key, jobId: equivalent.job.id };
    proof.userOwnership = { firstUserSavedPlaceId: exact.job.saved_place_id, secondUserSavedPlaceId: other.job.saved_place_id, sameGlobalPlace: firstSave?.place_id === secondSave?.place_id };
    proof.cacheSeparation = { unchanged: true, snapshot: afterCache };
    proof.ordinaryFallback = { jobId: ordinarySubmit.jobId, observed: ordinary };
    proof.disabledFallback = { jobId: disabledSubmit.jobId, observed: disabledFallback, reactivatedRevision };
    proof.wrongPlace = { jobId: wrong.job.id, correctionEventId: correction.id, assertionKind: correction.assertion_kind, fixtureStatus: quarantined.status, noAutomaticRemap: quarantined.place_id === PLACE_ID, nextLookupRows: lookupAfterQuarantine.data.length, finalRevision };
    console.log(JSON.stringify({ result: 'PASS', ...proof }, null, 2));
  } finally {
    if (fixtureMutatedByProof) {
      const current = await readFixture(first.admin, FIXTURE_ID);
      if (current.status !== 'active') {
        await setActiveAfterProbe(first.admin, current, actor, 'proof_finally_recovery');
      }
    }
    const jobIds = [...first.trackedJobIds, ...second.trackedJobIds];
    if (jobIds.length) await first.admin.from('onboarding_tutorial_fixture_events').delete().in('source_job_id', jobIds);
    await first.admin.from('onboarding_tutorial_fixture_events').delete().eq('actor', actor);
    await first.admin.from('analytics_events').delete().in('user_id', [first.identity.userId, second.identity.userId]);
    const [firstCleanup, secondCleanup] = await Promise.all([first.cleanup(), second.cleanup()]);
    if (firstCleanup.errors.length || secondCleanup.errors.length) {
      throw new Error(`proof_cleanup_failed:${[...firstCleanup.errors, ...secondCleanup.errors].join('|')}`);
    }
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
