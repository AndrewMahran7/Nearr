// Server-controlled cleanup executor for abandoned/converted anonymous users.
// Scheduling and secret provisioning are intentionally a separate manual
// deployment ticket. This function is never called by the mobile client.
// @ts-nocheck -- Deno runtime.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const expectedSecret = Deno.env.get('ANONYMOUS_CLEANUP_WORKER_SECRET') ?? '';
  const suppliedSecret = req.headers.get('x-nearr-worker-secret') ?? '';
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceKey) return json({ ok: false, error: 'server_misconfigured' }, 500);
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const abandonedTtl = Deno.env.get('ANONYMOUS_ONBOARDING_TTL') ?? '30 days';
  const convertedGrace = Deno.env.get('ANONYMOUS_CONVERTED_GRACE') ?? '24 hours';
  const { data: candidates, error } = await admin.rpc(
    'list_anonymous_onboarding_cleanup_candidates',
    { p_abandoned_ttl: abandonedTtl, p_converted_grace: convertedGrace, p_limit: 100 },
  );
  if (error) return json({ ok: false, error: 'candidate_query_failed' }, 500);

  let removed = 0;
  const failures: Array<{ session: string; step: string }> = [];
  for (const candidate of candidates ?? []) {
    const userId = candidate.anonymous_user_id;
    const sessionId = candidate.onboarding_session_id;
    const user = await admin.auth.admin.getUserById(userId);
    if (user.error && user.error.status !== 404) {
      failures.push({ session: sessionId, step: 'auth_lookup' });
      continue;
    }
    if (user.data.user && user.data.user.is_anonymous !== true) {
      failures.push({ session: sessionId, step: 'permanent_user_guard' });
      continue;
    }

    // Remove service-only diagnostics with potentially identifying source
    // content. Product rows with CASCADE disappear with auth.users. Analytics
    // is intentionally untouched; its auth FK becomes null and its independent
    // onboarding_session_id remains available for aggregate funnel analysis.
    for (const table of ['feedback', 'share_agent_runs', 'share_extraction_failures']) {
      const cleared = await admin.from(table).delete().eq('user_id', userId);
      if (cleared.error) {
        failures.push({ session: sessionId, step: table });
        break;
      }
    }
    if (failures.some((failure) => failure.session === sessionId)) continue;

    const grants = await admin.from('onboarding_account_transfer_grants')
      .delete().eq('onboarding_session_id', sessionId);
    if (grants.error) {
      failures.push({ session: sessionId, step: 'transfer_grants' });
      continue;
    }
    if (user.data.user) {
      const deletion = await admin.auth.admin.deleteUser(userId);
      if (deletion.error && deletion.error.status !== 404) {
        failures.push({ session: sessionId, step: 'auth_delete' });
        continue;
      }
    }
    const compacted = await admin.from('onboarding_v2_sessions').update({
      anonymous_user_id: null,
      cleanup_completed_at: new Date().toISOString(),
      cleanup_reason: candidate.reason,
      state: { terminal_stage: candidate.reason === 'converted_source' ? 'converted' : 'abandoned' },
    }).eq('id', sessionId);
    if (compacted.error) {
      failures.push({ session: sessionId, step: 'session_anonymize' });
      continue;
    }
    removed += 1;
  }
  return json({ ok: failures.length === 0, removed, failures });
});
