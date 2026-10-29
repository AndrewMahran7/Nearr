-- Preserve existing save/source/cache/geography behavior while authorizing the
-- whole RPC before its first write. No provider or release flag is enabled.
create function public.require_current_recognition_commit(p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_country text;
begin
  if p_user_id is null then raise exception 'not_authenticated'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'recognition_commit_requires_read_committed'; end if;
  -- These locks keep the exact policy/consent decision stable through the
  -- delegated RPC's commit. A withdrawal that wins first is seen by the fresh
  -- READ COMMITTED check; one that arrives later waits until the save commits.
  perform 1 from public.global_release_policy where singleton for share;
  select country_code into v_country from public.account_eligibility_v2 where user_id=p_user_id for share;
  perform 1 from public.account_age_eligibility where user_id=p_user_id for share;
  perform 1 from public.eligibility_region_policy where country_code=v_country for share;
  perform 1 from public.account_processing_permissions where user_id=p_user_id for share;
  if public.is_account_eligible_for_ai(p_user_id) is distinct from true then raise exception 'global_eligibility_required'; end if;
end $$;
revoke all on function public.require_current_recognition_commit(uuid) from public,anon,authenticated,service_role;

alter function public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)
  rename to auto_complete_named_lead_pre_commit_guard;
revoke all on function public.auto_complete_named_lead_pre_commit_guard(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)
  from public,anon,authenticated,service_role;
create function public.auto_complete_named_lead(
  p_job_id uuid,p_logical_result_id text,p_attempt_token uuid,
  p_google_place_id text,p_name text,p_formatted_address text,
  p_latitude numeric,p_longitude numeric,p_category text,p_candidate_snapshot jsonb,
  p_confidence_score numeric default 1,p_rule_version text default 'named-lead-auto-v2'
) returns table(saved_place_id uuid,place_id uuid,reused boolean,completed boolean,idempotent boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_current_recognition_commit(auth.uid());
  return query select * from public.auto_complete_named_lead_pre_commit_guard(
    p_job_id,p_logical_result_id,p_attempt_token,p_google_place_id,p_name,p_formatted_address,
    p_latitude,p_longitude,p_category,p_candidate_snapshot,p_confidence_score,p_rule_version);
end $$;
revoke all on function public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)
  from public,anon,authenticated;
grant execute on function public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text) to authenticated;

alter function public.promote_share_job_soft_alternative(uuid,boolean) rename to promote_share_job_soft_alternative_pre_commit_guard;
revoke all on function public.promote_share_job_soft_alternative_pre_commit_guard(uuid,boolean) from public,anon,authenticated,service_role;
create function public.promote_share_job_soft_alternative(p_result_id uuid,p_make_primary boolean default true)
returns table(saved_place_id uuid,place_id uuid,reused boolean,primary_replaced boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_current_recognition_commit(auth.uid());
  return query select * from public.promote_share_job_soft_alternative_pre_commit_guard(p_result_id,p_make_primary);
end $$;
revoke all on function public.promote_share_job_soft_alternative(uuid,boolean) from public,anon,authenticated;
grant execute on function public.promote_share_job_soft_alternative(uuid,boolean) to authenticated;

alter function public.resolve_share_job(uuid,uuid) rename to resolve_share_job_pre_commit_guard;
revoke all on function public.resolve_share_job_pre_commit_guard(uuid,uuid) from public,anon,authenticated,service_role;
create function public.resolve_share_job(p_job_id uuid,p_saved_place_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_current_recognition_commit(auth.uid());
  return public.resolve_share_job_pre_commit_guard(p_job_id,p_saved_place_id);
end $$;
revoke all on function public.resolve_share_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_share_job(uuid,uuid) to authenticated;
