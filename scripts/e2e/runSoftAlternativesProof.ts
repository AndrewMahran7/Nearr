import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { cleanupSession } from './session';

const target = process.env.NEARR_AUTOMATIC_COMPLETION_SMOKE_TARGET === 'development' ? 'development' : 'production';
const expectedRef = target === 'development' ? 'qnfxnmvxpjzfydgudtvs' : 'rlqvxdwtetxsqxhqztkw';
const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

async function main(): Promise<void> {
  if (new URL(supabaseUrl).hostname.split('.')[0] !== expectedRef || !serviceRoleKey) {
    throw new Error(`refusing unexpected ${target} target`);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const runId = `soft-alternatives-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `${runId}@nearr.invalid`;
  const password = `Nz!${randomUUID()}${randomBytes(6).toString('hex')}`;
  let identity: { userId: string; email: string; accessToken: string } | null = null;
  const jobIds: string[] = [];
  const placeIds: string[] = [];
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) throw new Error(createError?.message ?? 'user_create_failed');
    const signin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signed, error: signError } = await signin.auth.signInWithPassword({ email, password });
    if (signError || !signed.session) throw new Error(signError?.message ?? 'signin_failed');
    identity = { userId: created.user.id, email, accessToken: signed.session.access_token };

    const { data: job, error: jobError } = await admin.from('share_jobs').insert({
      user_id: identity.userId, source_url: 'https://example.com/soft-alternatives-proof',
      canonical_url: 'https://example.com/soft-alternatives-proof', source_platform: 'link',
      status: 'processing_metadata', progress_stage: 'checking_video', idempotency_key: runId,
    }).select('id').single();
    if (jobError || !job) throw new Error(jobError?.message ?? 'job_insert_failed');
    jobIds.push(job.id);
    const { data: task, error: taskError } = await admin.from('share_media_tasks').insert({
      share_job_id: job.id, user_id: identity.userId, source_url: 'https://example.com/soft-alternatives-proof',
      canonical_url: 'https://example.com/soft-alternatives-proof', platform: 'link', status: 'processing', progress_stage: 'verifying_place',
    }).select('id').single();
    if (taskError || !task) throw new Error(taskError?.message ?? 'task_insert_failed');
    const { data: run, error: runError } = await admin.from('share_media_runs').insert({
      share_media_task_id: task.id, share_job_id: job.id, user_id: identity.userId, platform: 'link',
    }).select('id').single();
    if (runError || !run) throw new Error(runError?.message ?? 'run_insert_failed');

    const primaryProviderId = `${runId}-primary`;
    const { data: primary, error: primaryError } = await admin.rpc('auto_save_share_job_place_result', {
      p_share_job_id: job.id, p_share_media_task_id: task.id, p_share_media_run_id: run.id,
      p_logical_result_id: 'soft-proof', p_google_place_id: primaryProviderId,
      p_name: 'Primary Proof Place', p_formatted_address: '1 Proof Way, Test, CA',
      p_latitude: 34.1, p_longitude: -118.1, p_category: 'park', p_source_type: 'link',
      p_source_url: 'https://example.com/soft-alternatives-proof', p_confidence_score: 0.4,
      p_rule_version: 'automatic-completion-proof.v1', p_reason_codes: ['top1_plausible'],
    });
    if (primaryError || !primary?.[0]) throw new Error(primaryError?.message ?? 'primary_save_failed');
    placeIds.push(primary[0].place_id);
    await admin.from('share_jobs').update({ saved_place_id: primary[0].saved_place_id, status: 'completed', progress_stage: 'completed' }).eq('id', job.id);
    await admin.from('share_job_place_results').update({
      result_role: 'primary', candidate_rank: 1,
      candidate_snapshot: { googlePlaceId: primaryProviderId, name: 'Primary Proof Place', formattedAddress: '1 Proof Way, Test, CA', latitude: 34.1, longitude: -118.1, category: 'park' },
    }).eq('share_job_id', job.id).eq('logical_result_id', 'soft-proof');

    const alternatives = [2, 3].map((rank) => ({
      share_job_id: job.id, share_media_task_id: task.id, share_media_run_id: run.id,
      user_id: identity!.userId, logical_result_id: `soft-proof:alternative:${rank}`,
      google_place_id: `${runId}-alternative-${rank}`, outcome: 'secondary_soft_saved', origin: 'automatic',
      confidence_score: rank === 2 ? 0.35 : 0.25, rule_version: 'automatic-completion-proof.v1',
      reason_codes: ['ranked_plausible_alternative'], result_role: 'secondary', candidate_rank: rank,
      candidate_snapshot: { googlePlaceId: `${runId}-alternative-${rank}`, name: `Alternative Proof ${rank}`, formattedAddress: `${rank} Proof Way, Test, CA`, latitude: 34.1 + rank / 100, longitude: -118.1 - rank / 100, category: 'park' },
      finalized_at: new Date().toISOString(),
    }));
    const { data: inserted, error: insertError } = await admin.from('share_job_place_results').insert(alternatives).select('id,candidate_rank');
    if (insertError || !inserted || inserted.length !== 2) throw new Error(insertError?.message ?? 'alternative_insert_failed');

    const userClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${identity.accessToken}` } },
    });
    const rank2 = inserted.find((row) => row.candidate_rank === 2)!;
    const rank3 = inserted.find((row) => row.candidate_rank === 3)!;
    const { data: promoted, error: promoteError } = await userClient.rpc('promote_share_job_soft_alternative', { p_result_id: rank2.id, p_make_primary: true });
    if (promoteError || !promoted?.[0]) throw new Error(promoteError?.message ?? 'promotion_failed');
    placeIds.push(promoted[0].place_id);
    const { data: removed, error: removeError } = await userClient.rpc('remove_share_job_soft_alternative', { p_result_id: rank3.id });
    if (removeError || removed !== true) throw new Error(removeError?.message ?? 'removal_failed');

    const { data: rows, error: rowsError } = await admin.from('share_job_place_results')
      .select('candidate_rank,result_role,outcome,saved_place_id').eq('share_job_id', job.id).order('candidate_rank');
    if (rowsError) throw new Error(rowsError.message);
    const assertions = {
      threeDurableRankedRows: rows?.length === 3,
      oldPrimaryRetainedAsSecondary: rows?.[0]?.outcome === 'primary_replaced' && rows?.[0]?.result_role === 'secondary',
      rank2PromotedPrimary: rows?.[1]?.outcome === 'secondary_promoted' && rows?.[1]?.result_role === 'primary' && !!rows?.[1]?.saved_place_id,
      rank3Removed: rows?.[2]?.outcome === 'secondary_removed',
      promotionIdempotentShape: promoted[0].primary_replaced === true,
    };
    const report = { schemaVersion: 1, target, runId, assertions };
    const outDir = path.resolve('artifacts', 'automatic-completion', target);
    await mkdir(outDir, { recursive: true });
    const outputPath = path.join(outDir, `soft-alternatives-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ outputPath, report }, null, 2));
    if (Object.values(assertions).some((value) => !value)) process.exitCode = 1;
  } finally {
    const cleanup = await cleanupSession(admin, identity, jobIds);
    if (placeIds.length) await admin.from('places').delete().in('id', placeIds);
    console.log(JSON.stringify({ cleanup }, null, 2));
    if (identity && (!cleanup.userDeleted || cleanup.errors.length)) process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
