/**
 * Controlled Nearr-Dev proof for the Vayrin never-dead-end result contract.
 *
 * This intentionally injects worker-boundary payloads into the DEPLOYED Edge
 * finalizer. Worker parsing/recovery is covered by the deterministic suite;
 * this proves persistence, safe routing, and the exact client copy without
 * depending on a live model returning a particular malformed response.
 */

import { buildShareJobDetailState } from '../../lib/shareJobDetailState';
import { correlationKeyFor, openSession, type E2ESession } from './session';

type CaseSpec = {
  id: 'A' | 'B' | 'C' | 'D';
  label: string;
  outcome: 'partial_evidence' | 'insufficient_evidence';
  evidence?: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  expectPartial: boolean;
};

const malformedCandidate = {
  name: '',
  role: 'primary',
  confidence: 0.92,
  explicitEvidence: [{ source: 'visible_text', timestampSeconds: 1, value: 'Unreadable venue name' }],
};

function partialEvidence(input: {
  category: string;
  categoryTag: string;
  region?: string;
  country?: string;
  observed: string;
  validationErrors: string[];
}) {
  return {
    places: [malformedCandidate],
    partialPlaces: [{
      nameHint: null,
      category: input.category,
      categoryConfidence: 0.88,
      categoryEvidenceTags: [input.categoryTag],
      addressHint: null,
      city: null,
      region: input.region ?? null,
      country: input.country ?? null,
      role: 'primary',
      confidence: 0.72,
      explicitEvidence: [{ source: 'visible_text', timestampSeconds: 1, value: input.observed }],
      validationErrors: input.validationErrors,
    }],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: ['controlled_never_dead_end_proof'],
  };
}

const CASES: CaseSpec[] = [
  {
    id: 'A',
    label: 'malformed candidate + useful country/category',
    outcome: 'partial_evidence',
    evidence: partialEvidence({
      category: 'waterfall',
      categoryTag: 'visible_waterfall',
      country: 'Iceland',
      observed: 'Waterfall in Iceland',
      validationErrors: ['candidate_name_required'],
    }),
    diagnostics: { validationErrorClass: 'candidate_field_invalid', solAttempted: false },
    expectPartial: true,
  },
  {
    id: 'B',
    label: 'malformed candidate + region',
    outcome: 'partial_evidence',
    evidence: partialEvidence({
      category: 'scenic_spot',
      categoryTag: 'visible_mountain_landscape',
      region: 'Patagonia',
      observed: 'Mountain landscape in Patagonia',
      validationErrors: ['candidate_name_required'],
    }),
    diagnostics: { validationErrorClass: 'candidate_field_invalid', solAttempted: false },
    expectPartial: true,
  },
  {
    id: 'C',
    label: 'malformed candidate + Sol no hypotheses',
    outcome: 'partial_evidence',
    evidence: partialEvidence({
      category: 'waterfall',
      categoryTag: 'visible_waterfall',
      country: 'Norway',
      observed: 'Waterfall in Norway',
      validationErrors: ['candidate_name_required', 'recovery_empty'],
    }),
    diagnostics: {
      validationErrorClass: 'candidate_field_invalid',
      solAttempted: true,
      solCompleted: true,
      recoveryOutcome: 'recovery_empty',
    },
    expectPartial: true,
  },
  {
    id: 'D',
    label: 'genuine no evidence',
    outcome: 'insufficient_evidence',
    diagnostics: { validationErrorClass: null, solAttempted: false, finalResultClass: 'insufficient_evidence' },
    expectPartial: false,
  },
];

async function runCase(session: E2ESession, spec: CaseSpec) {
  if (!session.identity) throw new Error('ephemeral identity was not created');
  const sourceUrl = `https://www.instagram.com/reel/NearrNeverDeadEnd${spec.id}/`;
  const { data: job, error: jobError } = await session.admin.from('share_jobs').insert({
    user_id: session.identity.userId,
    source_url: sourceUrl,
    canonical_url: sourceUrl,
    source_platform: 'instagram',
    status: 'processing_metadata',
    progress_stage: 'checking_video',
    idempotency_key: correlationKeyFor(session.correlationId, `never-dead-end-${spec.id.toLowerCase()}`),
    locked_until: new Date(Date.now() + 15 * 60_000).toISOString(),
  }).select('id').single();
  if (jobError || !job) throw new Error(`case ${spec.id} job setup failed: ${jobError?.message ?? 'unknown'}`);
  session.trackedJobIds.push(job.id);

  const { data: task, error: taskError } = await session.admin.from('share_media_tasks').insert({
    share_job_id: job.id,
    user_id: session.identity.userId,
    source_url: sourceUrl,
    canonical_url: sourceUrl,
    platform: 'instagram',
    status: 'processing',
    progress_stage: 'verifying_place',
    locked_at: new Date().toISOString(),
    locked_until: new Date(Date.now() + 10 * 60_000).toISOString(),
    attempts: 1,
    max_attempts: 1,
  }).select('id').single();
  if (taskError || !task) throw new Error(`case ${spec.id} task setup failed: ${taskError?.message ?? 'unknown'}`);

  const response = await fetch(`${session.config.supabaseUrl}/functions/v1/process-share-jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.config.mediaFinalizeSecret}`,
    },
    body: JSON.stringify({
      mode: 'finalize_media_task',
      taskId: task.id,
      outcome: spec.outcome,
      evidence: spec.evidence,
      analysisAttempted: true,
      diagnostics: { source: 'nearr-dev-never-dead-end-proof', ...spec.diagnostics },
    }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`case ${spec.id} callback HTTP ${response.status}: ${responseText.slice(0, 200)}`);

  const { data: persisted, error: readError } = await session.admin.from('share_jobs')
    .select('id,status,decision,saved_place_id,candidate_payload,extraction_payload,suggested_query,needs_help_reason,failure_reason,failure_category,failure_code,analysis_attempted,source_platform')
    .eq('id', job.id)
    .single();
  if (readError || !persisted) throw new Error(`case ${spec.id} read failed: ${readError?.message ?? 'unknown'}`);
  const state = buildShareJobDetailState(persisted);
  const partialPreserved = state.partialResult !== null;
  const incorrectlyInsufficient = spec.expectPartial && state.reason === 'analysis_insufficient';
  const wrongSave = persisted.saved_place_id !== null || persisted.decision === 'auto_save';
  if (partialPreserved !== spec.expectPartial) {
    throw new Error(`case ${spec.id} partial preservation mismatch (expected ${spec.expectPartial}, got ${partialPreserved})`);
  }
  if (incorrectlyInsufficient) throw new Error(`case ${spec.id} collapsed to insufficient_evidence`);
  if (wrongSave) throw new Error(`case ${spec.id} produced a forbidden save`);
  if (spec.id === 'D' && state.reason !== 'analysis_insufficient') {
    throw new Error(`case D expected analysis_insufficient, got ${state.reason}`);
  }

  return {
    case: spec.id,
    input: spec.label,
    callbackStatus: response.status,
    persisted: { status: persisted.status, decision: persisted.decision, savedPlaceId: null },
    result: {
      kind: state.kind,
      reason: state.reason,
      partialClass: state.partialResult?.resultClass ?? null,
      canSearchManually: state.canSearchManually,
      title: state.copy.title,
      body: state.copy.body,
    },
  };
}

async function main() {
  const session = await openSession({ withIdentity: true });
  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  try {
    for (const spec of CASES) results.push(await runCase(session, spec));
    console.log(JSON.stringify({
      target: { supabase: `${session.config.supabaseRef} (Nearr-Dev)`, railwayEnvironment: session.config.railway.environment },
      correlationId: session.correlationId,
      wrongAutosave: 0,
      cases: results,
    }, null, 2));
  } finally {
    const cleanup = await session.cleanup();
    console.log(JSON.stringify({
      cleanup: {
        userDeleted: cleanup.userDeleted,
        diagnosticsDeleted: cleanup.diagnosticsDeleted,
        evidenceObjectsDeleted: cleanup.evidenceObjectsDeleted,
        retained: cleanup.retained.length,
        errors: cleanup.errors,
      },
    }));
    if (!cleanup.userDeleted || cleanup.errors.length > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
