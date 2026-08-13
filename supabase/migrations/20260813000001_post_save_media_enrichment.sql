-- Let the existing media worker claim supplemental enrichment tasks after the
-- user-facing metadata save is already complete.
--
-- Previously claim_media_tasks required share_jobs.status =
-- 'processing_metadata'. That was correct when media was only a fallback, but
-- it strands the new save-first/enrich-later task because its parent must stay
-- terminal 'completed'. A completed parent is eligible only when it carries an
-- authoritative saved_place_id. Cancelled, failed, needs_help, and completed
-- jobs without a saved target remain unclaimable.

set check_function_bodies = off;

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
          select 1
            from public.share_jobs sj
           where sj.id = c.share_job_id
             and (
               sj.status = 'processing_metadata'
               or (sj.status = 'completed' and sj.saved_place_id is not null)
             )
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
