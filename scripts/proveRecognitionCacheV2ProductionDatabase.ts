import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { canonicalContentIdentity, RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';
import { RECOGNITION_CACHE_POLICY_VERSION } from '../supabase/functions/_shared/recognitionCachePolicy';
import { cleanupSession } from './e2e/session';

const TARGET_REF = 'rlqvxdwtetxsqxhqztkw';
const ACK = 'I_ACKNOWLEDGE_CONTROLLED_PRODUCTION_CACHE_V2_SMOKE';
const SOURCE = 'https://www.instagram.com/reel/NEARRV2PRODMULTI2/';

function refOf(url: string): string | null {
  try { return new URL(url).hostname.split('.')[0] || null; } catch { return null; }
}

async function main(): Promise<void> {
  assert.equal(process.env.NEARR_CACHE_V2_PRODUCTION_SMOKE, ACK);
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim();
  const apiKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  assert.equal(refOf(supabaseUrl), TARGET_REF);
  assert.ok(apiKey);
  const admin = createClient(supabaseUrl, apiKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const identity = canonicalContentIdentity(SOURCE);
  assert.ok(identity);
  const startedAt = new Date().toISOString();
  const runKey = `nearr-prod-cache-v2-db-${randomUUID()}`;
  const password = `Nz!${randomUUID()}${randomBytes(6).toString('hex')}`;
  const email = `${runKey}@nearr.invalid`;
  const jobIds: string[] = [];
  let user: { userId: string; email: string; accessToken: string } | null = null;
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { purpose: 'nearr_production_cache_v2_database_smoke', runKey },
    });
    if (createError || !created.user) throw createError ?? new Error('ephemeral user was not created');
    const auth = createClient(supabaseUrl, apiKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) throw signInError ?? new Error('ephemeral sign-in returned no session');
    user = { userId: created.user.id, email, accessToken: signedIn.session.access_token };
    const owner = createClient(supabaseUrl, apiKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
    });
    const { data: places, error: placesError } = await admin.from('places').select('id,google_place_id,name')
      .not('google_place_id', 'is', null).not('latitude', 'is', null).not('longitude', 'is', null).limit(3);
    if (placesError || places?.length !== 3) throw placesError ?? new Error('three controlled places unavailable');
    const fingerprint = 'controlled-production-multi-evidence-v2';
    const { error: stateError } = await admin.from('recognition_source_states').insert({
      identity_key: identity.key, platform: identity.platform, content_id: identity.contentId,
      canonical_url: identity.canonicalUrl, identity_version: identity.identityVersion,
      source_fingerprint: fingerprint, policy_version: RECOGNITION_CACHE_POLICY_VERSION,
      recognition_version: RECOGNITION_VERSION, state: 'ELIGIBLE', visibility_scope: 'public',
    });
    if (stateError) throw stateError;
    const answerBase = {
      identity_key: identity.key, state: 'ELIGIBLE', answer_revision: 1, feedback_revision: 0,
      evidence_revision: 1, policy_version: RECOGNITION_CACHE_POLICY_VERSION,
      recognition_version: RECOGNITION_VERSION, source_fingerprint: fingerprint,
      specificity: 'exact', terminal_status: 'success', semantic_check_passed: true,
      geographic_check_passed: true, evidence_sufficient: true, strong_contradiction: false,
      saved_category: 'other', saved_category_source: 'fallback', saved_category_confidence: 0,
      saved_category_model_version: 'nearr-category-2026-08-13.v3', validated_feedback_revision: 0,
    };
    const { error: answersError } = await admin.from('recognition_cache_answers_v2').insert([
      { ...answerBase, slot_key: 'destination-a', place_id: places[0].id },
      { ...answerBase, slot_key: 'destination-b', place_id: places[1].id },
    ]);
    if (answersError) throw answersError;
    const { data: walletBefore, error: walletBeforeError } = await admin.from('place_find_wallets')
      .select('available_uses,reserved_uses,version').eq('user_id', user.userId).limit(1);
    if (walletBeforeError) throw walletBeforeError;

    const response = await fetch(`${supabaseUrl}/functions/v1/create-share-job`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.accessToken}`, apikey: apiKey },
      body: JSON.stringify({ url: SOURCE, clientRequestId: `${runKey}:multi-hit` }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json() as { jobId?: string; error?: string };
    if (!response.ok || !body.jobId) throw new Error(`create-share-job failed: ${response.status}:${body.error ?? 'no id'}`);
    jobIds.push(body.jobId);
    const deadline = Date.now() + 120_000;
    let job: Record<string, any> | null = null;
    while (Date.now() < deadline) {
      const read = await admin.from('share_jobs').select('*').eq('id', body.jobId).single();
      if (read.error) throw read.error;
      job = read.data;
      if (['completed', 'needs_help', 'failed'].includes(String(job?.status))) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    assert.equal(job?.status, 'completed');
    assert.equal(job?.extraction_payload?.recognitionCache?.hit, true);
    const savedIds = job?.candidate_payload?.savedPlaceIds as string[];
    assert.equal(savedIds.length, 2);
    const { count: mediaCount, error: mediaError } = await admin.from('share_media_tasks')
      .select('*', { count: 'exact', head: true }).eq('share_job_id', body.jobId);
    if (mediaError) throw mediaError;
    assert.equal(mediaCount, 0);

    const { error: correctionError } = await owner.rpc('correct_saved_place_provider_v2', {
      p_saved_place_id: savedIds[0], p_place_id: places[2].id,
      p_corrected_google_place_id: places[2].google_place_id, p_category: 'other',
      p_category_source: 'fallback', p_category_confidence: 0,
      p_category_model_version: RECOGNITION_CACHE_POLICY_VERSION,
      p_idempotency_key: `${runKey}:correction`,
    });
    if (correctionError) throw correctionError;
    const { data: work, error: workError } = await admin.from('recognition_revalidation_tasks')
      .select('*').eq('identity_key', identity.key).single();
    if (workError) throw workError;
    const completion = await admin.rpc('complete_recognition_revalidation_v2', {
      p_revalidation_task_id: work.id, p_decision: 'TECHNICAL_FAILURE', p_supported_place_id: null,
      p_diagnostics: { controlled: true, providerRequestMade: false },
      p_error_code: 'controlled_acquisition_unavailable',
    });
    if (completion.error) throw completion.error;
    const [{ data: sourceState, error: sourceError }, { data: answers, error: answerReadError }] = await Promise.all([
      admin.from('recognition_source_states').select('*').eq('identity_key', identity.key).single(),
      admin.from('recognition_cache_answers_v2').select('state,feedback_revision,validated_feedback_revision')
        .eq('identity_key', identity.key),
    ]);
    if (sourceError ?? answerReadError) throw sourceError ?? answerReadError;
    assert.equal(sourceState.whole_source_quarantined, false);
    assert.equal(answers?.filter((row) => row.state === 'QUARANTINED').length, 1);
    assert.equal(answers?.filter((row) => row.state === 'ELIGIBLE').length, 1);
    const sibling = answers?.find((row) => row.state === 'ELIGIBLE');
    assert.equal(sibling?.feedback_revision, 1);
    assert.equal(sibling?.validated_feedback_revision, 1);
    const [{ count: answerCount, error: countError }, { data: walletAfter, error: walletAfterError },
      { count: premiumCount, error: premiumError }] = await Promise.all([
      admin.from('recognition_cache_answers_v2').select('*', { count: 'exact', head: true }).eq('identity_key', identity.key),
      admin.from('place_find_wallets').select('available_uses,reserved_uses,version').eq('user_id', user.userId).limit(1),
      admin.from('analytics_events').select('*', { count: 'exact', head: true }).eq('user_id', user.userId).like('event_name', 'premium_%'),
    ]);
    if (countError ?? walletAfterError ?? premiumError) throw countError ?? walletAfterError ?? premiumError;
    assert.equal(answerCount, 2);
    assert.deepEqual(walletAfter, walletBefore);
    assert.equal(premiumCount ?? 0, 0);
    console.log(`CACHE_V2_PRODUCTION_DATABASE ${JSON.stringify({
      cacheHit: true, savedPlaceCount: 2, recognitionModelCallsOnHit: 0,
      correctedSlotQuarantined: true, siblingEligibleAtCurrentRevision: true,
      alternativesCountedAsLocations: 0, technicalFailureDisposition: completion.data,
      answerCountBeforeAndAfterTechnicalFailure: 2, paidModelCalls: 0,
      walletDelta: 0, premiumEvents: 0,
    })}`);
  } finally {
    const cleanup = await cleanupSession(admin, user, jobIds);
    await admin.from('recognition_cache_events').delete().eq('identity_key', identity.key).gte('created_at', startedAt);
    await admin.from('recognition_source_states').delete().eq('identity_key', identity.key);
    console.log(`CACHE_V2_PRODUCTION_DATABASE_CLEANUP ${JSON.stringify({
      userDeleted: cleanup.userDeleted, evidenceObjectsDeleted: cleanup.evidenceObjectsDeleted, errors: cleanup.errors,
    })}`);
    if (user && (!cleanup.userDeleted || cleanup.errors.length)) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
