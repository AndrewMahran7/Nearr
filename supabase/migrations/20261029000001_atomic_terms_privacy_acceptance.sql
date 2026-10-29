-- One explicit action records the current Terms acceptance and Privacy notice.
-- The revision remains unqualified until the operator approves the legal text.
create or replace function public.record_global_terms_and_privacy()
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_policy public.global_release_policy%rowtype;
begin
  if auth.uid() is null then raise exception 'consent_auth_required'; end if;
  select * into v_policy from public.global_release_policy where singleton for share;
  if not found or not v_policy.legal_approved then raise exception 'terms_not_qualified'; end if;
  insert into public.account_processing_permissions
    (user_id,terms_version,terms_accepted_at,privacy_notice_version,privacy_notice_seen_at)
  values
    (auth.uid(),v_policy.terms_version,now(),v_policy.privacy_notice_version,now())
  on conflict(user_id) do update set
    terms_version=excluded.terms_version,
    terms_accepted_at=excluded.terms_accepted_at,
    privacy_notice_version=excluded.privacy_notice_version,
    privacy_notice_seen_at=excluded.privacy_notice_seen_at;
end; $$;
revoke all on function public.record_global_terms_and_privacy() from public,anon;
grant execute on function public.record_global_terms_and_privacy() to authenticated;

-- Old app and Share Extension permissions remain separate. Requiring both
-- records here also closes a legacy Terms-only acceptance from granting AI.
create or replace function public.account_ai_access_reason(p_user_id uuid)
returns text language sql stable security definer set search_path=public,pg_temp as $$
 select case
   when e.user_id is null or e.status<>'eligible' or e.policy_version<>r.policy_version
     or region.minimum_age is null
     or (case e.age_band when 'under_13' then 0 when '13' then 13 when '14' then 14 when '15' then 15 when '16_17' then 16 when '18_plus' then 18 else 0 end) < region.minimum_age
     then 'eligibility_required'
   when legacy.status='revoked' then 'eligibility_required'
   when not coalesce(region.market_qualified,false) then 'region_not_available'
   when e.age_band<>'18_plus' then 'guardian_authorization_required'
   when not r.legal_approved then 'terms_not_qualified'
   when p.terms_version is distinct from r.terms_version or p.terms_accepted_at is null
     or p.privacy_notice_version is distinct from r.privacy_notice_version or p.privacy_notice_seen_at is null
     then 'terms_acceptance_required'
   when p.ai_allowed is distinct from true or p.ai_notice_version is distinct from r.ai_notice_version then 'ai_permission_required'
   when not r.recognition_qualified or r.provider_route<>'openai_only' then 'recognition_not_available'
   else 'allowed' end
 from public.global_release_policy r
 left join public.account_eligibility_v2 e on e.user_id=p_user_id
 left join public.account_age_eligibility legacy on legacy.user_id=p_user_id
 left join public.eligibility_region_policy region on region.country_code=e.country_code
 left join public.account_processing_permissions p on p.user_id=p_user_id where r.singleton;
$$;

create or replace function public.get_my_global_access()
returns jsonb language sql stable security definer set search_path=public,auth,pg_temp as $$
 select jsonb_build_object('status',coalesce(e.status,'pending'),'ageBand',e.age_band,
   'countryCode',e.country_code,'minimumAge',e.minimum_age,
   'aiAllowed',public.is_account_eligible_for_ai(auth.uid()),
   'aiReason',coalesce(public.account_ai_access_reason(auth.uid()),'recognition_not_available'),
   'aiPermission',coalesce(p.ai_allowed,false),'noticeVersion',r.ai_notice_version,'privacyVersion',r.privacy_notice_version,
   'termsVersion',r.terms_version,
   'termsAccepted',coalesce(p.terms_version=r.terms_version and p.terms_accepted_at is not null
     and p.privacy_notice_version=r.privacy_notice_version and p.privacy_notice_seen_at is not null,false),
   'legalApproved',r.legal_approved)
 from public.global_release_policy r
 left join public.account_eligibility_v2 e on e.user_id=auth.uid()
 left join public.account_processing_permissions p on p.user_id=auth.uid() where r.singleton;
$$;
