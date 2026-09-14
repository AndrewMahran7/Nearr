-- Make review sticky and keep the job payload/ledger in one coherent state.
-- A provider singleton is not stronger evidence than the recognition result
-- that produced the named lead.

set check_function_bodies = off;

alter function public.claim_named_lead_auto_recovery(uuid,text,text)
  rename to claim_named_lead_auto_recovery_v1_unsafe;
revoke all on function public.claim_named_lead_auto_recovery_v1_unsafe(uuid,text,text)
  from public, anon, authenticated;

create function public.claim_named_lead_auto_recovery(
  p_job_id uuid,
  p_logical_result_id text,
  p_policy_version text
)
returns table(attempt_token uuid, query text, expected_name text, context_label text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select exists(
    select 1
      from public.share_jobs j,
      lateral jsonb_array_elements(case when jsonb_typeof(j.candidate_payload->'mentionSlots')='array'
        then j.candidate_payload->'mentionSlots' else '[]'::jsonb end) s,
      lateral jsonb_array_elements(case when jsonb_typeof(s->'identityHypotheses')='array'
        then s->'identityHypotheses' else '[]'::jsonb end) i
     where j.id=p_job_id and j.user_id=v_uid
       and j.status in ('needs_help','failed')
       and s->>'mentionId'=trim(p_logical_result_id)
       and coalesce(i->>'evidenceKind','observable')='observable'
       and i->>'upstreamSafetyDecision'='AUTO_SAVE'
       and coalesce((i->>'confidence')::numeric,0) >= 0.9
  ) into v_allowed;
  if not v_allowed then return; end if;
  return query select * from public.claim_named_lead_auto_recovery_v1_unsafe(
    p_job_id,p_logical_result_id,p_policy_version
  );
end;
$$;

alter function public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)
  rename to auto_complete_named_lead_v1_unsafe;
revoke all on function public.auto_complete_named_lead_v1_unsafe(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)
  from public, anon, authenticated;

create function public.auto_complete_named_lead(
  p_job_id uuid,p_logical_result_id text,p_attempt_token uuid,
  p_google_place_id text,p_name text,p_formatted_address text,
  p_latitude numeric,p_longitude numeric,p_category text,
  p_candidate_snapshot jsonb,p_confidence_score numeric default 1,
  p_rule_version text default 'named-lead-auto-v2'
)
returns table(saved_place_id uuid,place_id uuid,reused boolean,completed boolean,idempotent boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_confidence numeric;
  v_result record;
  v_slots jsonb;
  v_payload jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select (i->>'confidence')::numeric into v_confidence
    from public.share_jobs j,
    lateral jsonb_array_elements(case when jsonb_typeof(j.candidate_payload->'mentionSlots')='array'
      then j.candidate_payload->'mentionSlots' else '[]'::jsonb end) s,
    lateral jsonb_array_elements(case when jsonb_typeof(s->'identityHypotheses')='array'
      then s->'identityHypotheses' else '[]'::jsonb end) i
   where j.id=p_job_id and j.user_id=v_uid
     and s->>'mentionId'=trim(p_logical_result_id)
     and coalesce(i->>'evidenceKind','observable')='observable'
     and i->>'upstreamSafetyDecision'='AUTO_SAVE'
     and coalesce((i->>'confidence')::numeric,0) >= 0.9
   order by (i->>'confidence')::numeric desc limit 1;
  if v_confidence is null then raise exception 'decisive_upstream_identity_required'; end if;

  select * into v_result from public.auto_complete_named_lead_v1_unsafe(
    p_job_id,p_logical_result_id,p_attempt_token,p_google_place_id,p_name,
    p_formatted_address,p_latitude,p_longitude,p_category,p_candidate_snapshot,
    v_confidence,'named-lead-auto-v2'
  );
  if v_result.saved_place_id is null then return; end if;

  select coalesce(jsonb_agg(
    case when s->>'mentionId'=trim(p_logical_result_id) then
      s || jsonb_build_object(
        'outcome','verified_single',
        'candidates',jsonb_build_array(p_candidate_snapshot),
        'saveState',case when v_result.reused then 'already_saved' else 'auto_saved' end,
        'savedPlaceId',v_result.saved_place_id,
        'resolutionReason','stronger_background_result'
      ) else s end
  ),'[]'::jsonb) into v_slots
  from public.share_jobs j,
  lateral jsonb_array_elements(case when jsonb_typeof(j.candidate_payload->'mentionSlots')='array'
    then j.candidate_payload->'mentionSlots' else '[]'::jsonb end) s
  where j.id=p_job_id;

  select jsonb_set(
    jsonb_set(coalesce(j.candidate_payload,'{}'::jsonb),'{mentionSlots}',v_slots,true),
    '{candidates}',jsonb_build_array(p_candidate_snapshot),true
  ) || jsonb_build_object('resolutionReason','stronger_background_result')
  into v_payload from public.share_jobs j where j.id=p_job_id;

  update public.share_jobs
     set candidate_payload=v_payload,
         resolution_source='fresh_recognition',
         updated_at=now()
   where id=p_job_id and user_id=v_uid;

  update public.share_job_place_results
     set confidence_score=v_confidence,
         rule_version='named-lead-auto-v2',
         reason_codes='["decisive_upstream_identity","stronger_background_result"]'::jsonb,
         candidate_snapshot=p_candidate_snapshot,
         updated_at=now()
   where share_job_id=p_job_id and logical_result_id=trim(p_logical_result_id);

  return query select v_result.saved_place_id,v_result.place_id,v_result.reused,
    v_result.completed,v_result.idempotent;
end;
$$;

revoke all on function public.claim_named_lead_auto_recovery(uuid,text,text),
  public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)
  from public,anon;
grant execute on function public.claim_named_lead_auto_recovery(uuid,text,text),
  public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)
  to authenticated;
