-- Durable worker wiring for async share jobs (pg_cron + pg_net).
--
-- DURABILITY MODEL (read this before changing anything):
--   * The `share_jobs` row in Postgres is the SOURCE OF TRUTH. It survives
--     regardless of whether any function invocation succeeds.
--   * A per-minute pg_cron sweep is the RELIABLE BACKSTOP that guarantees
--     every queued job is eventually claimed and processed.
--   * An AFTER INSERT trigger fires pg_net for LOW LATENCY (near-instant
--     pickup). It is best-effort ONLY — if it fails, the cron sweep still
--     processes the job. It is NOT the durability mechanism.
--
-- This migration is intentionally DEFENSIVE: if pg_cron / pg_net are not yet
-- enabled, or the worker secrets are not yet configured, everything degrades
-- to a silent no-op. Job creation, the queue, and RLS all keep working; the
-- worker simply doesn't dispatch until the operator finishes setup below.
--
-- ===========================================================================
-- OPERATOR SETUP (run ONCE, after `supabase db push`) — see
-- docs/ASYNC_SHARE_JOBS.md "Worker setup" for the full walkthrough:
--
--   1. Enable extensions (Dashboard → Database → Extensions, or here):
--        create extension if not exists pg_net;
--        create extension if not exists pg_cron;
--
--   2. Store the worker's endpoint + service key (Vault is preferred):
--        select vault.create_secret(
--          'https://<PROJECT_REF>.supabase.co/functions/v1',
--          'share_jobs_worker_edge_base_url');
--        select vault.create_secret(
--          '<SERVICE_ROLE_KEY>',
--          'share_jobs_worker_service_key');
--
--      (Fallback if Vault is unavailable — note this makes the key readable
--       to any DB superuser, so prefer Vault:)
--        alter database postgres
--          set app.settings.share_jobs_edge_base_url = 'https://<REF>.supabase.co/functions/v1';
--        alter database postgres
--          set app.settings.share_jobs_service_key = '<SERVICE_ROLE_KEY>';
--
--   3. Deploy the function:  supabase functions deploy process-share-jobs
-- ===========================================================================
--
-- Reversible. Run via Supabase CLI: supabase db push

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Extensions (best-effort; may require Dashboard enablement on hosted Supabase)
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not auto-enabled — enable via Dashboard → Database → Extensions, then re-run step 3.';
end $$;

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron not auto-enabled — enable via Dashboard → Database → Extensions, then re-run the cron block.';
end $$;

-- ---------------------------------------------------------------------------
-- invoke_process_share_jobs(): fire the worker endpoint via pg_net.
--
-- Reads config from Vault (preferred) or database settings (fallback). If
-- neither is configured, or pg_net is unavailable, this is a NO-OP that NEVER
-- raises — so inserts and the cron job are always safe.
-- ---------------------------------------------------------------------------
create or replace function public.invoke_process_share_jobs()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base_url text;
  v_key text;
begin
  -- Prefer Vault secrets.
  begin
    select decrypted_secret into v_base_url
      from vault.decrypted_secrets
     where name = 'share_jobs_worker_edge_base_url'
     limit 1;
  exception when others then
    v_base_url := null;
  end;
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'share_jobs_worker_service_key'
     limit 1;
  exception when others then
    v_key := null;
  end;

  -- Fall back to database settings.
  if v_base_url is null or v_base_url = '' then
    v_base_url := nullif(current_setting('app.settings.share_jobs_edge_base_url', true), '');
  end if;
  if v_key is null or v_key = '' then
    v_key := nullif(current_setting('app.settings.share_jobs_service_key', true), '');
  end if;

  -- Not configured yet → no-op (never raise). The cron backstop will start
  -- dispatching automatically once the secrets are set.
  if v_base_url is null or v_key is null then
    return;
  end if;

  perform net.http_post(
    url := v_base_url || '/process-share-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('trigger', 'db', 'limit', 5)
  );
exception when others then
  -- pg_net missing / transient failure: swallow. Durability is the persisted
  -- row + the cron sweep, not this call.
  return;
end;
$$;

revoke all on function public.invoke_process_share_jobs() from public;
revoke all on function public.invoke_process_share_jobs() from authenticated;
grant execute on function public.invoke_process_share_jobs() to service_role;

-- ---------------------------------------------------------------------------
-- AFTER INSERT kick (statement-level → one call per insert statement).
-- Low-latency optimization only; safe if it no-ops.
-- ---------------------------------------------------------------------------
create or replace function public.share_jobs_after_insert_kick()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.invoke_process_share_jobs();
  return null;
end;
$$;

drop trigger if exists share_jobs_kick_worker on public.share_jobs;
create trigger share_jobs_kick_worker
  after insert on public.share_jobs
  for each statement execute function public.share_jobs_after_insert_kick();

-- ---------------------------------------------------------------------------
-- Per-minute cron backstop (the actual durability guarantee).
-- Guarded so migration apply never fails when pg_cron is absent.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'process-share-jobs-sweep') then
      perform cron.unschedule('process-share-jobs-sweep');
    end if;
    perform cron.schedule(
      'process-share-jobs-sweep',
      '* * * * *',
      $cron$ select public.invoke_process_share_jobs(); $cron$
    );
  else
    raise notice 'pg_cron not present — schedule the sweep manually once enabled (see migration header).';
  end if;
exception when others then
  raise notice 'Could not schedule process-share-jobs-sweep automatically; schedule manually (see migration header).';
end $$;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback):
--   select cron.unschedule('process-share-jobs-sweep');   -- if pg_cron enabled
--   drop trigger if exists share_jobs_kick_worker on public.share_jobs;
--   drop function if exists public.share_jobs_after_insert_kick();
--   drop function if exists public.invoke_process_share_jobs();
-- ---------------------------------------------------------------------------
