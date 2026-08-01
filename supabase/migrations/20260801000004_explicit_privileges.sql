-- 20260801000004_explicit_privileges.sql
--
-- FORWARD-ONLY privilege hardening (Phase 1 + Phase 2).
--
-- Root cause this fixes: Nearr's earlier migrations relied on the Supabase
-- CLI's implicit default privileges to grant `authenticated` (and
-- `service_role`) SELECT/INSERT/UPDATE/DELETE on new public tables. Newer CLI
-- versions (>= ~2.10x) reduced those defaults so a freshly created table only
-- grants REFERENCES/TRIGGER/TRUNCATE to anon/authenticated/service_role. On a
-- clean reset with a current CLI that left `authenticated` without SELECT on
-- `share_jobs` (Phase 1 RLS suite failed) and `service_role` without DML on the
-- worker tables (the worker/finalizer would break). This migration makes every
-- required table + function permission EXPLICIT so a clean database no longer
-- depends on the CLI's default privileges.
--
-- Design invariants:
--   * RLS remains the ROW-level authorization boundary. These are TABLE-level
--     GRANTs that RLS then restricts per row.
--   * `authenticated` receives ONLY the DML each table's RLS policies allow and
--     the app genuinely uses. It never gets direct INSERT/UPDATE on
--     worker-managed share-job state, nor any access to the media tables, nor
--     TRUNCATE/REFERENCES on app tables.
--   * `anon` receives nothing on these tables (Nearr requires an authenticated
--     session).
--   * `service_role` (the trusted backend used by the Edge Functions + worker;
--     bypasses RLS but STILL needs table GRANTs for direct DML) receives the
--     DML it needs.
--   * Worker-only RPCs are executable by service_role only; owner-facing RPCs by
--     authenticated only. (PUBLIC is proven excluded because anon — which holds
--     every PUBLIC privilege — is revoked.)
--
-- Idempotent: only GRANT/REVOKE statements, safe to re-run. Additive/forward —
-- does not modify any previously applied migration.

set check_function_bodies = off;

-- ==========================================================================
-- Owner-facing tables
-- ==========================================================================

-- profiles: RLS self select/insert/update (no delete policy).
revoke all on table public.profiles from anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

-- places: shared catalog. Any authenticated user reads + inserts (dedup by
-- google_place_id); no client update/delete.
revoke all on table public.places from anon, authenticated;
grant select, insert on table public.places to authenticated;
grant select, insert, update, delete on table public.places to service_role;

-- saved_places: owner CRUD.
revoke all on table public.saved_places from anon, authenticated;
grant select, insert, update, delete on table public.saved_places to authenticated;
grant select, insert, update, delete on table public.saved_places to service_role;

-- notification_events: owner select/insert (audit log — no update/delete).
revoke all on table public.notification_events from anon, authenticated;
grant select, insert on table public.notification_events to authenticated;
grant select, insert, update, delete on table public.notification_events to service_role;

-- user_push_tokens: owner CRUD (registration also flows through the
-- register_push_token SECURITY DEFINER RPC; the client also disables its own
-- invalid token via a direct UPDATE).
revoke all on table public.user_push_tokens from anon, authenticated;
grant select, insert, update, delete on table public.user_push_tokens to authenticated;
grant select, insert, update, delete on table public.user_push_tokens to service_role;

-- ==========================================================================
-- share_jobs — worker-managed. The client may READ and DELETE its own jobs
-- (RLS-scoped) but must NEVER insert/update directly: forged worker state
-- (status, attempt counters, locks, notification bookkeeping) is prevented, and
-- writes flow through the resolve/cancel/retry SECURITY DEFINER RPCs. The
-- worker + finalizer run as service_role.
-- ==========================================================================
revoke all on table public.share_jobs from anon, authenticated;
grant select, delete on table public.share_jobs to authenticated;
grant select, insert, update, delete on table public.share_jobs to service_role;

-- ==========================================================================
-- share_media_tasks / share_media_runs — SERVICE-ROLE ONLY. RLS is enabled with
-- NO client policies; the client gets no table privileges at all. Only the
-- worker (service_role) reads/writes; claim/requeue/expire/recovery run
-- SECURITY DEFINER.
-- ==========================================================================
revoke all on table public.share_media_tasks from anon, authenticated;
revoke all on table public.share_media_runs  from anon, authenticated;
grant select, insert, update, delete on table public.share_media_tasks to service_role;
grant select, insert, update, delete on table public.share_media_runs  to service_role;

-- ==========================================================================
-- Owner-facing RPCs — authenticated end users only (each forces auth.uid()
-- ownership internally). Never PUBLIC/anon.
-- ==========================================================================
revoke all on function public.resolve_share_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_share_job(uuid, uuid) to authenticated;

revoke all on function public.cancel_share_job(uuid) from public, anon, authenticated;
grant execute on function public.cancel_share_job(uuid) to authenticated;

revoke all on function public.retry_share_job(uuid) from public, anon, authenticated;
grant execute on function public.retry_share_job(uuid) to authenticated;

revoke all on function public.register_push_token(text, text, text) from public, anon, authenticated;
grant execute on function public.register_push_token(text, text, text) to authenticated;

revoke all on function public.bump_reminder_opportunity_count(uuid[]) from public, anon, authenticated;
grant execute on function public.bump_reminder_opportunity_count(uuid[]) to authenticated;

-- ==========================================================================
-- Worker-only RPCs — SERVICE-ROLE ONLY. Explicitly revoked from PUBLIC, anon,
-- authenticated; granted to service_role.
-- ==========================================================================
revoke all on function public.claim_share_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_share_jobs(integer, integer) to service_role;

revoke all on function public.create_share_job_for_user(uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_share_job_for_user(uuid, text, text, text, text, integer) to service_role;

revoke all on function public.claim_share_job_notifications(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_share_job_notifications(integer, integer) to service_role;

revoke all on function public.claim_share_job_receipts(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_share_job_receipts(integer, integer) to service_role;

revoke all on function public.invoke_process_share_jobs() from public, anon, authenticated;
grant execute on function public.invoke_process_share_jobs() to service_role;

revoke all on function public.claim_media_tasks(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_media_tasks(integer, integer) to service_role;

revoke all on function public.expire_media_tasks(integer) from public, anon, authenticated;
grant execute on function public.expire_media_tasks(integer) to service_role;

revoke all on function public.requeue_media_task(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.requeue_media_task(uuid, integer, text) to service_role;

revoke all on function public.claim_stranded_media_parents(integer) from public, anon, authenticated;
grant execute on function public.claim_stranded_media_parents(integer) to service_role;

revoke all on function public.invoke_process_media_tasks() from public, anon, authenticated;
grant execute on function public.invoke_process_media_tasks() to service_role;

-- Note on SECURITY DEFINER search_path: every SECURITY DEFINER function in this
-- schema is defined with `set search_path = public, pg_temp` (or `= public`),
-- pinned at creation in its own migration, so this hardening pass does not need
-- to alter any function body.
