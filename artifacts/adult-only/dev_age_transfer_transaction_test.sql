-- Nearr-Dev only. Synthetic grants/decisions around existing account IDs;
-- all writes are enclosed in one transaction and rolled back.
begin;
do $$
declare
  v_session uuid;
  v_source uuid;
  v_adult_destination uuid;
  v_restricted_destination uuid;
  v_grant uuid;
begin
  select s.id, s.anonymous_user_id into v_session, v_source
    from public.onboarding_v2_sessions s
    join auth.users u on u.id = s.anonymous_user_id
   where not exists (select 1 from public.account_age_eligibility a where a.user_id = u.id)
   order by s.created_at desc limit 1;
  if v_session is null then raise exception 'no eligible Dev session fixture'; end if;
  select u.id into v_adult_destination from auth.users u
   where u.id <> v_source
     and not exists (select 1 from public.account_age_eligibility a where a.user_id = u.id)
   order by u.created_at desc limit 1;
  select u.id into v_restricted_destination from auth.users u
   where u.id not in (v_source, v_adult_destination)
     and not exists (select 1 from public.account_age_eligibility a where a.user_id = u.id)
   order by u.created_at desc limit 1;
  if v_adult_destination is null or v_restricted_destination is null then
    raise exception 'not enough pending Dev accounts';
  end if;

  insert into public.account_age_eligibility
    (user_id,status,assessment_method,policy_version)
  values (v_source,'adult_self_declared','self_declaration','test-rolled-back');

  insert into public.onboarding_account_transfer_grants
    (onboarding_session_id,source_user_id,destination_user_id,secret_hash,expires_at)
  values (v_session,v_source,v_adult_destination,decode(replace(gen_random_uuid()::text,'-',''),'hex'),now()+interval '1 hour')
  returning id into v_grant;
  update public.onboarding_account_transfer_grants set status='completed',completed_at=now()
   where id=v_grant;
  if not public.is_adult_eligible_for_ai(v_adult_destination) then
    raise exception 'adult decision did not transfer';
  end if;
  if (select assessment_method from public.account_age_eligibility where user_id=v_adult_destination) <> 'self_declaration' then
    raise exception 'assessment method changed during transfer';
  end if;
  update public.onboarding_account_transfer_grants set status='completed' where id=v_grant;
  if (select count(*) from public.account_age_eligibility where user_id=v_adult_destination) <> 1 then
    raise exception 'retry duplicated destination decision';
  end if;

  insert into public.account_age_eligibility
    (user_id,status,assessment_method,policy_version)
  values (v_restricted_destination,'under_18','self_declaration','test-rolled-back');
  insert into public.onboarding_account_transfer_grants
    (onboarding_session_id,source_user_id,destination_user_id,secret_hash,expires_at)
  values (v_session,v_source,v_restricted_destination,decode(replace(gen_random_uuid()::text,'-',''),'hex'),now()+interval '1 hour')
  returning id into v_grant;
  update public.onboarding_account_transfer_grants set status='completed',completed_at=now()
   where id=v_grant;
  if public.is_adult_eligible_for_ai(v_restricted_destination) then
    raise exception 'restricted destination was upgraded';
  end if;
  if (select status from public.account_age_eligibility where user_id=v_restricted_destination) <> 'under_18' then
    raise exception 'restricted decision was overwritten';
  end if;
end;
$$;
rollback;
select 'anonymous transfer, idempotency, and destination restriction passed and rolled back' as result;
