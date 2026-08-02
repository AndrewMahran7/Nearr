-- Dedicated scheduler-auth secret for the async share worker (Phase 1 fix).
--
-- WHY THIS EXISTS
--   The worker endpoint (process-share-jobs) was authenticated by requiring the
--   inbound bearer to EQUAL the Edge Function's injected SUPABASE_SERVICE_ROLE_KEY.
--   The scheduler (pg_net) sent the service_role JWT stored in the Vault secret
--   `share_jobs_worker_service_key`. When the project's API keys were refreshed,
--   the Function-injected SUPABASE_SERVICE_ROLE_KEY became a DIFFERENT (though
--   still valid) service_role JWT than the one in Vault, so the exact-equality
--   check failed and every pg_net call got HTTP 401 {"error":"unauthorized"} —
--   no job was ever claimed. Root cause proven by SHA-256 fingerprint compare
--   (Vault key digest != Function key digest), never by printing either key.
--
--   Copying the current service_role key into Vault would fix it only until the
--   next rotation. Instead the scheduler now authenticates with a DEDICATED,
--   high-entropy secret that is independent of the (rotating) service-role key
--   and carries no other privilege. process-share-jobs validates it in constant
--   time and is deployed with verify_jwt disabled (a private scheduler URL), so
--   the dedicated secret is the sole gate and is checked before any processing.
--
-- CREDENTIALS (set out-of-band; NEVER committed):
--   * Vault  `share_jobs_worker_secret`   — the raw secret pg_net sends.
--   * Edge Function env `SHARE_JOBS_WORKER_SECRET` — the SAME value the worker
--     compares against.
--   The legacy `share_jobs_worker_service_key` Vault secret is still sent as an
--   Authorization bearer for backward compatibility / manual admin invocation,
--   but is no longer required for the scheduler to authenticate.
--
-- ROTATION (see docs/ASYNC_SHARE_JOBS.md "Worker secret rotation"):
--   1. Generate a new high-entropy secret (e.g. `openssl rand -hex 48`).
--   2. Update BOTH sides so they match, in either order (a brief mismatch only
--      causes retried 401s; the durable queue + cron sweep recover with no data
--      loss once both match):
--        select vault.update_secret(
--          (select id from vault.secrets where name = 'share_jobs_worker_secret'),
--          '<NEW_SECRET>');
--        supabase secrets set SHARE_JOBS_WORKER_SECRET='<NEW_SECRET>' \
--          --project-ref <PROJECT_REF>
--   3. Confirm a manual `select public.invoke_process_share_jobs();` yields a
--      2xx in net._http_response.
--
-- Reversible + idempotent (create-or-replace). Applied out-of-band via
-- `supabase db query --linked -f` so the pending Phase 2 media migrations are
-- NOT pushed; recorded in the ledger with `supabase migration repair`.

set check_function_bodies = off;

create or replace function public.invoke_process_share_jobs()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base_url text;
  v_key text;
  v_worker_secret text;
  v_headers jsonb;
begin
  -- Endpoint base URL: Vault (preferred) or database setting fallback.
  begin
    select decrypted_secret into v_base_url
      from vault.decrypted_secrets
     where name = 'share_jobs_worker_edge_base_url'
     limit 1;
  exception when others then
    v_base_url := null;
  end;
  if v_base_url is null or v_base_url = '' then
    v_base_url := nullif(current_setting('app.settings.share_jobs_edge_base_url', true), '');
  end if;

  -- Dedicated scheduler secret (PRIMARY auth) — Vault or setting fallback.
  begin
    select decrypted_secret into v_worker_secret
      from vault.decrypted_secrets
     where name = 'share_jobs_worker_secret'
     limit 1;
  exception when others then
    v_worker_secret := null;
  end;
  if v_worker_secret is null or v_worker_secret = '' then
    v_worker_secret := nullif(current_setting('app.settings.share_jobs_worker_secret', true), '');
  end if;

  -- Legacy service-role key (kept as an OPTIONAL Authorization bearer for
  -- backward compatibility / manual admin invocation; no longer the primary).
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'share_jobs_worker_service_key'
     limit 1;
  exception when others then
    v_key := null;
  end;
  if v_key is null or v_key = '' then
    v_key := nullif(current_setting('app.settings.share_jobs_service_key', true), '');
  end if;

  -- Not configured yet (no URL, or no credential at all) → no-op, never raise.
  -- The durable queue + cron sweep resume automatically once configured.
  if v_base_url is null or (v_worker_secret is null and v_key is null) then
    return;
  end if;

  v_headers := jsonb_build_object('Content-Type', 'application/json');
  if v_worker_secret is not null and v_worker_secret <> '' then
    v_headers := v_headers || jsonb_build_object('x-nearr-worker-secret', v_worker_secret);
  end if;
  if v_key is not null and v_key <> '' then
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_key);
  end if;

  perform net.http_post(
    url := v_base_url || '/process-share-jobs',
    headers := v_headers,
    body := jsonb_build_object('trigger', 'db', 'limit', 5)
  );
exception when others then
  -- pg_net missing / transient failure: swallow. Durability is the persisted
  -- row + the cron sweep, not this call.
  return;
end;
$$;

-- Keep the tight grant set (service_role only).
revoke all on function public.invoke_process_share_jobs() from public;
revoke all on function public.invoke_process_share_jobs() from anon;
revoke all on function public.invoke_process_share_jobs() from authenticated;
grant execute on function public.invoke_process_share_jobs() to service_role;
