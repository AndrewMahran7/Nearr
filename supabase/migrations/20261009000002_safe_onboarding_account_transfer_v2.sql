-- Additive, source-preserving V2 transfer. Do not promote the Development V2 migration.
-- The V1 RPC signatures remain present for the public 1.4.55 client.

create or replace function public.begin_onboarding_account_transfer_v2(
  p_onboarding_session_id uuid, p_transfer_secret text
)
returns uuid
language plpgsql security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session public.onboarding_v2_sessions%rowtype;
  v_existing public.onboarding_account_transfer_grants%rowtype;
  v_grant_id uuid;
  v_hash bytea;
begin
  if v_user is null or not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
     or not exists(select 1 from auth.users where id=v_user and is_anonymous is true) then
    raise exception 'anonymous_auth_required';
  end if;
  if p_transfer_secret !~ '^[0-9a-f]{64}$' then raise exception 'invalid_transfer_secret'; end if;
  v_hash := digest(p_transfer_secret,'sha256');
  select * into v_session from public.onboarding_v2_sessions
   where id=p_onboarding_session_id and user_id=v_user and anonymous_user_id=v_user
     and permanent_user_id is null and cleanup_completed_at is null
     and lifecycle in ('anonymous_active','permanent_account_linking') for update;
  if not found then raise exception 'onboarding_session_not_transferable'; end if;

  -- A lost begin response with the same secret returns the same grant.
  select * into v_existing from public.onboarding_account_transfer_grants
   where secret_hash=v_hash for update;
  if found then
    if v_existing.onboarding_session_id<>v_session.id or v_existing.source_user_id<>v_user
       or v_existing.status<>'pending' or v_existing.expires_at<=now() then
      raise exception 'transfer_grant_not_available';
    end if;
    return v_existing.id;
  end if;
  update public.onboarding_account_transfer_grants set status='expired'
   where onboarding_session_id=v_session.id and status='pending';
  insert into public.onboarding_account_transfer_grants
    (onboarding_session_id,source_user_id,secret_hash,expires_at)
  values (v_session.id,v_user,v_hash,now()+interval '24 hours')
  returning id into v_grant_id;
  update public.onboarding_v2_sessions
     set lifecycle='permanent_account_linking',last_activity_at=now(),updated_at=now()
   where id=v_session.id;
  return v_grant_id;
end;
$$;
revoke all on function public.begin_onboarding_account_transfer_v2(uuid,text) from public,anon;
grant execute on function public.begin_onboarding_account_transfer_v2(uuid,text) to authenticated;

create or replace function public.complete_onboarding_account_transfer_v2(p_transfer_secret text)
returns jsonb
language plpgsql security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_destination uuid := auth.uid();
  v_grant public.onboarding_account_transfer_grants%rowtype;
  v_session public.onboarding_v2_sessions%rowtype;
  v_source_save public.saved_places%rowtype;
  v_destination_save public.saved_places%rowtype;
  v_destination_id uuid;
  v_destination_established boolean;
  v_tutorial_destination uuid;
  v_ids uuid[] := array[]::uuid[];
  v_map jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  if v_destination is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
     or not exists(select 1 from auth.users where id=v_destination and is_anonymous is false) then
    raise exception 'permanent_auth_required';
  end if;
  select * into v_grant from public.onboarding_account_transfer_grants
   where secret_hash=digest(coalesce(p_transfer_secret,''),'sha256') for update;
  if not found then raise exception 'transfer_grant_not_found'; end if;
  if v_grant.status='completed' then
    if v_grant.destination_user_id is distinct from v_destination then
      raise exception 'transfer_destination_mismatch';
    end if;
    return coalesce(v_grant.result,'{}'::jsonb)||jsonb_build_object('replayed',true);
  end if;
  if v_grant.status<>'pending' or v_grant.expires_at<=now()
     or v_grant.destination_user_id is not null then
    raise exception 'transfer_grant_not_pending';
  end if;
  if v_grant.source_user_id=v_destination then raise exception 'use_same_user_finalize'; end if;
  if not exists(select 1 from auth.users where id=v_grant.source_user_id and is_anonymous is true) then
    raise exception 'transfer_source_not_anonymous';
  end if;
  select * into v_session from public.onboarding_v2_sessions
   where id=v_grant.onboarding_session_id and user_id=v_grant.source_user_id
     and anonymous_user_id=v_grant.source_user_id and permanent_user_id is null
     and lifecycle='permanent_account_linking' and cleanup_completed_at is null for update;
  if not found then raise exception 'transfer_source_mismatch'; end if;
  if exists(select 1 from public.onboarding_v2_sessions
       where user_id=v_grant.source_user_id and id<>v_session.id
         and lifecycle<>'permanent_account') then
    raise exception 'transfer_source_has_another_active_session';
  end if;

  -- Deterministic locks reduce conflicts; the composite ownership FK is the
  -- authoritative race barrier for parent owner changes and late children.
  perform id from public.saved_places
   where user_id in (v_grant.source_user_id,v_destination)
   order by user_id,place_id,id for update;
  perform s.id from public.saved_place_sources s
   join public.saved_places p on p.id=s.saved_place_id
   where p.user_id in (v_grant.source_user_id,v_destination)
   order by s.saved_place_id,s.id for update of s;
  perform id from public.share_jobs where user_id=v_grant.source_user_id order by id for update;
  perform id from public.share_media_tasks where user_id=v_grant.source_user_id order by id for update;

  if exists(select 1 from public.saved_place_sources s
      join public.saved_places p on p.id=s.saved_place_id
      where p.user_id in (v_grant.source_user_id,v_destination) and s.user_id<>p.user_id) then
    raise exception 'transfer_source_owner_mismatch';
  end if;
  if exists(select 1 from public.share_jobs
      where user_id=v_grant.source_user_id and
        (status not in ('completed','failed','cancelled')
         or notification_status in ('pending','sending','retryable_failed')
         or premium_request_id is not null))
     or exists(select 1 from public.share_media_tasks
      where user_id=v_grant.source_user_id and status not in ('completed','failed','cancelled')) then
    raise exception 'transfer_active_work';
  end if;
  if exists(select 1 from public.share_jobs j join public.saved_places p on p.id=j.saved_place_id
      where j.user_id=v_grant.source_user_id and p.user_id<>v_grant.source_user_id)
     or exists(select 1 from public.share_job_place_results r
      join public.share_jobs j on j.id=r.share_job_id
      where r.user_id=v_grant.source_user_id and j.user_id<>v_grant.source_user_id)
     or exists(select 1 from public.share_job_place_results r
      where r.user_id=v_grant.source_user_id
        and (r.original_saved_place_id is not null or r.replacement_saved_place_id is not null))
     or exists(select 1 from public.share_media_tasks t
      join public.share_jobs j on j.id=t.share_job_id
      where t.user_id=v_grant.source_user_id and j.user_id<>v_grant.source_user_id)
     or exists(select 1 from public.notification_events n join public.saved_places p on p.id=n.saved_place_id
      where n.user_id=v_grant.source_user_id and p.user_id<>v_grant.source_user_id)
     or exists(select 1 from public.recognition_rejections where user_id=v_grant.source_user_id)
     or exists(select 1 from public.public_place_share_saves where user_id=v_grant.source_user_id)
     or exists(select 1 from public.public_place_shares ps
      join public.saved_place_sources s on s.id=ps.source_id where s.user_id=v_grant.source_user_id) then
    raise exception 'transfer_unresolved_dependent_graph';
  end if;
  -- A completed enrichment task on a duplicate source save cannot be
  -- silently reattached to B's distinct save/AI note.
  if exists(select 1 from public.share_media_tasks t
      join public.saved_places a on a.id=t.saved_place_id
      join public.saved_places b on b.place_id=a.place_id and b.user_id=v_destination
      where t.user_id=v_grant.source_user_id and a.user_id=v_grant.source_user_id) then
    raise exception 'transfer_duplicate_enrichment_conflict';
  end if;

  select exists(select 1 from public.saved_places where user_id=v_destination)
      or exists(select 1 from auth.users
         where id=v_destination and created_at<v_session.created_at)
    into v_destination_established;
  for v_source_save in select * from public.saved_places
       where user_id=v_grant.source_user_id order by place_id,id for update
  loop
    select * into v_destination_save from public.saved_places
     where user_id=v_destination and place_id=v_source_save.place_id for update;
    if not found then
      update public.saved_places set user_id=v_destination
       where id=v_source_save.id and user_id=v_grant.source_user_id;
      -- The composite FK ON UPDATE CASCADE moves every child in this statement.
      update public.notification_events set user_id=v_destination
       where saved_place_id=v_source_save.id and user_id=v_grant.source_user_id;
      v_destination_id:=v_source_save.id;
    else
      v_destination_id:=v_destination_save.id;
      if nullif(btrim(v_source_save.notes),'') is not null
         and nullif(btrim(v_destination_save.notes),'') is not null
         and v_source_save.notes<>v_destination_save.notes
         or nullif(btrim(v_source_save.ai_note),'') is not null
         and nullif(btrim(v_destination_save.ai_note),'') is not null
         and v_source_save.ai_note<>v_destination_save.ai_note
         or v_source_save.category_user_overridden
         and v_destination_save.category_user_overridden
         and v_source_save.category is distinct from v_destination_save.category then
        raise exception 'transfer_duplicate_metadata_conflict';
      end if;
      if v_source_save.radius_value is distinct from v_destination_save.radius_value
         or v_source_save.radius_unit is distinct from v_destination_save.radius_unit
         or v_source_save.notifications_enabled is distinct from v_destination_save.notifications_enabled
         or v_source_save.notification_count<>0
         or v_source_save.reminder_opportunity_count<>0
         or v_source_save.last_notified_at is not null
         or v_source_save.reminders_exhausted_at is not null
         or v_source_save.archived_at is not null then
        raise exception 'transfer_duplicate_reminder_conflict';
      end if;
      update public.saved_places b set
        notes=case when nullif(btrim(b.notes),'') is null then v_source_save.notes else b.notes end,
        ai_note=case when nullif(btrim(b.ai_note),'') is null then v_source_save.ai_note else b.ai_note end,
        visited_at=coalesce(b.visited_at,v_source_save.visited_at),
        category=case when not b.category_user_overridden and v_source_save.category_user_overridden
                      then v_source_save.category else b.category end,
        category_source=case when not b.category_user_overridden and v_source_save.category_user_overridden
                             then v_source_save.category_source else b.category_source end,
        category_confidence=case when not b.category_user_overridden and v_source_save.category_user_overridden
                                 then v_source_save.category_confidence else b.category_confidence end,
        category_model_version=case when not b.category_user_overridden and v_source_save.category_user_overridden
                                    then v_source_save.category_model_version else b.category_model_version end,
        category_user_overridden=b.category_user_overridden or v_source_save.category_user_overridden,
        categorized_at=case when not b.category_user_overridden and v_source_save.category_user_overridden
                            then v_source_save.categorized_at else b.categorized_at end
      where b.id=v_destination_id
        and (nullif(btrim(b.notes),'') is null and nullif(btrim(v_source_save.notes),'') is not null
          or nullif(btrim(b.ai_note),'') is null and nullif(btrim(v_source_save.ai_note),'') is not null
          or b.visited_at is null and v_source_save.visited_at is not null
          or not b.category_user_overridden and v_source_save.category_user_overridden);
      -- A's save and all of its associations remain intact. Copy only missing
      -- content identities to B's save; never overwrite B's existing link.
      insert into public.saved_place_sources
        (saved_place_id,user_id,identity_key,identity_version,platform,content_id,
         canonical_url,original_url,creator_handle,creator_name,caption_excerpt,
         ai_note,thumbnail_url,is_primary,first_attached_at,last_seen_at)
      select v_destination_id,v_destination,s.identity_key,s.identity_version,s.platform,s.content_id,
         s.canonical_url,s.original_url,s.creator_handle,s.creator_name,s.caption_excerpt,
         s.ai_note,s.thumbnail_url,
         s.is_primary and not exists(select 1 from public.saved_place_sources x
           where x.saved_place_id=v_destination_id and x.is_primary),
         s.first_attached_at,s.last_seen_at
      from public.saved_place_sources s where s.saved_place_id=v_source_save.id
      order by s.is_primary desc,s.first_attached_at,s.id
      on conflict (saved_place_id,identity_key) do nothing;
      if exists(select 1 from public.saved_place_sources s
          where s.saved_place_id=v_source_save.id and not exists(
            select 1 from public.saved_place_sources b
            where b.saved_place_id=v_destination_id and b.identity_key=s.identity_key)) then
        raise exception 'transfer_source_copy_incomplete';
      end if;
    end if;
    v_map:=v_map||jsonb_build_object(v_source_save.id::text,v_destination_id);
    v_ids:=array_append(v_ids,v_destination_id);
    if v_session.tutorial_saved_place_id=v_source_save.id then
      v_tutorial_destination:=v_destination_id;
    end if;
  end loop;

  -- Remap terminal anonymous queue history only after all destination saves
  -- and links exist. A job with a non-null unowned save is rejected above.
  update public.share_jobs j set user_id=v_destination,idempotency_key=null,
    saved_place_id=case when j.saved_place_id is null then null
      else coalesce((v_map->>j.saved_place_id::text)::uuid,j.saved_place_id) end
   where j.user_id=v_grant.source_user_id;
  update public.share_job_place_results r set user_id=v_destination,
    saved_place_id=case when r.saved_place_id is null then null
      else coalesce((v_map->>r.saved_place_id::text)::uuid,r.saved_place_id) end
   where r.user_id=v_grant.source_user_id;
  update public.share_media_tasks t set user_id=v_destination,
    saved_place_id=case when t.saved_place_id is null then null
      else coalesce((v_map->>t.saved_place_id::text)::uuid,t.saved_place_id) end
   where t.user_id=v_grant.source_user_id;
  update public.share_media_runs set user_id=v_destination where user_id=v_grant.source_user_id;
  update public.share_agent_runs set user_id=v_destination where user_id=v_grant.source_user_id;
  update public.share_extraction_failures set user_id=v_destination
   where user_id=v_grant.source_user_id;

  if exists(select 1 from public.saved_place_sources s
      join public.saved_places p on p.id=s.saved_place_id
      where s.user_id<>p.user_id and p.user_id in (v_destination,v_grant.source_user_id))
     or exists(select 1 from public.share_jobs j join public.saved_places p on p.id=j.saved_place_id
      where j.user_id<>p.user_id)
     or exists(select 1 from public.share_job_place_results r join public.saved_places p on p.id=r.saved_place_id
      where r.user_id<>p.user_id)
     or exists(select 1 from public.share_media_tasks t join public.saved_places p on p.id=t.saved_place_id
      where t.user_id<>p.user_id)
     or exists(select 1 from public.notification_events n join public.saved_places p on p.id=n.saved_place_id
      where n.user_id<>p.user_id) then
    raise exception 'transfer_final_graph_invariant';
  end if;
  v_result:=jsonb_build_object(
    'permanent_user_id',v_destination,
    'destination_was_established',v_destination_established,
    'tutorial_saved_place_id',v_tutorial_destination,
    'transferred_saved_place_ids',to_jsonb(v_ids),
    'transferred_saved_place_count',coalesce(array_length(v_ids,1),0),
    'replayed',false
  );
  update public.onboarding_v2_sessions
     set user_id=v_destination,permanent_user_id=v_destination,
         lifecycle='permanent_account',tutorial_saved_place_id=v_tutorial_destination,
         upgraded_at=now(),last_activity_at=now(),updated_at=now()
   where id=v_session.id;
  update public.analytics_events set converted_user_id=v_destination
   where onboarding_session_id=v_session.id and converted_user_id is null;
  update public.onboarding_account_transfer_grants
     set destination_user_id=v_destination,status='completed',completed_at=now(),result=v_result
   where id=v_grant.id;
  return v_result;
exception
  when unique_violation or deadlock_detected or serialization_failure then
    raise exception 'transfer_retryable_conflict' using errcode='40001';
end;
$$;
revoke all on function public.complete_onboarding_account_transfer_v2(text) from public,anon;
grant execute on function public.complete_onboarding_account_transfer_v2(text) to authenticated;

-- A duplicate transfer deliberately retains A's save/source graph. Never let
-- the optional cleanup worker cascade-delete that graph. This also protects
-- unresolved V1 source links until a separately reviewed recovery.
create or replace function public.list_anonymous_onboarding_cleanup_candidates(
  p_abandoned_ttl interval default interval '30 days',
  p_converted_grace interval default interval '24 hours',
  p_limit integer default 100
)
returns table(onboarding_session_id uuid,anonymous_user_id uuid,reason text)
language sql security definer set search_path=public,pg_temp
as $$
  select s.id,s.anonymous_user_id,
    case when s.lifecycle='permanent_account' then 'converted_source' else 'abandoned' end
  from public.onboarding_v2_sessions s
  where s.cleanup_completed_at is null and s.anonymous_user_id is not null
    and ((s.lifecycle in ('anonymous_active','permanent_account_linking')
           and s.last_activity_at<now()-p_abandoned_ttl)
      or (s.lifecycle='permanent_account' and s.anonymous_user_id<>s.permanent_user_id
           and s.upgraded_at<now()-p_converted_grace))
    and not exists(select 1 from public.saved_places p where p.user_id=s.anonymous_user_id)
    and not exists(select 1 from public.saved_place_sources x where x.user_id=s.anonymous_user_id)
    and not exists(select 1 from public.share_jobs j where j.user_id=s.anonymous_user_id)
    and not exists(select 1 from public.share_media_tasks t where t.user_id=s.anonymous_user_id)
    and not exists(select 1 from public.notification_events n where n.user_id=s.anonymous_user_id)
  order by s.last_activity_at limit greatest(1,least(p_limit,500));
$$;
revoke all on function public.list_anonymous_onboarding_cleanup_candidates(interval,interval,integer)
  from public,anon,authenticated;
grant execute on function public.list_anonymous_onboarding_cleanup_candidates(interval,interval,integer)
  to service_role;
