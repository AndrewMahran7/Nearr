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
//   1. capture the narrowly owned onboarding_v2_sessions IDs (read only)
//   2. analytics_events        (FK ON DELETE SET NULL → delete explicitly)
//   3. feedback                (FK ON DELETE SET NULL → delete explicitly)
//   4. share_agent_runs        (FK ON DELETE SET NULL → delete explicitly)
//   5. share_extraction_failures (FK ON DELETE SET NULL → delete explicitly)
//   6. auth.users delete → cascades profiles, saved_places,
//      notification_events (all FK ON DELETE CASCADE).
//   7. delete the captured onboarding checkpoints (transfer grants cascade).
//
// Canonical `places` rows are shared across users and are intentionally
// NEVER deleted here.

// @ts-nocheck — Deno runtime.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { CORS_HEADERS, preflight } from './cors.ts';
import { extractBearerToken, resolveDeleteAuthority } from './authToken.ts';
import {
  SHARE_EVIDENCE_BUCKET,
  evidencePathsForOwnedJob,
} from '../_shared/shareEvidenceLifecycle.ts';

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

  // Capture only this identity's sessions before auth deletion nulls their
  // foreign keys. This is deliberately read-only: if account deletion later
  // fails, the still-valid account keeps its onboarding checkpoint.
  const { data: onboardingSessions, error: onboardingLookupError } = await admin
    .from('onboarding_v2_sessions')
    .select('id')
    .or(`user_id.eq.${userId},permanent_user_id.eq.${userId}`);
  if (onboardingLookupError) {
    console.error(
      `[delete-account] lookup failed table=onboarding_v2_sessions ref=${userRef(userId)} code=${
        onboardingLookupError.code ?? 'unknown'
      }`,
    );
    return json({ ok: false, error: 'deletion_failed', step: 'onboarding_v2_sessions_lookup' }, 500);
  }
  const onboardingSessionIds = (onboardingSessions ?? []).map((session) => session.id);

  // Storage objects do not participate in auth/database cascades. Remove only
  // paths referenced by this user's job payloads; never list or sweep a bucket.
  let evidenceObjectsDeleted = 0;
  let lastJobId = '';
  for (;;) {
    let jobsQuery = admin
      .from('share_jobs')
      .select('id,user_id,candidate_payload')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .limit(200);
    if (lastJobId) jobsQuery = jobsQuery.gt('id', lastJobId);
    const { data: jobs, error: jobsError } = await jobsQuery;
    if (jobsError) {
      console.error(`[delete-account] lookup failed table=share_jobs ref=${userRef(userId)} code=${jobsError.code ?? 'unknown'}`);
      return json({ ok: false, error: 'deletion_failed', step: 'share_evidence_lookup' }, 500);
    }
    const rows = jobs ?? [];
    const paths = rows.flatMap((job) => evidencePathsForOwnedJob(job.candidate_payload, userId, job.id));
    for (let offset = 0; offset < paths.length; offset += 100) {
      const batch = paths.slice(offset, offset + 100);
      const { data: removed, error: removeError } = await admin.storage
        .from(SHARE_EVIDENCE_BUCKET)
        .remove(batch);
      if (removeError) {
        console.error(`[delete-account] failed storage=${SHARE_EVIDENCE_BUCKET} ref=${userRef(userId)} count=${batch.length}`);
        return json({ ok: false, error: 'deletion_failed', step: 'share_evidence' }, 500);
      }
      evidenceObjectsDeleted += removed?.length ?? batch.length;
    }
    if (rows.length < 200) break;
    lastJobId = rows[rows.length - 1].id;
  }
  if (evidenceObjectsDeleted > 0) {
    console.log(`[delete-account] cleared storage=${SHARE_EVIDENCE_BUCKET} ref=${userRef(userId)} count=${evidenceObjectsDeleted}`);
  }

  // Release any in-flight debit and detach the spendable wallet before auth
  // deletion. Immutable transaction and ledger rows remain pseudonymized for
  // purchase replay/refund integrity; no balance remains reachable by a user.
  const { error: walletCloseError } = await admin.rpc('close_place_find_wallet', {
    p_user_id: userId,
  });
  if (walletCloseError) {
    console.error(`[delete-account] failed step=place_find_wallet ref=${userRef(userId)} code=${walletCloseError.code ?? 'unknown'}`);
    return json({ ok: false, error: 'deletion_failed', step: 'place_find_wallet' }, 500);
  }

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
  let alreadyDeleted = false;
  if (deleteErr) {
    // Idempotency: if the user is already gone, treat as success so a
    // retried request after a dropped response still resolves cleanly.
    const message = String(deleteErr.message ?? '').toLowerCase();
    const alreadyGone =
      message.includes('not found') || deleteErr.status === 404;
    if (!alreadyGone) {
      console.error(
        `[delete-account] auth delete failed ref=${userRef(userId)} status=${
          deleteErr.status ?? 'unknown'
        }`,
      );
      return json({ ok: false, error: 'deletion_failed', step: 'auth_user' }, 500);
    }
    alreadyDeleted = true;
    console.log(`[delete-account] already_deleted ref=${userRef(userId)}`);
  }

  // The identity boundary now exists. Delete the captured checkpoints so
  // their JSON and transfer grants do not remain on the server. If this
  // best-effort cleanup fails, auth deletion has already made the rows
  // impossible to hydrate by the deleted user; do not misreport the account
  // as surviving.
  let onboardingCleanupPending = false;
  if (onboardingSessionIds.length > 0) {
    const { error: onboardingDeleteError } = await admin
      .from('onboarding_v2_sessions')
      .delete()
      .in('id', onboardingSessionIds);
    if (onboardingDeleteError) {
      onboardingCleanupPending = true;
      console.error(
        `[delete-account] post-auth cleanup failed table=onboarding_v2_sessions ref=${userRef(userId)} code=${
          onboardingDeleteError.code ?? 'unknown'
        }`,
      );
    } else {
      console.log(`[delete-account] cleared table=onboarding_v2_sessions ref=${userRef(userId)}`);
    }
  }

  console.log(`[delete-account] success ref=${userRef(userId)}`);
  return json({ ok: true, alreadyDeleted, onboardingCleanupPending, evidenceObjectsDeleted });
});
