import { pollUntil } from './e2e/poll';
import { openSession } from './e2e/session';
import { submitShareJob } from './e2e/fixtures/shared';

type Row = Record<string, any>;

const SOURCE_URL = (process.env.NEARR_E2E_VIDEO_AI_NOTE_URL ||
  'https://www.instagram.com/reel/DUWyZkfgbT4/').trim();
const TERMINAL_JOB = new Set(['completed', 'needs_help', 'failed', 'cancelled']);
const TERMINAL_TASK = new Set(['completed', 'needs_help', 'failed', 'cancelled']);

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
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
          .select('id,status,decision,saved_place_id,source_platform,created_at,updated_at')
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
    if (!job.saved_place_id) {
      throw new Error(`real video was not saved: status=${job.status} decision=${job.decision}`);
    }
    console.log(`LIVE_PROOF_STAGE saved job=${job.id} savedPlace=${job.saved_place_id}`);

    const aiTaskResult = await pollUntil<Row>(
      async () => {
        const { data, error } = await session.admin
          .from('share_media_tasks')
          .select('*')
          .eq('saved_place_id', job.saved_place_id)
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
          session.admin.from('saved_places').select('id,ai_note,notes,updated_at').eq('id', job.saved_place_id).single(),
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
      userNoteUntouched: !nonEmpty(saved.notes),
      readbackSucceeded: saved.id === job.saved_place_id && nonEmpty(saved.ai_note),
    };
    console.log(`LIVE_PROOF_RESULT ${JSON.stringify(proof)}`);
    if (
      !proof.jobCompleted ||
      !proof.taskClaimed ||
      proof.taskOutcome !== 'generated' ||
      !proof.aiNoteNonempty ||
      !proof.readbackSucceeded
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
