// Development-only authenticated reset for Onboarding V2 QA checkpoints.
// @ts-nocheck -- Deno runtime.

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const DEVELOPMENT_HOST = 'qnfxnmvxpjzfydgudtvs.supabase.co';
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

function isDevelopmentDeployment(supabaseUrl: string): boolean {
  try {
    return new URL(supabaseUrl).hostname === DEVELOPMENT_HOST;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!isDevelopmentDeployment(supabaseUrl)) return json({ ok: false, error: 'not_found' }, 404);
  if (!serviceRoleKey) return json({ ok: false, error: 'server_misconfigured' }, 500);

  let mode: string | null = null;
  try {
    mode = (await request.json())?.mode ?? null;
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400);
  }
  if (mode !== 'onboarding_only') return json({ ok: false, error: 'invalid_mode' }, 400);

  const header = request.headers.get('authorization') ?? '';
  const accessToken = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!accessToken) return json({ ok: false, error: 'missing_auth' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData?.user) return json({ ok: false, error: 'invalid_auth' }, 401);

  // The user id is derived solely from the verified token. Saves, jobs,
  // profiles, auth identities, and all non-onboarding data are untouched.
  const { error } = await admin
    .from('onboarding_v2_sessions')
    .delete()
    .eq('user_id', userData.user.id);
  if (error) {
    console.warn(`[onboarding-qa-reset] session_delete_failed code=${error.code ?? 'unknown'}`);
    return json({ ok: false, error: 'session_reset_failed' }, 503);
  }

  console.log(`[onboarding-qa-reset] complete user_ref=${userData.user.id.slice(0, 8)}`);
  return json({ ok: true, mode: 'onboarding_only' });
});
