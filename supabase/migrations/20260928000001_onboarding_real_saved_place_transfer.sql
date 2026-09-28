-- Onboarding Phase 1 now has an install-local scripted saved card. It is not a
-- saved_places row and must never be manufactured merely to satisfy transfer.
-- V2 grants therefore authorize the anonymous onboarding identity, then move
-- the real rows that identity actually owns. An empty real set is valid.
set check_function_bodies = off;

create or replace function public.begin_onboarding_account_transfer_v2(
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
     where s.id = p_onboarding_session_id
       and s.user_id = v_user_id
       and s.anonymous_user_id = v_user_id
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

revoke all on function public.begin_onboarding_account_transfer_v2(uuid,text) from public, anon;
grant execute on function public.begin_onboarding_account_transfer_v2(uuid,text) to authenticated;

create or replace function public.complete_onboarding_account_transfer_v2(p_transfer_secret text)
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
  v_source_saved record;
  v_destination_saved uuid;
  v_tutorial_destination uuid := null;
  v_transferred_ids uuid[] := array[]::uuid[];
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

  select exists (select 1 from public.saved_places where user_id = v_destination)
      or exists (select 1 from auth.users where id = v_destination and created_at < v_session.created_at)
    into v_destination_established;

  -- Every row in this loop is a real UUID-backed saved_places row. The local
  -- scripted tutorial id never enters Postgres and therefore cannot appear.
  for v_source_saved in
    select id, place_id from public.saved_places
     where user_id = v_grant.source_user_id
     order by created_at, id
     for update
  loop
    select id into v_destination_saved from public.saved_places
     where user_id = v_destination and place_id = v_source_saved.place_id
     for update;
    if v_destination_saved is not null then
      update public.share_jobs set saved_place_id = v_destination_saved
       where user_id = v_grant.source_user_id and saved_place_id = v_source_saved.id;
      update public.share_job_place_results set saved_place_id = v_destination_saved
       where user_id = v_grant.source_user_id and saved_place_id = v_source_saved.id;
      update public.notification_events set saved_place_id = v_destination_saved
       where user_id = v_grant.source_user_id and saved_place_id = v_source_saved.id;
      delete from public.saved_places
       where id = v_source_saved.id and user_id = v_grant.source_user_id;
    else
      update public.saved_places set user_id = v_destination
       where id = v_source_saved.id and user_id = v_grant.source_user_id;
      v_destination_saved := v_source_saved.id;
    end if;
    if v_session.tutorial_saved_place_id = v_source_saved.id then
      v_tutorial_destination := v_destination_saved;
    end if;
    v_transferred_ids := array_append(v_transferred_ids, v_destination_saved);
    v_destination_saved := null;
  end loop;

  -- The anonymous install is the bounded source owner authorized by the
  -- one-time grant. Move its real queue work too, including needs-review jobs
  -- that have not created a saved_places row yet.
  update public.share_media_tasks set user_id = v_destination
   where user_id = v_grant.source_user_id;
  update public.share_job_place_results set user_id = v_destination
   where user_id = v_grant.source_user_id;
  update public.share_media_runs set user_id = v_destination
   where user_id = v_grant.source_user_id;
  update public.share_agent_runs set user_id = v_destination
   where user_id = v_grant.source_user_id;
  update public.share_extraction_failures set user_id = v_destination
   where user_id = v_grant.source_user_id;
  update public.share_jobs set user_id = v_destination, idempotency_key = null
   where user_id = v_grant.source_user_id;
  update public.notification_events set user_id = v_destination
   where user_id = v_grant.source_user_id;

  v_result := jsonb_build_object(
    'permanent_user_id', v_destination,
    'destination_was_established', v_destination_established,
    'tutorial_saved_place_id', v_tutorial_destination,
    'transferred_saved_place_ids', to_jsonb(v_transferred_ids),
    'transferred_saved_place_count', coalesce(array_length(v_transferred_ids, 1), 0),
    'replayed', false
  );
  update public.onboarding_v2_sessions
     set user_id = v_destination, permanent_user_id = v_destination,
         lifecycle = 'permanent_account', tutorial_saved_place_id = v_tutorial_destination,
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

revoke all on function public.complete_onboarding_account_transfer_v2(text) from public, anon;
grant execute on function public.complete_onboarding_account_transfer_v2(text) to authenticated;

comment on function public.begin_onboarding_account_transfer_v2(uuid,text) is
  'Creates an onboarding identity grant without requiring a synthetic tutorial card to be a saved_places row.';
comment on function public.complete_onboarding_account_transfer_v2(text) is
  'Moves only real UUID-backed rows owned by the authorized anonymous identity; an empty real set is valid.';
