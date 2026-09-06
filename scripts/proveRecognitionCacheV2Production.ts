import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { canonicalContentIdentity, RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';
import { RECOGNITION_CACHE_POLICY_VERSION } from '../supabase/functions/_shared/recognitionCachePolicy';
import { cleanupSession, type EphemeralIdentity } from './e2e/session';

const TARGET_REF = 'rlqvxdwtetxsqxhqztkw';
const ACK = 'I_ACKNOWLEDGE_CONTROLLED_PRODUCTION_CACHE_V2_SMOKE';
const H01 = 'https://www.instagram.com/reel/DYpcd2ZBTsZ/';
const MULTI = 'https://www.instagram.com/reel/NEARRV2PRODMULTI1/';
const TERMINAL = new Set(['completed', 'needs_help', 'failed', 'cancelled']);

type Place = { id: string; google_place_id: string; name: string };
type SmokeIdentity = EphemeralIdentity & { password: string };

function refOf(url: string): string | null {
  try { return new URL(url).hostname.split('.')[0] || null; } catch { return null; }
}

async function createIdentity(admin: SupabaseClient, supabaseUrl: string, apiKey: string, runKey: string): Promise<SmokeIdentity> {
  const password = `Nz!${randomUUID()}${randomBytes(6).toString('hex')}`;
  const email = `${runKey}-${randomUUID().slice(0, 8)}@nearr.invalid`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { purpose: 'nearr_production_cache_v2_smoke', runKey },
  });
  if (createError || !created.user) throw new Error(`ephemeral user failed: ${createError?.message ?? 'unknown'}`);
  const auth = createClient(supabaseUrl, apiKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn.session) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(`ephemeral sign-in failed: ${signInError?.message ?? 'unknown'}`);
  }
  return { userId: created.user.id, email, accessToken: signedIn.session.access_token, password };
}

async function submit(
  admin: SupabaseClient,
  supabaseUrl: string,
  apiKey: string,
  identity: SmokeIdentity,
  runKey: string,
  fixture: string,
  sourceUrl: string,
  jobIds: string[],
) {
  const submittedAt = new Date().toISOString();
  const response = await fetch(`${supabaseUrl}/functions/v1/create-share-job`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${identity.accessToken}`, apikey: apiKey },
    body: JSON.stringify({ url: sourceUrl, clientRequestId: `${runKey}:${fixture}` }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`create-share-job ${response.status}: ${text.slice(0, 240)}`);
  const body = JSON.parse(text) as { jobId?: string };
  if (!body.jobId) throw new Error('create-share-job returned no job id');
  jobIds.push(body.jobId);
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from('share_jobs').select('*').eq('id', body.jobId).single();
    if (error) throw error;
    if (TERMINAL.has(String(data.status))) {
      const [{ data: media, error: mediaError }, { data: agentRuns, error: agentError }] = await Promise.all([
        admin.from('share_media_tasks').select('id,task_kind,status,model_calls').eq('share_job_id', body.jobId),
        admin.from('share_agent_runs').select('id').eq('user_id', identity.userId).gte('created_at', submittedAt),
      ]);
      if (mediaError ?? agentError) throw mediaError ?? agentError;
      return { job: data, media: media ?? [], agentRuns: agentRuns ?? [] };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${fixture} timed out`);
}

async function seedAnswer(admin: SupabaseClient, sourceUrl: string, placeId: string, slotKey: string, note: string) {
  const identity = canonicalContentIdentity(sourceUrl);
  assert.ok(identity);
  const { count, error: countError } = await admin.from('recognition_source_states')
    .select('*', { count: 'exact', head: true }).eq('identity_key', identity.key);
  if (countError) throw countError;
  assert.equal(count, 0, `refusing to overwrite Production V2 state for ${identity.key}`);
  const fingerprint = `controlled-production-frozen-evidence:${identity.contentId}`;
  const { error: stateError } = await admin.from('recognition_source_states').insert({
    identity_key: identity.key, platform: identity.platform, content_id: identity.contentId,
    canonical_url: identity.canonicalUrl, identity_version: identity.identityVersion,
    source_fingerprint: fingerprint, evidence_revision: 1, feedback_revision: 0,
    policy_version: RECOGNITION_CACHE_POLICY_VERSION, recognition_version: RECOGNITION_VERSION,
    state: 'ELIGIBLE', visibility_scope: 'public', source_ai_note: note,
  });
  if (stateError) throw stateError;
  const { data: answer, error: answerError } = await admin.from('recognition_cache_answers_v2').insert({
    identity_key: identity.key, slot_key: slotKey, place_id: placeId, state: 'ELIGIBLE',
    answer_revision: 1, feedback_revision: 0, evidence_revision: 1,
    policy_version: RECOGNITION_CACHE_POLICY_VERSION, recognition_version: RECOGNITION_VERSION,
    source_fingerprint: fingerprint, specificity: 'exact', terminal_status: 'success',
    semantic_check_passed: true, geographic_check_passed: true, evidence_sufficient: true,
    strong_contradiction: false, evidence_summary: { fixture: 'controlled_production_frozen_response' },
    saved_category: 'restaurant', saved_category_source: 'google_primary_type', saved_category_confidence: 1,
    saved_category_model_version: 'nearr-category-2026-08-13.v3', validated_feedback_revision: 0,
    last_validated_at: new Date().toISOString(),
  }).select('id').single();
  if (answerError || !answer) throw answerError ?? new Error('answer seed returned no row');
  return { identity, answerId: answer.id };
}

async function correct(
  admin: SupabaseClient,
  supabaseUrl: string,
  apiKey: string,
  owner: SmokeIdentity,
  savedPlaceId: string,
  replacement: Place,
  idempotencyKey: string,
) {
  const ownerClient = createClient(supabaseUrl, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${owner.accessToken}` } },
  });
  const { data: saved, error: savedError } = await admin.from('saved_places').select('category').eq('id', savedPlaceId).single();
  if (savedError) throw savedError;
  const { error } = await ownerClient.rpc('correct_saved_place_provider_v2', {
    p_saved_place_id: savedPlaceId, p_place_id: replacement.id,
    p_corrected_google_place_id: replacement.google_place_id,
    p_category: saved.category ?? 'restaurant', p_category_source: 'google_primary_type',
    p_category_confidence: 1, p_category_model_version: RECOGNITION_CACHE_POLICY_VERSION,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  const { data: immediate, error: immediateError } = await admin.from('saved_places')
    .select('place_id').eq('id', savedPlaceId).single();
  if (immediateError) throw immediateError;
  assert.equal(immediate.place_id, replacement.id);
}

async function waitForRevalidation(admin: SupabaseClient, identityKey: string) {
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from('recognition_revalidation_tasks').select('*')
      .eq('identity_key', identityKey).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (data && ['COMPLETED', 'FAILED', 'STALE'].includes(String(data.state))) return data;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error('revalidation timed out');
}

async function wallet(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from('place_find_wallets').select('*').eq('user_id', userId).limit(1);
  if (error) throw error;
  const row = data?.[0];
  return { present: !!row, available: Number(row?.available_uses ?? 0), reserved: Number(row?.reserved_uses ?? 0), version: Number(row?.version ?? 0) };
}

async function main(): Promise<void> {
  assert.equal(process.env.NEARR_CACHE_V2_PRODUCTION_SMOKE, ACK, 'production smoke acknowledgment missing');
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  assert.equal(refOf(supabaseUrl), TARGET_REF, 'refusing unexpected Production target');
  assert.ok(serviceRoleKey, 'missing Production service role key');
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const runKey = `nearr-prod-cache-v2-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const users: SmokeIdentity[] = [];
  const jobIds: string[] = [];
  const controlledKeys: string[] = [];
  try {
    const { data: places, error: placeError } = await admin.from('places').select('id,google_place_id,name')
      .in('google_place_id', ['ChIJ3dEbnTMh3YARhAvz8VeCxJg', 'ChIJE5pV1UMh3YARIhsItpUt0K8']);
    if (placeError) throw placeError;
    const capone = places?.find((row: Place) => /Capone/.test(row.name)) as Place | undefined;
    const secondFloor = places?.find((row: Place) => /2nd Floor/.test(row.name)) as Place | undefined;
    assert.ok(capone && secondFloor, 'controlled canonical places are missing');
    for (let i = 0; i < 3; i += 1) users.push(await createIdentity(admin, supabaseUrl, serviceRoleKey, runKey));
    const walletSetup = await Promise.all(users.map((user) => admin.rpc('ensure_place_find_wallet', {
      p_user_id: user.userId, p_is_anonymous: false,
    })));
    const walletSetupError = walletSetup.find((result) => result.error)?.error;
    if (walletSetupError) throw walletSetupError;
    const walletsBefore = await Promise.all(users.map((user) => wallet(admin, user.userId)));

    const seeded = await seedAnswer(admin, H01, capone.id, 'media-primary', 'Controlled source-grounded Production V2 note.');
    controlledKeys.push(seeded.identity.key);
    const oldRead = await admin.rpc('read_recognition_answers_v2', {
      p_identity_key: seeded.identity.key, p_identity_version: seeded.identity.identityVersion,
      p_policy_version: RECOGNITION_CACHE_POLICY_VERSION, p_recognition_version: RECOGNITION_VERSION,
      p_user_id: users[1].userId,
    });
    if (oldRead.error) throw oldRead.error;
    assert.equal(oldRead.data?.length, 1);
    const wrongHit = await submit(admin, supabaseUrl, serviceRoleKey, users[0], runKey, 'wrong-cache-hit', H01, jobIds);
    assert.equal(wrongHit.job.extraction_payload?.recognitionCache?.hit, true);
    assert.equal(wrongHit.media.length, 0);
    assert.equal(wrongHit.agentRuns.length, 0);
    await correct(admin, supabaseUrl, serviceRoleKey, users[0], wrongHit.job.saved_place_id, secondFloor,
      `${runKey}:correction-agree`);
    const stale = await admin.rpc('commit_recognition_cache_save_v2', {
      p_user_id: users[1].userId, p_identity_key: seeded.identity.key,
      p_answer_ids: [oldRead.data[0].answer_id], p_expected_feedback_revision: 0,
      p_policy_version: RECOGNITION_CACHE_POLICY_VERSION, p_recognition_version: RECOGNITION_VERSION,
    });
    const staleRejected = stale.error?.code === 'P0001' && stale.error.message === 'recognition_cache_stale';
    assert.ok(staleRejected || (!stale.error && (stale.data?.length ?? 0) === 0),
      `stale cache read was not rejected: ${stale.error?.code ?? 'unexpected rows'}`);
    const quarantinedRead = await admin.rpc('read_recognition_answers_v2', {
      p_identity_key: seeded.identity.key, p_identity_version: seeded.identity.identityVersion,
      p_policy_version: RECOGNITION_CACHE_POLICY_VERSION, p_recognition_version: RECOGNITION_VERSION,
      p_user_id: users[1].userId,
    });
    if (quarantinedRead.error) throw quarantinedRead.error;
    assert.equal(quarantinedRead.data?.length ?? 0, 0);
    const revalidation = await waitForRevalidation(admin, seeded.identity.key);
    assert.equal(revalidation.decision, 'AGREES_WITH_REPLACEMENT');
    const replacementHit = await submit(admin, supabaseUrl, serviceRoleKey, users[1], runKey, 'replacement-hit', H01, jobIds);
    assert.equal(replacementHit.job.extraction_payload?.recognitionCache?.hit, true);
    assert.equal(replacementHit.media.length, 0);
    assert.equal(replacementHit.agentRuns.length, 0);
    assert.notEqual(replacementHit.job.saved_place_id, wrongHit.job.saved_place_id);
    const { data: replacementSource, error: sourceError } = await admin.from('saved_place_sources')
      .select('canonical_url,ai_note').eq('saved_place_id', replacementHit.job.saved_place_id).limit(1).single();
    if (sourceError) throw sourceError;
    assert.ok(replacementSource.canonical_url);
    assert.equal(replacementSource.ai_note, 'Controlled source-grounded Production V2 note.');

    const multiIdentity = canonicalContentIdentity(MULTI);
    assert.ok(multiIdentity);
    controlledKeys.push(multiIdentity.key);
    const multiFingerprint = 'controlled-production-multi-evidence';
    const thirdPlace = (await admin.from('places').select('id,google_place_id,name').not('google_place_id', 'is', null)
      .neq('id', capone.id).neq('id', secondFloor.id).limit(1)).data?.[0] as Place | undefined;
    assert.ok(thirdPlace);
    const { error: multiStateError } = await admin.from('recognition_source_states').insert({
      identity_key: multiIdentity.key, platform: multiIdentity.platform, content_id: multiIdentity.contentId,
      canonical_url: multiIdentity.canonicalUrl, identity_version: multiIdentity.identityVersion,
      source_fingerprint: multiFingerprint, policy_version: RECOGNITION_CACHE_POLICY_VERSION,
      recognition_version: RECOGNITION_VERSION, state: 'ELIGIBLE', visibility_scope: 'public',
    });
    if (multiStateError) throw multiStateError;
    const answerBase = {
      identity_key: multiIdentity.key, state: 'ELIGIBLE', answer_revision: 1, feedback_revision: 0,
      evidence_revision: 1, policy_version: RECOGNITION_CACHE_POLICY_VERSION,
      recognition_version: RECOGNITION_VERSION, source_fingerprint: multiFingerprint,
      specificity: 'exact', terminal_status: 'success', semantic_check_passed: true,
      geographic_check_passed: true, evidence_sufficient: true, strong_contradiction: false,
      saved_category: 'other', saved_category_source: 'fallback', saved_category_confidence: 0,
      saved_category_model_version: 'nearr-category-2026-08-13.v3', validated_feedback_revision: 0,
    };
    const { error: multiAnswersError } = await admin.from('recognition_cache_answers_v2').insert([
      { ...answerBase, slot_key: 'destination-a', place_id: capone.id },
      { ...answerBase, slot_key: 'destination-b', place_id: secondFloor.id },
    ]);
    if (multiAnswersError) throw multiAnswersError;
    const multiHit = await submit(admin, supabaseUrl, serviceRoleKey, users[2], runKey, 'multi-hit', MULTI, jobIds);
    assert.equal(multiHit.job.extraction_payload?.recognitionCache?.hit, true);
    const savedIds = multiHit.job.candidate_payload?.savedPlaceIds as string[];
    assert.equal(savedIds.length, 2);
    await correct(admin, supabaseUrl, serviceRoleKey, users[2], savedIds[0], thirdPlace, `${runKey}:multi-correction`);
    const { data: multiAnswers, error: multiReadError } = await admin.from('recognition_cache_answers_v2')
      .select('state').eq('identity_key', multiIdentity.key);
    if (multiReadError) throw multiReadError;
    assert.equal(multiAnswers?.filter((row) => row.state === 'QUARANTINED').length, 1);
    assert.equal(multiAnswers?.filter((row) => row.state === 'ELIGIBLE').length, 1);
    const { data: multiWork, error: multiWorkError } = await admin.from('recognition_revalidation_tasks')
      .select('*').eq('identity_key', multiIdentity.key).single();
    if (multiWorkError) throw multiWorkError;
    const { error: technicalError } = await admin.rpc('complete_recognition_revalidation_v2', {
      p_revalidation_task_id: multiWork.id, p_decision: 'TECHNICAL_FAILURE', p_supported_place_id: null,
      p_diagnostics: { controlled: true, providerRequestMade: false }, p_error_code: 'controlled_acquisition_unavailable',
    });
    if (technicalError) throw technicalError;
    const { count: multiAnswerCount, error: multiCountError } = await admin.from('recognition_cache_answers_v2')
      .select('*', { count: 'exact', head: true }).eq('identity_key', multiIdentity.key);
    if (multiCountError) throw multiCountError;
    assert.equal(multiAnswerCount, 2);

    const [walletsAfter, support, premiumEvents] = await Promise.all([
      Promise.all(users.map((user) => wallet(admin, user.userId))),
      admin.from('recognition_identity_support').select('*', { count: 'exact', head: true })
        .eq('identity_key', seeded.identity.key).eq('support_kind', 'PASSIVE_CACHE_AUTOSAVE'),
      admin.from('analytics_events').select('*', { count: 'exact', head: true }).in('user_id', users.map((user) => user.userId))
        .like('event_name', 'premium_%'),
    ]);
    if (support.error ?? premiumEvents.error) throw support.error ?? premiumEvents.error;
    assert.deepEqual(walletsAfter, walletsBefore);
    assert.equal(support.count ?? 0, 0);
    assert.equal(premiumEvents.count ?? 0, 0);
    console.log(`CACHE_V2_PRODUCTION_SMOKE ${JSON.stringify({
      sources: 2, cacheHits: 3, cacheHitRecognitionModelCalls: 0,
      correctionAppliedImmediately: true, staleCommitPrevented: true,
      quarantineReadCount: 0, freshValidationDecision: revalidation.decision,
      replacementEligibleAndReused: true, independentRecipientSaves: true,
      sourceAndAiNotePreserved: true, multiPlaceSiblingPreserved: true,
      alternativesCountedAsLocations: 0, technicalFailureAnswerCountPreserved: multiAnswerCount,
      passiveCacheSupport: support.count ?? 0, premiumEvents: premiumEvents.count ?? 0,
      walletDelta: 0, revalidationModelCalls: Number(revalidation.diagnostics?.modelCalls ?? 0),
      knownModelCostUsd: Number(revalidation.diagnostics?.totalModelCostUsd ?? 0),
    })}`);
  } finally {
    const cleanupReports = [];
    for (const user of users.reverse()) cleanupReports.push(await cleanupSession(admin, user, jobIds));
    if (controlledKeys.length) {
      await admin.from('recognition_cache_events').delete().in('identity_key', controlledKeys).gte('created_at', startedAt);
      await admin.from('recognition_source_states').delete().in('identity_key', controlledKeys);
    }
    const errors = cleanupReports.flatMap((report) => report.errors);
    console.log(`CACHE_V2_PRODUCTION_CLEANUP ${JSON.stringify({
      usersDeleted: cleanupReports.map((report) => report.userDeleted),
      evidenceObjectsDeleted: cleanupReports.reduce((sum, report) => sum + report.evidenceObjectsDeleted, 0),
      controlledSourceStatesDeleted: controlledKeys.length, errors,
    })}`);
    if (errors.length || cleanupReports.some((report) => !report.userDeleted)) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
