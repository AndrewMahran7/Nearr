import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { canonicalContentIdentity } from '../lib/shareAgent/contentIdentity';
import { pollUntil } from './e2e/poll';
import { openSession } from './e2e/session';

const SOURCE_URL = 'https://www.instagram.com/reel/DUWyZkfgbT4/';
const TARGET_REF = 'qnfxnmvxpjzfydgudtvs';
const TERMINAL = new Set(['completed', 'needs_help', 'failed', 'cancelled']);

async function main(): Promise<void> {
  assert.equal(process.argv[2], 'cold', 'usage: proveRecognitionCacheV2Dev.ts cold');
  const startedAt = new Date().toISOString();
  const identity = canonicalContentIdentity(SOURCE_URL);
  assert.ok(identity);
  const session = await openSession({ withIdentity: true });
  assert.equal(session.config.supabaseRef, TARGET_REF);
  const userId = session.identity!.userId;
  let jobId = '';
  try {
    const { data: existing, error: existingError } = await session.admin
      .from('recognition_source_states').select('identity_key').eq('identity_key', identity.key);
    if (existingError) throw existingError;
    assert.equal(existing?.length ?? 0, 0, 'controlled source already has V2 state; refusing to overwrite it');

    const { data: job, error: jobError } = await session.admin.from('share_jobs').insert({
      user_id: userId,
      source_url: SOURCE_URL,
      canonical_url: identity.canonicalUrl,
      source_platform: identity.platform,
      recognition_identity_key: identity.key,
      recognition_content_id: identity.contentId,
      recognition_identity_version: identity.identityVersion,
      status: 'processing_metadata',
      progress_stage: 'checking_video',
      idempotency_key: `nearr-cache-v2-cold-${randomUUID()}`,
      billing_mode: 'normal_free',
      billing_outcome: 'unmetered:normal_free',
      locked_until: null,
    }).select('id').single();
    if (jobError || !job) throw new Error(`cold job insert failed: ${jobError?.message ?? 'unknown'}`);
    jobId = job.id;
    session.trackedJobIds.push(jobId);
    const { error: taskError } = await session.admin.from('share_media_tasks').insert({
      share_job_id: jobId,
      user_id: userId,
      source_url: SOURCE_URL,
      canonical_url: identity.canonicalUrl,
      platform: identity.platform,
      status: 'queued',
      progress_stage: 'queued',
      max_attempts: 1,
    });
    if (taskError) throw new Error(`cold media task insert failed: ${taskError.message}`);

    const terminal = await pollUntil<Record<string, any>>(
      async () => {
        const { data, error } = await session.admin.from('share_jobs').select('*').eq('id', jobId).single();
        if (error) throw error;
        return data;
      },
      (row) => TERMINAL.has(String(row.status)),
      { timeoutMs: 12 * 60_000, intervalMs: 3_000 },
    );
    assert.ok(terminal.ok, 'cold recognition timed out');
    assert.equal(terminal.value.status, 'completed');
    assert.equal(terminal.value.decision, 'auto_save');
    assert.ok(terminal.value.saved_place_id);

    const [{ data: task, error: taskReadError }, { data: run, error: runError },
      { data: state, error: stateError }, { data: answers, error: answersError },
      { data: results, error: resultsError }] = await Promise.all([
      session.admin.from('share_media_tasks').select('*').eq('share_job_id', jobId).single(),
      session.admin.from('share_media_runs').select('*').eq('share_job_id', jobId).single(),
      session.admin.from('recognition_source_states').select('*').eq('identity_key', identity.key).maybeSingle(),
      session.admin.from('recognition_cache_answers_v2').select('*').eq('identity_key', identity.key),
      session.admin.from('share_job_place_results').select('*').eq('share_job_id', jobId),
    ]);
    const firstError = taskReadError ?? runError ?? stateError ?? answersError ?? resultsError;
    if (firstError) throw firstError;
    assert.equal(task.status, 'completed');
    assert.equal(state === null, (answers?.length ?? 0) === 0,
      'source state and admitted answers must be created together');
    if (state) {
      assert.equal(state.state, 'ELIGIBLE');
      assert.ok(answers!.every((answer: any) => answer.state === 'ELIGIBLE'));
    }
    assert.ok((results ?? []).some((row: any) => row.result_role === 'primary' && row.outcome === 'auto_saved'));
    console.log(`CACHE_V2_DEV_COLD ${JSON.stringify({
      sourceIdentity: identity.key,
      jobStatus: terminal.value.status,
      jobDecision: terminal.value.decision,
      mediaStatus: task.status,
      modelProvider: run.model_provider,
      modelCalls: Number(task.model_calls ?? 0),
      solInvoked: run.sol_invoked === true,
      knownModelCostUsd: run.total_model_cost_usd ?? null,
      admittedToCache: state !== null,
      answerCount: answers!.length,
      sourceState: state?.state ?? null,
      feedbackRevision: state?.feedback_revision ?? null,
      evidenceRevision: state?.evidence_revision ?? null,
    })}`);
  } finally {
    await session.admin.from('recognition_cache_events').delete()
      .eq('identity_key', identity.key).gte('created_at', startedAt);
    const cleanup = await session.cleanup();
    console.log(`CACHE_V2_DEV_COLD_CLEANUP ${JSON.stringify({
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
