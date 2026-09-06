-- Dev received the automatic-completion migration before db lint identified a
-- PL/pgSQL output-column collision. Recreate only the RPC with qualified table
-- columns. Production receives the already-corrected base migration followed
-- by this idempotent definition.

create or replace function public.promote_share_job_soft_alternative(
  p_result_id uuid,
  p_make_primary boolean default true
)
returns table(saved_place_id uuid, place_id uuid, reused boolean, primary_replaced boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.share_job_place_results%rowtype;
  v_job public.share_jobs%rowtype;
  v_candidate jsonb;
  v_place_id uuid;
  v_saved_place_id uuid;
  v_reused boolean := false;
  v_primary_replaced boolean := false;
  v_source_type text;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  select * into v_result from public.share_job_place_results
   where id = p_result_id and user_id = v_user_id for update;
  if v_result.id is null then raise exception 'soft_alternative_not_found'; end if;
  if v_result.outcome = 'secondary_promoted' and v_result.saved_place_id is not null then
    return query select v_result.saved_place_id, v_result.place_id, true, false;
    return;
  end if;
  if v_result.outcome <> 'secondary_soft_saved' then raise exception 'soft_alternative_not_available'; end if;
  v_candidate := v_result.candidate_snapshot;
  if jsonb_typeof(v_candidate) <> 'object' then raise exception 'candidate_snapshot_missing'; end if;

  select * into v_job from public.share_jobs
   where id = v_result.share_job_id and user_id = v_user_id for update;
  if v_job.id is null then raise exception 'share_job_not_found'; end if;

  insert into public.places (google_place_id, name, formatted_address, latitude, longitude, category)
  values (
    v_result.google_place_id,
    nullif(trim(v_candidate->>'name'), ''),
    nullif(trim(v_candidate->>'formattedAddress'), ''),
    (v_candidate->>'latitude')::numeric,
    (v_candidate->>'longitude')::numeric,
    nullif(trim(v_candidate->>'category'), '')
  )
  on conflict (google_place_id) do update set
    name = excluded.name,
    formatted_address = coalesce(excluded.formatted_address, public.places.formatted_address),
    latitude = excluded.latitude,
    longitude = excluded.longitude
  returning id into v_place_id;

  select sp.id into v_saved_place_id from public.saved_places as sp
   where sp.user_id = v_user_id and sp.place_id = v_place_id for update;
  v_source_type := case lower(coalesce(v_job.source_platform, ''))
    when 'instagram' then 'instagram' when 'tiktok' then 'tiktok'
    when 'youtube' then 'youtube' when 'facebook' then 'facebook'
    when 'snapchat' then 'snapchat' else 'link' end;
  if v_saved_place_id is null then
    insert into public.saved_places (user_id, place_id, source_type, source_url)
    values (v_user_id, v_place_id, v_source_type, coalesce(v_job.canonical_url, v_job.source_url))
    returning id into v_saved_place_id;
  else
    v_reused := true;
  end if;

  if v_job.recognition_identity_key is not null and
     v_job.recognition_identity_version is not null and
     v_job.recognition_content_id is not null and
     coalesce(v_job.canonical_url, v_job.source_url) is not null then
    perform public.attach_saved_place_source(
      v_user_id, v_saved_place_id, v_job.recognition_identity_key,
      v_job.recognition_identity_version, v_source_type,
      v_job.recognition_content_id, coalesce(v_job.canonical_url, v_job.source_url),
      v_job.source_url, null, null, null, null, null
    );
  end if;

  if p_make_primary then
    update public.share_job_place_results
       set outcome = 'primary_replaced', result_role = 'secondary', updated_at = now()
     where share_job_id = v_job.id and user_id = v_user_id and result_role = 'primary'
       and id <> v_result.id and outcome in ('auto_saved', 'already_saved', 'secondary_promoted');
    v_primary_replaced := found;
  end if;

  update public.share_job_place_results
     set place_id = v_place_id, saved_place_id = v_saved_place_id,
         original_saved_place_id = coalesce(original_saved_place_id, v_saved_place_id),
         outcome = 'secondary_promoted', origin = 'user_confirmed',
         result_role = case when p_make_primary then 'primary' else 'secondary' end,
         finalized_at = now(), updated_at = now()
   where id = v_result.id;
  if p_make_primary then
    update public.share_jobs set
      saved_place_id = v_saved_place_id,
      extraction_payload = jsonb_set(coalesce(extraction_payload, '{}'::jsonb),
        '{savedPlaceName}', to_jsonb(v_candidate->>'name'), true),
      candidate_payload = jsonb_set(coalesce(candidate_payload, '{}'::jsonb),
        '{candidates}', jsonb_build_array(v_candidate), true),
      updated_at = now()
     where id = v_job.id and user_id = v_user_id;
  end if;
  return query select v_saved_place_id, v_place_id, v_reused, v_primary_replaced;
end;
$$;

revoke all on function public.promote_share_job_soft_alternative(uuid, boolean) from public, anon;
grant execute on function public.promote_share_job_soft_alternative(uuid, boolean) to authenticated;
