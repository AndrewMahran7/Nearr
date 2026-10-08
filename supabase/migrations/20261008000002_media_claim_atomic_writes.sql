-- Service-only write boundaries. Every candidate/ledger/terminal mutation locks
-- the parent before the task, matching the existing per-place save RPC.
-- A user selection or correction that wins the parent lock defeats late work.
create or replace function public.assert_media_claim_write(
  p_job_id uuid,p_task_id uuid,p_attempt integer,p_locked_at timestamptz
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.share_jobs%rowtype; t public.share_media_tasks%rowtype;
begin
  select * into j from public.share_jobs where id=p_job_id for update;
  if j.id is null or j.status<>'processing_metadata' then raise exception 'obsolete_media_claim'; end if;
  select * into t from public.share_media_tasks where id=p_task_id for update;
  if t.id is null or t.share_job_id is distinct from j.id or t.user_id is distinct from j.user_id
     or t.attempts is distinct from p_attempt or t.locked_at is distinct from p_locked_at
     or p_locked_at is null or p_attempt<1
     or t.status<>'processing' then raise exception 'obsolete_media_claim'; end if;
end $$;

create or replace function public.commit_media_claim_candidate(
  p_job_id uuid,p_task_id uuid,p_attempt integer,p_locked_at timestamptz,p_payload jsonb
) returns table(saved_place_id uuid,place_id uuid,reused boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; j public.share_jobs%rowtype; c jsonb:=p_payload->'candidate';
  category_resolution jsonb:=p_payload->'categoryResolution'; identity jsonb:=p_payload->'identity';
  source_meta jsonb:=p_payload->'sourceMetadata';
begin
  perform public.assert_media_claim_write(p_job_id,p_task_id,p_attempt,p_locked_at);
  select * into j from public.share_jobs where id=p_job_id;
  select * into r from public.auto_save_share_job_place_result(
    p_job_id,p_task_id,(p_payload->>'mediaRunId')::uuid,p_payload->>'logicalResultId',
    c->>'googlePlaceId',c->>'name',c->>'formattedAddress',(c->>'latitude')::numeric,(c->>'longitude')::numeric,
    category_resolution->>'category',p_payload->>'source',p_payload->>'sourceUrl',
    (p_payload->>'confidenceScore')::numeric,p_payload->>'ruleVersion',coalesce(p_payload->'reasonCodes','[]'::jsonb)
  );
  update public.places p set
    short_formatted_address=coalesce(c->>'shortFormattedAddress',p.short_formatted_address),
    google_primary_type=coalesce(c->>'primaryType',p.google_primary_type),
    google_types=case when jsonb_typeof(c->'types')='array' and jsonb_array_length(c->'types')>0 then array(select jsonb_array_elements_text(c->'types')) else p.google_types end,
    google_type_label=coalesce(c->>'googleMapsTypeLabel',c->>'primaryTypeDisplayName',p.google_type_label),
    business_status=coalesce(c->>'businessStatus',p.business_status)
    where p.id=r.place_id;
  update public.share_job_place_results x set candidate_snapshot=c,result_role='primary',candidate_rank=1,
    original_saved_place_id=coalesce(x.original_saved_place_id,r.saved_place_id)
    where x.share_job_id=p_job_id and x.logical_result_id=p_payload->>'logicalResultId';
  update public.saved_places sp set category=category_resolution->>'category',
    category_source=category_resolution->>'source',category_confidence=(category_resolution->>'confidence')::numeric,
    category_model_version=category_resolution->>'modelVersion',categorized_at=now()
    where sp.id=r.saved_place_id and not sp.category_user_overridden;
  update public.saved_places sp set ai_note=p_payload->>'autoNote'
    where sp.id=r.saved_place_id and sp.source_url=p_payload->>'sourceUrl' and sp.ai_note is null
      and nullif(p_payload->>'autoNote','') is not null;
  if identity->>'key' is not null then
    perform public.attach_saved_place_source(j.user_id,r.saved_place_id,identity->>'key',
      (identity->>'identityVersion')::integer,p_payload->>'source',identity->>'contentId',identity->>'canonicalUrl',
      p_payload->>'sourceUrl',source_meta->>'creatorHandle',source_meta->>'creatorName',source_meta->>'caption',
      p_payload->>'autoNote',source_meta->>'thumbnailUrl');
  end if;
  return query select r.saved_place_id,r.place_id,r.reused;
end $$;

create or replace function public.write_media_claim_results(
  p_job_id uuid,p_task_id uuid,p_attempt integer,p_locked_at timestamptz,p_rows jsonb
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.assert_media_claim_write(p_job_id,p_task_id,p_attempt,p_locked_at);
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>36 then raise exception 'invalid_result_rows'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where (r->>'share_job_id')::uuid is distinct from p_job_id
    or (r->>'share_media_task_id')::uuid is distinct from p_task_id
    or (r->>'user_id')::uuid is distinct from (select j.user_id from public.share_jobs j where j.id=p_job_id)) then raise exception 'invalid_result_owner'; end if;
  insert into public.share_job_place_results(share_job_id,share_media_task_id,share_media_run_id,user_id,logical_result_id,
    google_place_id,place_id,saved_place_id,original_saved_place_id,outcome,origin,confidence_score,rule_version,reason_codes,
    result_role,candidate_rank,candidate_snapshot,finalized_at)
  select x.share_job_id,x.share_media_task_id,x.share_media_run_id,x.user_id,x.logical_result_id,x.google_place_id,
    x.place_id,x.saved_place_id,x.original_saved_place_id,x.outcome,x.origin,x.confidence_score,x.rule_version,
    coalesce(x.reason_codes,'[]'::jsonb),x.result_role,x.candidate_rank,x.candidate_snapshot,x.finalized_at
    from jsonb_populate_recordset(null::public.share_job_place_results,p_rows) x
  on conflict(share_job_id,logical_result_id) do update set
    share_media_run_id=excluded.share_media_run_id,google_place_id=excluded.google_place_id,
    place_id=excluded.place_id,saved_place_id=excluded.saved_place_id,original_saved_place_id=excluded.original_saved_place_id,
    outcome=excluded.outcome,origin=excluded.origin,confidence_score=excluded.confidence_score,rule_version=excluded.rule_version,
    reason_codes=excluded.reason_codes,result_role=excluded.result_role,candidate_rank=excluded.candidate_rank,
    candidate_snapshot=excluded.candidate_snapshot,finalized_at=excluded.finalized_at,updated_at=now();
end $$;

create or replace function public.finalize_media_claim_parent(
  p_job_id uuid,p_task_id uuid,p_attempt integer,p_locked_at timestamptz,p_patch jsonb
) returns table(id uuid) language plpgsql security definer set search_path=public,pg_temp as $$
declare assignments text;
begin
  perform public.assert_media_claim_write(p_job_id,p_task_id,p_attempt,p_locked_at);
  if jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb then raise exception 'invalid_terminal_patch'; end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where k in ('id','user_id','created_at','source_url')
    or not exists(select 1 from pg_attribute a where a.attrelid='public.share_jobs'::regclass and a.attname=k and a.attnum>0 and not a.attisdropped))
    then raise exception 'invalid_terminal_patch_column'; end if;
  select string_agg(format('%I=(jsonb_populate_record(null::public.share_jobs,$2)).%I',k,k),',')
    into assignments from jsonb_object_keys(p_patch) k;
  return query execute format('update public.share_jobs set %s where share_jobs.id=$1 returning share_jobs.id',assignments)
    using p_job_id,p_patch;
end $$;

create or replace function public.promote_media_claim_video(
  p_job_id uuid,p_task_id uuid,p_attempt integer,p_locked_at timestamptz,p_row jsonb
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.assert_media_claim_write(p_job_id,p_task_id,p_attempt,p_locked_at);
  if not exists(select 1 from public.share_job_place_results r where r.share_job_id=p_job_id
    and r.share_media_task_id=p_task_id and r.place_id=(p_row->>'place_id')::uuid
    and r.outcome in ('auto_saved','already_saved')) then raise exception 'media_video_candidate_not_saved'; end if;
  insert into public.place_video_media(place_id,identity_key,identity_version,platform,content_id,canonical_url,original_url,
    creator_handle,creator_name,representative_frame_storage_path,representative_frame_timestamp_seconds,
    community_visibility,source_reachability,public_access_verified_at,is_synthetic,last_seen_at)
  select x.place_id,x.identity_key,x.identity_version,x.platform,x.content_id,x.canonical_url,x.original_url,
    x.creator_handle,x.creator_name,x.representative_frame_storage_path,x.representative_frame_timestamp_seconds,
    x.community_visibility,x.source_reachability,x.public_access_verified_at,x.is_synthetic,x.last_seen_at
    from jsonb_populate_record(null::public.place_video_media,p_row) x
  on conflict(place_id,identity_key) do update set
    creator_handle=coalesce(excluded.creator_handle,place_video_media.creator_handle),
    creator_name=coalesce(excluded.creator_name,place_video_media.creator_name),
    representative_frame_storage_path=coalesce(excluded.representative_frame_storage_path,place_video_media.representative_frame_storage_path),
    representative_frame_timestamp_seconds=coalesce(excluded.representative_frame_timestamp_seconds,place_video_media.representative_frame_timestamp_seconds),
    community_visibility=case when place_video_media.community_visibility in ('PRIVATE_SOURCE','OWNER_ONLY','PUBLIC_SOURCE_UNAVAILABLE') then place_video_media.community_visibility else excluded.community_visibility end,
    source_reachability=case when place_video_media.community_visibility in ('PRIVATE_SOURCE','OWNER_ONLY','PUBLIC_SOURCE_UNAVAILABLE') then place_video_media.source_reachability else excluded.source_reachability end,
    public_access_verified_at=case when place_video_media.community_visibility in ('PRIVATE_SOURCE','OWNER_ONLY','PUBLIC_SOURCE_UNAVAILABLE') then place_video_media.public_access_verified_at else excluded.public_access_verified_at end,
    last_seen_at=excluded.last_seen_at;
end $$;

revoke all on function public.assert_media_claim_write(uuid,uuid,integer,timestamptz),
  public.commit_media_claim_candidate(uuid,uuid,integer,timestamptz,jsonb),
  public.write_media_claim_results(uuid,uuid,integer,timestamptz,jsonb),
  public.finalize_media_claim_parent(uuid,uuid,integer,timestamptz,jsonb),
  public.promote_media_claim_video(uuid,uuid,integer,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.assert_media_claim_write(uuid,uuid,integer,timestamptz),
  public.commit_media_claim_candidate(uuid,uuid,integer,timestamptz,jsonb),
  public.write_media_claim_results(uuid,uuid,integer,timestamptz,jsonb),
  public.finalize_media_claim_parent(uuid,uuid,integer,timestamptz,jsonb),
  public.promote_media_claim_video(uuid,uuid,integer,timestamptz,jsonb) to service_role;
