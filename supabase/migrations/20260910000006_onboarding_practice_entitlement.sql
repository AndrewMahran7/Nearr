-- One bounded, exact-fixture practice save after the guided onboarding demo.
-- Development-only application code consumes this schema; no Production
-- deployment is authorized by this migration file's presence.

set check_function_bodies = off;

alter table public.onboarding_tutorial_fixtures
  add column if not exists tutorial_use text not null default 'demo';
alter table public.onboarding_tutorial_fixtures
  drop constraint if exists onboarding_tutorial_fixtures_tutorial_use_check;
alter table public.onboarding_tutorial_fixtures
  add constraint onboarding_tutorial_fixtures_tutorial_use_check
  check (tutorial_use in ('demo','practice','both'));

-- Existing qualified fixtures remain demo sources. This independently
-- verified, distinct Instagram source is presentation/lookup truth only; it
-- is never admitted to Recognition Cache V2.
do $$
declare
  v_place_id uuid;
begin
  select p.id into v_place_id
    from public.places as p
   where p.google_place_id = 'ChIJ3dEbnTMh3YARhAvz8VeCxJg'
     and p.merged_into_place_id is null
     and coalesce(p.business_status, '') <> 'CLOSED_PERMANENTLY'
   limit 1;
  if v_place_id is null then raise exception 'onboarding_practice_place_missing'; end if;

  insert into public.onboarding_tutorial_fixtures(
    id, identity_key, identity_version, platform, content_id, canonical_url,
    place_id, status, role, priority, provenance, verification_revision,
    verified_at, verified_by, health_state, last_health_checked_at,
    health_expires_at, tutorial_use
  ) values (
    '2b6fc7fe-2d88-46e8-a8ae-140680862da7',
    'v1:instagram:DUWyZkfgbT4', 1, 'instagram', 'DUWyZkfgbT4',
    'https://www.instagram.com/reel/DUWyZkfgbT4/', v_place_id,
    'active', 'backup', 180, 'onboarding_tutorial_verified', 1,
    now(), 'ONB2-06 independent source/place verification 2026-09-10',
    'healthy', now(), now() + interval '7 days', 'practice'
  ) on conflict (id) do update set
    place_id = excluded.place_id,
    tutorial_use = 'practice',
    updated_at = now();
end;
$$;

create table public.onboarding_practice_entitlements (
  onboarding_session_id uuid primary key references public.onboarding_v2_sessions(id) on delete cascade,
  user_id uuid not null,
  demo_share_job_id uuid not null unique references public.share_jobs(id) on delete restrict,
  demo_fixture_id uuid not null references public.onboarding_tutorial_fixtures(id) on delete restrict,
  selected_fixture_id uuid not null references public.onboarding_tutorial_fixtures(id) on delete restrict,
  status text not null default 'selected' check (status in ('selected','reserved','released','consumed')),
  active_share_job_id uuid unique references public.share_jobs(id) on delete set null,
  last_share_job_id uuid references public.share_jobs(id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  selected_at timestamptz not null default now(),
  reserved_at timestamptz,
  released_at timestamptz,
  consumed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (demo_fixture_id <> selected_fixture_id),
  check ((status = 'reserved') = (active_share_job_id is not null)),
  check ((status = 'consumed') = (consumed_at is not null))
);
create index onboarding_practice_entitlements_user_idx
  on public.onboarding_practice_entitlements(user_id, selected_at desc);

create table public.onboarding_practice_entitlement_events (
  id uuid primary key default gen_random_uuid(),
  onboarding_session_id uuid not null references public.onboarding_v2_sessions(id) on delete cascade,
  user_id uuid not null,
  fixture_id uuid not null references public.onboarding_tutorial_fixtures(id) on delete restrict,
  share_job_id uuid references public.share_jobs(id) on delete set null,
  event_type text not null check (event_type in ('selected','reserved','released','consumed','owner_transferred','rejected')),
  reason_code text not null check (length(trim(reason_code)) between 2 and 100),
  detail jsonb not null default '{}'::jsonb check (octet_length(detail::text) <= 4096),
  created_at timestamptz not null default now()
);
create index onboarding_practice_entitlement_events_session_idx
  on public.onboarding_practice_entitlement_events(onboarding_session_id, created_at);

alter table public.onboarding_practice_entitlements enable row level security;
alter table public.onboarding_practice_entitlement_events enable row level security;
revoke all on table public.onboarding_practice_entitlements from public, anon, authenticated;
revoke all on table public.onboarding_practice_entitlement_events from public, anon, authenticated;
grant all on table public.onboarding_practice_entitlements to service_role;
grant all on table public.onboarding_practice_entitlement_events to service_role;

create or replace function public.select_onboarding_practice_fixture(
  p_user_id uuid,
  p_onboarding_session_id uuid,
  p_preferred_platform text default null
)
returns table(
  fixture_id uuid,
  fixture_revision bigint,
  fixture_role text,
  platform text,
  identity_key text,
  identity_version integer,
  content_id text,
  canonical_url text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.onboarding_v2_sessions%rowtype;
  v_demo record;
  v_entitlement public.onboarding_practice_entitlements%rowtype;
  v_fixture public.onboarding_tutorial_fixtures%rowtype;
begin
  select s.* into v_session
    from public.onboarding_v2_sessions as s
   where s.id = p_onboarding_session_id and s.user_id = p_user_id
   for update;
  if not found or v_session.tutorial_saved_place_id is null then return; end if;

  select j.id as share_job_id, j.tutorial_fixture_id, f.place_id into v_demo
    from public.share_jobs as j
    join public.onboarding_tutorial_fixtures as f on f.id = j.tutorial_fixture_id
   where j.user_id = p_user_id
     and j.saved_place_id = v_session.tutorial_saved_place_id
     and j.status = 'completed'
     and j.billing_mode = 'onboarding_free'
     and j.resolution_source = 'tutorial_fixture'
   order by j.completed_at desc nulls last
   limit 1;
  if v_demo.tutorial_fixture_id is null then return; end if;

  select e.* into v_entitlement
    from public.onboarding_practice_entitlements as e
   where e.onboarding_session_id = p_onboarding_session_id;
  if found then
    select f.* into v_fixture from public.onboarding_tutorial_fixtures as f
     where f.id = v_entitlement.selected_fixture_id
       and f.tutorial_use in ('practice','both')
       and f.status = 'active' and f.health_state = 'healthy'
       and f.health_expires_at > now();
    if not found then return; end if;
  else
    select f.* into v_fixture
      from public.onboarding_tutorial_fixtures as f
     where f.tutorial_use in ('practice','both')
       and f.id <> v_demo.tutorial_fixture_id
       and f.place_id <> v_demo.place_id
       and f.status = 'active'
       and f.health_state = 'healthy'
       and f.health_expires_at > now()
       and (f.expected_media_sha256 is null or f.expected_media_sha256 = f.last_observed_media_sha256)
     order by (f.platform = lower(trim(coalesce(p_preferred_platform, '')))) desc,
              f.priority desc, f.created_at
     limit 1;
    if v_fixture.id is null then return; end if;
    insert into public.onboarding_practice_entitlements(
      onboarding_session_id,user_id,demo_share_job_id,demo_fixture_id,selected_fixture_id
    ) values (p_onboarding_session_id,p_user_id,v_demo.share_job_id,v_demo.tutorial_fixture_id,v_fixture.id)
    on conflict (onboarding_session_id) do nothing;
    insert into public.onboarding_practice_entitlement_events(
      onboarding_session_id,user_id,fixture_id,event_type,reason_code
    ) values (p_onboarding_session_id,p_user_id,v_fixture.id,'selected','eligible_distinct_fixture');
  end if;

  return query select f.id, f.verification_revision, f.role, f.platform,
    f.identity_key, f.identity_version, f.content_id, f.canonical_url
  from public.onboarding_tutorial_fixtures as f
  where f.id = v_fixture.id;
end;
$$;
revoke all on function public.select_onboarding_practice_fixture(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.select_onboarding_practice_fixture(uuid,uuid,text) to service_role;

create or replace function public.authorize_onboarding_practice_share_job(
  p_user_id uuid,
  p_share_job_id uuid,
  p_canonical_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.share_jobs%rowtype;
  v_entitlement public.onboarding_practice_entitlements%rowtype;
  v_prior_status text;
begin
  select j.* into v_job from public.share_jobs as j
   where j.id = p_share_job_id and j.user_id = p_user_id for update;
  if not found then return jsonb_build_object('authorized',false,'reason','job_not_owned'); end if;

  select e.* into v_entitlement from public.onboarding_practice_entitlements as e
   join public.onboarding_tutorial_fixtures as f on f.id=e.selected_fixture_id
   where e.user_id = p_user_id
     and f.canonical_url = trim(p_canonical_url)
     and f.platform = v_job.source_platform
     and f.status = 'active' and f.health_state = 'healthy'
     and f.health_expires_at > now()
   order by e.selected_at desc limit 1 for update of e;
  if not found or v_job.canonical_url <> trim(p_canonical_url) then
    return jsonb_build_object('authorized',false,'reason','no_exact_selected_entitlement');
  end if;
  if v_entitlement.status = 'consumed' then
    return jsonb_build_object('authorized',false,'reason','already_consumed');
  end if;
  if v_entitlement.active_share_job_id = v_job.id and v_job.billing_mode = 'onboarding_practice_free' then
    return jsonb_build_object('authorized',true,'reason','idempotent','status',v_job.status);
  end if;
  if v_entitlement.status = 'reserved' and v_entitlement.active_share_job_id <> v_job.id then
    select j.status into v_prior_status from public.share_jobs as j where j.id=v_entitlement.active_share_job_id;
    if v_prior_status not in ('failed','cancelled') then
      return jsonb_build_object('authorized',false,'reason','attempt_in_progress');
    end if;
  end if;
  if v_job.status not in ('awaiting_purchase','queued') or
     v_job.billing_mode not in ('blocked_anonymous','normal_free','onboarding_practice_free') then
    return jsonb_build_object('authorized',false,'reason','job_billing_ineligible');
  end if;
  if not exists (
    select 1 from public.onboarding_v2_sessions as s
    join public.share_jobs as demo on demo.user_id=s.user_id
      and demo.saved_place_id=s.tutorial_saved_place_id
      and demo.tutorial_fixture_id=v_entitlement.demo_fixture_id
      and demo.status='completed' and demo.billing_mode='onboarding_free'
    where s.id=v_entitlement.onboarding_session_id and s.user_id=p_user_id
  ) then return jsonb_build_object('authorized',false,'reason','demo_not_completed'); end if;

  update public.onboarding_practice_entitlements as e set
    status='reserved', active_share_job_id=v_job.id, last_share_job_id=v_job.id,
    attempt_count=e.attempt_count+1, reserved_at=now(), released_at=null, updated_at=now()
   where e.onboarding_session_id=v_entitlement.onboarding_session_id;
  update public.share_jobs as j set
    status='queued', progress_stage='queued', billing_mode='onboarding_practice_free',
    billing_outcome='onboarding_practice:reserved', billing_settled_at=now(), updated_at=now()
   where j.id=v_job.id;
  insert into public.onboarding_practice_entitlement_events(
    onboarding_session_id,user_id,fixture_id,share_job_id,event_type,reason_code
  ) values (v_entitlement.onboarding_session_id,p_user_id,v_entitlement.selected_fixture_id,
    v_job.id,'reserved','exact_fixture_authorized');
  return jsonb_build_object('authorized',true,'reason','reserved','status','queued');
end;
$$;
revoke all on function public.authorize_onboarding_practice_share_job(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.authorize_onboarding_practice_share_job(uuid,uuid,text) to service_role;

create or replace function public.settle_onboarding_practice_entitlement()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event text; v_reason text; v_session uuid; v_fixture uuid;
begin
  if new.billing_mode <> 'onboarding_practice_free' or new.status not in ('completed','failed','cancelled') then return new; end if;
  if new.status='completed' then v_event:='consumed'; v_reason:='practice_job_completed';
  else v_event:='released'; v_reason:='practice_job_'||new.status; end if;
  update public.onboarding_practice_entitlements as e set
    status=case when new.status='completed' then 'consumed' else 'released' end,
    active_share_job_id=null,
    consumed_at=case when new.status='completed' then now() else e.consumed_at end,
    released_at=case when new.status<>'completed' then now() else e.released_at end,
    updated_at=now()
  where e.active_share_job_id=new.id and e.status='reserved'
  returning e.onboarding_session_id,e.selected_fixture_id into v_session,v_fixture;
  if v_session is not null then
    insert into public.onboarding_practice_entitlement_events(
      onboarding_session_id,user_id,fixture_id,share_job_id,event_type,reason_code
    ) values(v_session,new.user_id,v_fixture,new.id,v_event,v_reason);
  end if;
  return new;
end; $$;
drop trigger if exists settle_onboarding_practice_entitlement on public.share_jobs;
create trigger settle_onboarding_practice_entitlement after update of status on public.share_jobs
  for each row when (old.status is distinct from new.status)
  execute function public.settle_onboarding_practice_entitlement();

create or replace function public.sync_onboarding_practice_entitlement_owner()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.user_id is distinct from new.user_id and new.user_id is not null then
    update public.onboarding_practice_entitlements set user_id=new.user_id,updated_at=now()
      where onboarding_session_id=new.id;
    insert into public.onboarding_practice_entitlement_events(
      onboarding_session_id,user_id,fixture_id,event_type,reason_code
    ) select e.onboarding_session_id,new.user_id,e.selected_fixture_id,'owner_transferred','onboarding_owner_changed'
      from public.onboarding_practice_entitlements as e where e.onboarding_session_id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists sync_onboarding_practice_entitlement_owner on public.onboarding_v2_sessions;
create trigger sync_onboarding_practice_entitlement_owner after update of user_id on public.onboarding_v2_sessions
  for each row execute function public.sync_onboarding_practice_entitlement_owner();

alter table public.share_jobs drop constraint if exists share_jobs_billing_mode_check;
alter table public.share_jobs add constraint share_jobs_billing_mode_check check(
  billing_mode in ('normal_free','premium_request','unmetered_legacy','onboarding_free',
    'onboarding_practice_free','metered','blocked_anonymous','source_replay_free','pro')
);

comment on table public.onboarding_practice_entitlements is
  'One server-selected, exact curated practice save per onboarding session; not a wallet or organic free-share grant.';
