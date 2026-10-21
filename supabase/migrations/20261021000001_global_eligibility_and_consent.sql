-- Additive 13+ policy. Qualification defaults false: policy thresholds alone
-- do not establish legal/provider permission. Never edit prior age migrations.
create table public.global_release_policy (
  singleton boolean primary key default true check (singleton),
  policy_version text not null default 'nearr-global-13-v1',
  ai_notice_version text not null default 'nearr-ai-openai-v1',
  privacy_notice_version text not null default 'nearr-global-privacy-v1',
  terms_version text not null default 'nearr-global-terms-v1',
  legal_approved boolean not null default false,
  recognition_qualified boolean not null default false,
  purchase_qualified boolean not null default false,
  provider_route text not null default 'disabled' check (provider_route in ('disabled','openai_only')),
  evidence_reference text,
  check (not (legal_approved or recognition_qualified or purchase_qualified) or nullif(btrim(evidence_reference),'') is not null)
);
insert into public.global_release_policy(singleton) values(true);
alter table public.global_release_policy enable row level security;
revoke all on public.global_release_policy from public, anon, authenticated;
grant all on public.global_release_policy to service_role;

create table public.eligibility_region_policy (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  minimum_age integer not null check (minimum_age between 13 and 18),
  market_qualified boolean not null default false,
  minor_ai_qualified boolean not null default false check (not minor_ai_qualified),
  evidence_reference text,
  check (not market_qualified or nullif(btrim(evidence_reference),'') is not null)
);
insert into public.eligibility_region_policy(country_code,minimum_age) values
 ('US',13),('GB',13),('ES',14),('IT',14),('KR',14),('FR',15),('DE',16),('BR',18),('JP',18),('MX',18);
alter table public.eligibility_region_policy enable row level security;
revoke all on public.eligibility_region_policy from public, anon, authenticated;
grant all on public.eligibility_region_policy to service_role;

create table public.account_eligibility_v2 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('eligible','under_minimum','region_unavailable','revoked')),
  age_band text not null check (age_band in ('under_13','13','14','15','16_17','18_plus')),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  minimum_age integer,
  policy_version text not null,
  assessed_at timestamptz not null default now(),
  changed_at timestamptz not null default now()
);
alter table public.account_eligibility_v2 enable row level security;
revoke all on public.account_eligibility_v2 from public, anon, authenticated;
grant select on public.account_eligibility_v2 to authenticated;
grant all on public.account_eligibility_v2 to service_role;
create policy account_eligibility_v2_owner_read on public.account_eligibility_v2
  for select to authenticated using (auth.uid() = user_id);

create table public.account_processing_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  terms_version text,
  terms_accepted_at timestamptz,
  privacy_notice_version text,
  privacy_notice_seen_at timestamptz,
  ai_notice_version text,
  ai_allowed boolean not null default false,
  ai_changed_at timestamptz,
  analytics_allowed boolean not null default false check (not analytics_allowed)
);
alter table public.account_processing_permissions enable row level security;
revoke all on public.account_processing_permissions from public, anon, authenticated;
grant select on public.account_processing_permissions to authenticated;
grant all on public.account_processing_permissions to service_role;
create policy processing_permissions_owner_read on public.account_processing_permissions
  for select to authenticated using(auth.uid() = user_id);

create or replace function public.declare_global_eligibility(p_age_band text,p_country_code text)
returns text language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_user uuid := auth.uid(); v_old public.account_eligibility_v2%rowtype;
  v_legacy text; v_min integer; v_age integer; v_status text;
begin
  if v_user is null then raise exception 'eligibility_auth_required'; end if;
  if p_age_band is null or p_age_band not in ('under_13','13','14','15','16_17','18_plus')
     or p_country_code is null or p_country_code !~ '^[A-Z]{2}$' then
    raise exception 'eligibility_answer_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('eligibility:'||v_user::text,0));
  select * into v_old from public.account_eligibility_v2 where user_id=v_user for update;
  if found then
    if v_old.age_band=p_age_band and v_old.country_code=p_country_code then return v_old.status; end if;
    raise exception 'eligibility_decision_locked';
  end if;
  select status into v_legacy from public.account_age_eligibility where user_id=v_user;
  if v_legacy='revoked' or (v_legacy='under_18' and p_age_band='18_plus') then
    raise exception 'eligibility_review_required';
  end if;
  select minimum_age into v_min from public.eligibility_region_policy where country_code=p_country_code;
  v_age := case p_age_band when 'under_13' then 0 when '13' then 13 when '14' then 14 when '15' then 15 when '16_17' then 16 else 18 end;
  v_status := case when v_age<13 then 'under_minimum' when v_min is null then 'region_unavailable' when v_age<v_min then 'under_minimum' else 'eligible' end;
  insert into public.account_eligibility_v2(user_id,status,age_band,country_code,minimum_age,policy_version)
    values(v_user,v_status,p_age_band,p_country_code,v_min,'nearr-global-13-v1');
  return v_status;
end;
$$;
revoke all on function public.declare_global_eligibility(text,text) from public,anon;
grant execute on function public.declare_global_eligibility(text,text) to authenticated;

-- Permissions are separate RPCs. A privacy notice is acknowledged, not bundled
-- into consent. Optional marketing/analytics remain disabled for this release.
create or replace function public.record_global_terms(p_terms_version text)
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'consent_auth_required'; end if;
  if not exists(select 1 from public.global_release_policy where legal_approved and terms_version=p_terms_version) then
    raise exception 'terms_not_qualified';
  end if;
  insert into public.account_processing_permissions(user_id,terms_version,terms_accepted_at)
    values(auth.uid(),p_terms_version,now()) on conflict(user_id) do update
    set terms_version=excluded.terms_version,terms_accepted_at=excluded.terms_accepted_at;
end;
$$;
create or replace function public.record_global_privacy_notice(p_notice_version text)
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'consent_auth_required'; end if;
  if not exists(select 1 from public.global_release_policy where legal_approved and privacy_notice_version=p_notice_version) then raise exception 'privacy_notice_version_invalid'; end if;
  insert into public.account_processing_permissions(user_id,privacy_notice_version,privacy_notice_seen_at)
    values(auth.uid(),p_notice_version,now()) on conflict(user_id) do update
    set privacy_notice_version=excluded.privacy_notice_version,privacy_notice_seen_at=excluded.privacy_notice_seen_at;
end;
$$;
create or replace function public.set_ai_sharing_permission(p_allowed boolean,p_notice_version text)
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
begin
  if auth.uid() is null or p_allowed is null then raise exception 'consent_auth_required'; end if;
  if p_allowed and not exists(select 1 from public.global_release_policy where legal_approved and ai_notice_version=p_notice_version) then
    raise exception 'ai_notice_not_qualified';
  end if;
  -- Withdrawal is always allowed, including after a notice version changes.
  insert into public.account_processing_permissions(user_id,ai_allowed,ai_notice_version,ai_changed_at)
    values(auth.uid(),p_allowed,p_notice_version,now()) on conflict(user_id) do update
    set ai_allowed=excluded.ai_allowed,ai_notice_version=excluded.ai_notice_version,ai_changed_at=excluded.ai_changed_at;
end;
$$;
revoke all on function public.record_global_terms(text) from public,anon;
revoke all on function public.record_global_privacy_notice(text) from public,anon;
revoke all on function public.set_ai_sharing_permission(boolean,text) from public,anon;
grant execute on function public.record_global_terms(text) to authenticated;
grant execute on function public.record_global_privacy_notice(text) to authenticated;
grant execute on function public.set_ai_sharing_permission(boolean,text) to authenticated;

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
   when p.terms_version is distinct from r.terms_version or p.terms_accepted_at is null then 'terms_acceptance_required'
   when p.ai_allowed is distinct from true or p.ai_notice_version is distinct from r.ai_notice_version then 'ai_permission_required'
   when not r.recognition_qualified or r.provider_route<>'openai_only' then 'recognition_not_available'
   else 'allowed' end
 from public.global_release_policy r
 left join public.account_eligibility_v2 e on e.user_id=p_user_id
 left join public.account_age_eligibility legacy on legacy.user_id=p_user_id
 left join public.eligibility_region_policy region on region.country_code=e.country_code
 left join public.account_processing_permissions p on p.user_id=p_user_id where r.singleton;
$$;
create or replace function public.is_account_eligible_for_ai(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(public.account_ai_access_reason(p_user_id)='allowed',false);
$$;
create or replace function public.is_account_eligible_for_purchase(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select purchase_qualified from public.global_release_policy where singleton),false)
   and public.is_account_eligible_for_ai(p_user_id);
$$;
revoke all on function public.account_ai_access_reason(uuid) from public,anon,authenticated;
revoke all on function public.is_account_eligible_for_ai(uuid) from public,anon,authenticated;
revoke all on function public.is_account_eligible_for_purchase(uuid) from public,anon,authenticated;
grant execute on function public.account_ai_access_reason(uuid) to service_role;
grant execute on function public.is_account_eligible_for_ai(uuid) to service_role;
grant execute on function public.is_account_eligible_for_purchase(uuid) to service_role;

create or replace function public.get_my_global_access()
returns jsonb language sql stable security definer set search_path=public,auth,pg_temp as $$
 select jsonb_build_object('status',coalesce(e.status,'pending'),'ageBand',e.age_band,
   'countryCode',e.country_code,'minimumAge',e.minimum_age,
   'aiAllowed',public.is_account_eligible_for_ai(auth.uid()),
   'aiReason',coalesce(public.account_ai_access_reason(auth.uid()),'recognition_not_available'),
   'aiPermission',coalesce(p.ai_allowed,false),'noticeVersion',r.ai_notice_version,'privacyVersion',r.privacy_notice_version,
   'termsVersion',r.terms_version,'termsAccepted',p.terms_version=r.terms_version and p.terms_accepted_at is not null,
   'legalApproved',r.legal_approved)
 from public.global_release_policy r
 left join public.account_eligibility_v2 e on e.user_id=auth.uid()
 left join public.account_processing_permissions p on p.user_id=auth.uid() where r.singleton;
$$;
revoke all on function public.get_my_global_access() from public,anon;
grant execute on function public.get_my_global_access() to authenticated;

-- Legacy workers still call this function and contain Gemini dispatch. They
-- must remain closed even after a replacement route eventually qualifies.
create or replace function public.is_adult_eligible_for_ai(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select false; $$;

create or replace function public.guard_share_job_age_eligibility()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (tg_op='INSERT' and new.status in ('queued','awaiting_purchase','processing_metadata'))
    or (tg_op='UPDATE' and new.status in ('queued','processing_metadata')) then
   if not public.is_account_eligible_for_ai(new.user_id) then raise exception 'global_eligibility_required'; end if;
 end if;
 return new;
end; $$;
create or replace function public.guard_share_media_task_age_eligibility()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (tg_op='INSERT' and new.status in ('queued','processing')) or (tg_op='UPDATE' and new.status in ('queued','processing')) then
   if not public.is_account_eligible_for_ai(new.user_id) then raise exception 'global_eligibility_required'; end if;
 end if;
 return new;
end; $$;

-- Never overwrite a destination's restrictive decision or consent. Only a
-- completed, destination-bound transfer grants a new owner a source decision.
create or replace function public.propagate_transferred_global_eligibility()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.status<>'completed' and new.status='completed' and new.destination_user_id is not null then
   perform pg_advisory_xact_lock(hashtextextended('eligibility:'||new.destination_user_id::text,0));
   insert into public.account_eligibility_v2(user_id,status,age_band,country_code,minimum_age,policy_version,assessed_at)
     select new.destination_user_id,status,age_band,country_code,minimum_age,policy_version,assessed_at
     from public.account_eligibility_v2 where user_id=new.source_user_id on conflict(user_id) do nothing;
   -- New account must explicitly re-establish permissions; withdrawal on the
   -- destination cannot be overwritten by an older source permission.
 end if;
 return new;
end; $$;
create trigger onboarding_transfer_global_eligibility after update of status on public.onboarding_account_transfer_grants
 for each row execute function public.propagate_transferred_global_eligibility();

-- Roll back by containment (disable qualification and stop dispatch), never by
-- restoring the adult-only alias to an unrestricted provider route.
