-- Durable recovery for an observable named lead that previously reached
-- needs_help. Search attempts are server-latched and successful persistence is
-- atomic. This path deliberately does not write recognition cache/support:
-- a provider singleton is machine evidence, not a user confirmation.

set check_function_bodies = off;

create or replace function public.claim_named_lead_auto_recovery(
  p_job_id uuid,
  p_logical_result_id text,
  p_policy_version text
)
returns table(attempt_token uuid, query text, expected_name text, context_label text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_job public.share_jobs%rowtype;
  v_slot jsonb;
  v_identity jsonb;
  v_prior jsonb;
  v_token uuid := gen_random_uuid();
  v_logical text := trim(p_logical_result_id);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if length(v_logical) not between 1 and 160 or length(trim(p_policy_version)) not between 1 and 80 then
    raise exception 'invalid_recovery_request';
  end if;
  select * into v_job from public.share_jobs
   where id=p_job_id and user_id=v_uid for update;
  if v_job.id is null then raise exception 'share_job_not_found'; end if;
  if v_job.status not in ('needs_help','failed') then return; end if;

  select s into v_slot from jsonb_array_elements(
    case when jsonb_typeof(v_job.candidate_payload->'mentionSlots')='array'
      then v_job.candidate_payload->'mentionSlots' else '[]'::jsonb end
  ) s where s->>'mentionId'=v_logical limit 1;
  select i into v_identity from jsonb_array_elements(
    case when jsonb_typeof(v_slot->'identityHypotheses')='array'
      then v_slot->'identityHypotheses' else '[]'::jsonb end
  ) i where coalesce(i->>'evidenceKind','observable')='observable'
      and length(trim(coalesce(i->>'name',''))) between 2 and 160 limit 1;
  if v_identity is null then return; end if;

  v_prior := v_job.candidate_payload->'automaticRecovery'->v_logical;
  if v_prior->>'policyVersion'=trim(p_policy_version) and (
    v_prior->>'status' in ('no_match','choice_required','saved') or
    (v_prior->>'status'='searching' and
      coalesce((v_prior->>'attemptedAt')::timestamptz,now()) > now()-interval '5 minutes') or
    (v_prior->>'status'='technical_failure' and
      coalesce((v_prior->>'retryAfter')::timestamptz,now()) > now())
  ) then return; end if;

  update public.share_jobs set candidate_payload=jsonb_set(
    coalesce(candidate_payload,'{}'::jsonb),'{automaticRecovery}',
    coalesce(candidate_payload->'automaticRecovery','{}'::jsonb) || jsonb_build_object(v_logical,
      jsonb_build_object('policyVersion',trim(p_policy_version),'status','searching',
        'attemptToken',v_token,'attemptedAt',now())),true),updated_at=now()
  where id=v_job.id;
  return query select v_token,
    concat_ws(' ',trim(v_identity->>'name'),nullif(trim(coalesce(v_identity->>'contextLabel',v_slot->>'contextLabel')),'')),
    trim(v_identity->>'name'),nullif(trim(coalesce(v_identity->>'contextLabel',v_slot->>'contextLabel')),'');
end;
$$;

create or replace function public.finish_named_lead_auto_recovery(
  p_job_id uuid,p_logical_result_id text,p_attempt_token uuid,p_outcome text
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid:=auth.uid(); v_job public.share_jobs%rowtype; v_logical text:=trim(p_logical_result_id); v_prior jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_outcome not in ('no_match','choice_required','technical_failure','stale') then raise exception 'invalid_recovery_outcome'; end if;
  select * into v_job from public.share_jobs where id=p_job_id and user_id=v_uid for update;
  if v_job.id is null then raise exception 'share_job_not_found'; end if;
  v_prior:=v_job.candidate_payload->'automaticRecovery'->v_logical;
  if v_prior->>'attemptToken' is distinct from p_attempt_token::text or v_prior->>'status'<>'searching' then return false; end if;
  update public.share_jobs set candidate_payload=jsonb_set(coalesce(candidate_payload,'{}'::jsonb),'{automaticRecovery}',
    coalesce(candidate_payload->'automaticRecovery','{}'::jsonb) || jsonb_build_object(v_logical,
      (v_prior-'attemptToken') || jsonb_build_object('status',p_outcome,'finishedAt',now()) ||
      case when p_outcome='technical_failure' then jsonb_build_object('retryAfter',now()+interval '1 minute') else '{}'::jsonb end),true),updated_at=now()
    where id=v_job.id;
  return true;
end;
$$;

create or replace function public.auto_complete_named_lead(
  p_job_id uuid,p_logical_result_id text,p_attempt_token uuid,
  p_google_place_id text,p_name text,p_formatted_address text,
  p_latitude numeric,p_longitude numeric,p_category text,
  p_candidate_snapshot jsonb,p_confidence_score numeric default 1,
  p_rule_version text default 'named-lead-auto-v1'
)
returns table(saved_place_id uuid,place_id uuid,reused boolean,completed boolean,idempotent boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_job public.share_jobs%rowtype; v_existing public.share_job_place_results%rowtype;
  v_place uuid; v_saved uuid; v_reused boolean:=false; v_payload jsonb; v_slots jsonb;
  v_remaining integer:=0; v_source_type text; v_logical text:=trim(p_logical_result_id); v_prior jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_job from public.share_jobs where id=p_job_id and user_id=v_uid for update;
  if v_job.id is null then raise exception 'share_job_not_found'; end if;
  select * into v_existing from public.share_job_place_results
    where share_job_id=v_job.id and logical_result_id=v_logical for update;
  if v_existing.saved_place_id is not null and v_existing.outcome in ('auto_saved','already_saved') then
    return query select v_existing.saved_place_id,v_existing.place_id,v_existing.outcome='already_saved',v_job.status='completed',true;
    return;
  end if;
  if v_job.status not in ('needs_help','failed') then raise exception 'share_job_not_recoverable'; end if;
  v_prior:=v_job.candidate_payload->'automaticRecovery'->v_logical;
  if v_prior->>'status'<>'searching' or v_prior->>'attemptToken' is distinct from p_attempt_token::text then
    raise exception 'recovery_claim_stale';
  end if;
  if not exists(select 1 from jsonb_array_elements(
      case when jsonb_typeof(v_job.candidate_payload->'mentionSlots')='array' then v_job.candidate_payload->'mentionSlots' else '[]'::jsonb end) s,
      lateral jsonb_array_elements(case when jsonb_typeof(s->'identityHypotheses')='array' then s->'identityHypotheses' else '[]'::jsonb end) i
      where s->>'mentionId'=v_logical and coalesce(i->>'evidenceKind','observable')='observable'
        and length(trim(coalesce(i->>'name',''))) between 2 and 160) then raise exception 'observable_named_lead_required'; end if;
  if length(trim(p_google_place_id))<1 or length(trim(p_name))<1 or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
    or p_confidence_score not between 0 and 1 or jsonb_typeof(p_candidate_snapshot)<>'object' then raise exception 'invalid_candidate'; end if;

  insert into public.places(google_place_id,name,formatted_address,latitude,longitude,category)
  values(trim(p_google_place_id),trim(p_name),nullif(trim(p_formatted_address),''),p_latitude,p_longitude,nullif(trim(p_category),''))
  on conflict(google_place_id) do update set name=excluded.name,
    formatted_address=coalesce(excluded.formatted_address,public.places.formatted_address),
    latitude=excluded.latitude,longitude=excluded.longitude,category=coalesce(excluded.category,public.places.category)
  returning id into v_place;
  select id into v_saved from public.saved_places where user_id=v_uid and place_id=v_place for update;
  v_source_type:=case lower(coalesce(v_job.source_platform,'')) when 'instagram' then 'instagram' when 'tiktok' then 'tiktok'
    when 'youtube' then 'youtube' when 'facebook' then 'facebook' when 'snapchat' then 'snapchat' else 'link' end;
  if v_saved is null then
    insert into public.saved_places(user_id,place_id,radius_value,radius_unit,source_type,source_url,ai_note)
    values(v_uid,v_place,null,null,v_source_type,coalesce(v_job.canonical_url,v_job.source_url),
      left(nullif(trim(p_candidate_snapshot->>'aiNote'),''),1000)) returning id into v_saved;
  else v_reused:=true; end if;
  if v_job.recognition_identity_key is not null and coalesce(v_job.canonical_url,v_job.source_url) is not null then
    perform public.attach_saved_place_source(v_uid,v_saved,v_job.recognition_identity_key,
      coalesce(v_job.recognition_identity_version,1),v_source_type,coalesce(v_job.recognition_content_id,v_job.recognition_identity_key),
      coalesce(v_job.canonical_url,v_job.source_url),v_job.source_url,null,null,null,
      p_candidate_snapshot->>'aiNote',null);
  end if;
  insert into public.share_job_place_results(share_job_id,user_id,logical_result_id,google_place_id,place_id,saved_place_id,
    original_saved_place_id,outcome,origin,confidence_score,rule_version,reason_codes,finalized_at,result_role,candidate_rank,candidate_snapshot)
  values(v_job.id,v_uid,v_logical,trim(p_google_place_id),v_place,v_saved,v_saved,
    case when v_reused then 'already_saved' else 'auto_saved' end,'automatic',p_confidence_score,trim(p_rule_version),
    '["observable_named_lead","defensible_provider_singleton"]'::jsonb,now(),'primary',1,p_candidate_snapshot)
  on conflict(share_job_id,logical_result_id) do update set google_place_id=excluded.google_place_id,place_id=excluded.place_id,
    saved_place_id=excluded.saved_place_id,original_saved_place_id=coalesce(public.share_job_place_results.original_saved_place_id,excluded.original_saved_place_id),
    outcome=excluded.outcome,origin='automatic',confidence_score=excluded.confidence_score,rule_version=excluded.rule_version,
    reason_codes=excluded.reason_codes,finalized_at=now(),result_role='primary',candidate_rank=1,candidate_snapshot=excluded.candidate_snapshot,updated_at=now();

  select coalesce(jsonb_agg(case when s->>'mentionId'=v_logical then
      (s || jsonb_build_object('outcome','verified_single','candidates',jsonb_build_array(p_candidate_snapshot))) else s end),'[]'::jsonb)
    into v_slots from jsonb_array_elements(v_job.candidate_payload->'mentionSlots') s;
  v_payload:=jsonb_set(coalesce(v_job.candidate_payload,'{}'::jsonb),'{mentionSlots}',v_slots,true);
  v_payload:=jsonb_set(v_payload,'{savedPlaceIds}',coalesce(v_payload->'savedPlaceIds','[]'::jsonb) || to_jsonb(v_saved),true);
  v_payload:=jsonb_set(v_payload,'{automaticRecovery}',coalesce(v_payload->'automaticRecovery','{}'::jsonb) ||
    jsonb_build_object(v_logical,(v_prior-'attemptToken') || jsonb_build_object('status','saved','finishedAt',now(),'savedPlaceId',v_saved)),true);
  select count(*) into v_remaining from jsonb_array_elements(v_slots) s
    where coalesce(s->>'outcome','') not in ('verified_single','dismissed','not_a_place');
  update public.share_jobs set candidate_payload=v_payload,saved_place_id=coalesce(saved_place_id,v_saved),
    status=case when v_remaining=0 then 'completed' else 'needs_help' end,
    decision=case when v_remaining=0 then 'auto_save' else decision end,
    progress_stage=case when v_remaining=0 then 'completed' else progress_stage end,
    suggested_query=case when v_remaining=0 then null else suggested_query end,
    needs_help_reason=case when v_remaining=0 then null else needs_help_reason end,
    completed_at=case when v_remaining=0 then now() else completed_at end,updated_at=now()
    where id=v_job.id;
  return query select v_saved,v_place,v_reused,v_remaining=0,false;
end;
$$;

revoke all on function public.claim_named_lead_auto_recovery(uuid,text,text),
  public.finish_named_lead_auto_recovery(uuid,text,uuid,text),
  public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)
  from public,anon;
grant execute on function public.claim_named_lead_auto_recovery(uuid,text,text),
  public.finish_named_lead_auto_recovery(uuid,text,uuid,text),
  public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)
  to authenticated;
