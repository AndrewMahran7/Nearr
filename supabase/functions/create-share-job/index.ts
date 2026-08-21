// supabase/functions/create-share-job/index.ts
//
// Authenticated, fast job-creation endpoint for the async share flow.
//
// Contract:
//   Request  (POST): { "url": "...", "clientRequestId": "..." }
//                    Authorization: Bearer <supabase access token>
//   Response (200):  { "jobId": "...", "status": "queued", "duplicate": false }
//
// Responsibilities (and NOTHING more — this must return fast):
//   1. Authenticate the user (no unauthenticated jobs). Supabase Anonymous
//      Sign-In users are intentionally valid: they have a verified auth user
//      id and remain inside the same owner/RLS boundary as permanent users.
//   2. Validate the URL is a public http/https URL (SSRF guard).
//   3. Normalize known platform tracking params.
//   4. Create OR return an idempotent job.
//   5. Respond. Extraction happens later in process-share-jobs.
//
// It NEVER runs extraction, NEVER downloads media, and NEVER stores the auth
// token in the job row or logs.

// @ts-nocheck — Deno runtime.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

import { normalizeShareUrl } from '../../../lib/shareAgent/tiktokUrl.ts';
import { inspectFacebookUrl } from '../../../lib/shareAgent/facebookUrl.ts';
import { detectPlatform } from '../process-share-link/platform/detectPlatform.ts';
import { validateShareUrl } from './urlValidation.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(unknown)';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // ---- Parse body ------------------------------------------------
  let body: { url?: string; clientRequestId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // ---- Env -------------------------------------------------------
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  // ---- Auth (Authorization header only) --------------------------
  const headerAuth = req.headers.get('authorization') ?? '';
  const bearer = headerAuth.toLowerCase().startsWith('bearer ')
    ? headerAuth.slice(7).trim()
    : '';
  const accessToken = bearer.trim();
  if (!accessToken) {
    return json({ error: 'missing_auth' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return json({ error: 'invalid_auth' }, 401);
  }
  const userId = userData.user.id;

  // ---- Validate + normalize URL ----------------------------------
  const validation = validateShareUrl(body.url);
  if (!validation.ok) {
    console.log(`[share-job] rejected reason=${validation.reason}`);
    return json({ error: 'invalid_url', reason: validation.reason }, 400);
  }
  const originalUrl = validation.url;
  const normalized = normalizeShareUrl(originalUrl);
  const canonicalUrl = normalized.url || originalUrl;
  const platform = detectPlatform(canonicalUrl);
  if (platform === 'facebook') {
    const facebook = inspectFacebookUrl(canonicalUrl);
    if (!facebook?.supported) {
      console.log('[share-job] rejected reason=unsupported_facebook_url');
      return json({ error: 'unsupported_facebook_url' }, 400);
    }
  }

  const idempotencyKey =
    typeof body.clientRequestId === 'string' && body.clientRequestId.trim()
      ? body.clientRequestId.trim().slice(0, 200)
      : null;

  const dedupeWindowSeconds = 90;
  const { data: created, error: createErr } = await admin.rpc('create_share_job_for_user', {
    p_user_id: userId,
    p_source_url: originalUrl,
    p_canonical_url: canonicalUrl,
    p_source_platform: platform,
    p_idempotency_key: idempotencyKey,
    p_dedupe_window_seconds: dedupeWindowSeconds,
  });

  if (createErr || !Array.isArray(created) || created.length === 0) {
    console.log(`[share-job] create_failed host=${hostOf(canonicalUrl)} code=${(createErr as { code?: string })?.code ?? 'unknown'}`);
    return json({ error: 'create_failed' }, 500);
  }

  const row = created[0];
  if (row.duplicate) {
    console.log(`[share-job] duplicate_returned job_id=${row.job_id}`);
  } else {
    console.log(`[share-job] created job_id=${row.job_id} platform=${platform}`);
  }
  return json({ jobId: row.job_id, status: row.status, duplicate: !!row.duplicate });
});
