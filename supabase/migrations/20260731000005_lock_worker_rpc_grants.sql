-- Lock down worker-only RPC execute grants (security hardening).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Migrations 20260731000001 / 000003 / 000004 create the worker-only RPCs and
-- `revoke ... from public`, then `grant execute ... to service_role`. On
-- Supabase that is NOT sufficient: the platform's DEFAULT PRIVILEGES grant
-- EXECUTE on every newly-created public function DIRECTLY to the `anon` and
-- `authenticated` roles. `revoke ... from public` does not remove a
-- role-specific grant, so those roles retained EXECUTE on:
--
--   * public.claim_share_jobs(integer, integer)
--   * public.claim_share_job_notifications(integer, integer)
--   * public.claim_share_job_receipts(integer, integer)
--   * public.create_share_job_for_user(uuid, text, text, text, text, integer)
--   * public.invoke_process_share_jobs()   (anon retained EXECUTE)
--
-- IMPACT (high): create_share_job_for_user takes p_user_id as an argument, so
-- an authenticated user could forge share jobs for ANY user_id, bypassing the
-- create-share-job Edge Function's auth. The claim_* RPCs let a client mutate
-- the global worker queue / notification state.
--
-- This forward-only migration explicitly revokes EXECUTE from anon +
-- authenticated on the worker-only functions. service_role keeps its explicit
-- grant (the durable worker authenticates as the service role), and the
-- owner-scoped client RPCs (resolve/cancel/retry_share_job, register_push_token)
-- are intentionally left executable by authenticated and are untouched here.
--
-- Additive + reversible. Run via Supabase CLI: supabase db push

set check_function_bodies = off;

do $$
begin
  -- Guard each revoke so the migration still applies cleanly even if a
  -- function is renamed/removed in a future refactor.
  revoke all on function public.claim_share_jobs(integer, integer)
    from anon, authenticated;
  revoke all on function public.claim_share_job_notifications(integer, integer)
    from anon, authenticated;
  revoke all on function public.claim_share_job_receipts(integer, integer)
    from anon, authenticated;
  revoke all on function public.create_share_job_for_user(uuid, text, text, text, text, integer)
    from anon, authenticated;
  revoke all on function public.invoke_process_share_jobs()
    from anon, authenticated;
exception when undefined_function then
  raise notice 'lock_worker_rpc_grants: a target function was missing; skipping (%).', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback) — restores the pre-hardening (INSECURE) state:
--   grant execute on function public.claim_share_jobs(integer, integer) to anon, authenticated;
--   grant execute on function public.claim_share_job_notifications(integer, integer) to anon, authenticated;
--   grant execute on function public.claim_share_job_receipts(integer, integer) to anon, authenticated;
--   grant execute on function public.create_share_job_for_user(uuid, text, text, text, text, integer) to anon, authenticated;
--   grant execute on function public.invoke_process_share_jobs() to anon, authenticated;
-- ---------------------------------------------------------------------------
