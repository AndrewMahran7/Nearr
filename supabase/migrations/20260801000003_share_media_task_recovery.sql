-- Phase 2 (hardening) — bounded parent recovery + retry backoff + cancellation.
--
-- FORWARD migration (idempotent). Supersedes the "far-future parent lease"
-- rescue model from 20260801000001. Instead of parking the parent share_job on
-- a distant `locked_until` and hoping the metadata claim reclaims it, we:
--   * add `next_attempt_at` for bounded exponential retry backoff,
--   * make claim_media_tasks skip future-scheduled retries AND tasks whose
--     parent is no longer actively processing (cancelled/terminal),
--   * add requeue_media_task() so a retry sets a real backoff atomically,
--   * cascade share_job cancellation to its media task,
--   * keep expire_media_tasks() as the exhaustion reaper.
--
-- The explicit recovery is completed in the Deno worker
-- (process-share-jobs): a recovery sweep finalizes the parent of any
-- terminal-failed / cancelled media task that is still `processing_metadata`.
--
-- Additive + reversible. No destructive changes. Run via: supabase db push

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- next_attempt_at — earliest time a queued/retrying task may be claimed.
-- ---------------------------------------------------------------------------
alter table public.share_media_tasks
  add column if not exists next_attempt_at timestamptz;

-- Claim scan now also considers next_attempt_at.
drop index if exists share_media_tasks_claimable_idx;
create index if not exists share_media_tasks_claimable_idx
  on public.share_media_tasks (next_attempt_at, created_at)
  where status in ('queued', 'processing');

-- ---------------------------------------------------------------------------
-- claim_media_tasks(): race-safe pull, now bounded by:
--   * attempts < max_attempts               (bounded retries)
--   * next_attempt_at null or <= now()       (backoff respected)
--   * status queued OR stale-lease processing (crash recovery)
--   * parent share_job is STILL processing_metadata
--       → a cancelled / already-finalized parent's task is never claimed.
-- Terminal tasks are never reclaimed. SECURITY DEFINER; service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.claim_media_tasks(
  p_limit integer default 2,
  p_lock_seconds integer default 600
)
returns setof public.share_media_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.share_media_tasks mt
     set status = 'processing',
         attempts = mt.attempts + 1,
         locked_at = now(),
         locked_until = now() + make_interval(secs => greatest(p_lock_seconds, 60)),
         progress_stage = coalesce(mt.progress_stage, 'queued'),
         updated_at = now()
   where mt.id in (
     select c.id
       from public.share_media_tasks c
      where c.attempts < c.max_attempts
        and (c.next_attempt_at is null or c.next_attempt_at <= now())
        and (
          c.status = 'queued'
          or (c.status = 'processing' and c.locked_until is not null and c.locked_until < now())
        )
        and exists (
          select 1 from public.share_jobs sj
           where sj.id = c.share_job_id
             and sj.status = 'processing_metadata'
        )
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning mt.*;
end;
$$;

revoke all on function public.claim_media_tasks(integer, integer) from public;
revoke all on function public.claim_media_tasks(integer, integer) from anon, authenticated;
grant execute on function public.claim_media_tasks(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- requeue_media_task(): schedule a retry with a bounded backoff. Does NOT
-- increment attempts (that happens exactly once per claim). Only affects a
-- still-active (non-terminal) task. Service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.requeue_media_task(
  p_task_id uuid,
  p_backoff_seconds integer,
  p_failure_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.share_media_tasks mt
     set status = 'queued',
         locked_until = null,
         next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_backoff_seconds, 30), 1)),
         failure_code = coalesce(p_failure_code, mt.failure_code),
         updated_at = now()
   where mt.id = p_task_id
     and mt.status not in ('completed', 'needs_help', 'failed', 'cancelled');
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.requeue_media_task(uuid, integer, text) from public;
revoke all on function public.requeue_media_task(uuid, integer, text) from anon, authenticated;
grant execute on function public.requeue_media_task(uuid, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- expire_media_tasks(): exhaustion reaper. Marks non-terminal tasks that have
-- exhausted their retry budget (attempts >= max_attempts, lease expired, and
-- no pending backoff) as 'failed'. The Deno recovery sweep then finalizes the
-- parent to needs_help(manual). Service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.expire_media_tasks(
  p_limit integer default 25
)
returns setof public.share_media_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.share_media_tasks mt
     set status = 'failed',
         failure_code = coalesce(mt.failure_code, 'media_worker_unavailable'),
         locked_until = null,
         updated_at = now()
   where mt.id in (
     select c.id
       from public.share_media_tasks c
      where c.status in ('queued', 'processing')
        and c.attempts >= c.max_attempts
        and (c.locked_until is null or c.locked_until < now())
        and (c.next_attempt_at is null or c.next_attempt_at <= now())
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning mt.*;
end;
$$;

revoke all on function public.expire_media_tasks(integer) from public;
revoke all on function public.expire_media_tasks(integer) from anon, authenticated;
grant execute on function public.expire_media_tasks(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Cancellation cascade: when a share_job is cancelled, stop its media task so
-- it is never claimed or finalized. AFTER UPDATE, additive — Phase 1 share_job
-- behavior is unchanged for every other transition.
-- ---------------------------------------------------------------------------
create or replace function public.share_jobs_cascade_cancel_media()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled' then
    update public.share_media_tasks
       set status = 'cancelled',
           failure_code = coalesce(failure_code, 'parent_cancelled'),
           updated_at = now()
     where share_job_id = new.id
       and status in ('queued', 'processing');
  end if;
  return new;
end;
$$;

drop trigger if exists share_jobs_cancel_cascade_media on public.share_jobs;
create trigger share_jobs_cancel_cascade_media
  after update of status on public.share_jobs
  for each row execute function public.share_jobs_cascade_cancel_media();

-- ---------------------------------------------------------------------------
-- claim_stranded_media_parents(): explicit, bounded parent recovery. Returns
-- parent share_jobs that are STILL processing_metadata but whose media task is
-- terminal-failed / cancelled (the media worker could not finalize them, e.g.
-- it crashed or was stopped during a rollback). The Deno recovery sweep
-- finalizes each to needs_help(manual). FOR UPDATE SKIP LOCKED so overlapping
-- sweeps do not fight; finalize() is additionally idempotent. Service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.claim_stranded_media_parents(
  p_limit integer default 25
)
returns setof public.share_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select sj.*
    from public.share_jobs sj
   where sj.status = 'processing_metadata'
     and exists (
       select 1 from public.share_media_tasks mt
        where mt.share_job_id = sj.id
          and mt.status in ('failed', 'cancelled')
     )
   order by sj.updated_at
   for update skip locked
   limit greatest(p_limit, 1);
end;
$$;

revoke all on function public.claim_stranded_media_parents(integer) from public;
revoke all on function public.claim_stranded_media_parents(integer) from anon, authenticated;
grant execute on function public.claim_stranded_media_parents(integer) to service_role;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback):
--   drop function if exists public.claim_stranded_media_parents(integer);
--   drop trigger if exists share_jobs_cancel_cascade_media on public.share_jobs;
--   drop function if exists public.share_jobs_cascade_cancel_media();
--   drop function if exists public.requeue_media_task(uuid, integer, text);
--   -- (claim_media_tasks / expire_media_tasks revert to the 20260801000001 bodies)
--   alter table public.share_media_tasks drop column if exists next_attempt_at;
-- ---------------------------------------------------------------------------
