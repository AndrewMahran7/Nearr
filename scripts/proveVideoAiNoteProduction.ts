import { randomBytes, randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PRODUCTION_REF = 'rlqvxdwtetxsqxhqztkw';
const ACK = 'I_ACKNOWLEDGE_EPHEMERAL_PRODUCTION_WRITE';
const SOURCE_URL = (process.env.NEARR_PRODUCTION_AI_NOTE_URL ?? '').trim();
const EXPECTED_USER_NOTE = (process.env.NEARR_PRODUCTION_AI_USER_NOTE ?? '').trim();
const CLEANUP_SAVED_PLACE_ID = (process.env.NEARR_PRODUCTION_AI_NOTE_CLEANUP_SAVED_PLACE_ID ?? '').trim();
const terminalJobs = new Set(['completed', 'needs_help', 'failed', 'cancelled']);
const terminalTasks = new Set(['completed', 'needs_help', 'failed', 'cancelled']);
type Row = Record<string, any>;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function objects(value: unknown, out: Row[] = []): Row[] {
  if (Array.isArray(value)) for (const child of value) objects(child, out);
  else if (value && typeof value === 'object') {
    const row = value as Row;
    if (text(row.googlePlaceId) && text(row.name)) out.push(row);
    for (const child of Object.values(row)) objects(child, out);
  }
  return out;
}

async function poll<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!done(last) && Date.now() < deadline) {
    await wait(3_000);
    last = await read();
  }
  if (!done(last)) throw new Error('production smoke poll timed out');
  return last;
}

async function readOne(client: SupabaseClient, table: string, select: string, column: string, value: string): Promise<Row | null> {
  const result = await client.from(table).select(select).eq(column, value).maybeSingle();
  if (result.error) throw new Error(`${table} read failed: ${result.error.message}`);
  return result.data as Row | null;
}

async function main(): Promise<void> {
  if (process.env.NEARR_PRODUCTION_AI_NOTE_SMOKE !== ACK) throw new Error('production smoke acknowledgment missing');
  const supabaseUrl = text(process.env.SUPABASE_URL);
  const serviceKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (new URL(supabaseUrl).hostname.split('.')[0] !== PRODUCTION_REF) throw new Error('refusing non-Production Supabase target');
  if (!serviceKey) throw new Error('Production service-role key unavailable');

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (CLEANUP_SAVED_PLACE_ID) {
    const saved = await readOne(admin, 'saved_places', 'user_id,place_id', 'id', CLEANUP_SAVED_PLACE_ID);
    if (!saved) {
      console.log('PRODUCTION_SMOKE_CLEANUP savedAlreadyGone=true');
      return;
    }
    const found = await admin.auth.admin.getUserById(saved.user_id);
    if (found.error) throw new Error(`cleanup user lookup failed: ${found.error.message}`);
    if (!text(found.data.user?.email).startsWith('nearr-production-ai-note-')) {
      throw new Error('refusing to delete a non-smoke Production user');
    }
    const deleted = await admin.auth.admin.deleteUser(saved.user_id);
    if (deleted.error) throw new Error(`cleanup user delete failed: ${deleted.error.message}`);
    const remaining = await admin.from('saved_places').select('id', { count: 'exact', head: true }).eq('place_id', saved.place_id);
    if (!remaining.error && remaining.count === 0) await admin.from('places').delete().eq('id', saved.place_id);
    console.log('PRODUCTION_SMOKE_CLEANUP verifiedPrefix=true userDeleted=true orphanPlaceChecked=true');
    return;
  }
  if (!SOURCE_URL.startsWith('https://www.instagram.com/reel/')) throw new Error('a fixed public Instagram reel is required');
  const password = `Nz!${randomUUID()}${randomBytes(6).toString('hex')}`;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const email = `nearr-production-ai-note-${stamp}-${randomBytes(4).toString('hex')}@nearr.invalid`;
  let userId: string | null = null;
  let insertedPlaceId: string | null = null;
  try {
    const created = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { purpose: 'nearr_production_ai_note_smoke' },
    });
    if (created.error || !created.data.user) throw new Error(`ephemeral user creation failed: ${created.error?.message ?? 'no user'}`);
    userId = created.data.user.id;
    // Keep the service-role observer immutable; signing in mutates a client's
    // auth session and would silently downgrade subsequent admin reads.
    const authClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await authClient.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw new Error(`ephemeral sign-in failed: ${signedIn.error?.message ?? 'no session'}`);
    const token = signedIn.data.session.access_token;
    const owner = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const response = await fetch(`${supabaseUrl}/functions/v1/create-share-job`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: serviceKey },
      body: JSON.stringify({ url: SOURCE_URL, clientRequestId: `prod-ai-note-${randomUUID()}` }),
    });
    const submitted = await response.json().catch(() => null) as Row | null;
    const jobId = text(submitted?.jobId ?? submitted?.id);
    if (!response.ok || !jobId) throw new Error(`create-share-job failed HTTP ${response.status}`);
    console.log(`PRODUCTION_SMOKE_STAGE submitted job=${jobId}`);

    const job = await poll(
      async () => {
        const row = await readOne(admin, 'share_jobs', 'id,status,decision,saved_place_id,source_platform,candidate_payload', 'id', jobId);
        if (!row) throw new Error('share job disappeared');
        return row;
      },
      (row) => terminalJobs.has(String(row.status)),
      600_000,
    );
    let savedPlaceId = text(job.saved_place_id) || null;
    let confirmedCandidate = false;
    if (!savedPlaceId && ['candidate_confirmation', 'multi_candidate_confirmation'].includes(String(job.decision))) {
      const candidate = objects(job.candidate_payload)[0];
      if (!candidate || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) {
        throw new Error('Production result had no persistable confirmation candidate');
      }
      const found = await owner.from('places').select('id').eq('google_place_id', candidate.googlePlaceId).maybeSingle();
      if (found.error) throw new Error(`candidate lookup failed: ${found.error.message}`);
      let placeId = text(found.data?.id);
      if (!placeId) {
        const inserted = await owner.from('places').insert({
          google_place_id: candidate.googlePlaceId, name: candidate.name,
          formatted_address: candidate.formattedAddress ?? null,
          latitude: candidate.latitude, longitude: candidate.longitude,
          google_types: Array.isArray(candidate.types) ? candidate.types : [],
        }).select('id').single();
        if (inserted.error || !inserted.data) throw new Error(`candidate insert failed: ${inserted.error?.message ?? 'no row'}`);
        placeId = inserted.data.id;
        insertedPlaceId = placeId;
      }
      const saved = await owner.from('saved_places').insert({
        user_id: userId, place_id: placeId, source_type: job.source_platform, source_url: SOURCE_URL,
      }).select('id').single();
      if (saved.error || !saved.data) throw new Error(`candidate save failed: ${saved.error?.message ?? 'no row'}`);
      savedPlaceId = saved.data.id;
      const resolved = await owner.rpc('resolve_share_job', { p_job_id: jobId, p_saved_place_id: savedPlaceId });
      if (resolved.error || resolved.data !== true) throw new Error(`candidate resolution failed: ${resolved.error?.message ?? String(resolved.data)}`);
      confirmedCandidate = true;
    }
    if (!savedPlaceId) throw new Error(`Production video did not become a save: ${job.decision}`);
    if (EXPECTED_USER_NOTE) {
      const update = await owner.from('saved_places').update({ notes: EXPECTED_USER_NOTE }).eq('id', savedPlaceId).eq('user_id', userId);
      if (update.error) throw new Error(`user note write failed: ${update.error.message}`);
    }
    console.log(`PRODUCTION_SMOKE_STAGE saved savedPlace=${savedPlaceId} confirmed=${confirmedCandidate}`);

    const task = await poll(
      async () => {
        const result = await admin.from('share_media_tasks').select('*')
          .eq('saved_place_id', savedPlaceId!).eq('task_kind', 'ai_note_enrichment').maybeSingle();
        if (result.error) throw new Error(`AI-note task read failed: ${result.error.message}`);
        return result.data as Row | null;
      },
      (row) => !!row && terminalTasks.has(String(row.status)),
      600_000,
    );
    const saved = await readOne(admin, 'saved_places', 'id,ai_note,notes', 'id', savedPlaceId);
    const note = text(saved?.ai_note);
    const validOutcome = ['accepted', 'accepted_after_retry', 'already_present'].includes(String(task?.ai_note_outcome));
    const proof = {
      target: PRODUCTION_REF,
      jobId,
      savedPlaceId,
      taskId: task?.id ?? null,
      jobDecision: job.decision,
      confirmedCandidate,
      taskStatus: task?.status ?? null,
      taskOutcome: task?.ai_note_outcome ?? null,
      promptVersion: task?.prompt_version ?? null,
      modelCalls: task?.model_calls ?? null,
      retried: task?.ai_note_outcome === 'accepted_after_retry',
      aiNote: note || null,
      userNotePreserved: EXPECTED_USER_NOTE ? saved?.notes === EXPECTED_USER_NOTE : !text(saved?.notes),
      legacyPattern: /^That\s+.+\s+looked unreal[.!?]*$/i.test(note),
      compact: note.length > 0 && note.length <= 220 && (note.match(/[.!?](?=\s|$)/g) ?? []).length <= 1,
    };
    console.log(`PRODUCTION_SMOKE_RESULT ${JSON.stringify(proof)}`);
    if (!validOutcome || !proof.aiNote || !proof.userNotePreserved || proof.legacyPattern || !proof.compact) {
      throw new Error('Production AI-note smoke failed its release assertions');
    }
  } finally {
    if (userId) {
      const deleted = await admin.auth.admin.deleteUser(userId);
      console.log(`PRODUCTION_SMOKE_CLEANUP userDeleted=${!deleted.error}`);
    }
    if (insertedPlaceId) {
      const remaining = await admin.from('saved_places').select('id', { count: 'exact', head: true }).eq('place_id', insertedPlaceId);
      if (!remaining.error && remaining.count === 0) await admin.from('places').delete().eq('id', insertedPlaceId);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
