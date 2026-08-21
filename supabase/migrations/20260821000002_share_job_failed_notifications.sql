-- Technical share-job failures now carry an honest result notification. Reuse
-- the existing retry/receipt lifecycle; only widen its terminal-status filter.

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
      where c.status in ('completed', 'needs_help', 'failed')
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
      where c.status in ('completed', 'needs_help', 'failed')
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
