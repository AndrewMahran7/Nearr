import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { canonicalContentIdentity, RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';
import { RECOGNITION_CACHE_POLICY_VERSION } from '../supabase/functions/_shared/recognitionCachePolicy';
import { submitShareJob } from './e2e/fixtures/shared';
import { pollUntil } from './e2e/poll';
import { openSession } from './e2e/session';

const SOURCE = 'https://www.instagram.com/reel/NEARRV2MULTI1/';

async function main(): Promise<void> {
  const session = await openSession({ withIdentity: true });
  const identity = canonicalContentIdentity(SOURCE);
  assert.ok(identity);
  const startedAt = new Date().toISOString();
  try {
    const { data: places, error: placesError } = await session.admin.from('places')
      .select('id,google_place_id,name').not('google_place_id', 'is', null)
      .not('latitude', 'is', null).not('longitude', 'is', null).limit(3);
    if (placesError) throw placesError;
    assert.equal(places?.length, 3);
    const fingerprint = 'controlled-frozen-multi-evidence';
    const { data: coldMiss, error: coldMissError } = await session.admin.rpc('read_recognition_answers_v2', {
      p_identity_key: `${identity.key}:unseeded`,
      p_identity_version: identity.identityVersion,
      p_policy_version: RECOGNITION_CACHE_POLICY_VERSION,
      p_recognition_version: RECOGNITION_VERSION,
      p_user_id: session.identity!.userId,
    });
    if (coldMissError) throw coldMissError;
    assert.equal(coldMiss?.length ?? 0, 0, 'an unknown identity must miss Cache V2');
    const { error: stateError } = await session.admin.from('recognition_source_states').insert({
      identity_key: identity.key, platform: identity.platform, content_id: identity.contentId,
      canonical_url: identity.canonicalUrl, identity_version: identity.identityVersion,
      source_fingerprint: fingerprint, policy_version: RECOGNITION_CACHE_POLICY_VERSION,
      recognition_version: RECOGNITION_VERSION, state: 'ELIGIBLE', visibility_scope: 'public',
    });
    if (stateError) throw stateError;
    const base = {
      identity_key: identity.key, state: 'ELIGIBLE', answer_revision: 1, feedback_revision: 0,
      evidence_revision: 1, policy_version: RECOGNITION_CACHE_POLICY_VERSION,
      recognition_version: RECOGNITION_VERSION, source_fingerprint: fingerprint, specificity: 'exact',
      terminal_status: 'success', semantic_check_passed: true, geographic_check_passed: true,
      evidence_sufficient: true, strong_contradiction: false, validated_feedback_revision: 0,
      saved_category: 'other', saved_category_source: 'fallback', saved_category_confidence: 0,
      saved_category_model_version: 'nearr-category-2026-08-13.v3',
    };
    const { error: answersError } = await session.admin.from('recognition_cache_answers_v2').insert([
      { ...base, slot_key: 'destination-a', place_id: places![0].id },
      { ...base, slot_key: 'destination-b', place_id: places![1].id },
    ]);
    if (answersError) throw answersError;

    const submitted = await submitShareJob(session, 'multi-cache-hit', SOURCE);
    if (!submitted.ok) throw new Error(submitted.detail);
    const terminal = await pollUntil<Record<string, any>>(
      async () => {
        const { data, error } = await session.admin.from('share_jobs').select('*').eq('id', submitted.jobId).single();
        if (error) throw error;
        return data;
      },
      (job) => ['completed', 'needs_help', 'failed'].includes(job.status),
      { timeoutMs: 120_000, intervalMs: 2_000 },
    );
    assert.ok(terminal.ok);
    assert.equal(terminal.value.extraction_payload?.recognitionCache?.hit, true);
    const savedIds = terminal.value.candidate_payload?.savedPlaceIds as string[];
    assert.equal(savedIds.length, 2);
    const owner = createClient(session.config.supabaseUrl, session.config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${session.identity!.accessToken}` } },
    });
    const { error: correctionError } = await owner.rpc('correct_saved_place_provider_v2', {
      p_saved_place_id: savedIds[0], p_place_id: places![2].id,
      p_corrected_google_place_id: places![2].google_place_id, p_category: 'other',
      p_category_source: 'fallback', p_category_confidence: 0,
      p_category_model_version: RECOGNITION_CACHE_POLICY_VERSION,
      p_idempotency_key: `cache-v2-multi-${randomUUID()}`,
    });
    if (correctionError) throw correctionError;
    const [{ data: sourceState }, { data: answers }, { data: work, error: workError },
      { data: quarantinedRead, error: quarantinedReadError }] = await Promise.all([
      session.admin.from('recognition_source_states').select('*').eq('identity_key', identity.key).single(),
      session.admin.from('recognition_cache_answers_v2').select('slot_key,state,feedback_revision,validated_feedback_revision').eq('identity_key', identity.key).order('slot_key'),
      session.admin.from('recognition_revalidation_tasks').select('*').eq('identity_key', identity.key).single(),
      session.admin.rpc('read_recognition_answers_v2', {
        p_identity_key: identity.key,
        p_identity_version: identity.identityVersion,
        p_policy_version: RECOGNITION_CACHE_POLICY_VERSION,
        p_recognition_version: RECOGNITION_VERSION,
        p_user_id: session.identity!.userId,
      }),
    ]);
    if (workError ?? quarantinedReadError) throw workError ?? quarantinedReadError;
    assert.equal(sourceState.state, 'QUARANTINED');
    assert.equal(sourceState.whole_source_quarantined, false);
    assert.equal(answers?.filter((answer: any) => answer.state === 'QUARANTINED').length, 1);
    assert.equal(answers?.filter((answer: any) => answer.state === 'ELIGIBLE').length, 1);
    assert.equal(quarantinedRead?.length ?? 0, 0, 'quarantined source must be excluded from Cache V2 reads');
    const sibling = answers?.find((answer: any) => answer.state === 'ELIGIBLE');
    assert.ok(sibling);
    assert.equal(sibling.feedback_revision, 1);
    assert.equal(sibling.validated_feedback_revision, 1);
    const { data: disposition, error: completionError } = await session.admin.rpc('complete_recognition_revalidation_v2', {
      p_revalidation_task_id: work.id, p_decision: 'TECHNICAL_FAILURE', p_supported_place_id: null,
      p_diagnostics: { controlled: true, providerRequestMade: false }, p_error_code: 'controlled_acquisition_unavailable',
    });
    if (completionError) throw completionError;
    const { count: answerCount, error: countError } = await session.admin.from('recognition_cache_answers_v2')
      .select('*', { count: 'exact', head: true }).eq('identity_key', identity.key);
    if (countError) throw countError;
    assert.equal(answerCount, 2);
    console.log(`CACHE_V2_DEV_DATABASE ${JSON.stringify({
      multiPlaceCacheHit: true,
      coldMissAnswerCount: coldMiss?.length ?? 0,
      savedPlaceCount: savedIds.length,
      correctedSlotQuarantined: true,
      quarantinedReadAnswerCount: quarantinedRead?.length ?? 0,
      siblingEligibleAtCurrentRevision: true,
      alternativesCountedAsLocations: 0,
      technicalFailureDisposition: disposition,
      answerCountBeforeAndAfterTechnicalFailure: 2,
      paidModelCalls: 0,
    })}`);
  } finally {
    const cleanup = await session.cleanup();
    await session.admin.from('recognition_cache_events').delete().eq('identity_key', identity.key).gte('created_at', startedAt);
    await session.admin.from('recognition_source_states').delete().eq('identity_key', identity.key);
    console.log(`CACHE_V2_DEV_DATABASE_CLEANUP ${JSON.stringify({ userDeleted: cleanup.userDeleted, errors: cleanup.errors })}`);
    if (!cleanup.userDeleted || cleanup.errors.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
