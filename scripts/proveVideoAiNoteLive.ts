import { createClient } from '@supabase/supabase-js';

import { findSavedPlaceForOpen } from '../lib/openSavedPlace';
import { whySavedDisplay } from '../lib/placeDetailUi';
import { pollUntil } from './e2e/poll';
import { openSession } from './e2e/session';
import { submitShareJob } from './e2e/fixtures/shared';

type Row = Record<string, any>;

const SOURCE_URL = (process.env.NEARR_E2E_VIDEO_AI_NOTE_URL ||
  'https://www.instagram.com/reel/DUWyZkfgbT4/').trim();
const EXPECTED_USER_NOTE = (process.env.NEARR_E2E_VIDEO_AI_USER_NOTE || '').trim();
const TERMINAL_JOB = new Set(['completed', 'needs_help', 'failed', 'cancelled']);
const TERMINAL_TASK = new Set(['completed', 'needs_help', 'failed', 'cancelled']);

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function candidateObjects(value: unknown, out: Row[] = []): Row[] {
  if (Array.isArray(value)) {
    for (const child of value) candidateObjects(child, out);
  } else if (value && typeof value === 'object') {
    const row = value as Row;
    if (nonEmpty(row.googlePlaceId) && nonEmpty(row.name)) out.push(row);
    for (const child of Object.values(row)) candidateObjects(child, out);
  }
  return out;
}

async function main(): Promise<void> {
  const session = await openSession({ withIdentity: true });
  let proof: Row = {};
  try {
    const submitted = await submitShareJob(session, 'video-ai-note-live', SOURCE_URL);
    if (!submitted.ok) throw new Error(submitted.detail);
    console.log(`LIVE_PROOF_STAGE submitted job=${submitted.jobId}`);

    const jobResult = await pollUntil<Row>(
      async () => {
        const { data, error } = await session.admin
          .from('share_jobs')
          .select('id,status,decision,saved_place_id,source_platform,candidate_payload,created_at,updated_at')
          .eq('id', submitted.jobId)
          .maybeSingle();
        if (error) throw error;
        return data as Row | null;
      },
      (row) => TERMINAL_JOB.has(String(row.status)),
      { timeoutMs: 240_000, intervalMs: 2_000 },
    );
    if (!jobResult.ok) throw new Error('real video share job did not reach a terminal state');
    const job = jobResult.value;
    let savedPlaceId = job.saved_place_id as string | null;
    let confirmedCandidate = false;
    if (!savedPlaceId && ['candidate_confirmation', 'multi_candidate_confirmation'].includes(String(job.decision))) {
      const owner = createClient(session.config.supabaseUrl, session.config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${session.identity!.accessToken}` } },
      });
      const candidate = candidateObjects(job.candidate_payload)[0];
      if (!candidate || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) {
        throw new Error(`real video produced no persistable candidate: status=${job.status} decision=${job.decision}`);
      }
      const { data: existing, error: lookupError } = await owner.from('places')
        .select('id').eq('google_place_id', candidate.googlePlaceId).maybeSingle();
      if (lookupError) throw new Error(`candidate lookup failed: ${lookupError.message}`);
      let placeId = existing?.id as string | undefined;
      if (!placeId) {
        const { data: inserted, error: placeError } = await owner.from('places').insert({
          google_place_id: candidate.googlePlaceId,
          name: candidate.name,
          formatted_address: candidate.formattedAddress ?? null,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          google_types: Array.isArray(candidate.types) ? candidate.types : [],
        }).select('id').single();
        if (placeError || !inserted) throw new Error(`candidate place insert failed: ${placeError?.message ?? 'no row'}`);
        placeId = inserted.id;
      }
      const { data: saved, error: saveError } = await owner.from('saved_places').insert({
        user_id: session.identity!.userId,
        place_id: placeId,
        source_type: job.source_platform,
        source_url: SOURCE_URL,
      }).select('id').single();
      if (saveError || !saved) throw new Error(`candidate save failed: ${saveError?.message ?? 'no row'}`);
      savedPlaceId = saved.id;
      const { data: resolved, error: resolveError } = await owner.rpc('resolve_share_job', {
        p_job_id: job.id,
        p_saved_place_id: savedPlaceId,
      });
      if (resolveError || resolved !== true) throw new Error(`candidate job resolution failed: ${resolveError?.message ?? String(resolved)}`);
      confirmedCandidate = true;
      job.saved_place_id = savedPlaceId;
      job.status = 'completed';
    }
    if (!savedPlaceId) {
      throw new Error(`real video was not saved: status=${job.status} decision=${job.decision}`);
    }
    console.log(`LIVE_PROOF_STAGE saved job=${job.id} savedPlace=${savedPlaceId} confirmed=${confirmedCandidate}`);
    if (EXPECTED_USER_NOTE) {
      const { error } = await session.admin.from('saved_places')
        .update({ notes: EXPECTED_USER_NOTE })
        .eq('id', savedPlaceId)
        .eq('user_id', session.identity!.userId);
      if (error) throw error;
      console.log('LIVE_PROOF_STAGE user-note-written');
    }

    const aiTaskResult = await pollUntil<Row>(
      async () => {
        const { data, error } = await session.admin
          .from('share_media_tasks')
          .select('*')
          .eq('saved_place_id', savedPlaceId)
          .eq('task_kind', 'ai_note_enrichment')
          .maybeSingle();
        if (error) throw error;
        return data as Row | null;
      },
      () => true,
      { timeoutMs: 60_000, intervalMs: 1_000 },
    );
    if (!aiTaskResult.ok) throw new Error('AI-note obligation was not created');
    console.log(`LIVE_PROOF_STAGE ai-task-created task=${aiTaskResult.value.id}`);

    const completion = await pollUntil<{ task: Row; saved: Row }>(
      async () => {
        const [{ data: task, error: taskError }, { data: saved, error: savedError }] = await Promise.all([
          session.admin.from('share_media_tasks').select('*').eq('id', aiTaskResult.value.id).single(),
          session.admin.from('saved_places').select('id,ai_note,notes,updated_at').eq('id', savedPlaceId).single(),
        ]);
        if (taskError) throw taskError;
        if (savedError) throw savedError;
        return { task: task as Row, saved: saved as Row };
      },
      ({ task, saved }) =>
        nonEmpty(saved.ai_note) || TERMINAL_TASK.has(String(task.status)),
      { timeoutMs: 480_000, intervalMs: 3_000 },
    );
    if (!completion.ok) throw new Error('AI-note task did not converge within eight minutes');

    const recognition = await session.admin
      .from('share_media_tasks')
      .select('id,status,attempts,analysis_provider,analysis_model,model_calls,model_input_tokens,model_output_tokens,model_thinking_tokens')
      .eq('share_job_id', job.id)
      .eq('task_kind', 'recognition')
      .maybeSingle();
    if (recognition.error) throw recognition.error;

    const task = completion.value.task;
    const saved = completion.value.saved;
    // Cold-start proof: issue the same full database projection used by
    // listSavedPlaces(), cross the JSON cache/storage boundary, then resolve by
    // the exact saved_places.id before applying Place Detail's render rule.
    const { data: appRows, error: appRowsError } = await session.admin
      .from('saved_places')
      .select('*, place:places(*)')
      .eq('user_id', session.identity!.userId)
      .order('created_at', { ascending: false });
    if (appRowsError) throw appRowsError;
    const coldRows = JSON.parse(JSON.stringify(appRows ?? [])) as Array<{
      id: string;
      notes?: string | null;
      ai_note?: string | null;
      place?: { google_place_id?: string | null } | null;
    }>;
    const selected = findSavedPlaceForOpen(coldRows, { savedPlaceId: saved.id });
    const rendered = whySavedDisplay(selected ?? {});
    const coldStartQueryReturnsAiNote = nonEmpty(selected?.ai_note);
    const placeDetailRendersAiNote = EXPECTED_USER_NOTE
      ? rendered.origin === 'user' && rendered.text === EXPECTED_USER_NOTE
      : rendered.origin === 'source' && rendered.text === selected?.ai_note;
    proof = {
      target: session.config.supabaseRef,
      jobId: job.id,
      recognitionTaskId: (recognition.data as Row | null)?.id ?? null,
      savedPlaceId: saved.id,
      aiNoteTaskId: task.id,
      sourcePlatform: job.source_platform,
      jobDecision: job.decision,
      jobCompleted: job.status === 'completed',
      obligationCreated: true,
      taskClaimed: Number(task.attempts) > 0 || nonEmpty(task.locked_at),
      taskStatus: task.status,
      taskOutcome: task.ai_note_outcome,
      analysisProvider: task.analysis_provider,
      analysisModel: task.analysis_model,
      modelCalls: task.model_calls,
      modelInputTokens: task.model_input_tokens,
      modelOutputTokens: task.model_output_tokens,
      modelThinkingTokens: task.model_thinking_tokens,
      aiNoteNonempty: nonEmpty(saved.ai_note),
      aiNote: nonEmpty(saved.ai_note) ? String(saved.ai_note).slice(0, 220) : null,
      userNoteUntouched: EXPECTED_USER_NOTE
        ? saved.notes === EXPECTED_USER_NOTE
        : !nonEmpty(saved.notes),
      readbackSucceeded: saved.id === savedPlaceId && nonEmpty(saved.ai_note),
      realPhysicalLikeSavePathUsed:
        job.source_platform === 'instagram' && (job.decision === 'auto_save' || confirmedCandidate),
      coldStartQueryReturnsAiNote,
      exactSelectedRow: selected?.id === saved.id,
      placeDetailRendersAiNote,
    };
    console.log(`LIVE_PROOF_RESULT ${JSON.stringify(proof)}`);
    if (
      !proof.jobCompleted ||
      !proof.taskClaimed ||
      !['accepted', 'accepted_after_retry', 'already_present'].includes(String(proof.taskOutcome)) ||
      !proof.aiNoteNonempty ||
      !proof.userNoteUntouched ||
      !proof.readbackSucceeded ||
      !proof.realPhysicalLikeSavePathUsed ||
      !proof.coldStartQueryReturnsAiNote ||
      !proof.exactSelectedRow ||
      !proof.placeDetailRendersAiNote
    ) {
      throw new Error(`live proof incomplete: ${JSON.stringify(proof)}`);
    }
  } finally {
    const cleanup = await session.cleanup();
    console.log(`LIVE_PROOF_CLEANUP userDeleted=${cleanup.userDeleted} errors=${cleanup.errors.length}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
