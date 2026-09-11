import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import { pollUntil } from './e2e/poll';
import { cleanupSession, newCorrelationId, openSession, type EphemeralIdentity } from './e2e/session';

const DEV_REF = 'qnfxnmvxpjzfydgudtvs';
const DORSET_URL = 'https://www.instagram.com/reel/C9Z963muLHI/';
const CAPONES_URL = 'https://www.instagram.com/reel/DUWyZkfgbT4/';
const TERMINAL = new Set(['completed', 'needs_help', 'failed', 'cancelled', 'awaiting_purchase']);

type EdgeJob = { jobId: string; status: string; duplicate: boolean; requiresPurchase: boolean };

async function post(config: any, identity: EphemeralIdentity, functionName: string, body: unknown) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${identity.accessToken}`,
      apikey: config.anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as any;
  return { response, payload };
}

async function submit(config: any, identity: EphemeralIdentity, url: string, requestId: string, submissionPath: 'host_app' | 'share_extension'): Promise<EdgeJob> {
  const { response, payload } = await post(config, identity, 'create-share-job', {
    url,
    clientRequestId: requestId,
    submissionPath,
  });
  if (!response.ok || !payload.jobId) throw new Error(`create_failed:${response.status}:${payload.error ?? 'invalid'}`);
  assert.equal(payload.requiresPurchase, false);
  assert.notEqual(payload.status, 'awaiting_purchase');
  return payload as EdgeJob;
}

async function terminal(admin: SupabaseClient, jobId: string): Promise<any> {
  const result = await pollUntil(async () => {
    const { data, error } = await admin
      .from('share_jobs')
      .select('id,user_id,status,billing_mode,billing_outcome,saved_place_id,canonical_url,resolution_source,tutorial_fixture_id,submission_path')
      .eq('id', jobId)
      .single();
    if (error) throw error;
    return data;
  }, (job) => TERMINAL.has(job.status), { timeoutMs: 180_000, intervalMs: 750 });
  if (!result.ok) throw new Error(`job_timeout:${jobId}`);
  return result.value;
}

async function run(): Promise<void> {
  if (process.env.RUN_LIVE_ONBOARDING_CLEAN_PROOF !== '1') throw new Error('live_proof_not_opted_in');
  const root = await openSession({ withIdentity: false, withEdgeSecrets: false });
  assert.equal(root.config.supabaseRef, DEV_REF);

  const authClient = createClient(root.config.supabaseUrl, root.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await authClient.auth.signInAnonymously({
    options: { data: { purpose: 'onb2_07_clean_baseline_proof' } },
  });
  if (signed.error || !signed.data.user || !signed.data.session) throw signed.error ?? new Error('anonymous_session_missing');
  const user = signed.data.user as User;
  assert.equal(user.is_anonymous, true);
  const identity: EphemeralIdentity = {
    userId: user.id,
    email: `${user.id}@anonymous.nearr.invalid`,
    accessToken: signed.data.session.access_token,
  };
  const userClient = createClient(root.config.supabaseUrl, root.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${identity.accessToken}` } },
  });
  const jobIds: string[] = [];

  try {
    const demoFixture = await post(root.config, identity, 'get-onboarding-tutorial', {
      mode: 'demo', preferredPlatform: 'instagram',
    });
    assert.equal(demoFixture.response.status, 200);
    assert.equal(demoFixture.payload.canonicalUrl, DORSET_URL);

    const demoRequestId = `${newCorrelationId()}:dorset`;
    const demoCreated = await submit(root.config, identity, DORSET_URL, demoRequestId, 'host_app');
    jobIds.push(demoCreated.jobId);
    const demo = await terminal(root.admin, demoCreated.jobId);
    assert.equal(demo.status, 'completed');
    assert.equal(demo.billing_mode, 'normal_free');
    assert.equal(demo.billing_outcome, 'unmetered:normal_free');
    assert.equal(demo.resolution_source, 'tutorial_fixture');
    assert.equal(demo.submission_path, 'host_app');
    assert.ok(demo.saved_place_id);

    const onboardingSessionId = randomUUID();
    const checkpoint = await userClient.rpc('upsert_onboarding_v2_session', {
      p_session_id: onboardingSessionId,
      p_revision: 1,
      p_state: { stage: 'practice_ready', proof: 'onb2_07' },
      p_lifecycle: 'anonymous_active',
      p_tutorial_saved_place_id: demo.saved_place_id,
      p_tutorial_source_url: DORSET_URL,
    });
    if (checkpoint.error) throw checkpoint.error;

    const practiceFixture = await post(root.config, identity, 'get-onboarding-tutorial', {
      mode: 'practice', onboardingSessionId, preferredPlatform: 'instagram',
    });
    assert.equal(practiceFixture.response.status, 200);
    assert.equal(practiceFixture.payload.canonicalUrl, CAPONES_URL);
    assert.notEqual(practiceFixture.payload.fixtureId, demo.tutorial_fixture_id);

    const practiceRequestId = `${newCorrelationId()}:capones`;
    const practiceCreated = await submit(root.config, identity, CAPONES_URL, practiceRequestId, 'share_extension');
    jobIds.push(practiceCreated.jobId);
    const practice = await terminal(root.admin, practiceCreated.jobId);
    assert.equal(practice.status, 'completed');
    assert.equal(practice.billing_mode, 'normal_free');
    assert.equal(practice.billing_outcome, 'unmetered:normal_free');
    assert.equal(practice.resolution_source, 'tutorial_fixture');
    assert.equal(practice.submission_path, 'share_extension');
    assert.ok(practice.saved_place_id);
    assert.notEqual(practice.saved_place_id, demo.saved_place_id);

    const exactRetry = await submit(root.config, identity, CAPONES_URL, practiceRequestId, 'share_extension');
    assert.equal(exactRetry.jobId, practiceCreated.jobId);
    assert.equal(exactRetry.duplicate, true);

    const [jobs, saves, wallets, reservations, ledger, pro, entitlements] = await Promise.all([
      root.admin.from('share_jobs').select('id,status,billing_mode,billing_outcome').in('id', jobIds),
      root.admin.from('saved_places').select('id,place_id').eq('user_id', identity.userId),
      root.admin.from('place_find_wallets').select('*', { count: 'exact', head: true }).eq('user_id', identity.userId),
      root.admin.from('place_find_reservations').select('*', { count: 'exact', head: true }).in('share_job_id', jobIds),
      root.admin.from('place_find_ledger').select('*', { count: 'exact', head: true }).in('share_job_id', jobIds),
      root.admin.from('nearr_pro_access').select('*', { count: 'exact', head: true }).eq('user_id', identity.userId),
      root.admin.from('onboarding_practice_entitlements').select('*', { count: 'exact', head: true }).eq('user_id', identity.userId),
    ]);
    for (const result of [jobs, saves, wallets, reservations, ledger, pro, entitlements]) {
      if (result.error) throw result.error;
    }
    assert.equal(jobs.data?.length, 2);
    assert.ok(jobs.data?.every((job) => job.status === 'completed' && job.billing_mode === 'normal_free' && job.billing_outcome === 'unmetered:normal_free'));
    assert.equal(saves.data?.length, 2);
    assert.deepEqual([wallets.count, reservations.count, ledger.count, pro.count, entitlements.count], [0, 0, 0, 0, 0]);

    const reset = await post(root.config, identity, 'reset-onboarding-qa', { mode: 'onboarding_only' });
    assert.equal(reset.response.status, 200);
    assert.equal(reset.payload.ok, true);
    const [sessionsAfterReset, savesAfterReset] = await Promise.all([
      root.admin.from('onboarding_v2_sessions').select('*', { count: 'exact', head: true }).eq('user_id', identity.userId),
      root.admin.from('saved_places').select('*', { count: 'exact', head: true }).eq('user_id', identity.userId),
    ]);
    if (sessionsAfterReset.error || savesAfterReset.error) throw sessionsAfterReset.error ?? savesAfterReset.error;
    assert.equal(sessionsAfterReset.count, 0);
    assert.equal(savesAfterReset.count, 2);

    console.log(JSON.stringify({
      result: 'PASS',
      target: DEV_REF,
      owner: { anonymous: true, userRef: identity.userId.slice(0, 8) },
      demo: { source: DORSET_URL, jobId: demo.id, saveId: demo.saved_place_id, billing: demo.billing_outcome },
      practice: { source: CAPONES_URL, jobId: practice.id, saveId: practice.saved_place_id, billing: practice.billing_outcome },
      totals: { jobs: jobs.data?.length, saves: saves.data?.length },
      monetization: { wallets: 0, reservations: 0, ledgerEntries: 0, proAccess: 0, practiceEntitlements: 0 },
      idempotency: { duplicate: true, sameJob: exactRetry.jobId === practice.id },
      reset: { sessionsRemaining: 0, savesPreserved: 2 },
    }, null, 2));
  } finally {
    const cleanup = await cleanupSession(root.admin, identity, jobIds);
    if (cleanup.errors.length > 0) throw new Error(`proof_cleanup_failed:${cleanup.errors.join('|')}`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
