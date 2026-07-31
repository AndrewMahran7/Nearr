-- Async share-job notification durability + short-window URL dedupe.
--
-- Goals:
-- 1) Decouple terminal job state from push delivery state.
-- 2) Add bounded retry/backoff for push submission failures.
-- 3) Add receipt-check claim path for submitted tickets.
-- 4) Replace indefinite active-URL collapse with a short dedupe window
--    backed by an atomic DB function.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Notification state on share_jobs.
-- ---------------------------------------------------------------------------
alter table public.share_jobs
  add column if not exists notification_status text
    check (
      notification_status is null or notification_status in (
        'pending',
        'sending',
        'submitted',
        'retryable_failed',
        'permanently_failed'
      )
    ),
  add column if not exists notification_attempts integer not null default 0,
  add column if not exists notification_max_attempts integer not null default 6,
  add column if not exists notification_last_attempt_at timestamptz,
  add column if not exists notification_next_attempt_at timestamptz,
  add column if not exists notification_ticket_ids jsonb,
  add column if not exists notification_error_code text,
  add column if not exists notification_submitted_at timestamptz,
  add column if not exists notification_payload jsonb,
  add column if not exists notification_receipts_checked_at timestamptz;

alter table public.share_jobs
  drop column if exists notification_sent_at;

create index if not exists share_jobs_notification_claim_idx
  on public.share_jobs (notification_next_attempt_at, created_at)
  where status in ('completed', 'needs_help')
    and notification_status in ('pending', 'retryable_failed', 'sending');

create index if not exists share_jobs_notification_receipts_idx
  on public.share_jobs (notification_receipts_checked_at, created_at)
  where status in ('completed', 'needs_help')
    and notification_status = 'submitted';

-- ---------------------------------------------------------------------------
-- Replace indefinite active URL uniqueness with short-window dedupe.
--
-- Prior index collapsed intentional re-shares for as long as an older job
-- remained queued/processing. We now dedupe in a bounded window inside an
-- atomic function using advisory locks.
-- ---------------------------------------------------------------------------
drop index if exists public.share_jobs_active_url_uidx;

create index if not exists share_jobs_active_url_window_idx
  on public.share_jobs (user_id, canonical_url, created_at desc)
  where status in ('queued', 'processing_metadata');

-- ---------------------------------------------------------------------------
-- Atomic job creation for service-role edge function callers.
--
-- p_dedupe_window_seconds default 90:
-- - rapid duplicate taps collapse
-- - intentional re-share after window is allowed
-- ---------------------------------------------------------------------------
create or replace function public.create_share_job_for_user(
  p_user_id uuid,
  p_source_url text,
  p_canonical_url text,
  p_source_platform text,
  p_idempotency_key text default null,
  p_dedupe_window_seconds integer default 90
)
returns table(job_id uuid, status text, duplicate boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing record;
  v_inserted record;
  v_lock_key bigint;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  -- Serialize concurrent same-user same-url creates.
  v_lock_key := hashtextextended(
    p_user_id::text || ':' || coalesce(p_canonical_url, p_source_url, ''),
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select sj.id, sj.status
      into v_existing
      from public.share_jobs sj
     where sj.user_id = p_user_id
       and sj.idempotency_key = p_idempotency_key
     limit 1;
    if found then
      return query select v_existing.id, v_existing.status, true;
      return;
    end if;
  end if;

  select sj.id, sj.status
    into v_existing
    from public.share_jobs sj
   where sj.user_id = p_user_id
     and sj.canonical_url = p_canonical_url
     and sj.status in ('queued', 'processing_metadata')
     and sj.created_at >= now() - make_interval(secs => greatest(p_dedupe_window_seconds, 1))
   order by sj.created_at desc
   limit 1;

  if found then
    return query select v_existing.id, v_existing.status, true;
    return;
  end if;

  begin
    insert into public.share_jobs (
      user_id,
      source_url,
      canonical_url,
      source_platform,
      status,
      progress_stage,
      idempotency_key
    )
    values (
      p_user_id,
      p_source_url,
      p_canonical_url,
      p_source_platform,
      'queued',
      'queued',
      p_idempotency_key
    )
    returning id, share_jobs.status into v_inserted;
  exception when unique_violation then
    if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
      select sj.id, sj.status
        into v_existing
        from public.share_jobs sj
       where sj.user_id = p_user_id
         and sj.idempotency_key = p_idempotency_key
       limit 1;
      if found then
        return query select v_existing.id, v_existing.status, true;
        return;
      end if;
    end if;
    raise;
  end;

  return query select v_inserted.id, v_inserted.status, false;
end;
$$;

revoke all on function public.create_share_job_for_user(uuid, text, text, text, text, integer) from public;
grant execute on function public.create_share_job_for_user(uuid, text, text, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Notification claim paths for process-share-jobs.
-- ---------------------------------------------------------------------------
create or replace function public.claim_share_job_notifications(
  p_limit integer default 20,
  p_stale_seconds integer default 180
)
returns setof public.share_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.share_jobs sj
     set notification_status = 'sending',
         notification_attempts = coalesce(sj.notification_attempts, 0) + 1,
         notification_last_attempt_at = now(),
         updated_at = now()
   where sj.id in (
     select c.id
       from public.share_jobs c
      where c.status in ('completed', 'needs_help')
        and c.notification_payload is not null
        and coalesce(c.notification_attempts, 0) < coalesce(c.notification_max_attempts, 6)
        and (
          (c.notification_status = 'pending' and coalesce(c.notification_next_attempt_at, now()) <= now())
          or (c.notification_status = 'retryable_failed' and coalesce(c.notification_next_attempt_at, now()) <= now())
          or (
            c.notification_status = 'sending'
            and c.notification_last_attempt_at is not null
            and c.notification_last_attempt_at < now() - make_interval(secs => greatest(p_stale_seconds, 30))
          )
        )
      order by coalesce(c.notification_next_attempt_at, c.created_at), c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning sj.*;
end;
$$;

revoke all on function public.claim_share_job_notifications(integer, integer) from public;
grant execute on function public.claim_share_job_notifications(integer, integer) to service_role;

create or replace function public.claim_share_job_receipts(
  p_limit integer default 20,
  p_recheck_seconds integer default 90
)
returns setof public.share_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.share_jobs sj
     set notification_receipts_checked_at = now(),
         updated_at = now()
   where sj.id in (
     select c.id
       from public.share_jobs c
      where c.status in ('completed', 'needs_help')
        and c.notification_status = 'submitted'
        and c.notification_ticket_ids is not null
        and jsonb_typeof(c.notification_ticket_ids) = 'array'
        and jsonb_array_length(c.notification_ticket_ids) > 0
        and (
          c.notification_receipts_checked_at is null
          or c.notification_receipts_checked_at < now() - make_interval(secs => greatest(p_recheck_seconds, 30))
        )
      order by coalesce(c.notification_submitted_at, c.updated_at), c.updated_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning sj.*;
end;
$$;

revoke all on function public.claim_share_job_receipts(integer, integer) from public;
grant execute on function public.claim_share_job_receipts(integer, integer) to service_role;

-- DOWN (manual):
-- drop function if exists public.claim_share_job_receipts(integer, integer);
-- drop function if exists public.claim_share_job_notifications(integer, integer);
-- drop function if exists public.create_share_job_for_user(uuid, text, text, text, text, integer);
-- drop index if exists public.share_jobs_active_url_window_idx;
-- create unique index share_jobs_active_url_uidx on public.share_jobs (user_id, canonical_url)
--   where status in ('queued', 'processing_metadata');
-- alter table public.share_jobs
--   drop column if exists notification_status,
--   drop column if exists notification_attempts,
--   drop column if exists notification_max_attempts,
--   drop column if exists notification_last_attempt_at,
--   drop column if exists notification_next_attempt_at,
--   drop column if exists notification_ticket_ids,
--   drop column if exists notification_error_code,
--   drop column if exists notification_submitted_at,
--   drop column if exists notification_payload,
--   drop column if exists notification_receipts_checked_at;
