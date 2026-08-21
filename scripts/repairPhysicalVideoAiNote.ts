import assert from 'node:assert/strict';

import { groundedAiPlaceNoteFallback } from '../lib/aiPlaceNote';
import { findSavedPlaceForOpen } from '../lib/openSavedPlace';
import { whySavedDisplay } from '../lib/placeDetailUi';
import { openSession } from './e2e/session';

const EXPECTED_DEV_REF = 'qnfxnmvxpjzfydgudtvs';
const SAVED_PLACE_ID = '1f77a789-c8ba-4866-be3b-16c9fcba0d1c';
const AI_NOTE_TASK_ID = '8f7efbb7-79b9-4375-9e20-d67053b51d1d';

type Row = Record<string, any>;
type ColdSavedRow = Row & {
  id: string;
  notes?: string | null;
  ai_note?: string | null;
  place?: { google_place_id?: string | null } | null;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function main(): Promise<void> {
  if (!process.argv.includes('--apply')) {
    throw new Error('Refusing to mutate Nearr-Dev without the explicit --apply flag.');
  }
  const session = await openSession({ withIdentity: false, withEdgeSecrets: false });
  assert.equal(session.config.supabaseRef, EXPECTED_DEV_REF, 'development project only');
  assert.ok(nonEmpty(session.config.mediaFinalizeSecret), 'development finalizer secret is present');

  const { data: saved, error: savedError } = await session.admin
    .from('saved_places')
    .select('*, place:places(*)')
    .eq('id', SAVED_PLACE_ID)
    .maybeSingle();
  if (savedError || !saved) throw new Error(`Physical saved-place lookup failed: ${savedError?.message ?? 'missing'}`);

  const { data: task, error: taskError } = await session.admin
    .from('share_media_tasks')
    .select('*')
    .eq('id', AI_NOTE_TASK_ID)
    .maybeSingle();
  if (taskError || !task) throw new Error(`Physical AI-note task lookup failed: ${taskError?.message ?? 'missing'}`);

  const finalPlace = Array.isArray(saved.place) ? saved.place[0] : saved.place;
  const representedSource = task.canonical_url || task.source_url;
  assert.equal(task.task_kind, 'ai_note_enrichment');
  assert.equal(task.saved_place_id, saved.id);
  assert.equal(task.user_id, saved.user_id);
  assert.equal(task.target_place_id, saved.place_id);
  assert.equal(representedSource, saved.source_url);
  assert.equal(String(saved.source_type).toLowerCase(), 'instagram');
  assert.ok(nonEmpty(finalPlace?.name), 'the exact saved row has a joined place name');

  const authUser = await session.admin.auth.admin.getUserById(saved.user_id);
  assert.ok(authUser.data.user, 'the saved row belongs to an auth user');
  assert.ok(
    !String(authUser.data.user?.email ?? '').endsWith('@nearr.invalid'),
    'the target is Andrew\'s non-ephemeral physical user, not an E2E fixture',
  );

  if (!nonEmpty(saved.ai_note)) {
    assert.equal(task.status, 'queued', 'only the traced queued obligation may be repaired');
    assert.equal(task.failure_code, 'ai_note_rejected_ungrounded_claim');
    assert.equal(task.ai_note_outcome, 'retry_after_generation');
    const evidence = Array.isArray(task.evidence_snapshot) ? task.evidence_snapshot.slice(0, 8) : [];
    const fallback = groundedAiPlaceNoteFallback({ placeName: finalPlace.name, evidence });
    assert.ok(nonEmpty(fallback.note), 'retained scoped evidence must support a validated fallback');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(
        `${session.config.supabaseUrl}/functions/v1/process-share-jobs`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${session.config.mediaFinalizeSecret}`,
          },
          body: JSON.stringify({
            mode: 'finalize_media_task',
            taskId: task.id,
            targetPlaceId: task.target_place_id,
            targetSourceUrl: representedSource,
            outcome: 'evidence',
            analysisAttempted: true,
            evidence: {
              places: [{
                name: finalPlace.name,
                category: null,
                address: null,
                city: null,
                region: null,
                country: null,
                coordinates: null,
                role: 'primary',
                confidence: 1,
                explicitEvidence: evidence,
                inferredEvidence: [],
                // Force the exact failure class seen on the physical callback;
                // the deployed delivery boundary must recover from evidence.
                memoryCue: 'Saved for the unsupported model claim shown here',
                memoryCueEvidence: evidence,
              }],
              multipleIntentionalPlaces: false,
              insufficientEvidence: false,
              warnings: [],
            },
            diagnostics: {
              modelProvider: task.analysis_provider,
              modelName: task.analysis_model,
              modelCalls: 0,
              noteInputEvidenceCount: evidence.length,
              repairReplay: true,
            },
          }),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timer);
    }
    const body = await response.json().catch(() => ({})) as Row;
    assert.equal(response.status, 200, `finalizer HTTP ${response.status}`);
    assert.equal(body.route, 'ai_note_enrichment');
    assert.equal(body.enriched, true, 'the exact physical row was enriched');
    assert.equal(body.groundedFallbackUsed, true, 'the deployed fallback repaired the physical rejection');
  }

  const { data: readback, error: readbackError } = await session.admin
    .from('saved_places')
    .select('*, place:places(*)')
    .eq('id', SAVED_PLACE_ID)
    .maybeSingle();
  if (readbackError || !readback) throw new Error(`Physical readback failed: ${readbackError?.message ?? 'missing'}`);
  const { data: taskReadback } = await session.admin
    .from('share_media_tasks')
    .select('id,status,ai_note_outcome,failure_code,model_calls')
    .eq('id', AI_NOTE_TASK_ID)
    .maybeSingle();
  assert.ok(nonEmpty(readback.ai_note), 'saved_places.ai_note is nonempty after repair');
  assert.equal(taskReadback?.status, 'completed');
  assert.equal(taskReadback?.ai_note_outcome, 'generated');

  // Reproduce the cold-start data boundary with the exact database-shaped row:
  // JSON is the cache/storage boundary and ID-first selection is the map path.
  const coldRows = JSON.parse(JSON.stringify([readback])) as ColdSavedRow[];
  const selected = findSavedPlaceForOpen(coldRows, { savedPlaceId: SAVED_PLACE_ID });
  assert.equal(selected?.id, SAVED_PLACE_ID);
  const rendered = whySavedDisplay(selected!);
  assert.equal(rendered.origin, 'source');
  assert.equal(rendered.text, readback.ai_note);

  console.log(JSON.stringify({
    target: session.config.supabaseRef,
    savedPlaceId: readback.id,
    taskId: taskReadback?.id,
    aiNoteNonempty: nonEmpty(readback.ai_note),
    aiNoteLength: String(readback.ai_note).trim().length,
    taskStatus: taskReadback?.status,
    taskOutcome: taskReadback?.ai_note_outcome,
    repairModelCalls: 0,
    coldStartQueryReturnedAiNote: nonEmpty(coldRows[0]?.ai_note),
    exactSelectedRow: selected?.id === SAVED_PLACE_ID,
    placeDetailRendersAiNote: rendered.origin === 'source' && rendered.text === readback.ai_note,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
