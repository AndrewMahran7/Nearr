import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { openSession } from './session';

const candidate = (id: string) => ({
  googlePlaceId: id, name: 'Nagarkot Zip Coaster',
  formattedAddress: 'Mahamanjushree Nagarkot 44812, Nepal',
  latitude: 27.7171758, longitude: 85.518039,
  types: ['establishment', 'point_of_interest', 'tourist_attraction'],
  primaryType: 'tourist_attraction', aiNote: 'A synthetic development proof note.',
});
const slot = (id: string, outcome = 'no_match') => ({
  mentionId: id, displayName: 'Nagarkot ZipCoaster', contextLabel: 'Nagarkot, Bagmati Province, Nepal',
  outcome, candidates: [], identityHypotheses: [{ name: 'Nagarkot ZipCoaster',
    contextLabel: 'Nagarkot, Bagmati Province, Nepal', evidenceKind: 'observable', timestamps: [1] }],
});

async function main() {
  const session = await openSession({ withIdentity: true, withEdgeSecrets: false });
  assert.ok(session.identity);
  const uid = session.identity.userId;
  const client = createClient(session.config.supabaseUrl, session.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.identity.accessToken}` } },
  });
  const suffix = session.correlationId.replace(/[^a-z0-9]/gi, '').slice(-20);
  const googleIds = [`named-${suffix}`, `multi-${suffix}`];
  const identityKeys = [`instagram:${suffix}:single`, `instagram:${suffix}:reuse`, `instagram:${suffix}:multi`];
  const makeJob = async (name: string, slots: unknown[], savedPlaceId: string | null = null) => {
    const source = `https://www.instagram.com/p/${suffix}${name}/`;
    const inserted = await session.admin.from('share_jobs').insert({
      user_id: uid, source_url: source, canonical_url: source, source_platform: 'instagram',
      status: 'needs_help', progress_stage: 'manual', decision: 'candidate_confirmation',
      saved_place_id: savedPlaceId, candidate_payload: { mentionSlots: slots },
      suggested_query: 'Nagarkot ZipCoaster', needs_help_reason: 'automatic_deep_named_lead',
      idempotency_key: `${session.correlationId}:${name}`,
      recognition_identity_key: identityKeys[name === 'single' ? 0 : name === 'reuse' ? 1 : 2],
      recognition_identity_version: 1, recognition_content_id: `${suffix}-${name}`,
    }).select('id').single();
    if (inserted.error) throw inserted.error;
    session.trackedJobIds.push(inserted.data.id);
    return inserted.data.id as string;
  };
  const claim = async (jobId: string, logicalId: string) => {
    const result = await client.rpc('claim_named_lead_auto_recovery', {
      p_job_id: jobId, p_logical_result_id: logicalId, p_policy_version: 'named-lead-auto-v1-proof',
    });
    if (result.error) throw result.error;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    assert.ok(row?.attempt_token);
    return row.attempt_token as string;
  };
  const complete = async (jobId: string, logicalId: string, token: string, c: ReturnType<typeof candidate>) => {
    const result = await client.rpc('auto_complete_named_lead', {
      p_job_id: jobId, p_logical_result_id: logicalId, p_attempt_token: token,
      p_google_place_id: c.googlePlaceId, p_name: c.name, p_formatted_address: c.formattedAddress,
      p_latitude: c.latitude, p_longitude: c.longitude, p_category: c.primaryType,
      p_candidate_snapshot: c, p_confidence_score: 1, p_rule_version: 'named-lead-auto-v1-proof',
    });
    if (result.error) throw result.error;
    return (Array.isArray(result.data) ? result.data[0] : result.data) as any;
  };
  try {
    const before = await session.admin.from('recognition_identity_support').select('place_id').in('identity_key', identityKeys);
    if (before.error) throw before.error;
    assert.equal(before.data?.length, 0);
    const singleJob = await makeJob('single', [slot('premium-destination-1')]);
    const token = await claim(singleJob, 'premium-destination-1');
    const first = await complete(singleJob, 'premium-destination-1', token, candidate(googleIds[0]!));
    assert.equal(first.completed, true);
    const replay = await complete(singleJob, 'premium-destination-1', token, candidate(googleIds[0]!));
    assert.equal(replay.idempotent, true);

    const reuseJob = await makeJob('reuse', [slot('premium-destination-1')]);
    const reused = await complete(reuseJob, 'premium-destination-1', await claim(reuseJob, 'premium-destination-1'), candidate(googleIds[0]!));
    assert.equal(reused.reused, true);
    assert.equal(reused.saved_place_id, first.saved_place_id);

    const multiJob = await makeJob('multi', [slot('already', 'verified_single'), slot('remaining')], first.saved_place_id);
    const multi = await complete(multiJob, 'remaining', await claim(multiJob, 'remaining'), candidate(googleIds[1]!));
    assert.equal(multi.completed, true);

    const [jobs, results, sources, after] = await Promise.all([
      session.admin.from('share_jobs').select('id,status,decision,suggested_query,needs_help_reason').in('id', [singleJob,reuseJob,multiJob]),
      session.admin.from('share_job_place_results').select('share_job_id,origin,outcome,saved_place_id').in('share_job_id',[singleJob,reuseJob,multiJob]),
      session.admin.from('saved_place_sources').select('identity_key,saved_place_id').eq('user_id',uid),
      session.admin.from('recognition_identity_support').select('place_id').in('identity_key',identityKeys),
    ]);
    assert.ok(jobs.data?.every((row) => row.status === 'completed' && row.decision === 'auto_save' && !row.suggested_query && !row.needs_help_reason));
    for (const result of [jobs, results, sources, after]) if (result.error) throw result.error;
    assert.equal(results.data?.length, 3);
    assert.ok(results.data?.every((row) => row.origin === 'automatic'));
    assert.equal(sources.data?.length, 3);
    assert.equal(after.data?.length, 0);
    console.log(`PASS named-lead Dev proof correlation=${session.correlationId}`);
    console.log('HAPPY_PATH=passed IDEMPOTENT_REPLAY=passed EXISTING_SAVE_REUSED=passed MULTI_REMAINDER=passed');
    console.log('SOURCE_LINKS=3 AUTOMATIC_LEDGER_ROWS=3 RECOGNITION_SUPPORT_DELTA=0');
  } finally {
    const cleanup = await session.cleanup();
    if (!cleanup.userDeleted || cleanup.errors.length) throw new Error(`cleanup failed: ${cleanup.errors.join('; ')}`);
    const deleted = await session.admin.from('places').delete().in('google_place_id',googleIds);
    if (deleted.error) throw deleted.error;
  }
}
main().catch((error) => { console.error(error); process.exitCode=1; });
