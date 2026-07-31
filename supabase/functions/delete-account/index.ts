// supabase/functions/delete-account/index.ts
//
// Account-deletion Edge Function (Apple App Review Guideline 5.1.1(v)).
//
// Permanently deletes the authenticated user's account and user-owned
// data. There is NO deactivation / soft-delete path — this is a hard
// delete of the Supabase Auth user plus the user's owned rows.
//
// Security model:
//   - Requires a valid `Authorization: Bearer <access_token>` header.
//   - The caller is authenticated with a server-side service-role admin
//     client via `auth.getUser(token)`.
//   - The user id is derived EXCLUSIVELY from the verified token. A user
//     id / email in the request body is ignored (see authToken.ts).
//   - The service-role secret lives only in the function environment
//     (SUPABASE_SERVICE_ROLE_KEY, injected by the Supabase runtime). It is
//     never returned to or accepted from the client.
//   - Only POST (and OPTIONS for CORS) are accepted.
//   - Access tokens, service-role secrets, and emails are never logged.
//
// Deletion order (must delete user-owned rows that do NOT cascade BEFORE
// removing the auth user):
//   1. analytics_events        (FK ON DELETE SET NULL → delete explicitly)
//   2. feedback                (FK ON DELETE SET NULL → delete explicitly)
//   3. share_agent_runs        (FK ON DELETE SET NULL → delete explicitly)
//   4. share_extraction_failures (FK ON DELETE SET NULL → delete explicitly)
//   5. auth.users delete → cascades profiles, saved_places,
//      notification_events (all FK ON DELETE CASCADE).
//
// Canonical `places` rows are shared across users and are intentionally
// NEVER deleted here.

// @ts-nocheck — Deno runtime.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { CORS_HEADERS, preflight } from './cors.ts';
import { extractBearerToken, resolveDeleteAuthority } from './authToken.ts';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Short, non-sensitive reference for correlating logs (not full uuid/PII). */
function userRef(userId: string): string {
  return userId ? userId.slice(0, 8) : 'unknown';
}

// User-owned tables whose foreign key is ON DELETE SET NULL — these would
// otherwise keep orphaned, still-user-linked rows after the auth user is
// removed, so we delete them explicitly first.
const EXPLICIT_DELETE_TABLES = [
  'analytics_events',
  'feedback',
  'share_agent_runs',
  'share_extraction_failures',
] as const;

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[delete-account] misconfigured: missing supabase env');
    return json({ ok: false, error: 'server_misconfigured' }, 500);
  }

  // ---- Authenticate ------------------------------------------------
  const token = extractBearerToken(req.headers.get('authorization'));
  if (!token) {
    console.warn('[delete-account] rejected: missing bearer token');
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    console.warn('[delete-account] rejected: invalid token');
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  // Body is parsed only to detect (and log-then-ignore) a forged id. The
  // deletion authority is ALWAYS the token user.
  let bodyUserId: unknown = undefined;
  try {
    const body = await req.json();
    bodyUserId = body?.userId ?? body?.user_id ?? body?.id;
  } catch {
    // No/invalid body is fine — the token is the sole authority.
  }

  const { userId, ignoredBodyUserId } = resolveDeleteAuthority({
    authenticatedUserId: userData.user.id,
    requestBodyUserId: bodyUserId,
  });
  if (ignoredBodyUserId) {
    console.warn(
      `[delete-account] ignored forged body user id for ref=${userRef(userId)}`,
    );
  }

  console.log(`[delete-account] start ref=${userRef(userId)}`);

  // ---- Delete user-owned rows that do NOT cascade ------------------
  for (const table of EXPLICIT_DELETE_TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', userId);
    if (error) {
      // Do NOT proceed to auth-user deletion if a required cleanup step
      // failed — we must not report success on a partial delete.
      console.error(
        `[delete-account] failed table=${table} ref=${userRef(userId)} code=${
          error.code ?? 'unknown'
        }`,
      );
      return json({ ok: false, error: 'deletion_failed', step: table }, 500);
    }
    console.log(`[delete-account] cleared table=${table} ref=${userRef(userId)}`);
  }

  // ---- Delete the auth user (cascades profiles/saved_places/notif) -
  const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
  if (deleteErr) {
    // Idempotency: if the user is already gone, treat as success so a
    // retried request after a dropped response still resolves cleanly.
    const message = String(deleteErr.message ?? '').toLowerCase();
    const alreadyGone =
      message.includes('not found') || deleteErr.status === 404;
    if (alreadyGone) {
      console.log(`[delete-account] already_deleted ref=${userRef(userId)}`);
      return json({ ok: true, alreadyDeleted: true });
    }
    console.error(
      `[delete-account] auth delete failed ref=${userRef(userId)} status=${
        deleteErr.status ?? 'unknown'
      }`,
    );
    return json({ ok: false, error: 'deletion_failed', step: 'auth_user' }, 500);
  }

  console.log(`[delete-account] success ref=${userRef(userId)}`);
  return json({ ok: true });
});
