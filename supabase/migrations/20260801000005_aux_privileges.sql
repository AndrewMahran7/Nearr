-- 20260801000005_aux_privileges.sql
--
-- FORWARD-ONLY privilege hardening for the remaining application objects not
-- covered by 20260801000004_explicit_privileges.sql. Same root cause: these
-- tables + functions relied on the Supabase CLI's implicit default privileges;
-- a clean reset on a current CLI (2.111.0) leaves every role with only
-- REFERENCES/TRIGGER/TRUNCATE on these tables. This makes their required grants
-- EXPLICIT so the whole public schema is CLI-independent.
--
-- Scope (audited against app + Edge Function usage):
--   * analytics_events           — client append-only (anon + authenticated
--                                  INSERT; no client read); service_role reads.
--   * feedback                   — authenticated append-only (INSERT own);
--                                  service_role reads/triages.
--   * share_agent_runs           — service-role only (shadow-run diagnostics).
--   * share_extraction_failures  — service-role only (extraction-miss logs).
--   * trigger/helper functions   — system-invoked only; never client-callable.
--
-- RLS is unchanged and remains the row-level boundary. No TRUNCATE to client
-- roles. Idempotent GRANT/REVOKE only. Does not modify prior migrations.

set check_function_bodies = off;

-- ==========================================================================
-- analytics_events — append-only telemetry. The mobile client inserts events
-- BOTH before sign-in (anon: anonymous-only rows) and after (authenticated:
-- own or null user_id). RLS enforces the user_id constraints. No client
-- SELECT/UPDATE/DELETE. service_role reads (SQL editor) + account-deletion
-- cleanup.
-- ==========================================================================
revoke all on table public.analytics_events from public, anon, authenticated;
grant insert on table public.analytics_events to anon;
grant insert on table public.analytics_events to authenticated;
grant select, insert, update, delete on table public.analytics_events to service_role;

-- ==========================================================================
-- feedback — authenticated inserts its own feedback (RLS: user_id = auth.uid()).
-- No anon, no client read. service_role reads/triages + account-deletion cleanup.
-- ==========================================================================
revoke all on table public.feedback from public, anon, authenticated;
grant insert on table public.feedback to authenticated;
grant select, insert, update, delete on table public.feedback to service_role;

-- ==========================================================================
-- share_agent_runs / share_extraction_failures — SERVICE-ROLE ONLY. RLS
-- deny-all for client roles; only the Edge Functions (service_role) write, and
-- server scripts / account-deletion read/delete.
-- ==========================================================================
revoke all on table public.share_agent_runs          from public, anon, authenticated;
revoke all on table public.share_extraction_failures from public, anon, authenticated;
grant select, insert, update, delete on table public.share_agent_runs          to service_role;
grant select, insert, update, delete on table public.share_extraction_failures to service_role;

-- ==========================================================================
-- Trigger / helper functions — invoked by the trigger system (as the table
-- owner), NEVER called directly by a client. Lock EXECUTE away from PUBLIC and
-- the client roles explicitly (triggers still fire regardless of EXECUTE grants).
-- ==========================================================================
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.share_jobs_after_insert_kick() from public, anon, authenticated;
revoke all on function public.share_jobs_cascade_cancel_media() from public, anon, authenticated;
revoke all on function public.share_media_tasks_after_insert_kick() from public, anon, authenticated;
revoke all on function public.share_media_tasks_enforce_owner() from public, anon, authenticated;
