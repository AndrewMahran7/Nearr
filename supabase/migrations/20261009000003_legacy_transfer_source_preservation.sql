-- Keep the public 1.4.55 RPC signature and result contract. The composite
-- owner FK cascades its unique-save parent owner change; the duplicate path
-- must not delete A's saved-place/source graph or discard source identities.
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
    if v_grant.destination_user_id is distinct from v_destination then raise exception 'transfer_destination_mismatch'; end if;
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
  if exists (select 1 from public.share_jobs
      where id = any(v_job_ids) and saved_place_id is not null
        and saved_place_id <> v_source_saved)
     or exists (select 1 from public.share_media_tasks
      where share_job_id = any(v_job_ids) and saved_place_id is not null
        and saved_place_id <> v_source_saved) then
    raise exception 'legacy_transfer_unrelated_saved_place_dependency';
  end if;

  if v_destination_saved is not null then
    -- Preserve the anonymous save and its link IDs. Materialize only missing
    -- content identities on B's existing save; never overwrite B's links.
    insert into public.saved_place_sources (
      saved_place_id,user_id,identity_key,identity_version,platform,content_id,
      canonical_url,original_url,creator_handle,creator_name,caption_excerpt,
      ai_note,thumbnail_url,is_primary,first_attached_at,last_seen_at
    )
    select v_destination_saved,v_destination,s.identity_key,s.identity_version,
      s.platform,s.content_id,s.canonical_url,s.original_url,s.creator_handle,
      s.creator_name,s.caption_excerpt,s.ai_note,s.thumbnail_url,
      s.is_primary and not exists (
        select 1 from public.saved_place_sources x
        where x.saved_place_id = v_destination_saved and x.is_primary
      ),s.first_attached_at,s.last_seen_at
    from public.saved_place_sources s
    where s.saved_place_id = v_source_saved
    order by s.is_primary desc,s.first_attached_at,s.id
    on conflict (saved_place_id,identity_key) do nothing;
    if exists (
      select 1 from public.saved_place_sources s
      where s.saved_place_id = v_source_saved
        and not exists (
          select 1 from public.saved_place_sources b
          where b.saved_place_id = v_destination_saved
            and b.identity_key = s.identity_key
        )
    ) then raise exception 'transfer_source_copy_incomplete'; end if;
    update public.saved_places b
       set source_url = coalesce(nullif(btrim(b.source_url),''),nullif(btrim(a.source_url),'')),
           source_type = case when nullif(btrim(b.source_url),'') is null
             and nullif(btrim(a.source_url),'') is not null
             then a.source_type else b.source_type end
      from public.saved_places a
     where b.id = v_destination_saved and a.id = v_source_saved
       and nullif(btrim(b.source_url),'') is null
       and nullif(btrim(a.source_url),'') is not null;
    update public.share_jobs set saved_place_id = v_destination_saved where id = any(v_job_ids);
    update public.share_job_place_results set saved_place_id = v_destination_saved where share_job_id = any(v_job_ids);
  else
    update public.saved_places set user_id = v_destination where id = v_source_saved and user_id = v_grant.source_user_id;
    v_destination_saved := v_source_saved;
    update public.notification_events set user_id = v_destination
     where saved_place_id = v_destination_saved and user_id = v_grant.source_user_id;
  end if;

  -- Explicit allowlist: only rows belonging to the tutorial job(s) move.
  update public.share_jobs set user_id = v_destination, idempotency_key = null where id = any(v_job_ids);
  update public.share_media_tasks set user_id = v_destination,
    saved_place_id = case when saved_place_id = v_source_saved
      then v_destination_saved else saved_place_id end
   where share_job_id = any(v_job_ids);
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
