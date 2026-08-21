-- Onboarding V2 anonymous persistence and permanent-account conversion.
-- Production release timestamped after the already-applied 20260821000001
-- migration; never backfill this schema under its earlier development ID.

set check_function_bodies = off;
create extension if not exists "pgcrypto";

create table if not exists public.onboarding_v2_sessions (
  id                       uuid primary key,
  user_id                  uuid references auth.users(id) on delete set null,
  anonymous_user_id        uuid,
  permanent_user_id        uuid references auth.users(id) on delete set null,
  lifecycle                text not null check (lifecycle in (
                               'anonymous_active',
                               'permanent_account_linking',
                               'permanent_account'
                             )),
  revision                 integer not null default 0 check (revision >= 0),
  state                    jsonb not null default '{}'::jsonb,
  tutorial_saved_place_id  uuid references public.saved_places(id) on delete set null,
  tutorial_source_url      text,
  last_activity_at         timestamptz not null default now(),
  upgraded_at              timestamptz,
  cleanup_completed_at     timestamptz,
  cleanup_reason           text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists onboarding_v2_sessions_user_activity_idx
  on public.onboarding_v2_sessions (user_id, last_activity_at desc)
  where user_id is not null;
create index if not exists onboarding_v2_sessions_cleanup_idx
  on public.onboarding_v2_sessions (lifecycle, last_activity_at)
  where cleanup_completed_at is null;

alter table public.onboarding_v2_sessions enable row level security;
drop policy if exists "onboarding_v2_sessions: owner select" on public.onboarding_v2_sessions;
create policy "onboarding_v2_sessions: owner select"
  on public.onboarding_v2_sessions for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.onboarding_v2_sessions from public, anon, authenticated;
grant select on table public.onboarding_v2_sessions to authenticated;
grant all on table public.onboarding_v2_sessions to service_role;

-- Funnel identity is independent from auth.users, so deletion can null the
-- auth IDs while conversion/drop-off analysis remains intact.
alter table public.analytics_events
  add column if not exists onboarding_session_id uuid,
  add column if not exists converted_user_id uuid references auth.users(id) on delete set null;
create index if not exists analytics_events_onboarding_session_idx
  on public.analytics_events (onboarding_session_id, created_at);

drop policy if exists "analytics_events: auth insert" on public.analytics_events;
create policy "analytics_events: auth insert"
  on public.analytics_events for insert to authenticated
  with check (
    (user_id is null or user_id = auth.uid())
    and (converted_user_id is null or converted_user_id = auth.uid())
  );

create or replace function public.upsert_onboarding_v2_session(
  p_session_id uuid,
  p_revision integer,
  p_state jsonb,
  p_lifecycle text,
  p_tutorial_saved_place_id uuid default null,
  p_tutorial_source_url text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_anonymous boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
begin
  if v_user_id is null or p_session_id is null then raise exception 'unauthorized'; end if;
  if p_lifecycle not in ('anonymous_active', 'permanent_account_linking', 'permanent_account') then
    raise exception 'invalid_lifecycle';
  end if;
  if v_is_anonymous and p_lifecycle = 'permanent_account' then
    raise exception 'anonymous_cannot_finalize';
  end if;
  if p_tutorial_saved_place_id is not null and not exists (
    select 1 from public.saved_places where id = p_tutorial_saved_place_id and user_id = v_user_id
  ) then
    raise exception 'tutorial_place_not_owned';
  end if;

  insert into public.onboarding_v2_sessions (
    id, user_id, anonymous_user_id, permanent_user_id, lifecycle, revision,
    state, tutorial_saved_place_id, tutorial_source_url, last_activity_at
  ) values (
    p_session_id, v_user_id, v_user_id,
    case when v_is_anonymous then null else v_user_id end,
    p_lifecycle, greatest(p_revision, 0), coalesce(p_state, '{}'::jsonb),
    p_tutorial_saved_place_id, p_tutorial_source_url, now()
  )
  on conflict (id) do update set
    user_id = excluded.user_id,
    permanent_user_id = case
      when v_is_anonymous then onboarding_v2_sessions.permanent_user_id
      else v_user_id
    end,
    lifecycle = excluded.lifecycle,
    revision = excluded.revision,
    state = excluded.state,
    tutorial_saved_place_id = coalesce(excluded.tutorial_saved_place_id, onboarding_v2_sessions.tutorial_saved_place_id),
    tutorial_source_url = coalesce(excluded.tutorial_source_url, onboarding_v2_sessions.tutorial_source_url),
    last_activity_at = now(),
    updated_at = now()
  where onboarding_v2_sessions.user_id = v_user_id
    and excluded.revision >= onboarding_v2_sessions.revision;
end;
$$;
revoke all on function public.upsert_onboarding_v2_session(uuid,integer,jsonb,text,uuid,text) from public, anon;
grant execute on function public.upsert_onboarding_v2_session(uuid,integer,jsonb,text,uuid,text) to authenticated;

create table if not exists public.onboarding_account_transfer_grants (
  id                     uuid primary key default gen_random_uuid(),
  onboarding_session_id  uuid not null references public.onboarding_v2_sessions(id) on delete cascade,
  source_user_id         uuid not null,
  destination_user_id    uuid,
  secret_hash            bytea not null unique,
  status                 text not null default 'pending' check (status in ('pending','completed','expired')),
  result                  jsonb,
  expires_at              timestamptz not null,
  completed_at            timestamptz,
  created_at              timestamptz not null default now()
);
create unique index if not exists onboarding_transfer_one_pending_uidx
  on public.onboarding_account_transfer_grants (onboarding_session_id)
  where status = 'pending';
alter table public.onboarding_account_transfer_grants enable row level security;
revoke all on table public.onboarding_account_transfer_grants from public, anon, authenticated;
grant all on table public.onboarding_account_transfer_grants to service_role;

create or replace function public.begin_onboarding_account_transfer(
  p_onboarding_session_id uuid,
  p_transfer_secret text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_grant_id uuid;
begin
  if v_user_id is null or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'anonymous_auth_required';
  end if;
  if length(coalesce(p_transfer_secret, '')) < 32 then raise exception 'weak_transfer_secret'; end if;
  if not exists (
    select 1 from public.onboarding_v2_sessions s
     where s.id = p_onboarding_session_id and s.user_id = v_user_id
       and s.anonymous_user_id = v_user_id and s.tutorial_saved_place_id is not null
  ) then
    raise exception 'onboarding_session_not_transferable';
  end if;

  update public.onboarding_account_transfer_grants
     set status = 'expired'
   where onboarding_session_id = p_onboarding_session_id and status = 'pending';
  insert into public.onboarding_account_transfer_grants (
    onboarding_session_id, source_user_id, secret_hash, expires_at
  ) values (
    p_onboarding_session_id, v_user_id, digest(p_transfer_secret, 'sha256'), now() + interval '24 hours'
  ) returning id into v_grant_id;
  update public.onboarding_v2_sessions
     set lifecycle = 'permanent_account_linking', last_activity_at = now(), updated_at = now()
   where id = p_onboarding_session_id and user_id = v_user_id;
  return v_grant_id;
end;
$$;
revoke all on function public.begin_onboarding_account_transfer(uuid,text) from public, anon;
grant execute on function public.begin_onboarding_account_transfer(uuid,text) to authenticated;

create or replace function public.finalize_onboarding_identity_link(p_onboarding_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_saved_place_id uuid;
  v_result jsonb;
begin
  if v_user_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'permanent_auth_required';
  end if;
  select tutorial_saved_place_id into v_saved_place_id
    from public.onboarding_v2_sessions
   where id = p_onboarding_session_id and user_id = v_user_id and anonymous_user_id = v_user_id
   for update;
  if not found then raise exception 'same_user_link_not_authorized'; end if;
  v_result := jsonb_build_object(
    'permanent_user_id', v_user_id,
    'destination_was_established', false,
    'tutorial_saved_place_id', v_saved_place_id,
    'replayed', false
  );
  update public.onboarding_v2_sessions
     set permanent_user_id = v_user_id, lifecycle = 'permanent_account',
         upgraded_at = coalesce(upgraded_at, now()), last_activity_at = now(), updated_at = now()
   where id = p_onboarding_session_id;
  update public.analytics_events
     set converted_user_id = v_user_id
   where onboarding_session_id = p_onboarding_session_id and converted_user_id is null;
  update public.onboarding_account_transfer_grants
     set destination_user_id = v_user_id, status = 'completed', completed_at = now(), result = v_result
   where onboarding_session_id = p_onboarding_session_id and status = 'pending';
  update public.profiles p set email = u.email, updated_at = now()
    from auth.users u where p.id = v_user_id and u.id = v_user_id;
  return v_result;
end;
$$;
revoke all on function public.finalize_onboarding_identity_link(uuid) from public, anon;
grant execute on function public.finalize_onboarding_identity_link(uuid) to authenticated;

create or replace function public.complete_onboarding_account_transfer(p_transfer_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_destination uuid := auth.uid();
  v_grant public.onboarding_account_transfer_grants%rowtype;
  v_session public.onboarding_v2_sessions%rowtype;
  v_destination_established boolean;
  v_source_saved uuid;
  v_destination_saved uuid;
  v_place_id uuid;
  v_job_ids uuid[] := array[]::uuid[];
  v_result jsonb;
begin
  if v_destination is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'permanent_auth_required';
  end if;
  select * into v_grant from public.onboarding_account_transfer_grants
   where secret_hash = digest(coalesce(p_transfer_secret, ''), 'sha256') for update;
  if not found then raise exception 'transfer_grant_not_found'; end if;
  if v_grant.status = 'completed' then
    if v_grant.destination_user_id <> v_destination then raise exception 'transfer_destination_mismatch'; end if;
    return coalesce(v_grant.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  if v_grant.status <> 'pending' or v_grant.expires_at <= now() then
    update public.onboarding_account_transfer_grants set status = 'expired' where id = v_grant.id;
    raise exception 'transfer_grant_expired';
  end if;
  if v_grant.source_user_id = v_destination then raise exception 'use_same_user_finalize'; end if;

  select * into v_session from public.onboarding_v2_sessions
   where id = v_grant.onboarding_session_id and anonymous_user_id = v_grant.source_user_id
   for update;
  if not found or v_session.user_id <> v_grant.source_user_id then raise exception 'transfer_source_mismatch'; end if;

  select exists (
    select 1 from public.saved_places where user_id = v_destination
  ) or exists (
    select 1 from auth.users where id = v_destination and created_at < v_session.created_at
  ) into v_destination_established;

  v_source_saved := v_session.tutorial_saved_place_id;
  select place_id into v_place_id from public.saved_places
   where id = v_source_saved and user_id = v_grant.source_user_id for update;
  if v_place_id is null then raise exception 'tutorial_saved_place_missing'; end if;
  select id into v_destination_saved from public.saved_places
   where user_id = v_destination and place_id = v_place_id for update;

  select coalesce(array_agg(id), array[]::uuid[]) into v_job_ids
    from public.share_jobs
   where user_id = v_grant.source_user_id
     and (saved_place_id = v_source_saved or source_url = v_session.tutorial_source_url);

  if v_destination_saved is not null then
    update public.share_jobs set saved_place_id = v_destination_saved where id = any(v_job_ids);
    update public.share_job_place_results set saved_place_id = v_destination_saved where share_job_id = any(v_job_ids);
    delete from public.saved_places where id = v_source_saved and user_id = v_grant.source_user_id;
  else
    update public.saved_places set user_id = v_destination where id = v_source_saved and user_id = v_grant.source_user_id;
    v_destination_saved := v_source_saved;
    update public.notification_events set user_id = v_destination
     where saved_place_id = v_destination_saved and user_id = v_grant.source_user_id;
  end if;

  -- Explicit allowlist: only rows belonging to the tutorial job(s) move.
  update public.share_jobs set user_id = v_destination, idempotency_key = null where id = any(v_job_ids);
  update public.share_media_tasks set user_id = v_destination where share_job_id = any(v_job_ids);
  update public.share_job_place_results set user_id = v_destination where share_job_id = any(v_job_ids);
  update public.share_media_runs set user_id = v_destination where share_job_id = any(v_job_ids);
  update public.share_agent_runs set user_id = v_destination
   where user_id = v_grant.source_user_id and url = v_session.tutorial_source_url;
  update public.share_extraction_failures set user_id = v_destination
   where user_id = v_grant.source_user_id
     and (original_url = v_session.tutorial_source_url or canonical_url = v_session.tutorial_source_url);

  v_result := jsonb_build_object(
    'permanent_user_id', v_destination,
    'destination_was_established', v_destination_established,
    'tutorial_saved_place_id', v_destination_saved,
    'replayed', false
  );
  update public.onboarding_v2_sessions
     set user_id = v_destination, permanent_user_id = v_destination,
         lifecycle = 'permanent_account', tutorial_saved_place_id = v_destination_saved,
         upgraded_at = now(), last_activity_at = now(), updated_at = now()
   where id = v_session.id;
  update public.analytics_events set converted_user_id = v_destination
   where onboarding_session_id = v_session.id and converted_user_id is null;
  update public.onboarding_account_transfer_grants
     set destination_user_id = v_destination, status = 'completed', completed_at = now(), result = v_result
   where id = v_grant.id;
  return v_result;
end;
$$;
revoke all on function public.complete_onboarding_account_transfer(text) from public, anon;
grant execute on function public.complete_onboarding_account_transfer(text) to authenticated;

-- Recovery seam for the narrow window where the atomic transfer committed but
-- the client died before persisting the returned destination mapping. Only the
-- already-recorded destination user can read the completed result.
create or replace function public.resume_completed_onboarding_account_transfer(
  p_onboarding_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_destination uuid := auth.uid();
  v_result jsonb;
begin
  if v_destination is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'permanent_auth_required';
  end if;
  select g.result into v_result
    from public.onboarding_account_transfer_grants g
   where g.onboarding_session_id = p_onboarding_session_id
     and g.destination_user_id = v_destination and g.status = 'completed'
   order by g.completed_at desc limit 1;
  if v_result is null then raise exception 'completed_transfer_not_found'; end if;
  return v_result || jsonb_build_object('replayed', true);
end;
$$;
revoke all on function public.resume_completed_onboarding_account_transfer(uuid) from public, anon;
grant execute on function public.resume_completed_onboarding_account_transfer(uuid) to authenticated;

-- Service-role-only candidate list for the separately scheduled cleanup job.
create or replace function public.list_anonymous_onboarding_cleanup_candidates(
  p_abandoned_ttl interval default interval '30 days',
  p_converted_grace interval default interval '24 hours',
  p_limit integer default 100
)
returns table(onboarding_session_id uuid, anonymous_user_id uuid, reason text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.anonymous_user_id,
    case when s.lifecycle = 'permanent_account' then 'converted_source' else 'abandoned' end
  from public.onboarding_v2_sessions s
  where s.cleanup_completed_at is null
    and s.anonymous_user_id is not null
    and (
      (s.lifecycle in ('anonymous_active','permanent_account_linking') and s.last_activity_at < now() - p_abandoned_ttl)
      or
      (s.lifecycle = 'permanent_account' and s.anonymous_user_id <> s.permanent_user_id
       and s.upgraded_at < now() - p_converted_grace)
    )
  order by s.last_activity_at
  limit greatest(1, least(p_limit, 500));
$$;
revoke all on function public.list_anonymous_onboarding_cleanup_candidates(interval,interval,integer) from public, anon, authenticated;
grant execute on function public.list_anonymous_onboarding_cleanup_candidates(interval,interval,integer) to service_role;

-- DOWN (manual): drop the four functions, transfer table, session table, and
-- the two analytics columns/index only after all V2 clients are retired.
