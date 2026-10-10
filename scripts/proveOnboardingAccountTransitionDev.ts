import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import {
  createEphemeralIdentity,
  newCorrelationId,
  openSession,
  type EphemeralIdentity,
} from './e2e/session';
import type { DeployedConfig } from './e2e/config';

const DEV_REF = 'qnfxnmvxpjzfydgudtvs';

type Scenario = {
  label: string;
  destinationEstablished: boolean;
  realSaveCount: 0 | 1;
};

async function createAnonymous(config: DeployedConfig): Promise<EphemeralIdentity> {
  const auth = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await auth.auth.signInAnonymously({
    options: { data: { purpose: 'onboarding_account_transition_regression' } },
  });
  if (result.error || !result.data.user || !result.data.session) {
    throw result.error ?? new Error('anonymous_session_missing');
  }
  const user = result.data.user as User;
  return {
    userId: user.id,
    email: `${user.id}@anonymous.nearr.invalid`,
    accessToken: result.data.session.access_token,
  };
}

function scopedClient(config: DeployedConfig, identity: EphemeralIdentity): SupabaseClient {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${identity.accessToken}` } },
  });
}

async function runScenario(
  root: Awaited<ReturnType<typeof openSession>>,
  scenario: Scenario,
  expectFailure: boolean,
) {
  const anonymous = await createAnonymous(root.config);
  let permanent: EphemeralIdentity | null = scenario.destinationEstablished
    ? await createEphemeralIdentity(root.admin, root.config, newCorrelationId(), {
        purpose: 'onboarding_account_transition_regression',
      })
    : null;
  let placeId: string | null = null;
  const anonymousClient = scopedClient(root.config, anonymous);
  const onboardingSessionId = randomUUID();
  const transferSecret = `${randomUUID()}${randomUUID()}`;
  const sourceUrl = `https://example.com/nearr-transition-${randomUUID()}`;

  try {
    const checkpoint = await anonymousClient.rpc('upsert_onboarding_v2_session', {
      p_session_id: onboardingSessionId,
      p_revision: 1,
      p_state: {
        stage: 'account_required',
        identityLifecycle: 'anonymous_active',
        independentSaveCount: scenario.realSaveCount,
        proof: 'account_transition_media_task',
      },
      p_lifecycle: 'anonymous_active',
      p_tutorial_saved_place_id: null,
      p_tutorial_source_url: 'onboarding://local-scripted-fixture',
    });
    if (checkpoint.error) throw checkpoint.error;

    if (scenario.realSaveCount === 1) {
      const place = await root.admin.from('places').insert({
        google_place_id: `nearr-transition-${randomUUID()}`,
        name: 'Account transition regression place',
        formatted_address: 'Development fixture',
        latitude: 0,
        longitude: 0,
      }).select('id').single();
      if (place.error || !place.data) throw place.error ?? new Error('place_fixture_missing');
      placeId = place.data.id;
      const save = await root.admin.from('saved_places').insert({
        user_id: anonymous.userId,
        place_id: placeId,
        source_type: 'link',
        source_url: sourceUrl,
      });
      if (save.error) throw save.error;
    }

    const job = await root.admin.from('share_jobs').insert({
      user_id: anonymous.userId,
      source_url: sourceUrl,
      canonical_url: sourceUrl,
      source_platform: 'unknown',
      status: 'needs_help',
      progress_stage: 'single',
      decision: 'manual_fallback',
      needs_help_reason: 'regression_fixture',
    }).select('id').single();
    if (job.error || !job.data) throw job.error ?? new Error('job_fixture_missing');

    const task = await root.admin.from('share_media_tasks').insert({
      share_job_id: job.data.id,
      user_id: anonymous.userId,
      source_url: sourceUrl,
      canonical_url: sourceUrl,
      platform: 'unknown',
      status: 'needs_help',
      task_kind: 'recognition',
    }).select('id').single();
    if (task.error || !task.data) throw task.error ?? new Error('task_fixture_missing');

    const grant = await anonymousClient.rpc('begin_onboarding_account_transfer_v2', {
      p_onboarding_session_id: onboardingSessionId,
      p_transfer_secret: transferSecret,
    });
    if (grant.error) throw grant.error;

    if (!permanent) {
      permanent = await createEphemeralIdentity(root.admin, root.config, newCorrelationId(), {
        purpose: 'onboarding_account_transition_regression',
      });
    }
    const permanentClient = scopedClient(root.config, permanent);
    const completion = await permanentClient.rpc('complete_onboarding_account_transfer_v2', {
      p_transfer_secret: transferSecret,
    });

    if (expectFailure) {
      assert.ok(completion.error);
      assert.match(completion.error?.message ?? '', /owner .* does not match parent job owner|owner mismatch/i);
      return {
        label: scenario.label,
        result: 'EXPECTED_FAILURE_REPRODUCED',
        failureClass: 'share_media_task_parent_owner_order',
      };
    }

    if (completion.error) throw completion.error;
    assert.equal(completion.data?.destination_was_established, scenario.destinationEstablished);
    assert.equal(completion.data?.transferred_saved_place_count, scenario.realSaveCount);
    assert.equal(completion.data?.tutorial_saved_place_id, null);
    assert.equal(completion.data?.replayed, false);

    const [movedJob, movedTask, movedSession] = await Promise.all([
      root.admin.from('share_jobs').select('user_id').eq('id', job.data.id).single(),
      root.admin.from('share_media_tasks').select('user_id').eq('id', task.data.id).single(),
      root.admin.from('onboarding_v2_sessions').select('user_id,lifecycle').eq('id', onboardingSessionId).single(),
    ]);
    for (const result of [movedJob, movedTask, movedSession]) {
      if (result.error) throw result.error;
    }
    assert.equal(movedJob.data?.user_id, permanent.userId);
    assert.equal(movedTask.data?.user_id, permanent.userId);
    assert.equal(movedSession.data?.user_id, permanent.userId);
    assert.equal(movedSession.data?.lifecycle, 'permanent_account');

    const replay = await permanentClient.rpc('complete_onboarding_account_transfer_v2', {
      p_transfer_secret: transferSecret,
    });
    if (replay.error) throw replay.error;
    assert.equal(replay.data?.replayed, true);

    return {
      label: scenario.label,
      result: 'PASS',
      destinationEstablished: scenario.destinationEstablished,
      transferredSavedPlaces: completion.data?.transferred_saved_place_count,
      parentAndTaskOwnerMatch: true,
      replayedIdempotently: true,
    };
  } finally {
    const deletionErrors: string[] = [];
    for (const identity of [anonymous, permanent].filter(Boolean) as EphemeralIdentity[]) {
      const deleted = await root.admin.auth.admin.deleteUser(identity.userId);
      if (deleted.error && !/not found/i.test(deleted.error.message)) deletionErrors.push(deleted.error.message);
    }
    if (placeId) {
      const placeDelete = await root.admin.from('places').delete().eq('id', placeId);
      if (placeDelete.error) deletionErrors.push(placeDelete.error.message);
    }
    if (deletionErrors.length > 0) throw new Error(`proof_cleanup_failed:${deletionErrors.join('|')}`);
  }
}

async function main() {
  if (process.env.RUN_LIVE_ONBOARDING_ACCOUNT_TRANSITION !== '1') {
    throw new Error('live_account_transition_proof_not_opted_in');
  }
  const expectFailure = process.env.EXPECT_ONBOARDING_ACCOUNT_TRANSITION_FAILURE === '1';
  const root = await openSession({ withIdentity: false, withEdgeSecrets: false });
  assert.equal(root.config.supabaseRef, DEV_REF);

  const scenarios: Scenario[] = expectFailure
    ? [{ label: 'founder-shape', destinationEstablished: true, realSaveCount: 0 }]
    : [
        { label: 'founder-shape', destinationEstablished: true, realSaveCount: 0 },
        { label: 'new-identity-zero-save', destinationEstablished: false, realSaveCount: 0 },
        { label: 'new-identity-one-real-save', destinationEstablished: false, realSaveCount: 1 },
      ];
  const results = [];
  for (const scenario of scenarios) results.push(await runScenario(root, scenario, expectFailure));
  console.log(JSON.stringify({
    result: expectFailure ? 'EXPECTED_FAILURE_REPRODUCED' : 'PASS',
    target: DEV_REF,
    scenarios: results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
