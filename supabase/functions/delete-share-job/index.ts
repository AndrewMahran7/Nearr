// Authenticated physical share-job deletion. Queue removal never calls this;
// it uses archive_active_queue_for_user and preserves history/evidence.
// @ts-nocheck -- Deno runtime.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import {
  SHARE_EVIDENCE_BUCKET,
  deleteOwnedShareJob,
} from '../_shared/shareEvidenceLifecycle.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function bearer(header: string | null): string {
  const value = header?.trim() ?? '';
  return /^bearer\s+/i.test(value) ? value.replace(/^bearer\s+/i, '').trim() : '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'server_misconfigured' }, 500);

  const token = bearer(req.headers.get('authorization'));
  if (!token) return json({ ok: false, error: 'unauthorized' }, 401);
  let jobId = '';
  try {
    const body = await req.json();
    jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : '';
  } catch {
    // Invalid JSON is the same as a missing id.
  }
  if (!UUID.test(jobId)) return json({ ok: false, error: 'invalid_job_id' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return json({ ok: false, error: 'unauthorized' }, 401);
  const userId = userData.user.id;

  const { data: job, error: lookupError } = await admin
    .from('share_jobs')
    .select('id,user_id,candidate_payload')
    .eq('id', jobId)
    .maybeSingle();
  if (lookupError) {
    console.error(`[delete-share-job] lookup_failed user=${userId.slice(0, 8)} job=${jobId.slice(0, 8)}`);
    return json({ ok: false, error: 'lookup_failed' }, 500);
  }
  if (!job) return json({ ok: true, alreadyDeleted: true, evidenceRemoved: 0 });
  if (job.user_id !== userId) {
    console.warn(`[delete-share-job] owner_mismatch user=${userId.slice(0, 8)} job=${jobId.slice(0, 8)}`);
    return json({ ok: false, error: 'not_found' }, 404);
  }

  const result = await deleteOwnedShareJob({
    callerUserId: userId,
    job,
    removeEvidence: (paths) => admin.storage.from(SHARE_EVIDENCE_BUCKET).remove(paths),
    deleteRow: async () => {
      const { error } = await admin.from('share_jobs').delete().eq('id', jobId).eq('user_id', userId);
      return { error };
    },
  });
  if (result.status === 'evidence_cleanup_failed') {
    console.error(`[delete-share-job] evidence_cleanup_failed user=${userId.slice(0, 8)} job=${jobId.slice(0, 8)} attempted=${result.attemptedEvidenceObjects}`);
    return json({ ok: false, error: result.status, attempted: result.attemptedEvidenceObjects }, 502);
  }
  if (result.status !== 'deleted') {
    console.error(`[delete-share-job] row_delete_failed user=${userId.slice(0, 8)} job=${jobId.slice(0, 8)}`);
    return json({ ok: false, error: result.status }, 500);
  }
  console.log(`[delete-share-job] success user=${userId.slice(0, 8)} job=${jobId.slice(0, 8)} evidence=${result.removedEvidenceObjects}`);
  return json({ ok: true, alreadyDeleted: false, evidenceRemoved: result.removedEvidenceObjects });
});
