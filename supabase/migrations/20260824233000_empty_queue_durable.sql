-- Durable, account-level queue archival.
--
-- Queue removal is deliberately orthogonal to worker status. In-flight work
-- may finish normally, but queue_archived_at is never cleared by worker state
-- transitions, so an archived job cannot reappear in the user's queue.

set check_function_bodies = off;

alter table public.share_jobs
  add column if not exists queue_archived_at timestamptz;

create index if not exists share_jobs_user_active_queue_idx
  on public.share_jobs (user_id, created_at desc)
  where queue_archived_at is null
    and status in ('queued', 'processing_metadata', 'needs_help', 'failed');

comment on column public.share_jobs.queue_archived_at is
  'When set, excludes this historical job from the account queue without cancelling work or deleting history.';

-- With p_job_ids omitted, archive exactly the queue items visible at the
-- database-side cutoff: active/actionable jobs plus the 24-hour recent
-- automatic-save section. With ids supplied, the same primitive archives
-- those owned queue jobs (used by per-item removal and Clear completed).
create or replace function public.archive_active_queue_for_user(
  p_job_ids uuid[] default null
)
returns table(archived_count bigint, cutoff timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_cutoff timestamptz := transaction_timestamp();
  v_archived_count bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  with archived as (
    update public.share_jobs sj
       set queue_archived_at = v_cutoff
     where sj.user_id = v_uid
       and sj.queue_archived_at is null
       and sj.created_at <= v_cutoff
       and (
         (p_job_ids is not null and sj.id = any(p_job_ids))
         or (
           p_job_ids is null
           and (
             sj.status in ('queued', 'processing_metadata', 'needs_help', 'failed')
             or exists (
               select 1
                 from public.share_job_place_results r
                where r.share_job_id = sj.id
                  and r.user_id = v_uid
                  and r.origin = 'automatic'
                  and r.outcome = 'auto_saved'
                  and r.finalized_at >= v_cutoff - interval '24 hours'
                  and r.finalized_at <= v_cutoff
             )
           )
         )
       )
    returning 1
  )
  select count(*)::bigint into v_archived_count from archived;

  return query select v_archived_count, v_cutoff;
end;
$$;

revoke all on function public.archive_active_queue_for_user(uuid[])
  from public, anon;
grant execute on function public.archive_active_queue_for_user(uuid[])
  to authenticated, service_role;

-- Historical share jobs and their cascading result/media ledgers must no
-- longer be directly deletable by the mobile client. Account deletion and
-- internal retention work continue through service_role.
drop policy if exists "share_jobs: owner delete" on public.share_jobs;
revoke delete on table public.share_jobs from authenticated;
