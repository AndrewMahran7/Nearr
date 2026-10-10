-- Nearr 1.5 result pushes: one automatic provider attempt after a durable
-- attempt-start marker. A lost Expo response may lose a push, never trigger an
-- intentional resend. The authoritative share_job result is unaffected.

do $$
begin
  if exists (
    select 1 from public.share_jobs
    where notification_payload is not null
      and notification_status in ('sending', 'retryable_failed')
  ) then
    raise exception 'unresolved_legacy_notification_attempts_prevent_migration';
  end if;
end;
$$;

alter table public.share_jobs
  drop constraint share_jobs_notification_status_check;
alter table public.share_jobs
  add constraint share_jobs_notification_status_check check (
    notification_status is null or notification_status in (
      'pending', 'sending', 'submitted', 'retryable_failed',
      'permanently_failed', 'delivery_unknown'
    )
  ),
  add column notification_logical_id text,
  add column notification_attempt_id uuid,
  add column notification_attempt_started_at timestamptz,
  add column notification_receipt_status text
    check (notification_receipt_status is null or notification_receipt_status in (
      'pending', 'accepted', 'failed', 'unknown'
    )),
  add constraint share_jobs_notification_logical_id_length_check
    check (notification_logical_id is null or octet_length(notification_logical_id) <= 64);

-- A claim is PREPARING only. It can be recovered after a stale lease only
-- while no external provider attempt has been durably started. A matching
-- attempt ID fences a paused worker after a later recovery claim.
create or replace function public.claim_share_job_notifications(
  p_limit integer default 20,
  p_stale_seconds integer default 180
)
returns setof public.share_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- Multiple immediate/cron drains may reconcile concurrently. Lock in a
  -- stable order and skip rows another drain already owns.
  with stale as (
    select c.id from public.share_jobs c
     where c.notification_status = 'sending'
       and c.notification_attempt_started_at is not null
       and c.notification_last_attempt_at < now() - make_interval(secs => greatest(p_stale_seconds, 30))
     order by c.id
     for update skip locked
     limit greatest(p_limit, 1)
  )
  update public.share_jobs sj
     set notification_status = 'delivery_unknown',
         notification_error_code = 'provider_outcome_unknown_stale',
         notification_next_attempt_at = null,
         updated_at = now()
   where sj.id in (select id from stale);

  return query
  update public.share_jobs sj
     set notification_status = 'sending',
         notification_attempts = coalesce(sj.notification_attempts, 0) + 1,
         notification_attempt_id = gen_random_uuid(),
         notification_attempt_started_at = null,
         notification_logical_id = coalesce(
           sj.notification_logical_id,
           'n1:' || sj.id::text || ':' || case sj.status
             when 'completed' then 'c' when 'needs_help' then 'h' else 'f' end
         ),
         notification_last_attempt_at = now(),
         updated_at = now()
   where sj.id in (
     select c.id from public.share_jobs c
      where c.status in ('completed', 'needs_help', 'failed')
        and c.notification_payload is not null
        and coalesce(c.notification_attempts, 0) < coalesce(c.notification_max_attempts, 6)
        and (
          (c.notification_status in ('pending', 'retryable_failed')
            and coalesce(c.notification_next_attempt_at, now()) <= now())
          or (c.notification_status = 'sending'
            and c.notification_attempt_started_at is null
            and c.notification_last_attempt_at < now() - make_interval(secs => greatest(p_stale_seconds, 30)))
        )
      order by coalesce(c.notification_next_attempt_at, c.created_at), c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning sj.*;
end;
$$;
revoke all on function public.claim_share_job_notifications(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_share_job_notifications(integer, integer) to service_role;

-- This transaction commits before fetch() is called. It also checks that the
-- currently actionable job and payload still describe the same logical event.
create or replace function public.begin_share_job_notification_provider_attempt(
  p_job_id uuid,
  p_attempt_id uuid
)
returns setof public.share_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return query
  update public.share_jobs sj
     set notification_attempt_started_at = now(), updated_at = now()
   where sj.id = p_job_id
     and sj.notification_attempt_id = p_attempt_id
     and sj.notification_status = 'sending'
     and sj.notification_attempt_started_at is null
     and sj.status in ('completed', 'needs_help', 'failed')
     and sj.notification_logical_id = 'n1:' || sj.id::text || ':' || case sj.status
       when 'completed' then 'c' when 'needs_help' then 'h' else 'f' end
     and sj.notification_payload #>> '{data,jobId}' = sj.id::text
     and sj.notification_payload #>> '{data,type}' = case sj.status
       when 'completed' then 'share_job_completed' else 'share_job_needs_help' end
  returning sj.*;
end;
$$;
revoke all on function public.begin_share_job_notification_provider_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_share_job_notification_provider_attempt(uuid, uuid) to service_role;

-- A matching attempt may finish even if a concurrent sweep has already
-- classified the stale attempt as unknown. This preserves a late ticket.
create or replace function public.finish_share_job_notification_provider_attempt(
  p_job_id uuid,
  p_attempt_id uuid,
  p_outcome text,
  p_ticket_refs jsonb default '[]'::jsonb,
  p_error_code text default null
)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_updated integer;
begin
  if p_outcome not in ('submitted', 'delivery_unknown', 'permanently_failed')
     or jsonb_typeof(p_ticket_refs) is distinct from 'array'
     or (p_outcome = 'submitted' and jsonb_array_length(p_ticket_refs) = 0) then
    raise exception 'invalid_notification_attempt_outcome';
  end if;
  update public.share_jobs sj
     set notification_status = p_outcome,
         notification_ticket_ids = p_ticket_refs,
         notification_error_code = p_error_code,
         notification_next_attempt_at = null,
         notification_submitted_at = case
           when jsonb_array_length(p_ticket_refs) > 0 then now()
           else sj.notification_submitted_at end,
         notification_receipt_status = case
           when jsonb_array_length(p_ticket_refs) > 0 then 'pending'
           else sj.notification_receipt_status end,
         updated_at = now()
   where sj.id = p_job_id
     and sj.notification_attempt_id = p_attempt_id
     and sj.notification_attempt_started_at is not null
     and sj.notification_status in ('sending', 'delivery_unknown');
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;
revoke all on function public.finish_share_job_notification_provider_attempt(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_share_job_notification_provider_attempt(uuid, uuid, text, jsonb, text) to service_role;

-- Receipts observe known tickets only. They never re-enter the send claim.
create or replace function public.claim_share_job_receipts(
  p_limit integer default 20,
  p_recheck_seconds integer default 90
)
returns setof public.share_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return query
  update public.share_jobs sj
     set notification_receipts_checked_at = now(), updated_at = now()
   where sj.id in (
     select c.id from public.share_jobs c
      where c.status in ('completed', 'needs_help', 'failed')
        and c.notification_status in ('submitted', 'delivery_unknown')
        and c.notification_ticket_ids is not null
        and jsonb_typeof(c.notification_ticket_ids) = 'array'
        and jsonb_array_length(c.notification_ticket_ids) > 0
        and coalesce(c.notification_receipt_status, 'pending') in ('pending', 'unknown')
        and (c.notification_receipts_checked_at is null
          or c.notification_receipts_checked_at < now() - make_interval(secs => greatest(p_recheck_seconds, 30)))
      order by coalesce(c.notification_submitted_at, c.updated_at), c.updated_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning sj.*;
end;
$$;
revoke all on function public.claim_share_job_receipts(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_share_job_receipts(integer, integer) to service_role;
