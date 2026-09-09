-- Establish the canonical Development recognition job contract without
-- replaying the historically-colliding 20260908 qualification migration.
--
-- Actual Development objects are the input state. Cache V2 objects are
-- intentionally untouched. The token-monetization tables may remain for their
-- own experiment, but normal recognition no longer depends on its RPC overload.

set check_function_bodies = off;

alter table public.share_jobs
  add column if not exists recognition_run_mode text not null default 'normal';

alter table public.share_jobs
  drop constraint if exists share_jobs_recognition_run_mode_check;
alter table public.share_jobs
  add constraint share_jobs_recognition_run_mode_check
  check (recognition_run_mode in ('normal', 'qualification_fresh'));

-- Only normal jobs participate in canonical-source active-work dedupe.
-- Qualification jobs intentionally run independently for each request ID.
drop index if exists public.share_jobs_active_url_uidx;
drop index if exists public.share_jobs_active_url_window_idx;
create unique index share_jobs_active_url_uidx
  on public.share_jobs (user_id, canonical_url)
  where status in ('awaiting_purchase', 'queued', 'processing_metadata')
    and recognition_run_mode = 'normal';

-- Normal request contract:
--   * exact user + request-key retries return the original job;
--   * an active same-user canonical-source job is reused;
--   * completed jobs are never reused for a new request key;
--   * users never dedupe across accounts.
-- Legacy window/force parameters remain in the signature for wire compatibility
-- and are intentionally ignored by the canonical contract.
create or replace function public.create_share_job_for_user(
  p_user_id uuid,
  p_source_url text,
  p_canonical_url text,
  p_source_platform text,
  p_idempotency_key text default null,
  p_dedupe_window_seconds integer default 90,
  p_is_anonymous boolean default false,
  p_force_rerun boolean default false
) returns table(
  job_id uuid,
  status text,
  duplicate boolean,
  requires_purchase boolean,
  available_uses integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.share_jobs%rowtype;
  v_job public.share_jobs%rowtype;
  v_available integer := 0;
  v_lock_key bigint;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  perform p_dedupe_window_seconds, p_force_rerun;
  v_lock_key := hashtextextended(
    p_user_id::text || ':' || coalesce(p_canonical_url, p_source_url, ''),
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  if not p_is_anonymous then
    perform * from public.ensure_place_find_wallet(p_user_id, false);
    select wallet.available_uses
      into v_available
      from public.place_find_wallets as wallet
     where wallet.user_id = p_user_id;
  end if;

  if nullif(trim(p_idempotency_key), '') is not null then
    select sj.*
      into v_existing
      from public.share_jobs as sj
     where sj.user_id = p_user_id
       and sj.idempotency_key = p_idempotency_key
     limit 1;
    if found then
      return query select
        v_existing.id,
        v_existing.status,
        true,
        v_existing.status = 'awaiting_purchase',
        v_available;
      return;
    end if;
  end if;

  select sj.*
    into v_existing
    from public.share_jobs as sj
   where sj.user_id = p_user_id
     and sj.canonical_url = p_canonical_url
     and sj.recognition_run_mode = 'normal'
     and sj.status in ('awaiting_purchase', 'queued', 'processing_metadata')
   order by sj.created_at desc
   limit 1;
  if found then
    return query select
      v_existing.id,
      v_existing.status,
      true,
      v_existing.status = 'awaiting_purchase',
      v_available;
    return;
  end if;

  insert into public.share_jobs(
    user_id,
    source_url,
    canonical_url,
    source_platform,
    status,
    progress_stage,
    idempotency_key,
    billing_mode,
    billing_outcome,
    billing_settled_at,
    recognition_run_mode
  ) values (
    p_user_id,
    p_source_url,
    p_canonical_url,
    p_source_platform,
    'queued',
    'queued',
    p_idempotency_key,
    'normal_free',
    'unmetered:normal_free',
    now(),
    'normal'
  ) returning * into v_job;

  return query select v_job.id, v_job.status, false, false, v_available;
end;
$$;

-- Remove the experimental token-aware overload from the recognition entry
-- point after the standalone eight-argument contract has been installed.
drop function if exists public.create_share_job_for_user(
  uuid,text,text,text,text,integer,boolean,boolean,boolean
);

create or replace function public.create_dev_qualification_share_job_for_user(
  p_user_id uuid,
  p_source_url text,
  p_canonical_url text,
  p_source_platform text,
  p_idempotency_key text
) returns table(
  job_id uuid,
  status text,
  duplicate boolean,
  requires_purchase boolean,
  available_uses integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.share_jobs%rowtype;
  v_job public.share_jobs%rowtype;
  v_lock_key bigint;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;
  if coalesce(length(trim(p_idempotency_key)), 0) not between 8 and 200 then
    raise exception 'invalid_qualification_idempotency_key';
  end if;

  v_lock_key := hashtextextended(
    p_user_id::text || ':qualification:' || p_idempotency_key,
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  select sj.*
    into v_existing
    from public.share_jobs as sj
   where sj.user_id = p_user_id
     and sj.idempotency_key = p_idempotency_key
   limit 1;
  if found then
    return query select v_existing.id, v_existing.status, true, false, 0;
    return;
  end if;

  insert into public.share_jobs(
    user_id,
    source_url,
    canonical_url,
    source_platform,
    status,
    progress_stage,
    idempotency_key,
    billing_mode,
    billing_outcome,
    billing_settled_at,
    recognition_run_mode
  ) values (
    p_user_id,
    p_source_url,
    p_canonical_url,
    p_source_platform,
    'queued',
    'queued',
    p_idempotency_key,
    'normal_free',
    'unmetered:dev_qualification',
    now(),
    'qualification_fresh'
  ) returning * into v_job;

  return query select v_job.id, v_job.status, false, false, 0;
end;
$$;

revoke all on function public.create_share_job_for_user(
  uuid,text,text,text,text,integer,boolean,boolean
) from public, anon, authenticated;
revoke all on function public.create_dev_qualification_share_job_for_user(
  uuid,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.create_share_job_for_user(
  uuid,text,text,text,text,integer,boolean,boolean
) to service_role;
grant execute on function public.create_dev_qualification_share_job_for_user(
  uuid,text,text,text,text
) to service_role;

comment on column public.share_jobs.recognition_run_mode is
  'normal, or qualification_fresh for Edge-authorized dedicated Development corpus runs';
comment on function public.create_share_job_for_user(
  uuid,text,text,text,text,integer,boolean,boolean
) is
  'Canonical normal contract: exact request retry and active same-source reuse; completed jobs do not satisfy new requests.';
comment on function public.create_dev_qualification_share_job_for_user(
  uuid,text,text,text,text
) is
  'Service-role-only Development qualification path: exact request retries are stable and each distinct request ID creates independent fresh-media work.';
