import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { openSession } from './e2e/session';

const TARGET_REF = 'qnfxnmvxpjzfydgudtvs';

type Created = {
  job_id: string;
  status: string;
  duplicate: boolean;
};

async function main(): Promise<void> {
  const session = await openSession({ withIdentity: true, withEdgeSecrets: false });
  assert.equal(session.config.supabaseRef, TARGET_REF);
  assert.ok(session.identity);
  const identity = session.identity!;
  const owner = createClient(session.config.supabaseUrl, session.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${identity.accessToken}` } },
  });
  const sourceUrl = `https://example.com/nearr-reconciliation/${randomUUID()}`;
  const normalArgs = (requestId: string) => ({
    p_user_id: identity.userId,
    p_source_url: sourceUrl,
    p_canonical_url: sourceUrl,
    p_source_platform: 'genericWeb',
    p_idempotency_key: requestId,
    p_dedupe_window_seconds: 90,
    p_is_anonymous: false,
    p_force_rerun: true,
  });
  const createNormal = async (requestId: string): Promise<Created> => {
    const { data, error } = await session.admin.rpc('create_share_job_for_user', normalArgs(requestId));
    if (error || !Array.isArray(data) || !data[0]) throw error ?? new Error('normal_rpc_no_row');
    session.trackedJobIds.push(data[0].job_id);
    return data[0] as Created;
  };
  const qualificationArgs = (requestId: string) => ({
    p_user_id: identity.userId,
    p_source_url: sourceUrl,
    p_canonical_url: sourceUrl,
    p_source_platform: 'genericWeb',
    p_idempotency_key: requestId,
  });
  const createQualification = async (requestId: string): Promise<Created> => {
    const { data, error } = await session.admin.rpc(
      'create_dev_qualification_share_job_for_user',
      qualificationArgs(requestId),
    );
    if (error || !Array.isArray(data) || !data[0]) throw error ?? new Error('qualification_rpc_no_row');
    session.trackedJobIds.push(data[0].job_id);
    return data[0] as Created;
  };

  try {
    const requestA = `normal-a-${randomUUID()}`;
    const requestB = `normal-b-${randomUUID()}`;
    const requestC = `normal-c-${randomUUID()}`;
    const first = await createNormal(requestA);
    const exactRetry = await createNormal(requestA);
    const activeDuplicate = await createNormal(requestB);
    assert.equal(first.duplicate, false);
    assert.equal(exactRetry.job_id, first.job_id);
    assert.equal(exactRetry.duplicate, true);
    assert.equal(activeDuplicate.job_id, first.job_id);
    assert.equal(activeDuplicate.duplicate, true);

    const { data: cancelled, error: cancelError } = await owner.rpc('cancel_share_job', {
      p_job_id: first.job_id,
    });
    if (cancelError) throw cancelError;
    assert.equal(cancelled, true, 'controlled normal job could not be moved terminal');
    const later = await createNormal(requestC);
    assert.notEqual(later.job_id, first.job_id);
    assert.equal(later.duplicate, false);

    const qualificationA = `qualification-a-${randomUUID()}`;
    const qualificationB = `qualification-b-${randomUUID()}`;
    const qFirst = await createQualification(qualificationA);
    const qRetry = await createQualification(qualificationA);
    const qFresh = await createQualification(qualificationB);
    assert.equal(qFirst.duplicate, false);
    assert.equal(qRetry.job_id, qFirst.job_id);
    assert.equal(qRetry.duplicate, true);
    assert.notEqual(qFresh.job_id, qFirst.job_id);
    assert.equal(qFresh.duplicate, false);

    const { data: modes, error: modesError } = await session.admin
      .from('share_jobs')
      .select('id,recognition_run_mode')
      .in('id', [first.job_id, later.job_id, qFirst.job_id, qFresh.job_id]);
    if (modesError) throw modesError;
    assert.equal(modes?.filter((row) => row.recognition_run_mode === 'normal').length, 2);
    assert.equal(modes?.filter((row) => row.recognition_run_mode === 'qualification_fresh').length, 2);

    console.log(`DEVELOPMENT_JOB_CONTRACT ${JSON.stringify({
      exactRetry: { firstJobId: first.job_id, retryJobId: exactRetry.job_id, duplicate: exactRetry.duplicate },
      activeSameSource: { firstJobId: first.job_id, duplicateJobId: activeDuplicate.job_id, duplicate: activeDuplicate.duplicate },
      laterFresh: { terminalJobId: first.job_id, newJobId: later.job_id, duplicate: later.duplicate },
      qualification: {
        firstJobId: qFirst.job_id,
        retryJobId: qRetry.job_id,
        freshJobId: qFresh.job_id,
        retryDuplicate: qRetry.duplicate,
        freshDuplicate: qFresh.duplicate,
      },
    })}`);
  } finally {
    const cleanup = await session.cleanup();
    console.log(`DEVELOPMENT_JOB_CONTRACT_CLEANUP ${JSON.stringify({
      userDeleted: cleanup.userDeleted,
      diagnosticsDeleted: cleanup.diagnosticsDeleted,
      evidenceObjectsDeleted: cleanup.evidenceObjectsDeleted,
      errors: cleanup.errors,
    })}`);
    if (!cleanup.userDeleted || cleanup.errors.length > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
