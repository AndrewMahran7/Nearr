// services/media-worker/tests/integration/e2e.test.ts
//
// FULL synthetic queue -> finalizer path against the REAL local Supabase DB.
//
// REAL: local Postgres queue, claim_media_tasks RPC, the worker HTTP server,
//       the FFmpeg pipeline (ffprobe/frames/dedup/cleanup), the worker's
//       verifyPlaceEvidence callback, and the DB parent-state transitions.
// MOCKED (per mission): media retrieval (a mock resolver returns locally
//       generated synthetic video), paid transcription + model APIs, and Google
//       Places (a deterministic resolver stub inside the local finalize
//       handler). The finalize handler mirrors the Deno finalizer's DB contract;
//       the Deno finalizer's PURE decisions are unit-tested separately
//       (scripts/testMediaFinalizePlan.ts, testMediaAdversarialEvidence.ts).
//
// Gated: runs only when MEDIA_E2E_TESTS=1 AND SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY are set AND ffmpeg is available. Skips otherwise, so
// it is safe in the default `npm test` run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, copyFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { loadConfig, type WorkerConfig } from '../../src/config/env.js';
import { startServer, type ServerContext } from '../../src/server/httpServer.js';
import type { MediaResolver, ResolveInput } from '../../src/resolvers/MediaResolver.js';
import type { ResolvedMedia } from '../../src/types/media.js';
import type { TranscriptionProvider } from '../../src/providers/transcription.js';
import type { ModelProvider, AnalyzeInput, AnalyzeOutput } from '../../src/providers/model.js';
import { selectOcrProvider } from '../../src/providers/ocr.js';
import type { MediaPlaceEvidence } from '../../src/types/evidence.js';
import type { TaskDeps } from '../../src/pipeline/runMediaTask.js';
import { generateSyntheticMedia, ffmpegAvailable } from '../support/generateSyntheticMedia.js';

// PRODUCTION finalization modules — the SAME typed code the Deno
// process-share-jobs edge function imports (supabase/functions/process-share-jobs).
// The E2E finalize server below makes NONE of its own auth / ownership /
// idempotency / routing decisions: it calls these functions and only performs
// the (mocked, per mission) Google-Places + saveForUser + notification I/O. If
// production auth, ownership, idempotency, or routing changes, this test changes.
import {
  authorizeServiceRoleBearer,
  isTerminalTaskStatus,
  planPreResolve,
  planPostResolve,
} from '../../../../supabase/functions/process-share-jobs/mediaFinalizePlan.js';
import {
  parseMediaEvidence,
  renderMediaEvidenceCaption,
  mediaEvidenceAutoSaveEligible,
} from '../../../../supabase/functions/process-share-jobs/mediaEvidence.js';

const ENABLED =
  process.env.MEDIA_E2E_TESTS === '1' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

/** Returns the pre-generated synthetic video, copied INTO the job workDir so
 *  cleanup deletes it (proves per-job temp isolation + teardown). */
class MockResolver implements MediaResolver {
  readonly name = 'mock/test';
  constructor(private sourceVideo: string) {}
  supports(): boolean {
    return true;
  }
  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    const dest = path.join(input.workDir, 'source.mp4');
    await copyFile(this.sourceVideo, dest);
    const s = await stat(dest);
    return {
      canonicalUrl: input.canonicalUrl ?? input.sourceUrl,
      localFilePath: dest,
      mimeType: 'video/mp4',
      sizeBytes: s.size,
      source: 'mock',
      warnings: [],
    };
  }
}

class MockTranscription implements TranscriptionProvider {
  readonly name = 'mock';
  async transcribe(): Promise<any> {
    return { provider: 'mock', segments: [], language: null, status: 'no_audio' };
  }
}

/** Returns a fixed evidence payload (mocks the paid multimodal model). */
class MockModel implements ModelProvider {
  readonly name = 'mock';
  constructor(private evidence: MediaPlaceEvidence) {}
  async analyze(_input: AnalyzeInput): Promise<AnalyzeOutput> {
    return { provider: 'mock', promptVersion: 'mock-v1', evidence: this.evidence };
  }
}

const STRONG_EVIDENCE: MediaPlaceEvidence = {
  places: [
    {
      name: 'Capones Cucina',
      category: 'restaurant',
      categoryConfidence: 0.9,
      categoryEvidenceTags: ['test_fixture'],
      address: '19688 Beach Blvd',
      city: 'Huntington Beach',
      region: 'CA',
      country: 'USA',
      coordinates: null,
      role: 'primary',
      confidence: 0.92,
      explicitEvidence: [
        { timestampSeconds: 2, source: 'visible_text', value: '19688 BEACH BLVD' },
        { timestampSeconds: 3, source: 'visible_text', value: 'CAPONES CUCINA' },
      ],
      inferredEvidence: [],
      memoryCue: null,
      memoryCueEvidence: [],
    },
  ],
  multipleIntentionalPlaces: false,
  insufficientEvidence: false,
  warnings: [],
};

const INSUFFICIENT_EVIDENCE: MediaPlaceEvidence = {
  places: [],
  multipleIntentionalPlaces: false,
  insufficientEvidence: true,
  warnings: ['no_place_signal'],
};

// A primary place WITH an explicit street address (so the resolver stub would
// auto_save) but BELOW the media confidence threshold — production
// planPostResolve must downgrade this to needs_help (never a silent save).
const WEAK_CONFIDENCE_EVIDENCE: MediaPlaceEvidence = {
  places: [
    {
      name: 'Capones Cucina',
      category: 'restaurant',
      categoryConfidence: 0.9,
      categoryEvidenceTags: ['test_fixture'],
      address: '19688 Beach Blvd',
      city: 'Huntington Beach',
      region: 'CA',
      country: 'USA',
      coordinates: null,
      role: 'primary',
      confidence: 0.6, // < DEFAULT_MEDIA_AUTOSAVE_MIN_CONFIDENCE (0.7)
      explicitEvidence: [
        { timestampSeconds: 2, source: 'visible_text', value: '19688 BEACH BLVD' },
      ],
      inferredEvidence: [],
      memoryCue: null,
      memoryCueEvidence: [],
    },
  ],
  multipleIntentionalPlaces: false,
  insufficientEvidence: false,
  warnings: [],
};

// ---------------------------------------------------------------------------
// E2E finalize server. Performs ONLY the mission-mandated MOCKED I/O
// (deterministic Google-Places stub + idempotent saveForUser + notification
// reservation) and delegates EVERY auth / ownership / idempotency / routing
// decision to the PRODUCTION modules imported above — the same decision code
// path the Deno finalizeMediaTask runs. Only the DB side effects are local.
// ---------------------------------------------------------------------------

async function reserveNotificationOnce(client: SupabaseClient, jobId: string, patch: Record<string, unknown>) {
  // Guarded on processing_metadata so a replay / concurrent sweep reserves once.
  const { data } = await client
    .from('share_jobs')
    .update({ ...patch, notification_status: 'pending', notification_next_attempt_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'processing_metadata')
    .select('id')
    .maybeSingle();
  return !!data;
}

/** Idempotent place + saved_place (mocks the Places lookup + saveForUser). */
async function saveForUserStub(
  client: SupabaseClient,
  job: { id: string; user_id: string },
  task: { canonical_url?: string | null; source_url?: string | null },
  place: { name: string; address: string | null; city: string | null; region: string | null },
): Promise<string> {
  const gid = `test-${place.name}`.toLowerCase().replace(/\s+/g, '-');
  let placeId: string;
  const { data: existingPlace } = await client.from('places').select('id').eq('google_place_id', gid).maybeSingle();
  if (existingPlace) placeId = existingPlace.id;
  else {
    const { data: np } = await client
      .from('places')
      .insert({ google_place_id: gid, name: place.name, formatted_address: `${place.address}, ${place.city}, ${place.region}`, latitude: 33.66, longitude: -117.99, category: 'restaurant' })
      .select('id')
      .single();
    placeId = np!.id;
  }
  const { data: existingSaved } = await client.from('saved_places').select('id').eq('user_id', job.user_id).eq('place_id', placeId).maybeSingle();
  if (existingSaved) return existingSaved.id;
  const { data: sp } = await client
    .from('saved_places')
    .insert({ user_id: job.user_id, place_id: placeId, source_type: 'instagram', source_url: task.canonical_url ?? task.source_url })
    .select('id')
    .single();
  return sp!.id;
}

function makeFinalizeServer(
  client: SupabaseClient,
  serviceRoleKey: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const reply = (o: unknown, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };

      // PRODUCTION request auth: bearer must equal the service-role key.
      if (!authorizeServiceRoleBearer(req.headers['authorization'] ?? null, serviceRoleKey)) {
        return reply({ error: 'unauthorized' }, 401);
      }

      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body: any = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {};
      }

      const taskId = typeof body.taskId === 'string' ? body.taskId : '';
      if (!taskId) return reply({ error: 'missing_task_id' }, 400);
      const { data: task } = await client.from('share_media_tasks').select('*').eq('id', taskId).maybeSingle();
      if (!task) return reply({ error: 'task_not_found' }, 404);

      // OWNERSHIP: the parent is ALWAYS derived from the task's FK, never body.jobId.
      const { data: job } = task.share_job_id
        ? await client.from('share_jobs').select('*').eq('id', task.share_job_id).maybeSingle()
        : { data: null as any };

      const outcome: 'evidence' | 'unavailable' | 'failed' =
        body.outcome === 'unavailable' ? 'unavailable' : body.outcome === 'failed' ? 'failed' : 'evidence';
      const parsed = outcome === 'evidence' ? parseMediaEvidence(body.evidence) : ({ ok: false, error: outcome } as const);
      const rendered = parsed.ok ? renderMediaEvidenceCaption(parsed.value) : { title: '', description: '', renderedPlaces: 0 };

      // PRODUCTION pre-resolve routing (terminal-task + parent idempotency).
      const pre = planPreResolve({
        taskStatus: task.status,
        parentStatus: job?.status ?? 'missing',
        outcome,
        evidenceParseOk: parsed.ok,
        renderedPlaces: rendered.renderedPlaces,
      });

      if (pre.action === 'idempotent_task_terminal') {
        return reply({ ok: true, idempotent: true, taskStatus: pre.taskStatus });
      }
      if (!job) {
        await client.from('share_media_tasks').update({ status: 'failed', failure_code: 'parent_job_missing' }).eq('id', taskId);
        return reply({ error: 'parent_job_missing' }, 404);
      }
      if (pre.action === 'parent_already_terminal') {
        await client.from('share_media_tasks').update({ status: 'completed', progress_stage: 'cleanup' }).eq('id', taskId);
        return reply({ ok: true, parentAlreadyTerminal: true, jobStatus: job.status });
      }
      if (pre.action === 'manual_fallback') {
        await reserveNotificationOnce(client, job.id, { status: 'needs_help', decision: 'manual_fallback', progress_stage: 'manual' });
        await client.from('share_media_tasks').update({ status: pre.taskTerminalStatus, failure_code: pre.failureCode, progress_stage: 'cleanup' }).eq('id', taskId);
        return reply({ ok: true, route: 'manual', reason: pre.failureCode });
      }

      // pre.action === 'resolve' guarantees the evidence parsed.
      if (!parsed.ok) return reply({ error: 'unexpected_parse_state' }, 500);
      const ev = parsed.value;

      // Deterministic Google-Places stub standing in for resolveSharedPlace: a
      // primary place with an explicit street address "verifies" (auto_save);
      // otherwise the resolver would ask for a confirmation. The EXTRA media
      // auto-save gate + any downgrade come from PRODUCTION planPostResolve.
      const primary = ev.places.find((p) => p.role === 'primary') ?? ev.places[0]!;
      const resolverRoute: 'auto_save' | 'needs_help' = primary.address ? 'auto_save' : 'needs_help';
      const post = planPostResolve({
        route: resolverRoute,
        needsHelpMode: 'single',
        autoSaveEligible: resolverRoute === 'auto_save' && mediaEvidenceAutoSaveEligible(ev),
      });

      if (post.action === 'auto_save') {
        const savedId = await saveForUserStub(client, job, task, primary);
        await reserveNotificationOnce(client, job.id, { status: 'completed', decision: 'auto_save', saved_place_id: savedId, progress_stage: 'completed', completed_at: new Date().toISOString() });
        await client.from('share_media_tasks').update({ status: 'completed', progress_stage: 'cleanup' }).eq('id', taskId);
        return reply({ ok: true, route: 'auto_save' });
      }

      await reserveNotificationOnce(client, job.id, { status: 'needs_help', decision: 'candidate_confirmation', progress_stage: post.mode });
      await client.from('share_media_tasks').update({ status: 'completed', progress_stage: 'cleanup' }).eq('id', taskId);
      return reply({ ok: true, route: 'needs_help', downgraded: post.downgraded });
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/finalize`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// ---------------------------------------------------------------------------

test('full synthetic queue -> finalizer path', { skip: !ENABLED }, async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip('ffmpeg not available');
    return;
  }

  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userId = '11111111-1111-4111-8111-111111111111'; // seeded by scripts/seedTestUsers.sql
  const userIdB = '22222222-2222-4222-8222-222222222222'; // seeded by scripts/seedTestUsers.sql
  const work = await mkdtemp(path.join(tmpdir(), 'nearr-e2e-'));
  const media = await generateSyntheticMedia(work);
  const finalizeSrv = await makeFinalizeServer(client, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Server-to-server calls carry the service-role bearer, exactly as the worker
  // does (verifyPlaceEvidence). Wrong/absent bearer must be rejected.
  const SERVICE_BEARER = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`;
  const finalizePost = (payload: Record<string, unknown>, authHeader: string | null = SERVICE_BEARER) =>
    fetch(finalizeSrv.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(authHeader ? { authorization: authHeader } : {}) },
      body: JSON.stringify(payload),
    });

  const baseCfg = loadConfig();
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'nearr-e2e-temps-'));

  function buildCtx(model: ModelProvider, resolver: MediaResolver): ServerContext {
    const cfg: WorkerConfig = {
      ...baseCfg,
      port: 0, // OS-assigned free port per run
      workerSecret: 'e2e-secret',
      finalizeUrl: finalizeSrv.url,
      supabaseUrl: process.env.SUPABASE_URL!,
      supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tempDir: tempRoot,
      maxConcurrency: 1,
      claimBatchSize: 5,
    };
    const deps: TaskDeps = { cfg, client, resolvers: [resolver], transcription: new MockTranscription(), model, ocr: selectOcrProvider(cfg) };
    return { cfg, deps };
  }

  async function seedTask(): Promise<{ jobId: string; taskId: string }> {
    const { data: job } = await client
      .from('share_jobs')
      .insert({ user_id: userId, source_url: `https://ig/e2e/${randomUUID()}`, source_platform: 'instagram', status: 'processing_metadata', progress_stage: 'checking_video' })
      .select('id')
      .single();
    const { data: task } = await client
      .from('share_media_tasks')
      .insert({ share_job_id: job!.id, user_id: userId, source_url: `https://ig/e2e/${randomUUID()}`, platform: 'instagram', status: 'queued', progress_stage: 'queued' })
      .select('id')
      .single();
    return { jobId: job!.id, taskId: task!.id };
  }

  async function runServerOnce(ctx: ServerContext): Promise<void> {
    const server = startServer(ctx);
    // Give listen() a tick.
    await new Promise((r) => setTimeout(r, 150));
    const addr = server.address() as any;
    const res = await fetch(`http://127.0.0.1:${addr.port}/v1/process-media-tasks`, {
      method: 'POST',
      headers: { authorization: 'Bearer e2e-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ trigger: 'test', limit: 5 }),
    });
    assert.equal(res.ok, true);
    await new Promise((r) => server.close(r));
  }

  async function tempEmpty(): Promise<boolean> {
    const entries = await readdir(tempRoot).catch(() => [] as string[]);
    return entries.length === 0;
  }

  try {
    // ---- Scenario 1: SAVE (explicit address) -> completed + saved_place -----
    {
      const { jobId, taskId } = await seedTask();
      await runServerOnce(buildCtx(new MockModel(STRONG_EVIDENCE), new MockResolver(media.videoWithAudio)));

      const { data: job } = await client.from('share_jobs').select('*').eq('id', jobId).maybeSingle();
      assert.equal(job!.status, 'completed', 'save: parent completed');
      assert.ok(job!.saved_place_id, 'save: saved_place_id set');
      assert.equal(job!.notification_status, 'pending', 'save: notification reserved once');
      const { data: taskRow } = await client.from('share_media_tasks').select('status').eq('id', taskId).maybeSingle();
      assert.equal(taskRow!.status, 'completed', 'save: task completed');

      // ---- Replay the callback: no duplicate save / notification ----------
      const notifBefore = { status: job!.notification_status, next: job!.notification_next_attempt_at };
      const replay = await finalizePost({ mode: 'finalize_media_task', taskId, outcome: 'evidence', evidence: STRONG_EVIDENCE });
      const replayBody = (await replay.json()) as any;
      assert.equal(replayBody.idempotent, true, 'replay is idempotent (task terminal)');
      const placeRow = await client.from('places').select('id').eq('google_place_id', 'test-capones-cucina').single();
      const after = await client.from('saved_places').select('id').eq('user_id', userId).eq('place_id', placeRow.data!.id);
      assert.equal(after.data?.length, 1, 'replay did not create a duplicate saved_place');
      const { data: jobAfter } = await client.from('share_jobs').select('notification_status,notification_next_attempt_at').eq('id', jobId).maybeSingle();
      assert.equal(jobAfter!.notification_status, notifBefore.status, 'replay did not re-reserve a notification');
      assert.equal(jobAfter!.notification_next_attempt_at, notifBefore.next, 'replay left the notification reservation unchanged');
      console.log('E2E scenario 1 (save + replay): PASS');
    }

    // ---- Scenario 2: NEEDS_HELP (insufficient evidence) --------------------
    {
      const { jobId, taskId } = await seedTask();
      await runServerOnce(buildCtx(new MockModel(INSUFFICIENT_EVIDENCE), new MockResolver(media.videoNoAudio)));
      const { data: job } = await client.from('share_jobs').select('*').eq('id', jobId).maybeSingle();
      assert.equal(job!.status, 'needs_help', 'needs_help: parent needs_help');
      assert.equal(job!.saved_place_id, null, 'needs_help: no saved_place');
      const { data: taskRow } = await client.from('share_media_tasks').select('status').eq('id', taskId).maybeSingle();
      assert.ok(['needs_help', 'failed', 'completed'].includes(taskRow!.status), 'needs_help: task terminal');
      console.log('E2E scenario 2 (needs_help): PASS');
    }

    // ---- Scenario 3: wrong taskId is rejected ------------------------------
    {
      const res = await finalizePost({ mode: 'finalize_media_task', taskId: randomUUID(), outcome: 'evidence', evidence: STRONG_EVIDENCE });
      assert.equal(res.status, 404, 'unknown taskId rejected');
      console.log('E2E scenario 3 (mismatch rejected): PASS');
    }

    // ---- Scenario 4: cancellation cascade + no processing ------------------
    {
      const { jobId, taskId } = await seedTask();
      await client.from('share_jobs').update({ status: 'cancelled' }).eq('id', jobId);
      const { data: taskRow } = await client.from('share_media_tasks').select('status').eq('id', taskId).maybeSingle();
      assert.equal(taskRow!.status, 'cancelled', 'cancel cascade set task cancelled');
      // Claim must skip it (parent not processing + task terminal).
      await runServerOnce(buildCtx(new MockModel(STRONG_EVIDENCE), new MockResolver(media.videoWithAudio)));
      const { data: job } = await client.from('share_jobs').select('status,saved_place_id').eq('id', jobId).maybeSingle();
      assert.equal(job!.status, 'cancelled', 'cancelled parent stays cancelled');
      assert.equal(job!.saved_place_id, null, 'cancelled parent never saved');
      console.log('E2E scenario 4 (cancellation respected): PASS');
    }

    // ---- Scenario 5: callback authentication (production guard) -------------
    {
      const wrong = await finalizePost({ mode: 'finalize_media_task', taskId: randomUUID(), outcome: 'evidence' }, 'Bearer WRONG');
      assert.equal(wrong.status, 401, 'wrong bearer rejected');
      const none = await finalizePost({ mode: 'finalize_media_task', taskId: randomUUID(), outcome: 'evidence' }, null);
      assert.equal(none.status, 401, 'missing bearer rejected');
      console.log('E2E scenario 5 (callback auth): PASS');
    }

    // ---- Scenario 6: ownership derived from the task FK, never the body -----
    {
      const { jobId, taskId } = await seedTask(); // task + FK parent owned by user_a
      const { data: otherJob } = await client
        .from('share_jobs')
        .insert({ user_id: userIdB, source_url: `https://ig/e2e/${randomUUID()}`, source_platform: 'instagram', status: 'processing_metadata', progress_stage: 'checking_video' })
        .select('id')
        .single();
      // Body names user_b's job — the finalizer must IGNORE it and use the FK.
      const res = await finalizePost({ mode: 'finalize_media_task', taskId, jobId: otherJob!.id, userId: userIdB, outcome: 'evidence', evidence: STRONG_EVIDENCE });
      assert.equal(res.status, 200, 'ownership: finalize ok');
      const { data: fkJob } = await client.from('share_jobs').select('status,user_id,saved_place_id').eq('id', jobId).maybeSingle();
      assert.equal(fkJob!.status, 'completed', 'ownership: FK parent finalized');
      assert.equal(fkJob!.user_id, userId, 'ownership: finalized the task FK owner (user_a)');
      assert.ok(fkJob!.saved_place_id, 'ownership: saved under the FK owner');
      const { data: bodyJob } = await client.from('share_jobs').select('status,saved_place_id').eq('id', otherJob!.id).maybeSingle();
      assert.equal(bodyJob!.status, 'processing_metadata', 'ownership: body jobId untouched');
      assert.equal(bodyJob!.saved_place_id, null, 'ownership: body jobId never saved');
      console.log('E2E scenario 6 (ownership from FK): PASS');
    }

    // ---- Scenario 7: media auto-save gate downgrade (never a silent save) ---
    {
      const { jobId } = await seedTask();
      await runServerOnce(buildCtx(new MockModel(WEAK_CONFIDENCE_EVIDENCE), new MockResolver(media.videoWithAudio)));
      const { data: job } = await client.from('share_jobs').select('status,saved_place_id').eq('id', jobId).maybeSingle();
      assert.equal(job!.status, 'needs_help', 'downgrade: resolver auto_save downgraded to needs_help');
      assert.equal(job!.saved_place_id, null, 'downgrade: not silently saved');
      console.log('E2E scenario 7 (auto-save gate downgrade): PASS');
    }

    // ---- Cleanup invariant --------------------------------------------------
    assert.equal(await tempEmpty(), true, 'temp root is empty after all jobs');
    console.log('E2E temp cleanup: PASS');
  } finally {
    await finalizeSrv.close();
    await rm(work, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});
