-- Follow-up fail-closed backstop for jobs/tasks queued before the age rollout.
-- An old worker must not claim an ineligible row while the age-aware Edge and
-- Railway deployments are being qualified. No existing row is deleted.

create or replace function public.guard_share_job_age_eligibility()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.status in ('queued', 'awaiting_purchase', 'processing_metadata'))
     or (tg_op = 'UPDATE' and new.status in ('queued', 'processing_metadata')) then
    if not public.is_adult_eligible_for_ai(new.user_id) then
      raise exception 'age_eligibility_required';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_share_media_task_age_eligibility()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.status in ('queued', 'processing'))
     or (tg_op = 'UPDATE' and new.status in ('queued', 'processing')) then
    if not public.is_adult_eligible_for_ai(new.user_id) then
      raise exception 'age_eligibility_required';
    end if;
  end if;
  return new;
end;
$$;
