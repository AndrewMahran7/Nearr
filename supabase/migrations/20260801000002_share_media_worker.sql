-- Phase 2 — Media worker wiring (pg_net wake-up + pg_cron backstop).
--
-- DURABILITY MODEL (identical philosophy to 20260731000003_share_jobs_worker):
--   * The `share_media_tasks` row is the SOURCE OF TRUTH. It survives whether
--     or not any invocation succeeds.
--   * A per-minute pg_cron sweep is the RELIABLE BACKSTOP that guarantees
--     every queued media task is eventually picked up by the containerized
--     media worker (services/media-worker).
--   * An AFTER INSERT trigger fires pg_net for LOW LATENCY (near-instant
--     pickup). Best-effort ONLY — if it fails, the cron sweep still delivers.
--
-- SECURITY (differs from the share-jobs worker on purpose):
--   * The media worker is a SEPARATE containerized service, NOT a Supabase
--     Edge Function. It is invoked with a DEDICATED invocation secret
--     (SHARE_MEDIA_WORKER_SECRET), NEVER the service-role key. The
--     service-role key is used by the worker INTERNALLY for DB access and is
--     never sent through pg_net, returned to clients, or logged.
--
-- Intentionally DEFENSIVE: if pg_cron / pg_net are not enabled, or the worker
-- secrets are not configured, everything degrades to a silent no-op. Media
-- task creation, the queue, RLS, and ordinary share-job inserts all keep
-- working; the media worker simply doesn't dispatch until setup completes.
--
-- ===========================================================================
-- OPERATOR SETUP (run ONCE, after `supabase db push`) — see
-- docs/MEDIA_FALLBACK.md "Deployment":
--
--   1. Enable extensions (usually already enabled by Phase 1):
--        create extension if not exists pg_net;
--        create extension if not exists pg_cron;
--
--   2. Store the media worker's base URL + invocation secret (Vault preferred).
--      The URL is the container's public base (NO trailing slash); the path
--      `/v1/process-media-tasks` is appended by the function below.
--        select vault.create_secret(
--          'https://media-worker.internal.example.com',
--          'share_media_worker_url');
--        select vault.create_secret(
--          '<SHARE_MEDIA_WORKER_SECRET>',
--          'share_media_worker_secret');
--
--      (Fallback if Vault is unavailable — readable to any DB superuser, so
--       prefer Vault:)
--        alter database postgres
--          set app.settings.share_media_worker_url = 'https://media-worker.internal.example.com';
--        alter database postgres
--          set app.settings.share_media_worker_secret = '<SHARE_MEDIA_WORKER_SECRET>';
--
--   3. Deploy the container and confirm GET /ready is healthy.
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
  raise notice 'pg_net not auto-enabled — enable via Dashboard → Database → Extensions.';
end $$;

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron not auto-enabled — enable via Dashboard → Database → Extensions.';
end $$;

-- ---------------------------------------------------------------------------
-- invoke_process_media_tasks(): fire the media worker endpoint via pg_net.
--
-- Reads config from Vault (preferred) or database settings (fallback). If
-- neither is configured, or pg_net is unavailable, this is a NO-OP that NEVER
-- raises — so media-task inserts and the cron job are always safe.
--
-- Sends ONLY the dedicated worker invocation secret as a Bearer token. The
-- service-role key is intentionally never referenced here.
-- ---------------------------------------------------------------------------
create or replace function public.invoke_process_media_tasks()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base_url text;
  v_secret text;
begin
  -- Prefer Vault secrets.
  begin
    select decrypted_secret into v_base_url
      from vault.decrypted_secrets
     where name = 'share_media_worker_url'
     limit 1;
  exception when others then
    v_base_url := null;
  end;
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'share_media_worker_secret'
     limit 1;
  exception when others then
    v_secret := null;
  end;

  -- Fall back to database settings.
  if v_base_url is null or v_base_url = '' then
    v_base_url := nullif(current_setting('app.settings.share_media_worker_url', true), '');
  end if;
  if v_secret is null or v_secret = '' then
    v_secret := nullif(current_setting('app.settings.share_media_worker_secret', true), '');
  end if;

  -- Not configured yet → no-op (never raise). The cron backstop starts
  -- dispatching automatically once the secrets are set.
  if v_base_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_base_url, '/') || '/v1/process-media-tasks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('trigger', 'db', 'limit', 2)
  );
exception when others then
  -- pg_net missing / transient failure: swallow. Durability is the persisted
  -- row + the cron sweep, not this call.
  return;
end;
$$;

revoke all on function public.invoke_process_media_tasks() from public;
revoke all on function public.invoke_process_media_tasks() from anon, authenticated;
grant execute on function public.invoke_process_media_tasks() to service_role;

-- ---------------------------------------------------------------------------
-- AFTER INSERT kick (statement-level → one call per insert statement).
-- Low-latency optimization only; safe if it no-ops. Never blocks the insert.
-- ---------------------------------------------------------------------------
create or replace function public.share_media_tasks_after_insert_kick()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.invoke_process_media_tasks();
  return null;
end;
$$;

drop trigger if exists share_media_tasks_kick_worker on public.share_media_tasks;
create trigger share_media_tasks_kick_worker
  after insert on public.share_media_tasks
  for each statement execute function public.share_media_tasks_after_insert_kick();

-- ---------------------------------------------------------------------------
-- Per-minute cron backstop (the actual durability guarantee).
-- Guarded so migration apply never fails when pg_cron is absent.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'process-media-tasks-sweep') then
      perform cron.unschedule('process-media-tasks-sweep');
    end if;
    perform cron.schedule(
      'process-media-tasks-sweep',
      '* * * * *',
      $cron$ select public.invoke_process_media_tasks(); $cron$
    );
  else
    raise notice 'pg_cron not present — schedule process-media-tasks-sweep manually once enabled.';
  end if;
exception when others then
  raise notice 'Could not schedule process-media-tasks-sweep automatically; schedule manually.';
end $$;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback — the fastest server-only rollback is simply to
-- unschedule the sweep; media-task rows stay intact and Phase 1 keeps working):
--   select cron.unschedule('process-media-tasks-sweep');   -- if pg_cron enabled
--   drop trigger if exists share_media_tasks_kick_worker on public.share_media_tasks;
--   drop function if exists public.share_media_tasks_after_insert_kick();
--   drop function if exists public.invoke_process_media_tasks();
-- ---------------------------------------------------------------------------
