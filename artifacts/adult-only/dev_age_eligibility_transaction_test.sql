-- Nearr-Dev only. Run as one API batch; every test write is rolled back.
-- The test selects existing pending Development accounts without printing IDs.
begin;

do $$
declare v_user uuid;
begin
  select u.id into v_user from auth.users u
  where not exists (select 1 from public.account_age_eligibility a where a.user_id = u.id)
  order by u.created_at desc limit 1;
  if v_user is null then raise exception 'no pending development account'; end if;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  if public.is_adult_eligible_for_ai(v_user) then raise exception 'unknown account allowed'; end if;
end;
$$;

set local role authenticated;
do $$
declare v_result text;
begin
  v_result := public.declare_age_eligibility_18_plus(true);
  if v_result <> 'adult_self_declared' then raise exception 'adult declaration failed'; end if;
  if public.declare_age_eligibility_18_plus(true) <> v_result then
    raise exception 'adult declaration was not idempotent';
  end if;
  if (select count(*) from public.account_age_eligibility where user_id = auth.uid()) <> 1 then
    raise exception 'owner read policy failed';
  end if;
  begin
    perform public.declare_age_eligibility_18_plus(false);
    raise exception 'conflicting declaration was accepted';
  exception when others then
    if sqlerrm <> 'age_decision_locked' then raise; end if;
  end;
  begin
    update public.account_age_eligibility set status = 'revoked' where user_id = auth.uid();
    raise exception 'direct client update was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.is_adult_eligible_for_ai(auth.uid());
    raise exception 'arbitrary-account eligibility RPC exposed to client';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
begin
  if not public.is_adult_eligible_for_ai(current_setting('request.jwt.claim.sub')::uuid) then
    raise exception 'adult eligibility did not persist inside transaction';
  end if;
end;
$$;

do $$
declare v_user uuid;
begin
  select u.id into v_user from auth.users u
  where u.id <> current_setting('request.jwt.claim.sub')::uuid
    and not exists (select 1 from public.account_age_eligibility a where a.user_id = u.id)
  order by u.created_at desc limit 1;
  if v_user is null then raise exception 'second pending development account unavailable'; end if;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
end;
$$;

set local role authenticated;
do $$
begin
  if public.declare_age_eligibility_18_plus(false) <> 'under_18' then
    raise exception 'underage declaration failed';
  end if;
  begin
    perform public.declare_age_eligibility_18_plus(true);
    raise exception 'underage account could self-upgrade';
  exception when others then
    if sqlerrm <> 'age_decision_locked' then raise; end if;
  end;
end;
$$;

reset role;
do $$
begin
  if public.is_adult_eligible_for_ai(current_setting('request.jwt.claim.sub')::uuid) then
    raise exception 'underage account allowed';
  end if;
end;
$$;

rollback;
select 'adult and underage transaction checks passed and rolled back' as result;
