-- Nearr 18+ eligibility: additive, fail-closed, and deliberately separate from
-- Terms acceptance, AI-sharing permission, and any claim of verified age.
-- Existing users have no row and therefore remain pending. No saved data moves.

create table if not exists public.account_age_eligibility (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('adult_self_declared', 'under_18', 'revoked')),
  assessment_method text not null check (assessment_method in ('self_declaration', 'administrative')),
  policy_version text not null,
  assessed_at timestamptz not null default now(),
  changed_at timestamptz not null default now()
);

comment on table public.account_age_eligibility is
  'Minimum-age eligibility decision; self-declaration is not independent age verification. Missing row means pending.';

alter table public.account_age_eligibility enable row level security;
revoke all on public.account_age_eligibility from public, anon, authenticated;
grant select on public.account_age_eligibility to authenticated;
drop policy if exists account_age_eligibility_owner_read on public.account_age_eligibility;
create policy account_age_eligibility_owner_read on public.account_age_eligibility
  for select to authenticated using (auth.uid() = user_id);

-- This is the only client-authorized status transition. A prior under-18 or
-- revoked decision cannot be undone by re-ticking a box or another device.
create or replace function public.declare_age_eligibility_18_plus(p_at_least_18 boolean)
returns text
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_existing text;
  v_next text;
begin
  if v_user is null then raise exception 'age_auth_required'; end if;
  -- The offline tutorial reaches a real-share practice under a Supabase
  -- anonymous owner. It must establish an account-bound declaration first;
  -- the one-time V2 transfer propagates that record to the permanent owner.
  if p_at_least_18 is null then raise exception 'age_answer_required'; end if;
  v_next := case when p_at_least_18 then 'adult_self_declared' else 'under_18' end;
  perform pg_advisory_xact_lock(hashtextextended('age:' || v_user::text, 0));
  select status into v_existing from public.account_age_eligibility
    where user_id = v_user for update;
  if v_existing is not null then
    if v_existing = v_next then return v_existing; end if;
    raise exception 'age_decision_locked';
  end if;
  insert into public.account_age_eligibility
    (user_id, status, assessment_method, policy_version)
  values (v_user, v_next, 'self_declaration', 'nearr-18-plus-v1');
  return v_next;
end;
$$;

revoke all on function public.declare_age_eligibility_18_plus(boolean) from public, anon;
grant execute on function public.declare_age_eligibility_18_plus(boolean) to authenticated;

-- Only service_role may ask about an arbitrary account. Edge/worker code must
-- derive this UUID from a validated JWT or an existing job/task owner.
create or replace function public.is_adult_eligible_for_ai(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select status = 'adult_self_declared'
       from public.account_age_eligibility
      where user_id = p_user_id),
    false
  );
$$;

revoke all on function public.is_adult_eligible_for_ai(uuid) from public, anon, authenticated;
grant execute on function public.is_adult_eligible_for_ai(uuid) to service_role;

-- Database backstop for old Edge code or another service-role insertion path.
-- Ownership transfer of pre-existing rows is unaffected; dispatch must perform
-- a fresh eligibility check separately before contacting an AI provider.
create or replace function public.guard_share_job_age_eligibility()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.status in ('queued', 'awaiting_purchase'))
     or (tg_op = 'UPDATE' and new.status = 'queued' and old.status <> 'queued') then
    if not public.is_adult_eligible_for_ai(new.user_id) then
      raise exception 'age_eligibility_required';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists share_jobs_age_eligibility_guard on public.share_jobs;
create trigger share_jobs_age_eligibility_guard
  before insert or update on public.share_jobs
  for each row execute function public.guard_share_job_age_eligibility();

-- A task can also be created by an internal RPC without a new share_jobs
-- insert (for example, enrichment of an existing save). Guard that queue too;
-- the worker still rechecks immediately before every external model call.
create or replace function public.guard_share_media_task_age_eligibility()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.status = 'queued')
     or (tg_op = 'UPDATE' and new.status = 'queued' and old.status <> 'queued') then
    if not public.is_adult_eligible_for_ai(new.user_id) then
      raise exception 'age_eligibility_required';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists share_media_tasks_age_eligibility_guard on public.share_media_tasks;
create trigger share_media_tasks_age_eligibility_guard
  before insert or update on public.share_media_tasks
  for each row execute function public.guard_share_media_task_age_eligibility();

-- The existing V2 transfer grant is one-time, locked, and destination-bound.
-- Copy only an adult declaration to a destination with no prior decision.
-- A destination's under-18 or revoked decision always wins. The source row
-- remains for audit until its anonymous auth account is deleted normally.
create or replace function public.propagate_transferred_age_eligibility()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'completed' and new.status = 'completed'
     and new.destination_user_id is not null then
    insert into public.account_age_eligibility
      (user_id, status, assessment_method, policy_version, assessed_at, changed_at)
    select new.destination_user_id, status, assessment_method,
           policy_version, assessed_at, now()
      from public.account_age_eligibility
     where user_id = new.source_user_id and status = 'adult_self_declared'
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists onboarding_transfer_age_eligibility on public.onboarding_account_transfer_grants;
create trigger onboarding_transfer_age_eligibility
  after update of status on public.onboarding_account_transfer_grants
  for each row execute function public.propagate_transferred_age_eligibility();

-- Recovery is to disable new AI ingress and dispatch, not to delete this table.
-- A database rollback requires a separate reviewed migration after all callers
-- have been reverted. Removing this guard alone would reopen old-client ingress.
